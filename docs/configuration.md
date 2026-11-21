# Configuration

Everything is read from the environment once, at start. A value that cannot be read (a port that is not a number, a duration that is not one) stops the server with the name of the setting.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` (`0.0.0.0` in the image) | Address the HTTP and signalling listeners bind to. |
| `PORT` | `8080` (`3000` in the image) | HTTP: page, API and `/up`. |
| `SIGNAL_PORT` | `8081` (`3001` in the image) | Signalling WebSocket (`/ws`). |
| `PUBLIC_ORIGIN` | empty | Origins allowed to open the socket, comma separated. Empty allows only the request's own host. |
| `WEB_DIR` | empty (`/web` in the image) | Directory of the built client. Empty serves the API only. |
| `WEB_LIVE_DIR` | empty | A directory laid over `WEB_DIR`: files found there win, so a newer client can be served without restarting. |
| `MEDIA` | on | `off` runs without the SFU (presence and chat only). |
| `MEDIA_UDP_PORT` | `0` | One UDP port shared by all media. `0` lets each connection pick its own port. |
| `MEDIA_PUBLIC_IP` | empty | Address announced to browsers when the host is behind NAT. |
| `COUNTRY_HEADER` | empty | Request header carrying the visitor's country, set by a proxy or CDN; shown in the open rooms. |
| `ADDRESS_HEADER` | empty | Request header carrying the visitor's address, set by a trusted proxy; used to make a ban hold and in the audit trail. |
| `HANDOVER_DIR` | empty | Directory shared with the next process; rooms are handed over through it on a planned stop. |
| `AUDIT_DIR` | empty | Directory of the audit trail. Empty turns it off. |
| `AUDIT_RETENTION_DAYS` | `183` | Days of audit files kept; older ones are deleted daily. |
| `AUDIT_QUEUE` | `8192` | Audit events that may wait to be written; past it, events are dropped and counted. |
| `AUDIT_LOG_STDOUT` | empty | `1` also writes each audit event to standard output as one JSON log record (`"msg":"audit"`, the event under `event`), after it reached the file, for a log collector. The record carries the same data as the file (addresses, names, public chat text), so keep that output as restricted as the files. The files stay the record. |
| `METRICS_INTERVAL` | `1m` | How often the `metrics` log line is written (Go duration); `0` turns it off. |
| `PASS_SOURCE`, `PASS_KEY` | empty | `http(s)` base URL of a trusted guest-pass issuer and the key it expects (at least 32 characters). Without both, `GET /api/pass/{id}` does not exist. |
| `GITHUB_REPO` | empty | `owner/name` of a repository whose star count the front page shows. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | empty | OTLP/HTTP collector for traces. Empty turns tracing off. When set, the server exports spans for a guest pass taken (`live.pass.take`), a join (`live.join`), a stay (`live.stay`) and a room's life (`live.room`), continuing the W3C `traceparent` a guest pass carries; join and leave audit events and log lines get `trace_id` and `span_id`. Span attributes carry the room name and flags only, never an address, a name or chat text. The standard `OTEL_SERVICE_NAME` (default `live`), `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG` apply. |

The audit trail is read where the server runs, never over HTTP:

```sh
live audit --dir "$AUDIT_DIR" [--room SLUG] [--ip ADDRESS] [--discord-user ID] [--guild ID] [--kind KIND] [--from DAY] [--to DAY] [--json]
```

The server logs JSON to stdout; `GET /up` answers `200` while it runs.
