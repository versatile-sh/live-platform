# Scout: security of an open-source, no-login room product

Date: 2026-11-16. Angle: security. Does not propose the final architecture.
Proof levels: read (source or doc read), specified (spec text), run (executed here). Confidence: high, medium, low. Web fetched 2026-11-16 unless noted. "bias" is the source's incentive.

## Short answer

1. An 8-character a-zA-Z0-9 random password has 47.6 bits (62^8 = 2.18e14). Online guessing is bounded by server rate limits and is not the main risk. An offline attack after a hash leak is: at an assumed 1e4 guesses/s per attacker unit it takes about 346 years per unit for half the space, so a fleet of 1000 units needs about 4 months. The 1e4/s rate is an assumption (HYPOTHESIS), not measured. A password a human chooses has far fewer bits.
2. OWASP's current minimum for Argon2id is m=19456 KiB, t=2, p=1. scrypt is N=2^17, r=8, p=1. bcrypt is legacy only (cost >= 10, 72-byte input cap). Argon2id is available in Go as `golang.org/x/crypto/argon2`; a stored room hash should carry its parameters.
3. The password must be checked server-side before any token is issued. The join token must be a random opaque value (>= 128 bits), short-lived, and bound to a room. Rate limit per room (global) and per IP. A per-room failure cap is the control that works against distributed guessing.
4. Owner without accounts means a capability: a random owner secret created with the room, shown once, stored hashed. Whoever holds it is the owner. Losing it is unrecoverable by design (owner decision needed).
5. WebSocket: Origin is the only browser-side CSWSH defence (RFC 6455 section 10.2 and library behaviour). Do not use cookies for WebSocket auth; use a token in the first message or subprotocol. Set read limits and per-connection message rate limits.
6. TURN is the highest-risk server component. coturn had 14+ advisories in 2026 (several high); Pion TURN's default PermissionHandler admits every peer IP, so relay to loopback/internal ranges must be denied by our code. Use ephemeral REST-style credentials with a short TTL.
7. React: the 2025-2026 RCE and DoS advisories affect only React Server Components packages (react-server-dom-*) and frameworks using them. A client-only Vite SPA does not use them. The Vite dev server had a critical RCE (GHSA-p4f5-76q4-ffq7, fixed 8.3.7) that needs the dev server exposed to the network; production builds are static files.
8. npm supply chain: 2025-2026 worm waves (Shai-Hulud and successors) spread through install scripts and stolen publisher tokens. Defences available now: committed lockfile, exact versions, `ignore-scripts`, `min-release-age` (npm), `minimumReleaseAge` (pnpm), few dependencies. Provenance did not stop at least one 2026 wave (secondary source).
9. Country for the lobby: Cloudflare `CF-IPCountry` is free but only exists behind Cloudflare, and the plan takes this host out of the tunnel (PR2). DB-IP Lite (CC BY 4.0, attribution link) can be redistributed with attribution; MaxMind GeoLite2 EULA restricts disclosure to third parties and demands deletion of old versions in 30 days, which conflicts with bundling in an open repository.
10. An IP address is personal data under GDPR recital 30. Listing a room's country is coarse, but the lobby must list only rooms the owner chose to make public, with no member names or IPs.

## 1. Password entropy and hashing

