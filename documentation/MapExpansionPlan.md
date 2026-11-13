# Map & Store Expansion Plan

## Camera: player-controlled zoom

A new game starts zoomed so the shop the player owns fills the area below the
top status bar. PageUp zooms in (down to about 8 tile rows on screen) and
PageDown zooms out, never further than the point where the whole owned shop
fits. When the shop doesn't fit at the chosen zoom, the camera follows the
player, kept within the owned rooms. Buying an expansion keeps the current zoom;
the player can zoom out to see more if they want. Resizing the window keeps the
same amount of shop visible. See `GameScene.refreshCamera()`.

The whole shop, every expansion included, is limited to **39 by 21 tiles**, so
it always fits on one 1920×1080 screen with tiles displayed at about 48 pixels
when fully zoomed out. The current sales floor zones cover 34 by 13 tiles;
additional expansion zones must be designed within that limit.

## Backroom window

The backroom (Storeroom, Loading Pad, and its upgrades) is a separate little map
authored at row `BACKROOM_GRID_Y` (100), far below the shop, so the shop camera
never sees it. A second camera draws it inside a framed "BACKROOM" window
(`#backroom-window`, under the HUD and pop-up windows) while the player is
inside; the shop stays visible, dimmed, and keeps running behind it.

- The starting usable floor is **128 by 256 world pixels** (2 by 4 game squares):
  its width exactly matches the loading pad, and its bottom half is entirely the
  pad. The black border sits outside the floor; total room size is 256 by 384
  world pixels. The pad holds a 3 by 3 grid of 32-pixel crate spots, sized to
  the pixel-art crates (one 48px art tile, drawn at the floor art's scale).
- The Sales Floor's backroom door (`getBackroomDoorCell()`) and the backroom's exit
  (`getBackroomExitCell()`) are solid doors in north walls. Pressing E while
  standing in front of one moves the player (and a carried crate) to the floor
  just inside the other (`getBackroomLink()`). A prompt above the door says so.
- Employees route through the same door pair (`GameScene.findPath()` adds a
  `teleportTo` waypoint) and start each shift inside the backroom.
- Fixture layout checks treat the two door fronts as connected (`links`).
- The window fits the whole owned backroom; each backroom upgrade in
  `BACKROOM_UPGRADE_ORDER` adds 128 world pixels of width without changing its
  height or moving the loading pad or exit. The Layout tab sells
  the next upgrade once its Shop Level is reached.
- Layout version 4 saves use the compact backroom. Older room layouts are
  rejected with a message to start a new game rather than relocating furniture
  or stock automatically.

## Core idea: author the max size, don't resize at runtime

Growing a Phaser tilemap at runtime is painful (re-tiling, re-colliding,
re-pathing). The shop has a fixed 39-by-21 tile limit. Rectangular `Zones`
in `js/logic/RoomLayout.js` describe the rooms that are built; additional
expansion zones must fit within that limit. A `locked` zone renders **nothing
at all** until unlocked. Unlocking it builds its tiles and tears down any
boundary walls that no longer need to exist.

This is the same pattern used by games like *Supermarket Simulator* and
*Moonlighter*'s shop expansions: the building already physically exists,
expansion is a key/wall removal, not new construction — except here, "already
exists" means "already authored in data," not "already rendered."

## Current implementation

- **`RoomLayout.js`** — the authored data: a flat list of zones, each with a
  grid position/size, a floor/wall tile key, and a `locked` flag. Currently
  defines `storeroom` and `loading_pad` (the backroom), three locked backroom
  upgrades (`BACKROOM_UPGRADE_ORDER`), `sales_floor`, and five locked sales-floor
  expansions (`EXPANSION_ORDER`), starting with `expansion_west` where the
  backroom used to stand. The sales floor zones occupy a 34-by-13 area inside
  the reserved 39-by-21 map.
- **`TileRoom.js`** — the renderer. On construction, builds tiles only for
  zones that start unlocked. The backroom is drawn to its exact pixel bounds
  and rebuilt as a whole on upgrade, preserving its exit. For each sales-floor
  zone, draws a floor tile per cell
  and a full wall tile on any perimeter cell whose edge faces the outer map
  boundary or a *locked* neighboring zone (a locked zone renders nothing, so
  its neighbor must seal that side). Wall cells get a static Arcade Physics
  body. `unlockZone(id)` builds that zone's tiles for the first time, then
  tears down any now-unnecessary wall cells on its neighbors.
- **`GameScene.js`** — builds one `TileRoom` and runs the zoomable camera
  (see above). The Manager Tablet's Layout tab lets the player buy the next
  sales-floor or backroom expansion after reaching its required Shop Level and
  having enough credits. Purchases are limited to when the store is closed and
  must be made in order; the old free debug unlocks have been removed.
- Tile art comes from `img/Icons_Extracted/Tileset/` (64 floor/wall tiles,
  fixed 256×256 grid-sliced from `Sheet1_A.jpg`) and
  `img/Icons_Extracted/Tileset/Fixtures/` (104 shop fixtures, chroma-key
  extracted from `Sheet2_A.jpg`). `data/TilesetManifest.json` lists every tile
  key/path so `boot.js` can bulk-load them without a hand-maintained list.
  The Sales Floor and its expansion use plain floor and wall tiles cut from the
  licensed sci-fi tileset in `img/Tilesets/scifi/` (see `js/logic/ShopTiles.js`;
  local-only, never committed). Debug keys `T` and `H` cycle through its floor and
  wall styles in-game.
  **Known issue:** this batch has a visible dark outline baked into every
  tile, so adjacent floor/wall tiles don't actually tile seamlessly — see
  `img/prompts/resourceRequest_04_SeamlessTilesetFix.md` for the regeneration
  request to fix this.

## Verified working

- Floor/wall tiles render correctly; the backroom opens in its own window and
  the player, crates, and employees cross through its doors.
- Fully zoomed out, the whole owned shop fits the window at every size.
- Buying an expansion removes the dividing wall and reveals its floor in the
  reserved space; the *true* outer map boundary (the far edge of `expansion_a`)
  correctly stays walled.

## What's deliberately NOT built yet (next steps, roughly in order)

1. **Multi-directional / multi-row expansion.** The current layout is a single
   horizontal row. `RoomLayout`'s zone model already supports arbitrary
   `gridX/gridY`, so adding e.g. a second row of Storeroom expansion or a
   taller Sales Floor is just more zone entries — `TileRoom`'s wall logic is
   written generically (checks all 4 edges via `zoneAt`), not hardcoded to a
   single row.
4. **Fixture placement data.** `Fixture` (in `ShopInventory.js`) still only
   supports one hand-seeded demo shelf. Real shelf/register/fixture placement
   (using the newly-extracted `Tileset/Fixtures/` sprites) and a Build Mode
   placement UI are separate, larger pieces of work.
5. **Pathfinding.** `Pathfinder.js` uses heap-based A* on an 8-pixel navigation
   grid for character movement, then smooths routes wherever a straight walk
   clears the room and character-sized fixture/wall boundaries. Customers and
   staff can use narrow spaces that tile-center routes used to reject; staff
   routes use their smaller collision body, and register destinations can sit
   directly at the counter's front. Collision remains active as a safety net.
   Other characters are still not route obstacles; customers can pass through
   one another, as before. Fixture moves happen between shifts, so live routes
   do not need to be rebuilt during rearrangement.
6. **Player avatar -- DONE.** `js/logic/Player.js` + `GameScene` now have a
   WASD/arrow-controlled player (temporary tinted reuse of customer art, see TODO.md),
   colliding with walls/fixtures but not customers (bible Step 30/58, highest Z-index via
   `setDepth(9999)`). The camera follows the player whenever the shop is bigger than
      the screen at the chosen zoom.
