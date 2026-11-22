// Package handoff passes the rooms of a server that is stopping to the one taking over, through a directory both can see.
package handoff

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/versatile-sh/live/server/service/presence"
)

const (
	noteName = "handover.json"
	saltName = "salt"
	fresh    = time.Minute
	every    = 100 * time.Millisecond
	saltLen  = 16
)

var errSaltLength = errors.New("handoff: salt file is too short")

type note struct {
	From  string                `json:"from"`
	Rooms []presence.HandedRoom `json:"rooms"`
}

// Dir is the directory two servers share during a deploy.
type Dir struct {
	path string
	id   string
	now  func() time.Time
}

// Open prepares the directory and gives this server a name of its own, so that it never takes back what it left.
func Open(path string, now func() time.Time) (*Dir, error) {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return nil, err
	}
	var id [8]byte
	if _, err := rand.Read(id[:]); err != nil {
		return nil, err
	}
	return &Dir{path: path, id: hex.EncodeToString(id[:]), now: now}, nil
}

// Salt answers the secret that keys visitors' origins, the same for every server that shares the directory; it is drawn once.
func (d *Dir) Salt() ([]byte, error) {
	file := filepath.Join(d.path, saltName)
	for {
		salt, err := os.ReadFile(file)
		if err == nil {
			if len(salt) < saltLen {
				return nil, errSaltLength
			}
			return salt, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
		drawn := make([]byte, saltLen)
		if _, err := rand.Read(drawn); err != nil {
			return nil, err
		}
		tmp, err := d.stage(saltName, drawn)
		if err != nil {
			return nil, err
		}
		err = os.Link(tmp, file)
		_ = os.Remove(tmp)
		if err != nil && !errors.Is(err, os.ErrExist) {
			return nil, err
		}
		if err == nil {
			return drawn, d.syncDir()
		}
	}
}

// Leave writes the rooms for the next server, whole or not at all.
func (d *Dir) Leave(rooms []presence.HandedRoom) error {
	data, err := json.Marshal(note{From: d.id, Rooms: rooms})
	if err != nil {
		return err
	}
	tmp, err := d.stage(noteName, data)
	if err != nil {
		return err
	}
	if err := os.Rename(tmp, filepath.Join(d.path, noteName)); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return d.syncDir()
}

func (d *Dir) stage(name string, data []byte) (string, error) {
	var nonce [8]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", err
	}
	tmp := filepath.Join(d.path, name+"."+d.id+"."+hex.EncodeToString(nonce[:])+".tmp")
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return tmp, nil
}

func (d *Dir) syncDir() error {
	f, err := os.Open(d.path)
	if err != nil {
		return err
	}
	err = f.Sync()
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}

// Taken waits until another server has picked the rooms up, and reports whether one did before ctx ended.
func (d *Dir) Taken(ctx context.Context) bool {
	tick := time.NewTicker(every / 2)
	defer tick.Stop()
	for {
		if _, err := os.Stat(filepath.Join(d.path, noteName)); errors.Is(err, os.ErrNotExist) {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-tick.C:
		}
	}
}

// Watch hands adopt the rooms another server leaves, for as long as ctx lives; a note this server wrote, or one older than a minute, is never adopted.
func (d *Dir) Watch(ctx context.Context, adopt func([]presence.HandedRoom)) {
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		if rooms, ok := d.take(); ok {
			adopt(rooms)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (d *Dir) take() ([]presence.HandedRoom, bool) {
	file := filepath.Join(d.path, noteName)
	info, err := os.Stat(file)
	if err != nil {
		return nil, false
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, false
	}
	var n note
	if json.Unmarshal(data, &n) != nil {
		_ = os.Remove(file)
		return nil, false
	}
	if n.From == d.id {
		return nil, false
	}
	if os.Remove(file) != nil || d.now().Sub(info.ModTime()) > fresh {
		return nil, false
	}
	return n.Rooms, true
}