| Fact | Value | Evidence | Proof | Confidence |
|---|---|---|---|---|
| Random a-zA-Z0-9, length 8 | 62^8 = 218,340,105,584,896; 47.63 bits | computed with python3 here | run | high (arithmetic) |
| Case-insensitive letters+digits, length 8 | 36^8 = 2.82e12; 41.36 bits | same | run | high |
| Letters only (52), length 8 | 5.35e13; 45.6 bits | same | run | high |
| Offline cost at assumed 1e3 / 1e4 / 1e5 guesses per second, one attacker unit | half the space in about 3459 / 346 / 35 years | same; rates are assumed, not measured | HYPOTHESIS for the rates | low |
| Online guessing at 10 / 60 / 600 failures per hour per room, distributed attacker | expected about 1.2e9 / 2.1e8 / 2.1e7 years | same | run (arithmetic) | high |
| Human-chosen 8 characters | far below 47.6 bits; the number depends on user behaviour and was not measured | no source read | HYPOTHESIS | low |
| Argon2id minimum | m=19456 KiB (19 MiB), t=2, p=1; equal-strength: m=47104/t=1, m=12288/t=3, m=9216/t=4, m=7168/t=5 (p=1) | OWASP Password Storage Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html, 2026-11-16, page shows no version or date; bias: community standard body | read | high |
| scrypt minimum | N=2^17, r=8, p=1; alternatives N=2^16 p=2, 2^15 p=3, 2^14 p=5, 2^13 p=10 | same | read | high |
| bcrypt | legacy only, work factor >= 10, 72-byte input cap, enforce a max length | same | read | high |
| PBKDF2 | HMAC-SHA256 600,000 iterations (FIPS case only) | same | read | high |
| Argon2 specification | RFC 9106 | cited by the OWASP page | read | medium |
| Server cost of Argon2id at 19 MiB, t=2 | not measured; each verify uses 19 MiB RAM, so concurrent verifies must be capped (a flood of join attempts is a memory DoS) | reasoning from the parameters | HYPOTHESIS | medium |

Design consequences (no architecture proposed): a per-room attempt counter and a global semaphore on hash verifications are needed whichever hash is chosen. A server-side secret ("pepper") is optional (OWASP cites draft-ietf-kitten-password-storage-07, read via the same page). A random room password the server itself generates is stronger than a user-chosen one; this is an owner question.

## 2. Tokens, reconnect secrets, owner privilege

| Item | Finding | Evidence | Proof |
|---|---|---|---|
| Join token, reconnect secret | No spec dictates this. Needs random opaque value from crypto/rand, >= 128 bits, stored server-side or HMAC-signed, expiry, room binding. | HYPOTHESIS (engineering judgement) | none |
| Reconnect with a secret | A leaked reconnect secret equals session takeover; bind it to one participant id and rotate on each use. | HYPOTHESIS | none |
| TURN credential format | username = expiry timestamp[:user id], password = base64(HMAC(secret, username)); TTL 86400 s suggested; no revocation, rely on expiry; secret rotation with two accepted secrets. The draft is expired (2014-01-16) and has no IETF standing. | draft-uberti-behave-turn-rest-00, https://datatracker.ietf.org/doc/html/draft-uberti-behave-turn-rest-00, 2026-11-16, high; bias: single author, de facto standard | read |
| Owner without account | Owner capability secret, shown once, stored hashed, compared in constant time. Not in any source; design reasoning only. | HYPOTHESIS | none |

## 3. WebSocket, message limits, floods

| Item | Finding | Evidence | Proof |
|---|---|---|---|
| Origin handling | A server must itself check Origin; browsers do not enforce same-origin on WebSockets. Section 10.2 text itself could not be read (fetch truncated at 100k chars). | RFC 6455, https://datatracker.ietf.org/doc/html/rfc6455 sections 5.1, 5.3 read; 10.2 not read | partly read |
| coder/websocket v1.8.15 (2026-06-15, ISC, maintained, pushed 2026-11-14) | `Accept` verifies Origin by default; `OriginPatterns` lists allowed hosts; `InsecureSkipVerify` disables; default read limit 32768 bytes per message (`SetReadLimit`). | coder/websocket@v1.8.15 accept.go:30-53,116-117; read.go:88-97 (cloned and read) | read |
| gorilla/websocket v1.5.3 | last release 2024-06-14, last push 2025-03-19; one old advisory (GHSA-jf24-p9p9-4rjh, fixed 1.4.1). Maintenance state: no release in 2.4 years. | GitHub API, 2026-11-16 | read, high |
| Client masking | client MUST mask; server MUST close on an unmasked frame (5.1) | RFC 6455 5.1 | specified |
| Message size, rate | RFC sets no maximum frame size (5.2); the server must set its own. | RFC 6455 5.2 | specified |
| Slowloris, connection floods | Go `net/http.Server` has `ReadHeaderTimeout`, `ReadTimeout`, `MaxHeaderBytes`; per-IP connection caps need own code or a reverse proxy. Not tested here. | HYPOTHESIS from memory of the stdlib API; not verified this session | none |
| gnet (PR3) | Not examined by this scout (owned by another angle). Whichever stack: cap per-IP connections, header size and idle time. | n/a | none |

