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
)

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
	if salt, err := os.ReadFile(file); err == nil && len(salt) >= 16 {
		return salt, nil
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	return salt, os.WriteFile(file, salt, 0o600)
}

// Leave writes the rooms for the next server, whole or not at all.
func (d *Dir) Leave(rooms []presence.HandedRoom) error {
	data, err := json.Marshal(note{From: d.id, Rooms: rooms})
	if err != nil {
		return err
	}
	tmp := filepath.Join(d.path, noteName+".tmp")
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(d.path, noteName))
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
