---
status: accepted
---
# A muted microphone is dropped by the server

The owner asked to mute everyone and to decide who speaks when a hand goes up. A mute that only asks each browser to stop would hold for nobody who changed the page, so the room is the authority here too.

A muted participant carries one more bit of their flags (256), set only by the server. While it is set the room refuses the microphone bit from that participant, and the media plane drops their microphone packets before forwarding them: whatever their browser sends, nobody hears it. Camera, screen, chat and the raised hand are untouched. Whoever arrives while the room is muted arrives muted. The owner is never muted by the room, and a participant who becomes the owner loses the mute.

A raised hand from a muted participant is the request to speak. The owner lets one speak (the bit is cleared and the hand lowered) or gives the microphone back to everyone. Being let speak turns nothing on: the participant is told and turns the microphone on themselves.

There is one owner and no co-hosts; a muted room whose owner leaves passes to the next participant, who inherits the decision to lift it.
