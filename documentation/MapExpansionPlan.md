# Map & Store Expansion Plan

## What changed from the original MVP design

`space_arms_dealer_bible.md` Step 57 originally said the shop floor would never
exceed a single screen and the camera would never pan. That's been superseded:
the player should be able to expand both the Sales Floor and the Storeroom, so
the map now needs to be bigger than the viewport and the camera needs to scroll.

## Core idea: author the max size, don't resize at runtime

Growing a Phaser tilemap at runtime is painful (re-tiling, re-colliding,
re-pathing). Instead, the **entire maximum possible store footprint is
authored up front** as a set of rectangular `Zones` (see
`js/logic/RoomLayout.js`). A zone can be `locked`, meaning it renders **nothing
at all** — no floor, no walls, it simply doesn't exist to the player yet — and
is excluded from the camera's scrollable area. The instant it's "purchased,"
unlocking it builds its tiles for the first time and tears down whatever
boundary walls no longer need to exist. No zone is ever destroyed or resized;
expansion only ever adds.

This is the same pattern used by games like *Supermarket Simulator* and
*Moonlighter*'s shop expansions: the building already physically exists,
expansion is a key/wall removal, not new construction — except here, "already
exists" means "already authored in data," not "already rendered."

## Current implementation

- **`RoomLayout.js`** — the authored data: a flat list of zones, each with a
  grid position/size, a floor/wall tile key, and a `locked` flag. Currently
  defines 3 zones in a single row: `storeroom` (unlocked) → `sales_floor`
  (unlocked) → `expansion_a` (locked, placeholder `cost: 5000`).
- **`TileRoom.js`** — the renderer. On construction, builds tiles only for
  zones that start unlocked. For each built zone, draws a floor tile per cell
  and a full wall tile on any perimeter cell whose edge faces the outer map
  boundary or a *locked* neighboring zone (a locked zone renders nothing, so
  its neighbor must seal that side). Wall cells get a static Arcade Physics
  body. `unlockZone(id)` builds that zone's tiles for the first time, then
  tears down any now-unnecessary wall cells on its neighbors, returning new
  camera bounds. `getCameraBounds()` computes the pixel bounding box of every
  currently-unlocked zone.
- **`GameScene.js`** — builds one `TileRoom`, calls `cameras.main.setBounds()`
  from it, and implements a simple pointer-drag-to-pan (there's no player
  avatar yet, so dragging is the stand-in for "looking around a store bigger
  than the screen"). A debug-only `U` keybind calls
  `room.unlockZone("expansion_a")` to prove the mechanism end-to-end.
- Tile art comes from `img/Icons_Extracted/Tileset/` (64 floor/wall tiles,
  fixed 256×256 grid-sliced from `Sheet1_A.jpg`) and
  `img/Icons_Extracted/Tileset/Fixtures/` (104 shop fixtures, chroma-key
  extracted from `Sheet2_A.jpg`). `data/TilesetManifest.json` lists every tile
  key/path so `boot.js` can bulk-load them without a hand-maintained list.
  **Known issue:** this batch has a visible dark outline baked into every
  tile, so adjacent floor/wall tiles don't actually tile seamlessly — see
  `img/prompts/resourceRequest_04_SeamlessTilesetFix.md` for the regeneration
  request to fix this.

## Verified working (tested via a shrunk viewport, since the authored room is
smaller than a normal desktop window)

- Floor/wall tiles render correctly, storeroom and sales floor sit side by
  side with no wall between them (both unlocked).
- Drag-to-pan moves the camera, correctly clamped to the bounds of whatever is
  currently unlocked.
- Pressing `U` extends the camera bounds and removes the dividing wall;
  panning into the newly-unlocked zone reveals its floor with no visible seam,
  and the *true* outer map boundary (the far edge of `expansion_a`) correctly
  stays walled.

## What's deliberately NOT built yet (next steps, roughly in order)

1. **Replace the debug `U` key with a real purchase UI.** `unlockZone()` and
   `zone.cost` already exist for this — a "Build Mode" / expansion-purchase
   window just needs to call `room.unlockZone(id)` after deducting credits via
   `PlayerState`, and respect the bible's existing rule that Build Mode is
   locked to off-shift hours.
2. **Loading Pad.** Not modeled as a zone yet. Should be an *unlocked-by-default,
   exterior* zone adjacent to the Storeroom (matching the bible's
   crate-hauling flow), using exterior/tarmac tiles instead of interior floor.
3. **Multi-directional / multi-row expansion.** The current layout is a single
   horizontal row. `RoomLayout`'s zone model already supports arbitrary
   `gridX/gridY`, so adding e.g. a second row of Storeroom expansion or a
   taller Sales Floor is just more zone entries — `TileRoom`'s wall logic is
   written generically (checks all 4 edges via `zoneAt`), not hardcoded to a
   single row.
4. **Fixture placement data.** `Fixture` (in `ShopInventory.js`) still only
   supports one hand-seeded demo shelf. Real shelf/register/fixture placement
   (using the newly-extracted `Tileset/Fixtures/` sprites) and a Build Mode
   placement UI are separate, larger pieces of work.
5. **Pathfinding.** Real grid-based pathfinding now exists (`Pathfinder.js`, an
   8-directional BFS with corner-cutting prevention). `GameScene.findPath()`
   combines `TileRoom.isWalkable()` (walls + locked zones) with a scene-level
   `blockedCells` set (fixture footprints, e.g. the shelf) to route customers
   around obstacles instead of walking straight at a point and getting stuck.
   `Customer.setDestination()` computes a path once per state transition
   (seek shelf / seek register / leave) and follows it waypoint-by-waypoint.
   Collision (`TileRoom.wallGroup` + `GameScene.customerGroup`) remains in
   place as a secondary safety net for the one thing pathfinding doesn't
   cover: other customers, which are dynamic and not baked into the grid.
   Still not modeled: path recomputation if a *new* fixture gets placed while
   a customer is already mid-walk (static obstacles are snapshotted once at
   scene creation), and a real navmesh for non-grid-aligned movement.
6. **Player avatar + camera follow.** Once a player-controlled character
   exists, the camera should switch from drag-to-pan to following the avatar
   (clamped to the same unlocked bounds), per the bible's Step 58 (player
   avatar always renders at top z-index).