## 4. TURN and SFU abuse

| Item | Finding | Evidence | Proof |
|---|---|---|---|
| TURN relay to arbitrary peers | RFC 8656 requires permissions per peer IP, 5 min lifetime; section 21.2.2 "Blacklisted IP Addresses" exists but its text was not read (fetch truncated). | RFC 8656 section 3.3, TOC, https://www.rfc-editor.org/rfc/rfc8656.html | partly read |
| TURN quotas | Servers should limit allocations per username and bandwidth per allocation; default max lifetime cap 3600 s; allocate ports 49152-65535 | RFC 8656 sections 5, 7.2 | specified |
| pion/turn v5.1.3 (2026-10-24, MIT; v6.0.0-rc.1 2026-11-10 is a release candidate) | `PermissionHandler` is nil by default and then `DefaultPermissionHandler` admits all peers. Deny of loopback, link-local, RFC 1918, and the VPS's own IPs is the integrator's job. `GenerateLongTermTURNRESTCredentials` and `LongTermTURNRESTAuthHandler` exist for REST-style credentials. | pion/turn@v5.1.3 server_config.go:40-65, lt_cred.go:28,90 (cloned and read) | read |
| pion advisories | GitHub advisories for pion/turn, pion/ice, pion/webrtc: none for current majors (one old pion/webrtc 2021). OSV API query for `github.com/pion/turn/v5`, `pion/webrtc/v4`, `pion/ice/v4` returned no vulns. pion/dtls had 6 advisories published 2026-10-16 (two critical, authentication bypass and signature confusion; fixed 3.1.13 for the 3.x line; the 2.x line has no listed patched version). Check which dtls version a given pion/webrtc pulls in. | GitHub API and https://api.osv.dev, 2026-11-16 | read/run (API calls), high |
| coturn 4.19.1 (2026-11-16) | licence reported as NOASSERTION by GitHub API (the repository ships BSD-style licence text; not read by this scout, so unconfirmed). 14 advisories listed 2026-06 to 2026-08, high ones: MOBILITY-TICKET takeover (fixed 4.15.0), ACME redirect heap disclosure (4.15.0), DTLS cookie state exhaustion (4.16.0), format-string via hiredis (4.13.0), IPv4-mapped 127.0.0.1 bypass of loopback protection (4.13.0), peer-IP ACL bypass (4.13.1 and 4.16.0 for IPv6). All fixed in <= 4.17.0. Practical lesson: the peer ACL has been bypassed twice. | https://github.com/coturn/coturn/security/advisories and GitHub API, 2026-11-16 | read, high |
| livekit v1.13.11 (2026-10-25, Apache-2.0) | no published GitHub advisories via API; OSV query for livekit-server returned none. SFU abuse specifics (publish permission, bandwidth) are not verified from source by this scout. | GitHub API, OSV | read (metadata only) |
| SFU bandwidth amplification, unauthorised publish | One publisher forwarded to N subscribers multiplies egress by N; needs publish permission in the join token and per-publisher bitrate caps. | HYPOTHESIS (reasoning) | none |
| IP exposure | P2P/mesh reveals every participant's IP (and ICE candidates incl. local addresses) to every other participant. SFU or TURN relay-only hides peer IPs from peers but exposes them to the server. | HYPOTHESIS from WebRTC design; W3C WebRTC spec not read for this | none |

## 5. End-to-end encryption options

