# live.versatile.sh

Rooms where people share a screen, voice and camera from a link, with no account.

## Language

**Room**:
A place identified by a slug where participants meet. It exists from creation until it is closed or expires.
_Avoid_: call, meeting, channel

**Slug**:
The name a person chooses for a room, which is also its address. A slug is free whenever its room does not exist.
_Avoid_: room id, room code

**Public room**:
A room anyone with the link may enter. Its media is encrypted in transit only.
_Avoid_: open room

**Private room**:
A room that asks for its room code. Its media is end-to-end encrypted with a key derived from that code in the browser.
_Avoid_: locked room, secret room

**Room code**:
The password of a private room: eight capitals and digits in two groups, drawn in the browser.
_Avoid_: password, PIN

**Listed room**:
A room whose owner chose to show it in the open rooms, public or private.

**Open rooms**:
The list and the map of listed rooms, each with the country detected for its owner.
_Avoid_: lobby (the word in code and URLs), waiting room

**Doorway**:
What a room asks before letting someone in: a name, and the room code if it is private.

**Look**:
How a participant appears when no camera shows them: the characters of a face, a colour, a tilt, or a photo kept only while they are in the room.

**Guest pass**:
A one-use ticket a trusted inviter (the Discord bot) prepares for one visit: a name, a photo and the access of the room to create. The link carries only its id (`?pass=`); the page takes it once from the server, which takes it from the inviter on the private network.
_Avoid_: token, login, account

**Invitation link**:
A room link, with a guest pass or a room code after `#`. A free room opened from a link starts unlisted; one with a code is created private with that code.

**Release**:
The moment a room that stayed empty ceases to exist and its slug becomes free.

**Participant**:
One browser tab present in a room. The server alone decides who is a participant.
_Avoid_: user, peer, member, client

**Owner**:
The participant who holds the room's owner secret and may admit, remove, transfer or close.
_Avoid_: host, admin

**Ghost**:
A participant shown to others after their browser can no longer take part. The product's first floor is that none outlives the removal bound.

**Unstable**:
The labelled state of a participant whose first liveness signal was missed. Shown to the others and to the participant at once.

**Reconnecting**:
The labelled state of a participant whose connection is suspected lost, during the grace before removal. Not a ghost.

**Transcript**:
The record of who said what and when, built from each participant transcribing their own microphone in their browser.
_Avoid_: minutes, captions (captions are the live view of it)

**Removal bound**:
The published maximum time between a participant vanishing and leaving everyone's view.

**Forwarding on demand**:
The server sends a participant only the tracks their page is showing.

**Egress budget**:
The operator's ceiling on media the server may send; joins are refused above it.

**Audit trail**:
The append-only record of who joined, left, said and decided what in a room, kept for six months and readable only by the operators. A private room's content is never in it.
_Avoid_: history, chat log

**Whiteboard**:
The one drawing surface a room shares. Each browser keeps it; the server relays its pieces unread and stores nothing, so it is gone when the room empties.
