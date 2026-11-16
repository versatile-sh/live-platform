package page

import "io/fs"

type layered struct{ over, under fs.FS }

// Layered answers a file from over when it is there and from under otherwise, so a newer client can be laid over the one built into the image without restarting the server.
func Layered(over, under fs.FS) fs.FS { return layered{over: over, under: under} }

// Open looks in the upper layer first.
func (l layered) Open(name string) (fs.File, error) {
	if file, err := l.over.Open(name); err == nil {
		return file, nil
	}
	return l.under.Open(name)
}
