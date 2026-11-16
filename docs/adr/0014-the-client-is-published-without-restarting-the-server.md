---
status: accepted
---
# The client is published without restarting the server

Every deploy used to drop every call. Rooms, sockets and media sessions live in the memory of one process, and replacing its container ends them; the published media port also forbids starting the new container before stopping the old. The owner asked that people in a call not feel a deploy.

Most changes are to the page, not to the server. So the two are published separately.

**The client alone** (`deploy/web.sh`): the built files are copied to a directory of the host that the container sees at `/web-live`, and the server answers from there before the copy built into its image (`page.Layered`). Files are read at each request, so nothing restarts. Scripts and styles carry their content in their names: the new ones are copied first and the old ones are kept for thirty days, so a tab opened before the deploy still finds the chunks it loads later; `index.html`, which names the new ones, is copied last. People in a call keep the page they have and get the new one at their next visit. Measured with two stand-in browsers in a call across a publish (`TestPublicStay`): neither was dropped.

**The server** (`deploy/server.sh`) is replaced while calls go on, and people see the call blink:

1. The new container starts beside the old one. Two containers cannot publish the same media port, so the port alternates between 40000 and 40001 from one deploy to the next.
2. When the proxy has moved to the new container, the old one is told to stop. It writes what it knows of each room to a directory both see (`/state`): settings, the hash of the room code's verifier, bans, whether the room is muted, who is in it, each one's look and photo, and the hash of each resume secret. Never a secret itself.
3. The new server, which watches that directory, rebuilds the rooms with everyone held as reconnecting for twelve seconds, and removes the note. The old server waits for the note to be gone, so that nobody returns before their place exists, then closes every socket with code 4012.
4. Each browser does what it already does when a connection drops: it returns at once with its secret, is given its place back (same id, same role), and negotiates media again with the new server.

Measured at the signalling level by a test that moves a muted room between two servers over real sockets (`TestRoomsOutliveAServer`). A second test runs the browser's own session code against two real server processes behind one name, stops the old one with the signal a deploy sends, and finds both people back in their places, same ids, same owner, room still muted, in about 60 ms on one machine without media (`handover.live.test.ts`). On the real site the socket returns through Cloudflare and media is negotiated again, so the pause in sound and picture should be around a second or two; that was not timed in a browser.

The key that turns a visitor's address into an origin is kept in `/state` instead of being drawn at each start, so a ban holds through a deploy. This narrows ADR 0011: the key no longer dies with the process, and someone with the host's disk could test addresses against a ban. They would already hold the host.

## What it does not cover

- A room created on the new server, in the second or two of overlap, with the name of a room still on the old one: the old room is not adopted and its people are dropped. Narrow, and accepted.
- A server that dies without being told to stop hands nothing over.
- The chat a person had on screen stays in their tab; the whiteboard lives in the browsers and survives as long as one of them does.
- No pause at all would need the media in a process that deploys do not replace. Not built.
