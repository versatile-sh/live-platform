#!/bin/bash
# S3 commands as run on 2026-11-16 (Go 1.27.3, govulncheck v1.9.0, DB updated 2026-11-11). Work dir: a scratch dir, deleted afterwards.
git clone https://github.com/livekit/dtls.git livekit-dtls
git clone https://github.com/pion/dtls.git pion-dtls
git clone --depth 1 --branch v1.13.11 https://github.com/livekit/livekit.git livekit
grep -n "dtls\|pion" livekit/go.mod                      # replace github.com/pion/dtls/v3 => github.com/livekit/dtls/v3 v3.1.5-warp.3
gh api '/repos/pion/dtls/security-advisories?per_page=50' > repo-adv.json   # advisory text, fix commits, patched versions
(cd livekit-dtls && git checkout v3.1.5-warp.3 && git diff --stat v3.1.5 v3.1.5-warp.3)   # warp.3 = pion v3.1.5 + 10 files
(cd livekit-dtls && for f in crypto.go handshake_cache.go; do git diff --quiet v3.1.5 v3.1.5-warp.3 -- $f && echo "$f identical to v3.1.5"; done)
(cd livekit && go build -o livekit-server ./cmd/server)
GOBIN=$PWD/bin go install golang.org/x/vuln/cmd/govulncheck@latest
(cd livekit && ../bin/govulncheck -show verbose ./...) ; ../bin/govulncheck -mode=binary livekit-server
curl -s https://vuln.go.dev/index/modules.json | jq -c '.[]|select(.path|test("pion/dtls|livekit/dtls"))'
