package signal

import (
	"context"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/gobwas/ws"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/guestpass"
	"github.com/versatile-sh/live/server/port/outbound"
	"github.com/versatile-sh/live/server/service/presence"
)

type recorder struct {
	mu     sync.Mutex
	events []outbound.AuditEvent
}

func (r *recorder) Record(e outbound.AuditEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, e)
}

func (r *recorder) joins() []outbound.AuditEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []outbound.AuditEvent
	for _, e := range r.events {
		if e.Kind == outbound.AuditJoin {
			out = append(out, e)
		}
	}
	return out
}

func auditedServer(t *testing.T) (string, *recorder, *guestpass.Ledger) {
	t.Helper()
	roomCfg := room.Config{Capacity: 10, ConnectTimeout: time.Second, Grace: 150 * time.Millisecond, UnhealthyCap: 300 * time.Millisecond, EmptyRelease: 200 * time.Millisecond, PasswordTries: 10, PasswordWindow: time.Minute}
	hub := presence.NewHub(roomCfg, presence.Liveness{UnstableAfter: time.Second, SuspectAfter: 2 * time.Second}, time.Now)
	rec := &recorder{}
	hub.UseAudit(rec)
	ledger := guestpass.NewLedger(time.Now)
	srv := NewServer(presence.WithoutMedia{Hub: hub}, DefaultConfig(nil, time.Now))
	srv.UsePasses(ledger)
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := probe.Addr().String()
	require.NoError(t, probe.Close())
	go func() { _ = srv.Run(addr) }()
	<-srv.Ready()
	t.Cleanup(func() {
		ctx, stop := context.WithTimeout(context.Background(), 2*time.Second)
		defer stop()
		_ = srv.Stop(ctx)
	})
	return "ws://" + addr + path, rec, ledger
}

func dialWith(t *testing.T, url string, header http.Header) *client {
	t.Helper()
	conn, _, _, err := ws.Dialer{Protocols: []string{Subprotocol}, Header: ws.HandshakeHeaderHTTP(header)}.Dial(context.Background(), url)
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	return &client{t: t, conn: conn}
}

func TestJoinIsAuditedWithWhatTheHeadersSay(t *testing.T) {
	url, rec, _ := auditedServer(t)
	dialWith(t, url, http.Header{
		"Cf-Connecting-Ip": {"203.0.113.7"}, "Cf-Ipcountry": {"BR"}, "Cf-Ipcity": {"Recife"}, "Cf-Timezone": {"America/Recife"},
		"User-Agent": {"Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"}, "Accept-Language": {"pt-BR"},
	}).join("ana")
	dial(t, url).join("bia")
	joins := rec.joins()
	require.Len(t, joins, 2)
	c := joins[0].Client
	require.NotNil(t, c)
	assert.Equal(t, "203.0.113.7", c.IP)
	assert.Equal(t, "BR", c.Geo.Country)
	assert.Equal(t, "Recife", c.Geo.City)
	assert.Equal(t, "Firefox 140", c.Browser)
	assert.Equal(t, "pt-BR", c.AcceptLanguage)
	assert.Nil(t, c.Discord)
	assert.Empty(t, joins[0].Present)
	assert.Equal(t, []outbound.AuditPerson{{PID: joins[0].Actor.PID, Name: "ana"}}, joins[1].Present)
	assert.Equal(t, "127.0.0.1", joins[1].Client.IP, "no Cloudflare header falls back to the socket address")
}

func TestOnlyTheServersOwnLedgerNamesTheDiscordOrigin(t *testing.T) {
	url, rec, ledger := auditedServer(t)
	ledger.Remember("pass-for-bk-0000000", outbound.PassRecord{Slug: "bk", Discord: room.Discord{UserID: "42", UserName: "ana", GuildID: "7", ChannelID: "9"}})
	ledger.Remember("pass-for-other-0000", outbound.PassRecord{Slug: "other", Discord: room.Discord{UserID: "43"}})

	forged := dial(t, url)
	forged.send(`{"t":"join","slug":"bk","name":"fake","discord":{"user_id":"1"},"discordUserId":"1","pass":"made-up-pass-id-0000"}`)
	_, err := forged.next()
	require.NoError(t, err)
	wrongRoom := dial(t, url)
	wrongRoom.send(`{"t":"join","slug":"bk","name":"wrong","pass":"pass-for-other-0000"}`)
	_, err = wrongRoom.next()
	require.NoError(t, err)
	genuine := dial(t, url)
	genuine.send(`{"t":"join","slug":"bk","name":"ana","pass":"pass-for-bk-0000000"}`)
	_, err = genuine.next()
	require.NoError(t, err)

	joins := rec.joins()
	require.Len(t, joins, 3)
	assert.Nil(t, joins[0].Client.Discord)
	assert.Nil(t, joins[1].Client.Discord)
	require.NotNil(t, joins[2].Client.Discord)
	assert.Equal(t, room.Discord{UserID: "42", UserName: "ana", GuildID: "7", ChannelID: "9"}, *joins[2].Client.Discord)
	_, again := ledger.Recall("pass-for-bk-0000000")
	assert.False(t, again, "a pass that let someone in is spent")
	_, kept := ledger.Recall("pass-for-other-0000")
	assert.True(t, kept, "a pass used for the wrong room stays")
}
