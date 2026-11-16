# live.versatile.sh

Rooms where people share a screen, voice and camera from a link, with no account.

## Language

**Room**:
A place identified by a slug where participants meet. It exists from creation until it is closed or expires.
_Avoid_: call, meeting, channel

**Public room**:
A room listed in the lobby that anyone may enter. Its media is encrypted in transit only.

**Private room**:
A room entered with a password. Its media is end-to-end encrypted with a key derived from that password in the browser.
_Avoid_: locked room, secret room

**Lobby**:
The list of public rooms, each with the country its owner chose.
_Avoid_: waiting room (that is the admission queue)

**Participant**:
One browser tab present in a room. The server alone decides who is a participant.
_Avoid_: user, peer, member, client

**Owner**:
The participant who holds the room's owner secret and may admit, remove, transfer or close.
_Avoid_: host, admin

**Ghost**:
A participant shown to others after their browser can no longer take part. The product's first floor is that none outlives the removal bound.

**Reconnecting**:
The labelled state of a participant whose connection is suspected lost, during the grace before removal. Not a ghost.

**Removal bound**:
The published maximum time between a participant vanishing and leaving everyone's view.

**Forwarding on demand**:
The server sends a participant only the tracks their page is showing.

**Egress budget**:
The operator's ceiling on media the server may send; joins are refused above it.
