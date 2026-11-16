---
status: accepted
---
# A ban keeps an origin out for as long as the room exists

The owner asked to ban, not only to remove. There are no accounts, so the only thing a ban can hold on to is where a visitor comes from. The signalling server reads the visitor's address from the header named in `ADDRESS_HEADER` (`CF-Connecting-IP` behind Cloudflare; the socket's own address when the variable is empty, for local use) and turns it into an opaque key: SHA-256 of a salt drawn at process start and the address, truncated. The room stores keys, never addresses, and they mean nothing after a restart.

A banned participant is closed with code 4404; a new entry from a banned origin is refused with `BANNED` before the room code is even checked. A room holds at most 64 bans and forgets them when it is released.

What this cannot do, said plainly: someone who changes network or uses a VPN comes back; everyone behind the same address (an office, a household, a mobile carrier's gateway) is kept out together. An origin the owner shares is never barred, so banning a housemate only removes them and the owner is never locked out of their own room. A ban that follows a person needs identity, which this product chose not to have.

`ADDRESS_HEADER` must only be set where the server cannot be reached except through the proxy that writes it; otherwise a visitor could name any address.