| Item | Finding | Evidence | Proof |
|---|---|---|---|
| SFrame RFC 9605 | Standards Track, August 2024. Per-frame overhead assumed 22 bytes (1 config + 2 KID + 3 CTR + 16 tag); suites incl. AES_128_GCM_SHA256_128 and AES_256_GCM_SHA512_128; short-tag CTR suites exist and raise forgery risk. Key management is out of scope (sender keys 5.1 or MLS 5.2 are examples). Header (KID, CTR) is not confidential. Any key holder can impersonate another sender. SFU can still route by RTP headers (6.1). | https://www.rfc-editor.org/rfc/rfc9605.html (read to char 100000 of 113637), 2026-11-16, high; bias: IETF | specified |
| Insertable Streams / RTCRtpScriptTransform browser support and cost | Not verified: the web.dev page returned 404 and no replacement was fetched. | none | not found |
| Cost to this product | E2EE needs a key distribution scheme with no accounts. Without accounts, the server (or room password) would be the trust root, so E2EE against a malicious server is not available by default. Also it breaks server-side transcription (PR5) because the server only sees ciphertext. | HYPOTHESIS (reasoning) | none |

## 6. Headers, XSS

| Item | Finding | Evidence | Proof |
|---|---|---|---|
| CSP, other headers | Not researched from primary sources in this pass (time-boxed). Needed set to check: CSP with no `unsafe-inline` scripts, `connect-src` limited to the WSS host, `frame-ancestors`, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy` for camera/mic/display-capture. | HYPOTHESIS | none |
| XSS in chat and display names | React escapes text children by default; risk comes from `dangerouslySetInnerHTML`, link rendering (`javascript:` URLs), markdown. Server should length-limit and strip control and bidi override characters. Not verified against react.dev in this pass. | HYPOTHESIS | none |

## 7. Lobby and country

| Item | Finding | Evidence | Proof |
|---|---|---|---|
| Cloudflare `CF-IPCountry` | ISO-3166-1 alpha-2; `XX` unknown, `T1` Tor; not added by default, needs the "Add visitor location headers" Managed Transform. Only exists when traffic goes through Cloudflare. PR2 removes the host from the tunnel, so the header disappears for this host unless proxied. Spoofable if the origin is reachable directly. | https://developers.cloudflare.com/fundamentals/reference/http-headers/, 2026-11-16, high; bias: vendor | read |
| DB-IP Lite | CC BY 4.0; credit DB-IP.com, and web apps must link back (`<a href='https://db-ip.com'>IP Geolocation by DB-IP</a>`); country, city, ASN in CSV and MMDB; monthly updates; "reduced coverage and accuracy". Redistribution is not separately addressed on the page; CC BY 4.0 itself allows it with attribution. OK for an open-source, hosted project, with the attribution link in the UI. | https://db-ip.com/db/lite.php, 2026-11-16, high; bias: vendor | read |
| MaxMind GeoLite2 | EULA updated 2026-02-12: must attribute; must destroy old versions within 30 days of an update (6.3); must not disclose the Services to a third party without notifying MaxMind and passing on equal obligations (6.1). The EULA page did not mention an account or licence key (the download page, which I could not fetch, historically requires one). Bundling the database in a public repo conflicts with 6.1 and 6.3. Self-hosters would need their own MaxMind account. Conclusion: not usable in the repo; usable only as a user-supplied optional file. | https://www.maxmind.com/en/geolite2/eula, 2026-11-16, medium (summary by fetch tool, not the full text); bias: vendor | read |
| What to derive | Country of the room's creator at creation time, not of all members, stored as a 2-letter code; the IP is not stored. | HYPOTHESIS | none |
| Privacy law | GDPR recital 30: IP addresses are online identifiers that can identify persons when combined with other data. https://gdpr-info.eu/recitals/no-30/, 2026-11-16, medium; bias: non-official mirror. LGPD not fetched. Room country plus room name can identify a small group; listing is opt-in by the owner. A legal basis, retention period, and a privacy notice are needed; this is not legal advice. | read (GDPR), not found (LGPD text) |
| Public-lobby DoS | Listing endpoint needs caching, pagination cap, and a creation rate limit per IP; room-slug enumeration is blocked only by unguessable slugs for private rooms (>= 64 bits random). | HYPOTHESIS | none |

## 8. Frontend supply chain

| Item | Finding | Evidence | Proof |
|---|---|---|---|
| React latest | v19.3.1 (2026-10-14), MIT, maintained. | GitHub API, 2026-11-16, high | read |
| CVE-2025-55182 (React2Shell) | Critical CVSS 10, unauthenticated RCE, published 2025-12-03; deserialization (CWE-502). Affects `react-server-dom-webpack`, `-parcel`, `-turbopack` 19.0.0, 19.1.0-19.1.1, 19.2.0; fixed 19.0.1, 19.1.2, 19.2.1. Frameworks: next, react-router, waku, @parcel/rsc, @vitejs/plugin-rsc, rwsdk. "If your app's React code does not use a server, your app is not affected." | https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components and GHSA-fv66-9v8q-g76r, 2026-11-16, high; bias: vendor | read |
| Later React advisories | DoS: CVE-2025-55184, CVE-2025-67779 (2025-12), CVE-2026-23864 (2026-01), CVE-2026-23869 (2026-04), CVE-2026-23870 (2026-05), CVE-2026-44907 (2026-07), GHSA-h3gv-c5rc-p453 (2026-10-14). Source exposure CVE-2025-55183. A second RCE, GHSA-xqc2-xf4c-x3h3 / CVE-2026-126187 (critical, 2026-10-14, typed arrays), affects the same three react-server-dom packages in 19.0.0-19.0.8, 19.1.0-19.1.9, 19.2.0-19.2.8, 19.3.0; fixed 19.0.9, 19.1.10, 19.2.9, 19.3.1. Same statement of non-impact for apps without a server. | GitHub API security-advisories for facebook/react, 2026-11-16, high | read |
| Client-only Vite SPA affected? | No by the vendor statement above, provided no RSC-capable plugin (`@vitejs/plugin-rsc`) or framework is installed. The client bundle imports `react` and `react-dom`, not `react-server-dom-*`. Not run: no build was inspected. | react.dev, advisory text | read |
| Vite latest | 8.3.8 (2026-11-11), MIT. Critical GHSA-p4f5-76q4-ffq7 (2026-11-10): RCE through `__vite-browser-external` on the dev server; only when the dev server is exposed with `--host`; affects 8.3.0-8.3.6; fixed 8.3.7. Other 2026 advisories are dev-server file-read bypasses (`server.fs.deny`). All are dev-server issues, not in the built static output. | GitHub API and advisory text, 2026-11-16, high | read |
| Next.js | 16.4.6 (2026-11-09), MIT. 2026 advisories include critical RCEs (next/og, `use cache`, Image Optimization API with SVG) and many cache/SSRF issues; latest batch fixed in 16.4.5 (2026-11-03). Not needed by a client-only SPA (an argument against adopting it, F6 only requires React). | GitHub API, 2026-11-16, high | read |
| Shai-Hulud 2.0 | Late Nov 2025; preinstall-script execution, Bun runtime for payload, stolen npm tokens used to republish maintainers' packages; 600-800+ packages (sources disagree: Check Point, Wiz, Snyk, Unit 42 via search results). | web search results only (titles/snippets), 2026-11-16, medium; bias: security vendors selling detection | read (secondary) |
| 2026 waves | Reported by secondary sources: @antv wave 2026-05-19 (323 packages, 637 versions in 39 minutes, valid provenance because published from legitimate CI); an August 2026 wave tied to a compromised Keyv maintainer account (counts disagree: 434 vs 1,300+ packages). I did not open the primary reports. | search snippets only, low-medium; bias: vendors/news | read (secondary) |
| npm `min-release-age` | Config exists; default null; value in days; `min-release-age-exclude` lists exceptions; `before` takes precedence if both set. Introduction version stated only by secondary source as npm 11.10.0. | https://docs.npmjs.com/cli/v11/using-npm/config, 2026-11-16, high | read |
| npm `ignore-scripts`, `allow-git`, `save-exact` | `ignore-scripts` default false; `allow-git` default "all" (set "none"); `save-exact` default false. | same page | read |
| pnpm | v12.21.0 (2026-11-13), MIT. Has `minimumReleaseAge`, `minimumReleaseAgeExclude`, `trustPolicy`, `strictDepBuilds`, `allowBuilds`; defaults and units not read (settings page only lists names). | https://pnpm.io/settings, GitHub API | read (names only) |
| Provenance | Does not prove a package is benign: a 2026 wave reportedly carried valid provenance (secondary source). | search snippet, low | read (secondary) |
| Defence list | committed lockfile + `npm ci`; exact versions; `ignore-scripts=true` (allow-list builds that need it); cooldown 7 days; `allow-git=none`; few direct dependencies, reviewed on add; CI with no publish tokens and read-only permissions; `npm audit signatures` and OSV scan in CI. Effectiveness of each was not measured. | HYPOTHESIS for the combination; individual settings read above | partly read |

## 9. Go side

| Item | Finding | Evidence | Proof |
|---|---|---|---|
| Go versions | 1.27.4 and 1.26.11 (both 2026-11-10); 1.25 unsupported; support = two latest majors. 1.27.4 and 1.26.11 fix security issues in net/http, cgo, go command, compiler, linker; 1.27.2 (2026-10-08) in crypto/tls, net/http, html/template; 1.27.3 in crypto/x509. The standard library is therefore a moving target; pin the toolchain and rebuild on each minor. | https://go.dev/doc/devel/release, 2026-11-16, high; bias: vendor | read |
| govulncheck | golang/vuln releases: v1.1.4 (2025-01-13) latest release tag, repo pushed 2026-10-11, BSD-3-Clause. Not run against this repo (no code yet). Use `govulncheck ./...` in CI, plus the `toolchain` line in go.mod. | GitHub API | read |
| Libraries named | pion/turn v5.1.3 (2026-10-24, MIT), pion/webrtc v4.2.26 (2026-10-28, MIT; v5.0.0-rc.3 2026-11-10 is a pre-release), pion/ice v4.4.9 (2026-11-09, MIT), pion/dtls v4.0.2 (2026-11-12, MIT), coder/websocket v1.8.15 (2026-06-15, ISC), livekit v1.13.11 (2026-10-25, Apache-2.0), coturn 4.19.1 (2026-11-16, licence not confirmed). All allow open-source redistribution and hosting (MIT, ISC, Apache-2.0 are permissive); coturn BSD-style claim unverified. | GitHub API releases and licences, 2026-11-16, high | read |

## Looked for and not found

- A primary-source list of CSP and security headers for a WebRTC app: not fetched.
- Browser support and cost data for RTCRtpScriptTransform and Insertable Streams: web.dev URL returned 404; no substitute read.
- RFC 6455 section 10.2 and RFC 8656 section 21 body text: pages truncated at 100k chars; sections not read.
- Primary reports (npm, GitHub, vendor posts) for the 2026 npm waves: only search snippets seen.
- pnpm `minimumReleaseAge` default and unit: settings page lists names only.
- MaxMind GeoLite2 account and licence-key requirement from the download page: not fetched.
- LGPD text and ANPD guidance on IP addresses: not fetched.
- Measured Argon2id hash time on the VPS, and a measured GPU guess rate: not run.
- Any pion/livekit published advisory affecting current releases: none found (GitHub API and OSV), which is absence of reports, not proof of absence of bugs.
- gnet's HTTP/TLS/WebSocket support (PR3): outside this angle.

## Questions only the owner can answer

1. Is the room password chosen by the owner or generated by the server? (A generated 8-character a-zA-Z0-9 value has 47.6 bits; a chosen one has much less.)
2. Is losing the owner secret acceptable (room cannot be moderated again), or is there a recovery path such as an email? (Email would add personal data.)
3. Is a malicious server in the threat model? If yes, E2EE (SFrame) is required and server-side transcription is excluded for those rooms.
4. Must rooms be unlisted by default, with the lobby strictly opt-in?
5. May the project depend on DB-IP Lite with a visible attribution link, or is a second source (self-hoster supplies a file) wanted? Is the host staying behind Cloudflare at all?
6. What legal jurisdiction and operator entity apply (EU GDPR, Brazil LGPD, both), and who writes the privacy notice?
7. Acceptable per-room and per-IP limits (failed joins per hour, rooms created per hour), and whether a wrong-password lockout may be used to deny service to the owner's guests.
8. May dependencies be frozen with a 7-day cooldown, accepting delayed security patches (an emergency override exists per package)?
