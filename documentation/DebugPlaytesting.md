# Debug playtesting

## Starting the desktop game

From the project directory, run `npm run dev`, then run `npm start` in a second
terminal. Leave both running while playing. Restart Electron after changes to
`main.js` or `preload.cjs`; refreshing only the renderer does not reload those files.
Desktop and browser saves are separate; switching to desktop does not import the
browser's saved game.

## Capturing a session

Click **Debug Info** in the top HUD at any point, including while paused or
before opening the store. Each successful click writes two numbered files:

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
apart. Use the existing PAUSE button first if an exact stationary comparison is
important. Taking a capture must not close menus or cancel a shelf move.

## What the report contains

- Shift day, elapsed/displayed time, pause/soft-close flags, served/turned-away
  counts, and starting credits/reputation.
- The shift-start customer pool and its intermediate calculations, tuning values,
  complete arrival schedule, and next scheduled arrival.
- Customer IDs stable within the current game scene (reset on a new game), factions, shopping lists,
  purchases, missing items, price tolerance, patience, paths, and queue order.
- Raw fixture contents, including sold-out stacks; hovercart and Go-Backs stock;
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

Press `\` to enable or disable the translucent solid green placement overlay. It appears only
while moving or placing a fixture and shows the floor that the fixture's body can
cover in at least one valid position. Other fixtures show their solid footprints
without blue standing-area outlines; the fixture being placed still shows its own blue outline.
The checks include its size, facing, standing space, other fixtures, walls,
locked areas, player/crate bodies, and checkout access. The grid fills in as
checks finish and updates when the fixture is turned or the available space changes.
Access checks use the character-sized standing area and its route, rather than treating
every touched floor tile as completely blocked.
Placement snaps to an 8-pixel grid. The overlay shows which of those positions
are valid without changing collision rules.
The existing `G` shortcut independently toggles the larger cyan floor-tile grid.

When you stand close enough to open a locker, a small gauge appears near the top of its front; it
disappears when you walk away. Green shows how much of its
storage space is used; red shows the free space left. This counts the space used by the items, not the number of items. The gauge
updates as stock changes and stays with the locker when it is moved. Carrying an
item crate no longer shows the large information card at the top of the screen;
instead a small two-row label just above the carried crate shows the item name, then
the crate quantity and the locker spaces it fills, for example "x5 (10)" (the locker
window shows used and total spaces in the same units). A fixture crate shows, for example, "SHELF fixture".

Pressing Space can pick up a crate while you are pushing it by walking into it.
A thrown crate keeps its launch speed until it is clear of the player, then slides
and slows down. While it is still launching it cannot be picked up; once it is
sliding, the player bumps into it and can pick it up. This applies to both item
and fixture crates.

Before a playtest, the assistant should give one specific question to investigate
and a short list of capture checkpoints. Afterward, provide the session folder
path and say which capture shows the problem. The assistant can then read those
local reports/screenshots and compare before/after state. No upload is required
when the assistant has access to the same filesystem.

For an unexpected bug, click Debug Info immediately, then describe what you
expected and what actually happened. If practical, capture again after the next
action that changes the symptom.

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
