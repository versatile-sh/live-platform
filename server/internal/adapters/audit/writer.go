// Package audit keeps the append-only audit trail as one JSON line per event in a file per UTC day, written off the signalling path.
package audit

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	"github.com/versatile-sh/live/server/internal/ports/outbound"
)

const (
	dayLayout    = "2006-01-02"
	filePrefix   = "audit-"
	fileSuffix   = ".jsonl"
	syncEvery    = 5 * time.Second
	errorEvery   = 30 * time.Second
	dirMode      = 0o700
	fileMode     = 0o600
	defaultQueue = 8192
)

// FileName is the name of the file that holds the events of the UTC day containing t.
func FileName(t time.Time) string { return filePrefix + t.UTC().Format(dayLayout) + fileSuffix }

// Day reads the UTC day a file name stands for, or reports false for a name that is not an audit file.
func Day(name string) (time.Time, bool) {
	if len(name) != len(filePrefix)+len(dayLayout)+len(fileSuffix) || name[:len(filePrefix)] != filePrefix || name[len(name)-len(fileSuffix):] != fileSuffix {
		return time.Time{}, false
	}
	day, err := time.Parse(dayLayout, name[len(filePrefix):len(name)-len(fileSuffix)])
	return day, err == nil
}

// Config says where the trail lives and how many events may wait to be written.
type Config struct {
	Dir   string
	Queue int
	Log   *slog.Logger
}

// Writer appends events from a buffered queue on its own goroutine; a full queue drops the event and counts it, so the signalling path never waits.
type Writer struct {
	dir     string
	log     *slog.Logger
	queue   chan outbound.AuditEvent
	stop    chan struct{}
	done    chan struct{}
	stopped atomic.Bool
	written atomic.Uint64
	dropped atomic.Uint64
	failed  atomic.Uint64
}

// Open creates the directory with owner-only access and starts the writer.
func Open(cfg Config) (*Writer, error) {
	if cfg.Dir == "" {
		return nil, errors.New("audit directory is empty")
	}
	if err := os.MkdirAll(cfg.Dir, dirMode); err != nil {
		return nil, fmt.Errorf("audit directory: %w", err)
	}
	if cfg.Queue <= 0 {
		cfg.Queue = defaultQueue
	}
	if cfg.Log == nil {
		cfg.Log = slog.New(slog.DiscardHandler)
	}
	w := &Writer{dir: cfg.Dir, log: cfg.Log, queue: make(chan outbound.AuditEvent, cfg.Queue), stop: make(chan struct{}), done: make(chan struct{})}
	go w.run()
	return w, nil
}

// Record queues the event; it never blocks, and an event that finds the queue full or the writer closed is dropped and counted. A private room's text is removed here as well.
func (w *Writer) Record(e outbound.AuditEvent) {
	if e.Private {
		e.Text = ""
	}
	if w.stopped.Load() {
		w.dropped.Add(1)
		return
	}
	select {
	case w.queue <- e:
	default:
		w.dropped.Add(1)
	}
}

// Depth is how many events wait to be written.
func (w *Writer) Depth() int { return len(w.queue) }

// Written is how many events reached the file.
func (w *Writer) Written() uint64 { return w.written.Load() }

// Dropped is how many events were lost because the queue was full or the writer closed.
func (w *Writer) Dropped() uint64 { return w.dropped.Load() }

// Failed is how many events could not be written to disk.
func (w *Writer) Failed() uint64 { return w.failed.Load() }

// Close stops accepting events, writes what is queued and closes the file, or gives up when ctx ends.
func (w *Writer) Close(ctx context.Context) error {
	if w.stopped.CompareAndSwap(false, true) {
		close(w.stop)
	}
	select {
	case <-w.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

type sink struct {
	dir  string
	day  string
	file *os.File
	out  *bufio.Writer
}

func (s *sink) write(e outbound.AuditEvent) error {
	day := e.At.UTC().Format(dayLayout)
	if s.file == nil || day != s.day {
		if err := s.rotate(e.At, day); err != nil {
			return err
		}
	}
	line, err := json.Marshal(e)
	if err != nil {
		return err
	}
	line = append(line, '\n')
	if s.out.Available() < len(line) {
		if err := s.out.Flush(); err != nil {
			return err
		}
	}
	_, err = s.out.Write(line)
	return err
}

func (s *sink) rotate(at time.Time, day string) error {
	if err := s.close(); err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(s.dir, FileName(at)), os.O_APPEND|os.O_CREATE|os.O_WRONLY, fileMode)
	if err != nil {
		return err
	}
	s.file, s.day, s.out = file, day, bufio.NewWriterSize(file, 64<<10)
	return nil
}

func (s *sink) flush() error {
	if s.out == nil {
		return nil
	}
	return s.out.Flush()
}

func (s *sink) sync() error {
	if err := s.flush(); err != nil || s.file == nil {
		return err
	}
	return s.file.Sync()
}

func (s *sink) close() error {
	if s.file == nil {
		return nil
	}
	err := errors.Join(s.sync(), s.file.Close())
	s.file, s.out = nil, nil
	return err
}

func (w *Writer) run() {
	defer close(w.done)
	s := &sink{dir: w.dir}
	tick := time.NewTicker(syncEvery)
	defer tick.Stop()
	var lastReport time.Time
	report := func(err error) {
		w.failed.Add(1)
		if now := time.Now(); now.Sub(lastReport) >= errorEvery {
			lastReport = now
			w.log.Error("audit write failed", "error", err.Error())
		}
	}
	handle := func(e outbound.AuditEvent) {
		if err := s.write(e); err != nil {
			report(err)
			return
		}
		w.written.Add(1)
		if len(w.queue) == 0 {
			if err := s.flush(); err != nil {
				report(err)
			}
		}
	}
	for {
		select {
		case e := <-w.queue:
			handle(e)
		case <-tick.C:
			if err := s.sync(); err != nil {
				report(err)
			}
		case <-w.stop:
			for {
				select {
				case e := <-w.queue:
					handle(e)
				default:
					if err := s.close(); err != nil {
						report(err)
					}
					return
				}
			}
		}
	}
}
