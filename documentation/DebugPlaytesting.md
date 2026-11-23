# Debug playtesting

## Starting the desktop game

From the project directory, run `npm start`. It starts the Vite development server
and opens the desktop game. Leave it running while playing. Restart Electron after
changes to `main.js` or `preload.cjs`; refreshing only the renderer does not reload
those files.
Desktop and browser saves are separate; switching to desktop does not import the
browser's saved game.

For browser-only play, run `npm run dev -- --open` in its own terminal.

## Shelf Test Room

On the title screen, choose **DEV**, then **SHELF TEST ROOM**. It's a fresh shop with
every floor expansion open, every contract signed, the top store level and a million
credits. Nothing in it is ever saved, so build any shelf layout you like.

The panel in the top-right corner:

- **Send 1 customer / Send 10 customers** lines people up outside; they walk in as soon
  as the shop has room (at most 6 inside at once).
- **Fill every shelf** stocks every empty spot on every shelf with random items and
  tops up the rest.
- The register serves customers by itself, so tests never stall at checkout.
- **Gave up** counts customers who couldn't reach a shelf, the register line or the
  door. The list under it says where each one was headed and where they stood, so a
  bad spot can be found on the map. In a good layout this should stay at 0.

## UI Lab

On the title screen, choose **DEV**, then **UI LAB**. It's a fresh shop for working on the
game's menus: everything is unlocked, there's a million credits, and two shelves near the
door are already stocked so the menus have something to show. Nothing in it is ever saved.

The panel in the top-right corner opens the real Manager's Tablet straight to any of its
tabs, so changes tried here are the same menus players see. **Send 1 customer** brings
someone in, and you serve them at the register as usual.

## Starting Template

On the title screen, choose **DEV**, then **STARTING TEMPLATE**. It's the shop exactly as a
new game starts it. Use the panel to set the starting money, add any fixture for free (click
the floor to put it down, R turns it), and move or remove what's already there; the last
register can't be removed. To stock a shelf, walk up to it and open it, choose an item in
**Fill with** at the top, and click a space to fill it to the top. Right-click a space to
empty it.

**Snapshot** saves the current layout, shelf stock and starting money as the start of every
new game, by rewriting `data/StartingTemplate.json`. It only works while the game runs from the
dev server (`npm start` or `npm run dev`). Nothing else in this area is saved.

## First Day Tutorial

Choose **DEV**, then **FIRST DAY TUTORIAL** to try the first-day guidance in a fresh shop
using the Starting Template. The guidance follows real actions through stocking, serving
customers, and ending the day. This test area never saves and does not change the regular game.

## Crate Test Room

Choose **DEV**, then **CRATE TEST ROOM** to open the real shop with everything unlocked and the
sales floor and backroom covered in full item crates, as single crates and stacks of two and three,
with walking room between them. **Refill crates** puts a fresh set down and **Clear crates**
empties the floor. This test area never saves.

## Decorator Mode

On the title screen, choose **DEV**, then **DECORATOR MODE**. It's a top-level shop with every
license signed and money that tops itself back up to a million after every purchase, for
trying out how the store looks. Expansions, shelves and stock can be bought from the tablet
as usual (expansions still go in order), or fixtures and shelf stock can be put down for free
with the same panel and **Fill with** picker as Starting Template. Nothing in it is saved.

## Shelf Collision Lab

On the title screen, choose **DEV**, then **SHELF COLLISION LAB**. It shows the short
(two-row) and tall (three-row) shelves facing every direction, plus back-to-back pairs. Red
marks the part of each shelf that people bump into; press **G** to hide or show it. Shelves
facing up or down are solid only around their feet, so you, customers, and staff can walk
behind their tops and be hidden by them. A pretend customer walks a loop behind the shelves.

**Every new shelf must be checked here before it ships.** Add it to the lab's shelf list in
`js/scenes/shelfCollisionLab.js` in all four facings, then walk into it from every side and
behind it: you should stop only at its feet, and it should hide you when you're behind it.

## Delivery Crate Lab

