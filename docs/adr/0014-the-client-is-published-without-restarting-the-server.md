---
status: accepted
---
# The client is published without restarting the server

Every deploy used to drop every call. Rooms, sockets and media sessions live in the memory of one process, and replacing its container ends them; the published media port also forbids starting the new container before stopping the old. The owner asked that people in a call not feel a deploy.

Most changes are to the page, not to the server. So the two are published separately.

**The client alone** (`deploy/web.sh`): the built files are copied to a directory of the host that the container sees at `/web-live`, and the server answers from there before the copy built into its image (`page.Layered`). Files are read at each request, so nothing restarts. Scripts and styles carry their content in their names: the new ones are copied first and the old ones are kept for thirty days, so a tab opened before the deploy still finds the chunks it loads later; `index.html`, which names the new ones, is copied last. People in a call keep the page they have and get the new one at their next visit. Measured with two stand-in browsers in a call across a publish (`TestPublicStay`): neither was dropped.

**The server** (`deploy/server.sh`) still interrupts: maintenance page, stop, start. It is needed only when Go code, the image or the deploy configuration changes, and should be done when the rooms are empty.

## What is still missing for a server deploy nobody feels

Decided in outline, not built:

1. The old server writes what it knows of each room when told to stop (settings, the verifier's hash, bans, who is in it and the hash of each resume secret) and closes the sockets with a code that means "come straight back".
2. The new server adopts that and holds each place for the seconds it takes a browser to return with its secret; the browser's existing resume path seats it again and media is negotiated anew.
3. The two containers overlap on alternating media ports, so the new one is healthy before the old one lets go.

That leaves a pause of a second or two in sound and picture, not a dropped call. A deploy with no pause at all would need the media to live in a process that deploys do not replace, which is a larger change than this product has earned yet.
