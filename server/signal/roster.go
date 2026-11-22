package signal

import (
	"strconv"
	"unicode/utf8"

	"github.com/versatile-sh/live/server/core/room"
)

const hexDigits = "0123456789abcdef"

func jsonStringLen(s string) int {
	n := 2
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			switch {
			case c == '"' || c == '\\' || c == '\b' || c == '\f' || c == '\n' || c == '\r' || c == '\t':
				n += 2
			case c < 0x20 || c == '<' || c == '>' || c == '&':
				n += 6
			default:
				n++
			}
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		switch {
		case r == utf8.RuneError && size == 1:
			n += 3
		case r == '\u2028' || r == '\u2029':
			n += 6
		default:
			n += size
		}
		i += size
	}
	return n
}

func appendJSONString(dst []byte, s string) []byte {
	dst = append(dst, '"')
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			switch c {
			case '"', '\\':
				dst = append(dst, '\\', c)
			case '\b':
				dst = append(dst, '\\', 'b')
			case '\f':
				dst = append(dst, '\\', 'f')
			case '\n':
				dst = append(dst, '\\', 'n')
			case '\r':
				dst = append(dst, '\\', 'r')
			case '\t':
				dst = append(dst, '\\', 't')
			default:
				if c < 0x20 || c == '<' || c == '>' || c == '&' {
					dst = append(dst, '\\', 'u', '0', '0', hexDigits[c>>4], hexDigits[c&0xf])
				} else {
					dst = append(dst, c)
				}
			}
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		switch {
		case r == utf8.RuneError && size == 1:
			dst = append(dst, "\uFFFD"...)
		case r == '\u2028':
			dst = append(dst, `\u2028`...)
		case r == '\u2029':
			dst = append(dst, `\u2029`...)
		default:
			dst = append(dst, s[i:i+size]...)
		}
		i += size
	}
	return append(dst, '"')
}

func digits(v uint64) int {
	n := 1
	for v >= 10 {
		v /= 10
		n++
	}
	return n
}

func rosterText(s room.Snapshot) []byte {
	return writeRoster(s, rosterLen(s))
}

func rosterLen(s room.Snapshot) int {
	n := len(`{"t":"roster","v":`) + digits(s.Version) + len(`,"people":[`) + len(`]}`)
	for i, p := range s.Participants {
		if i > 0 {
			n++
		}
		n += len(`{"pid":`) + digits(uint64(p.ID)) + len(`,"slot":`) + digits(uint64(p.Slot)) + len(`,"name":`) + jsonStringLen(p.Name) + len(`,"state":`) + jsonStringLen(p.State.String()) + len(`,"flags":`) + digits(uint64(p.Flags)) + 1
		if p.Look != "" {
			n += len(`,"look":`) + jsonStringLen(string(p.Look))
		}
		if p.Face != "" {
			n += len(`,"face":`) + jsonStringLen(p.Face)
		}
	}
	if len(s.Gone) > 0 {
		n += len(`,"gone":[]`)
		for i, d := range s.Gone {
			if i > 0 {
				n++
			}
			n += len(`{"pid":`) + digits(uint64(d.PID)) + len(`,"reason":`) + jsonStringLen(string(d.Reason)) + 1
		}
	}
	if s.Quiet {
		n += len(`,"quiet":true`)
	}
	if s.Locked {
		n += len(`,"locked":true`)
	}
	return n
}

func writeRoster(s room.Snapshot, size int) []byte {
	frame, at := textFrameOf(size)
	w := append(frame[at:at], `{"t":"roster","v":`...)
	w = strconv.AppendUint(w, s.Version, 10)
	w = append(w, `,"people":[`...)
	for i, p := range s.Participants {
		if i > 0 {
			w = append(w, ',')
		}
		w = append(w, `{"pid":`...)
		w = strconv.AppendUint(w, uint64(p.ID), 10)
		w = append(w, `,"slot":`...)
		w = strconv.AppendUint(w, uint64(p.Slot), 10)
		w = append(w, `,"name":`...)
		w = appendJSONString(w, p.Name)
		w = append(w, `,"state":`...)
		w = appendJSONString(w, p.State.String())
		w = append(w, `,"flags":`...)
		w = strconv.AppendUint(w, uint64(p.Flags), 10)
		if p.Look != "" {
			w = append(w, `,"look":`...)
			w = appendJSONString(w, string(p.Look))
		}
		if p.Face != "" {
			w = append(w, `,"face":`...)
			w = appendJSONString(w, p.Face)
		}
		w = append(w, '}')
	}
	w = append(w, ']')
	if len(s.Gone) > 0 {
		w = append(w, `,"gone":[`...)
		for i, d := range s.Gone {
			if i > 0 {
				w = append(w, ',')
			}
			w = append(w, `{"pid":`...)
			w = strconv.AppendUint(w, uint64(d.PID), 10)
			w = append(w, `,"reason":`...)
			w = appendJSONString(w, string(d.Reason))
			w = append(w, '}')
		}
		w = append(w, ']')
	}
	if s.Quiet {
		w = append(w, `,"quiet":true`...)
	}
	if s.Locked {
		w = append(w, `,"locked":true`...)
	}
	_ = append(w, '}')
	return frame
}
