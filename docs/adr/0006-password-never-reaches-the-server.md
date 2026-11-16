---
status: accepted
---
# A private room's password never reaches the server

The media key of a private room comes from its password, so a server that saw the password could decrypt the room. The browser derives two independent values from the password and the slug: the media key, which stays in the browser, and a verifier, which the server keeps only as a hash and compares on entry. The slow derivation runs in the browser, so each guess costs an attacker that work whether they try online or against a leaked hash. The password is 8 letters and digits, drawn at random in the browser by default; the owner may type their own.

## Consequences

- A typed password is as strong as the person's choice. The page says so when it is weak; one wrong proof ends the connection, and ten in five minutes lock the room for everyone until the window ends.
- A share link may carry the password after `#`, which browsers do not send.
- Changing the password changes the key: everyone without the new one leaves.