On the title screen, choose **DEV**, then **DELIVERY CRATE LAB**. It shows the remote-order
terminal beside the player. The animation starts automatically and continuously loops through
the floor doors opening, the dark delivery crate
rising on its platform, the crate lid opening and closing, the loaded platform lowering,
and the floor doors closing. There is no extra pause between the floor doors opening and
the crate rising. Three pictures show the crate appearing before its platform becomes visible;
lowering reverses the same pictures, so the platform disappears before the crate does.
Each of the six stages has **SLOW**, **NORMAL**, and **FAST** buttons. Normal preserves the
original 120 ms per picture; Slow uses 240 ms and Fast uses 60 ms. All six default to Fast,
the approved timing for the eventual in-game terminal animation. Changes affect that stage's
next picture delay without restarting the animation or changing the other stages. The green
button marks the selected speed. The existing holds between stages remain unchanged.
Choices survive leaving and reopening the lab during the same game session; they do not affect saved games.
Use **MENU** or **Esc** to leave. The animation pictures are in
`img/Generated/fixture_drone_terminal_crate_sheet.png` (16 pictures, 120×81 each, shown at full size).
All pictures share the same terminal and pad pixel for pixel. Only the moving doors, platform
and crate change; the raised crate can overlap the back of the pad but is clipped behind its front rim.
The original empty-platform sheet remains in `img/Generated/fixture_drone_terminal_sheet.png`.
Both sheets use the same cleaned, dark outline without the original white-background halo.
`img/Generated/fixture_drone_terminal_crate_sheet_red.png` is the same 16 pictures with the
crate's light red instead of green. The crate light is red while its order is missing items and
green once it has every item. The **CRATE LIGHT** button beside **MENU** swaps between the two
sheets without restarting the animation; the lab starts red.
The terminal screen is a separate overlay in `img/Generated/fixture_drone_terminal_screen_sheet.png`
(120 pictures, 16×15 each). Its readout lines scroll up one pixel per picture and wrap without a
seam, so the scroll reads as endless. It covers the screen at offset (10, 11) from the terminal
picture's top-left and plays at 10 pictures per second, independently of the mechanical stages and
their speed controls.

## Capturing a session

Click **Debug Info** in the top HUD, including before opening the store.
If paused, choose **Resume** first: the pause menu blocks background HUD buttons.
Each successful click writes two numbered files:

- `0001-screen.png`: the entire game window, including HUD and open menus.
- `0001-info.txt`: a readable header followed by a formatted JSON state dump.

Wait for "Debug #0001 saved" before closing the game. **OPEN FOLDER** opens the
session directory; hovering that button shows its full path. Subsequent clicks
use `0002`, `0003`, and so on in the same folder. A new desktop app launch starts
a new session on its first capture; refreshing the game does not.

Files are stored under the desktop app's user-data directory in `debug-sessions`
(normally `%APPDATA%\space-arms-dealer\debug-sessions` on Windows). They are local
only, never uploaded, never overwrite the real save, and are not loadable saves.
Keep or delete individual session folders when no longer needed. There is no
automatic retention/deletion.

The button reports errors instead of claiming a failed capture succeeded. Failed
writes can leave a partial capture; numbering can skip failed attempts. The
browser version explains that desktop capture is required rather than silently
producing a canvas-only screenshot without the menus.

Gameplay is not paused or altered by capturing. The report records the state at
the click and the screenshot's later capture timestamp; they can be a few frames
apart. If you pause to inspect the scene, resume before clicking Debug Info;
captures are not exact paused-state snapshots. Taking a capture must not close
menus or cancel a shelf move.

## What the report contains

- Shift day, elapsed/displayed time, pause/soft-close flags, served/turned-away
  counts, and starting credits/reputation.
- The shift-start customer pool and its intermediate calculations, tuning values,
  complete arrival schedule, and next scheduled arrival.
- Customer IDs stable within the current game scene (reset on a new game), factions, shopping lists,
  purchases, missing items, price tolerance, patience, paths, and queue order.
- Raw fixture contents, including sold-out stacks; Go-Backs stock;
  carried/floor crates; licenses, active factions, reputation, and store prices.
- Market prices, room locks, player/camera positions, open windows, checkout
  cards, pending shelf/fixture placement, and save/error status.
