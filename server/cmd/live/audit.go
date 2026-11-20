package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"time"

	"github.com/versatile-sh/live/server/internal/adapters/audit"
	"github.com/versatile-sh/live/server/internal/ports/outbound"
)

const auditUsage = "usage: live audit [--dir DIR] [--room SLUG] [--ip ADDRESS] [--discord-user ID] [--guild ID] [--kind KIND] [--from DATE] [--to DATE] [--json]"

// runAudit prints the audit trail as a timeline, or as JSON lines, filtered by the flags; it answers the process exit code.
func runAudit(args []string, getenv func(string) string, out, errOut io.Writer) int {
	flags := flag.NewFlagSet("audit", flag.ContinueOnError)
	flags.SetOutput(errOut)
	dir := flags.String("dir", getenv("AUDIT_DIR"), "directory of the audit trail (default $AUDIT_DIR)")
	f := audit.Filter{}
	flags.StringVar(&f.Room, "room", "", "room slug")
	flags.StringVar(&f.IP, "ip", "", "client address of a participant")
	flags.StringVar(&f.DiscordUser, "discord-user", "", "Discord user id of a participant")
	flags.StringVar(&f.Guild, "guild", "", "Discord server id a participant came from")
	kind := flags.String("kind", "", "room.created, join, leave, chat, owner or room.ended")
	from := flags.String("from", "", "first day or instant, YYYY-MM-DD or RFC 3339, UTC")
	to := flags.String("to", "", "last day (inclusive) or instant (exclusive), YYYY-MM-DD or RFC 3339, UTC")
	raw := flags.Bool("json", false, "print the events as JSON lines")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *dir == "" {
		fmt.Fprintln(errOut, "no audit directory: pass --dir or set AUDIT_DIR")
		fmt.Fprintln(errOut, auditUsage)
		return 2
	}
	var err error
	if f.From, err = instant(*from, false); err != nil {
		fmt.Fprintln(errOut, "--from:", err)
		return 2
	}
	if f.To, err = instant(*to, true); err != nil {
		fmt.Fprintln(errOut, "--to:", err)
		return 2
	}
	f.Kind = outbound.AuditKind(*kind)
	encoder := json.NewEncoder(out)
	count := 0
	skipped, err := audit.Scan(*dir, f, func(e outbound.AuditEvent) {
		count++
		if *raw {
			_ = encoder.Encode(e)
			return
		}
		_ = audit.WriteTimeline(out, e)
	})
	if err != nil {
		fmt.Fprintln(errOut, "audit:", err)
		return 1
	}
	if skipped > 0 {
		fmt.Fprintf(errOut, "skipped %d unreadable lines\n", skipped)
	}
	fmt.Fprintf(errOut, "%d events\n", count)
	return 0
}

func instant(value string, endOfDay bool) (time.Time, error) {
	if value == "" {
		return time.Time{}, nil
	}
	if day, err := time.Parse("2006-01-02", value); err == nil {
		if endOfDay {
			day = day.AddDate(0, 0, 1)
		}
		return day, nil
	}
	return time.Parse(time.RFC3339, value)
}
