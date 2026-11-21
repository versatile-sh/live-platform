package audit

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/versatile-sh/live/server/port/outbound"
)

const maxLine = 4 << 20

// Filter selects events; an empty field matches everything. The client fields match the join of a participant and every event that participant caused until they left.
type Filter struct {
	Room        string
	IP          string
	DiscordUser string
	Guild       string
	Kind        outbound.AuditKind
	From        time.Time
	To          time.Time
}

func (f Filter) byClient() bool { return f.IP != "" || f.DiscordUser != "" || f.Guild != "" }

func (f Filter) matchesClient(e outbound.AuditEvent) bool {
	c := e.Client
	if c == nil {
		return false
	}
	if f.IP != "" && c.IP != f.IP {
		return false
	}
	if f.DiscordUser != "" && (c.Discord == nil || c.Discord.UserID != f.DiscordUser) {
		return false
	}
	return f.Guild == "" || (c.Discord != nil && c.Discord.GuildID == f.Guild)
}

func (f Filter) matchesEvent(e outbound.AuditEvent) bool {
	return (f.Room == "" || e.Room == f.Room) && (f.Kind == "" || e.Kind == f.Kind) && (f.From.IsZero() || !e.At.Before(f.From)) && (f.To.IsZero() || e.At.Before(f.To))
}

type seatKey struct {
	room string
	pid  uint32
}

// Scan reads the day files in order and calls emit for each event the filter selects; lines it cannot read are skipped and counted in the result.
func Scan(dir string, f Filter, emit func(outbound.AuditEvent)) (skipped int, err error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	var names []string
	for _, entry := range entries {
		if _, ok := Day(entry.Name()); ok && !entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	slices.Sort(names)
	matched := map[seatKey]bool{}
	live := map[string]int{}
	for _, name := range names {
		n, err := scanFile(filepath.Join(dir, name), f, matched, live, emit)
		skipped += n
		if err != nil {
			return skipped, err
		}
	}
	return skipped, nil
}

func scanFile(path string, f Filter, matched map[seatKey]bool, live map[string]int, emit func(outbound.AuditEvent)) (int, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64<<10), maxLine)
	skipped := 0
	for scanner.Scan() {
		var e outbound.AuditEvent
		if json.Unmarshal(scanner.Bytes(), &e) != nil {
			skipped++
			continue
		}
		if selects(f, e, matched, live) && f.matchesEvent(e) {
			emit(e)
		}
	}
	return skipped, scanner.Err()
}

func selects(f Filter, e outbound.AuditEvent, matched map[seatKey]bool, live map[string]int) bool {
	if !f.byClient() {
		return true
	}
	actor := seatKey{room: e.Room}
	if e.Actor != nil {
		actor.pid = e.Actor.PID
	}
	switch e.Kind {
	case outbound.AuditRoomCreated, outbound.AuditJoin:
		hit := f.matchesClient(e)
		if hit && !matched[actor] {
			live[e.Room]++
		}
		matched[actor] = hit
		return hit
	case outbound.AuditLeave:
		hit := matched[actor]
		if hit {
			live[e.Room]--
		}
		delete(matched, actor)
		return hit
	case outbound.AuditRoomEnded:
		hit := live[e.Room] > 0
		delete(live, e.Room)
		return hit
	}
	if matched[actor] {
		return true
	}
	return e.Target != nil && matched[seatKey{room: e.Room, pid: e.Target.PID}]
}

// WriteTimeline prints one readable line for an event.
func WriteTimeline(w io.Writer, e outbound.AuditEvent) error {
	var b strings.Builder
	fmt.Fprintf(&b, "%s  %-12s room=%s", e.At.UTC().Format("2006-01-02 15:04:05"), e.Kind, e.Room)
	if e.Private {
		b.WriteString(" (private)")
	}
	if e.Actor != nil {
		fmt.Fprintf(&b, " by=#%d %q", e.Actor.PID, e.Actor.Name)
	}
	if e.Target != nil {
		fmt.Fprintf(&b, " target=#%d %q", e.Target.PID, e.Target.Name)
	}
	if e.Op != "" {
		fmt.Fprintf(&b, " op=%s", e.Op)
	}
	if e.Reason != "" {
		fmt.Fprintf(&b, " reason=%s", e.Reason)
	}
	if e.DurationMS > 0 {
		fmt.Fprintf(&b, " duration=%s", (time.Duration(e.DurationMS) * time.Millisecond).Round(time.Second))
	}
	if c := e.Client; c != nil {
		writeClient(&b, c.IP, c.Geo.Country, c.Geo.City, c.Browser, c.OS, c.Device)
		if c.Discord != nil {
			fmt.Fprintf(&b, " discord=%s(%q) guild=%s channel=%s", c.Discord.UserID, c.Discord.UserName, c.Discord.GuildID, c.Discord.ChannelID)
		}
	}
	if len(e.Present) > 0 {
		b.WriteString(" present=")
		for i, p := range e.Present {
			if i > 0 {
				b.WriteString(",")
			}
			b.WriteString("#" + strconv.FormatUint(uint64(p.PID), 10) + ":" + strconv.Quote(p.Name))
		}
	}
	if e.Kind == outbound.AuditChat {
		fmt.Fprintf(&b, " length=%d", e.Length)
		if e.ImageBytes > 0 {
			fmt.Fprintf(&b, " image=%dB", e.ImageBytes)
		}
		if e.Text != "" {
			fmt.Fprintf(&b, " text=%q", e.Text)
		}
	}
	b.WriteString("\n")
	_, err := io.WriteString(w, b.String())
	return err
}

func writeClient(b *strings.Builder, ip, country, city, browser, system, device string) {
	if ip != "" {
		b.WriteString(" ip=" + ip)
	}
	if country != "" || city != "" {
		b.WriteString(" geo=" + strings.Trim(country+"/"+city, "/"))
	}
	if browser != "" || system != "" {
		b.WriteString(" ua=" + strings.TrimSpace(browser+" on "+system) + " " + device)
	}
}