- The latest 200 diagnostic events, including customer arrivals/exits, sales,
  capacity rejections, timeout exits, floating gameplay messages, uncaught
  renderer errors, and unhandled promise rejections.

This is deliberately read from live state without save validation so a malformed
inventory or layout can still be diagnosed. Non-finite numbers are written as
strings (for example `"NaN"`) rather than silently becoming `null`. Events begin
when the game scene initializes and are bounded; this is not a full replay or a
recording of every console message. Screenshots include anything visible inside
the game window, so review them before sharing.

## Working with the assistant

For fixtures only, **body box** means the box fitted to the visible fixture pixels.
**Projection box** means the pixel-free area kept clear in front of the fixture, in
the direction it faces. Together they make the fixture's **collision box**.
Transparent padding around the fixture image is not part of its body box.
The doorway's full visible width stays clear for one floor tile immediately in front
of it; the glass door's clear area is narrower than the public double door's.

While moving or placing a fixture, other fixtures show their solid footprints
without blue standing-area outlines; the fixture being placed shows its own blue outline.
Access checks use the character-sized standing area and its route, rather than treating
every touched floor tile as completely blocked.
Placement snaps to an 8-pixel grid.

The bottom bar shows the picture, name, and count of the crate under the green arrow; the
cards above its right end list the carried crates, top crate first. The arrow only marks a
crate in front of the player, within reach; Ctrl moves it one crate down a floor stack.
Debug Info lists each floor stack and the carried crates.

Pressing Space can pick up a crate while you are pushing it by walking into it.
A thrown crate keeps its launch speed until it is clear of the player, then slides
and slows down. While it is still launching it cannot be picked up; once it is
sliding, the player bumps into it and can pick it up. This applies to both item
and fixture crates.

### Shelf backs, pushing, and restocking outlines

- In the Shelf Test Room, put an up-facing shelf above a down-facing shelf.
  Their feet can sit half a tile (32 world pixels) apart: the upright pictures
  overlap above the bases, rather than needing a gap as tall as the artwork.
  This applies to every current shelf size, including mixed sizes. Same-facing
  and front-to-front shelves still need their standing space; sideways backs
  may touch without overlapping their artwork.
- Hold a movement key against a loose crate: a small contact overlap must not stop
  the push. Locked pad crates, walls, and the four-crate movement limit still block it.
- Push a crate to the bottom wall, then pick it up and put it down there. Both
  actions allow its base to touch the wall without requiring an extra gap.
- Carry matching stock past people and floor stacks. The pulsing shelf outline
  stays above everything in the world canvas; HUD and menu windows stay above it.

The push solver treats up to two pixels of inward contact overlap as push contact.
Its contact margin finds nearby crates only; wall checks use the actual moved base,
and near-wall steps shorten to the available space rather than reserving that margin.

Before a playtest, the assistant should give one specific question to investigate
and a short list of capture checkpoints. Afterward, provide the session folder
path and say which capture shows the problem. The assistant can then read those
local reports/screenshots and compare before/after state. No upload is required
when the assistant has access to the same filesystem.

For an unexpected bug, click Debug Info immediately, then describe what you
expected and what actually happened. If practical, capture again after the next
action that changes the symptom.

### Investigating a wrong-change rejection

A false wrong-change rejection currently cannot be reproduced. Every handover
records the exact selected and owed amounts, displayed amount, input, and
`mouseHeld` in a `cash-handover` diagnostic event. If it happens, capture Debug Info
immediately afterward so those values can be compared with the displayed result.

## First playtest: faction eligibility and the traffic snapshot

Use the current save; no reset is required.

1. While the store is closed, click Debug Info.
2. If available, sign one new item license. Click Debug Info again before
   starting the shift. This checks that relevant factions activate immediately.
   If no license is affordable/available, skip this step.
3. Stock the shelves normally, start the shift, and click Debug Info immediately.
4. Serve the first customer (or capture immediately if something looks wrong),
   then click Debug Info again.

The assistant should compare license-derived active factions, guaranteed
visitors, shelf-stock/assortment calculations, the frozen shift-start pool,
scheduled versus actual arrivals, and the independent reputation changes.
