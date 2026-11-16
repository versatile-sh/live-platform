---
status: accepted
---
# A room is claimed by its slug and released 30 seconds after it empties

There are no accounts, so nothing can own a slug over time. Whoever opens a free slug names the room, configures it if they wish and becomes its owner; 30 seconds after the last participant leaves, the room and everything about it cease to exist and the slug is free again. The owner chose this over a reservation window: no slug is held unused, and no old password outlives its room.

- Room configuration (slug, kind, password verifier, country, hashed owner secret) is kept in a small file so that a restart does not release occupied rooms. Media, chat and names never reach the disk.
- Whether a room shows in the open rooms is the owner's switch, independent of whether it asks for a room code (owner decision of 2026-11-16, replacing "a private room is never listed"). A listed private room shows with a lock and asks for the code at its doorway.
- The lobby country is detected for the owner at creation and cannot be edited. Only the country code is kept. It is read from the header the proxy sets (`CF-IPCountry` behind Cloudflare, ADR 0004); a deployment with no such header shows no country until a local database lookup is added.
- Defaults: 10 participants per room and an egress budget of 500 Mbps, both configuration.

## Consequences

A slug means nothing between two meetings: a stranger may take `/bk` after the room is released. The page must make clear, on entry, whether a room was just created by the visitor or already existed.
