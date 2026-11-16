# Design system: live

The look of the web client. It follows `versatile.sh` for colour, depth and rules, and `adaptable.chat` for type and the speech bubble. Code is the source: tokens in `src/styles.css`, components in `src/ui/`.

## North star

One page that moves like a conveyor. The left half says what the product is and never moves; the right half is where things happen, and each step pushes everything one stop to the left.

| Stop | Left | Right |
|---|---|---|
| Home | the pitch on lime | the form on ink |
| Open rooms | the pitch on ink | the rooms on lime |
| Doorway | the pitch on lime | a room's questions on ink |

Being in a room replaces the page with the call.

## Tokens (`src/styles.css`, `@theme`)

A colour that is not a token does not exist. `src/ui/tokens.test.ts` checks contrast in both themes.

| Token | Dark | Light | Use |
|---|---|---|---|
| `canvas` | `#0e1116` | `#f5f5f2` | page |
| `card` | `#151a22` | `#ffffff` | panels, tiles |
| `sunken` | `#0a0d11` | `#eceae4` | the screen-share tile |
| `fg` | `#f5f5f2` | `#0e1116` | text, the primary button |
| `muted`, `muted-light` | `#9aa1ac`, `#646c7a` | `#4b5360`, `#7b828d` | secondary text, control borders |
| `accent` | `#c6f432` | `#4d6a00` | lime as text |
| `bubble`, `on-bubble` | `#c6f432`, `#0e1116` | same | lime as a surface, and text on it |
| `amber` | `#fbbf24` | `#8a5300` | errors, trouble, leaving |
| `line`, `line-strong` | `#25282c`, `#383b40` | `#e2e1dc`, `#cfcec8` | hairlines |
| `ink`, `paper` | `#0e1116`, `#f5f5f2` | same | fixed pair for surfaces that do not follow the theme (anything on lime) |
| `ink-raised`, `ink-lift` | `#1c222c`, `#252d39` | same | a card on ink, and the same card under the pointer |
| `lime-deep` | `#5e8c00` | same | an edge that must show on lime |

Type: Space Grotesk (display, bold, tracking -0.04em), Noto Sans (body), JetBrains Mono (the wordmark, addresses, room codes, counts). All served from our origin.

Shape. One family of speech bubbles, and nothing else has a tail:

| Class | Corners | Use it for |
| --- | --- | --- |
| `.bubble` | 1.25rem, 0.3rem tail bottom left | anything the site says or holds: cards, fields, menus, rows, messages from others |
| `.bubble-sent` | same, tail bottom right | what is mine or what I opened: my messages, sheets, dialogs, the command search |
| `.bubble-word` | 0.9em, 0.2em tail bottom left | one line of words: badges, chips, small buttons, labels over video, the switch and the two-way selector (their thumbs inherit the shape) |
| `.bubble-word-sent` | same, tail bottom right | one line of words on the sending side: the wordmark plate |

Outside the family only three shapes exist: `rounded-full` for round things (avatars, icon buttons, dots, colour swatches), `rounded-2xl` for screens (call tiles and side panels, which show and do not speak), and `rounded-md` for keycaps. No arbitrary radius (`rounded-[…]`) in components; `src/ui/shape.test.ts` fails when one appears.

Motion: `--ease-glide` for things that travel (the conveyor, sliding panes and thumbs, 500 to 700 ms); `--ease-settle` for things that arrive. Classes: `ride-in`, `swap-in`, `arrive`. Reduced motion turns all of it off.

## Components (`src/ui/`)

| Component | What it is |
|---|---|
| `Wordmark` | `live` in a bubble, then `versatile.sh` in bold mono with a lime `.sh`; on lime it sits on an ink plate |
| `Field` | the one text field: label, input with an optional prefix, a note that keeps its height |
| `Segmented` | a two-way pill whose thumb slides |
| `Switch` | an on/off row with a sliding thumb and a hint |
| `RoomCode` | a room code large in an ink bubble, with New and Copy |
| `button()` | primary (paper on ink), secondary (outlined), quiet |
| `Icon` | the room's icon set, one stroke weight |
| `Arrow` | the arrow of links and the back button |
| `Social` | the star count and the follow link, and the language choice |
| `Bubble` | a few words in a small bubble |
| `Shell` | the frame of a page that is not the front page |

Feature components built from them: `room/AccessSettings` (public or private, room code, open rooms), `lobby/RoomRow` (one room, tones `ink` and `raised`), `lobby/RoomsDialog`, `map/WorldMap`, `room/Tile`, `room/ChatPanel`, `room/PeoplePanel`, `room/OwnerPanel`.

## Rules

- **One live colour.** Lime means alive: the bubble, the chosen option, a raised hand, my messages. Never a tint over a section.
- **On lime, ink.** Anything drawn on the lime half uses `ink` and `paper`, never the theme tokens, and no white card.
- **Fixed boxes.** A box does not change size with its state: notes reserve their line, the see/back button keeps its place and width at every stop, Copy keeps its width when it says Copied.
- **Nothing teleports.** A change of view slides or cross-fades; a choice slides its thumb.
- **Trouble in words.** Unstable, reconnecting and refused are text and an amber edge, never colour alone.
- **No raw hex in a component, no inline style.** The content security policy forbids inline style, and the tokens are the palette.

## Known gaps

- Pills (the see/back button, small buttons on ink, chips in the rooms window, round call buttons) are written as class strings in four places. They want one `Pill` recipe.
- The design detector flags the 64px grid behind the pitch as a decorative background. It is the versatile.sh brand grid, kept on purpose.
- Nothing here was checked on a phone.
