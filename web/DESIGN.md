# Design system: live

The look of the web client. It follows `versatile.sh` for colour, depth and rules, and `adaptable.chat` for type and the speech bubble. Code is the source: tokens in `src/styles.css`, components in `src/ui/`.

## North star

One page that moves like a conveyor. The left half says what the product is and never moves; the right half is where things happen, and each step pushes everything one stop to the left.

| Stop | Left | Right |
|---|---|---|
| Home | the pitch on lime | the form on ink |
| Open rooms | the pitch on ink | the rooms on lime |
| Doorway | the pitch on lime | a room's questions on ink |
| More options (from the home or a doorway) | the form on ink, the pitch gone | its options on ink, past a hairline |

More options is one stop further on the same backdrop, with the same easing and duration: the pitch slides out, the form takes the left half and its options arrive on the right. On a phone there are no halves, so the options slide in over the whole page with a Back at the top. Going into a room is a forward view transition, coming out of one a back transition.

The front page never scrolls. It is one screen tall at every size; on a phone the pitch keeps its height and the panel under it takes the rest, scrolling inside only when nothing else fits (360x640). Options belong in a pane that slides in, never in a section that grows the page.

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

Outside the family only two shapes exist: `rounded-full` for round things (avatars, icon buttons, dots, colour swatches) and `rounded-md` for keycaps. Call tiles and panels are bubbles too: mine and what I opened with the tail on the right, the others with it on the left. No arbitrary radius (`rounded-[…]`) in components; `src/ui/shape.test.ts` fails when one appears.

Buttons. Every clickable skin lives in `src/ui/styles.ts`, and pages only pick one:

| What | Use | Shape |
| --- | --- | --- |
| `button({ variant, size })` | anything with words. Variants: `primary` (paper), `accent` (lime, the one confirming action), `secondary` (outline), `quiet`, `ink` and `onInk` for the lime and ink surfaces. Sizes `xs` 2rem, `sm` 2.25rem, `md` 2.75rem, `lg` 3rem | `.bubble-word` |
| `ICON_BUTTON`, `ICON_BUTTON_PLAIN`, `ICON_BUTTON_SOLID` | an icon alone: quiet, on a coloured surface, or filled (send) | round |
| `CHIP`, `CHIP_ON_INK` | a small choice that stays pressed; lime (paper on ink) when on | `.bubble-word` |
| `DOCK.*` | the call controls. A toggle is `round`, or a `split` pill: the button and a caret for its options under one fill, parted by a short line. On is lime; off is the card with a `muted-light` ring and a crossed icon, never a greyed-out button. The header's panel toggles and `…` are `top` (2.5rem), ink while open | round, split |
| `Segmented` | a choice between two or three things; the thumb slides | `.bubble-word` |
| `Switch` | on or off | `.bubble-word` |

`src/ui/shape.test.ts` fails when a page builds a button skin by hand.

Motion: `--ease-glide` for things that travel (the conveyor, sliding panes and thumbs, 500 to 700 ms); `--ease-settle` for things that arrive. Classes: `ride-in`, `swap-in`, `arrive`. Reduced motion turns all of it off.

## Components (`src/ui/`)

| Component | What it is |
|---|---|
| `Wordmark` | `live` in a bubble, then `versatile.sh` in bold mono with a lime `.sh`; on lime it sits on an ink plate |
| `Field` | the one text field: label, input with an optional prefix, a note that keeps its height |
| `Segmented` | a two-way pill whose thumb slides |
| `Switch` | an on/off row with a sliding thumb and a hint |
| `Disclosure` | a quiet button that shows or hides options under it (`aria-expanded`), sliding open; what it hides cannot be reached while closed. For settings inside a panel only, never on the front page |
| `OptionsPane` | a form's options one click away: a quiet toggle (`aria-expanded`, `aria-controls`) and a pane with Back, drawn into the place the page offers (`OptionsPlaceContext`) or in place without one. Showing moves focus to the first field, Escape and Back hide it and give focus back to the toggle, the hidden pane is inert, and its fields carry `form` so the form submits from either state |
| `RoomCode` | a room code large in an ink bubble, with New and Copy |
| `button()` | primary (paper on ink), secondary (outlined), quiet |
| `Icon` | the room's icon set, one stroke weight |
| `Arrow` | the arrow of links and the back button |
| `Social` | the star count and the follow link, and the language choice |
| `Bubble` | a few words in a small bubble |
| `Sheet` | the one modal window, a native `<dialog>`: it closes on its button, Escape or a click outside, gives focus back to what opened it, and fills the screen below 48rem. `bare` leaves padding and scrolling to a panel that brings its own |
| `Shell` | the frame of a page that is not the front page |

Feature components built from them: `room/AccessSettings` (public or private, room code, open rooms), `lobby/RoomRow` (one room, tones `ink` and `raised`), `lobby/RoomsDialog`, `map/WorldMap`, `room/Tile`, `room/ChatPanel`, `room/PeoplePanel`, `room/OwnerPanel`, `room/MoreMenu` (the call's menu behind the round `…` button in the header).

The call keeps one bar at the bottom with five things a person needs at a glance: microphone, camera, screen, Invite and Leave. The side panels (people, chat) and the `…` menu sit at the top right; everything else (hand, whiteboard, room settings, sound and video settings, look, visibility, connection, shortcuts, search) is in that menu. On a phone (below 48rem) the bar drops the words and the device carets; the header keeps the room's name whole and leaves the connection sentence to screen readers, showing a pulsing dot while joining and one word when in trouble; the side panel starts closed, closes when the window narrows, and opens as a full-screen `Sheet`, never a drawer.

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
- Only the room and the front page were checked on a phone (360 and 390 wide).
