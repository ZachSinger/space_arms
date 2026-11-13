# Codebase Critique

An honest review of _Space Arms Dealer_'s current structural weaknesses, as of the
documentation pass. Line counts are approximate.

This is a critique, not a to-do list. The fixes and their priority are in
[ArchitectureRecommendations.md](./ArchitectureRecommendations.md).

**Severity:**

- 🔴 Blocks shipping or upcoming features.
- 🟠 Slows development noticeably or causes recurring bugs.
- 🟡 Friction or tidiness.

## Summary

| # | Problem | Severity |
|---|---|---|
| 1 | ~~The game can't be packaged for release~~ (addressed; Steam steps remain) | ✅ |
| 2 | `GameScene` is a god object | 🔴 |
| 3 | Customer logic can't be reused for employees | 🔴 |
| 4 | Modules reach directly into the scene | 🟠 |
| 5 | Event bus is only wired for a few events | 🟠 |
| 6 | Input modes are scattered boolean flags | 🟠 |
| 7 | Inventory locations don't share one model | 🟠 |
| 8 | Fixture behaviour uses type checks spread across files | 🟠 |
| 9 | Pause is implemented per subsystem | 🟠 |
| 10 | DOM UI rebuilds via `innerHTML` with unescaped data | 🟠 |
| 11 | Saves have a version number but no migration path | 🟠 |
| 12 | Tuning numbers and fixture data are hardcoded in JS | 🟡 |
| 13 | Testing scene logic needs a Vite server and Phaser mocks | 🟡 |
| 14 | Pathfinding won't scale to a bigger map with employees | 🟡 |
| 15 | Debug features live in production code paths | 🟡 |
| 16 | Small duplication and leftovers | 🟡 |
| 17 | Documentation has drifted from the code | 🟡 |
| 18 | One 1,470-line stylesheet | 🟡 |

---

## ✅ 1. The game can't be packaged for release (addressed)

> **Status:** addressed. `vite.config.js` copies `data/` and referenced images into `dist/`,
> `main.js` loads `dist/` through the `app://game/` protocol when packaged, and
> `npm run package` builds a stand-alone exe with electron-builder. Steamworks integration
> and the Steam store steps are still to do.

Original finding:

- `main.js:90` always loads `http://localhost:5173`. A packaged build would open a blank
  window unless a Vite dev server happened to be running.
- There's no `vite.config.*`. `data/`, `img/`, and `styles/` are loaded by plain string
  paths, so `vite build` doesn't copy them into `dist/` (already noted in `AGENTS.md`).
- There's no packager (`electron-builder` / Forge) and no Steamworks integration.
- **Why it matters:** this is the one problem that fully blocks release, and packaging
  issues are much cheaper to find early than in the final weeks.

## 🔴 2. `GameScene` is a god object

`js/scenes/game.js` is ~1,950 lines with **62 instance fields** across **14 sections**.
It owns:

- save/load and autosave,
- on-screen messages,
- pathfinding queries,
- debug hooks,
- supply orders and pricing,
- fixture buying, crating, and placement,
- crate pickup, throwing, and pushing,
- fixture sprites,
- the register and its queue,
- customer arrivals and pools,
- checkout,
- the shift flow,
- the frame loop.

- **Every new feature has landed here** because the scene is the only object that can
  see everything. That's the root cause behind problems 4–9.
- **Changes are risky:** unrelated systems share fields such as `carriedCrate`,
  `startingShift`, and `operatingRegister`.

## 🔴 3. Customer logic can't be reused for employees

- `Customer.js` (~535 lines) mixes movement, pathing, shopping decisions, patience,
  queueing, sprite animation, and reputation effects in one class.
- It calls scene methods directly: `findPath`, `getStorePrice`, `getItem`,
  `showFloatingText`, `refreshShelfStockDisplay`, and `debugInfo.recordCustomer`.
- **Employees are next on the roadmap** (bible Part 6). They need the same walking,
  pathing, reservations, and queue awareness, plus hauling and register work. Built the
  same way, they would copy most of `Customer.js` and add another large block to
  `GameScene`.

## 🟠 4. Modules reach directly into the scene

At least 10 logic modules take `scene` and use its internals:

| Module | Reaches into |
|---|---|
| `Crate` | `restockCrates`, `loadingPadRect`, `crateBounds`, `physics` |
| `ManagerTablet` | placement, pricing, supply, fixture crating, input, shift flags |
| `FixturePlacement` | `windowManager`, `carriedCrate`, `moveFixture`, input, camera |
| `DebugInfo` | nearly every scene field |
| `LayoutRenderer`, `SupplyRenderer` | scene query methods |

- **There's no defined interface** between the scene and these modules, so any scene
  field rename can break code far away.
- **UI code depends on the Phaser scene,** which violates the intended DOM/Canvas
  decoupling in spirit, even though it holds technically (the UI never draws on the
  canvas).

## 🟠 5. Event bus is only wired for a few events

- The bible (Step 3) specifies an Event Bus. `EventBus.js` now publishes sales, crate hits,
  angry exits, missing primary stock, crate delivery results, shift start/end, player crate
  actions, fixture opening, register entry/exit, and inventory transfers. Major consequences are handled by
  listeners, while other communication still uses direct calls and subscriptions.
- **Consequence:** a single game moment (a sale, an angry customer, a crate hitting
  someone) calls audio, text feedback, reputation, debug logging, and stats directly in
  sequence.
- **Planned features need hooks into these same moments:** tutorials, music
  crossfades, finances, achievements, employee reactions. Each would mean editing the
  core logic again.

## 🟠 6. Input modes are partly centralized

- `ControlMode` now resolves loading, placement, modal, register, carrying, and walking
  profiles, and gates scene hotkeys and player movement.
- **Remaining:** some non-input systems still inspect the underlying flags directly, and
  keybinds remain split between `GameScene`, `Player`, `FixturePlacement`, and `title.js`.
- Rebinding keys still isn't possible.

## 🟠 7. Inventory movement is partly standardized

- `InventoryPool` is shared by the hovercart, Go-Backs, and lockers. That part is good.
- `InventoryTransfer` now handles player moves among pools, shelf slots, and item crates.
- Shelves and crates expose the methods the shared transfer needs, but remain different
  models because shelf slots have grid positions and crates have physical behavior.
- The supply draft is a bare `Map`.
- Customer shopping decisions remain separate, but shelf pickups and returning abandoned
  customer carts to Go-Backs now use `InventoryTransfer`. Employees don't use shared
  transfers yet.
- User-facing messages are still chosen by each UI caller.

## 🟠 8. Fixture behaviour uses type checks spread across files

- `FIXTURE_TYPES` is a JS constant (`FixtureLayout.js`). Behaviour is selected by
  `kind === "register"` checks and `instanceof ShelfFixture/StorageFixture`.
- That's about **15 type checks** across `game.js`, `FixtureLayout.js`,
  `FixtureWindow.js`, and `FixturePlacement.js`.
- **Adding a fixture kind** (weapon rack, security scanner, employee break-room door)
  means finding and editing every one of those branches.

## 🟠 9. Pause is implemented per subsystem

- There's no single simulation clock.
- **Pausing works differently per system:** `ShiftClock.isPaused` for time, a
  `crateMotionPaused` flag plus `body.moves` for crates, zeroed velocities for the player
  and customers, and launch state saved separately.
- **Every new moving system must remember to implement pause itself.**
- Fast-forward, a standard management-sim feature, would mean touching every one of
  these again.

## 🟠 10. DOM UI rebuilds via `innerHTML` with unescaped data

- About **19 template-string HTML blocks**. Most panels replace their whole body on every
  `PlayerState` change.
  - **Lost state:** focus, scroll position, and in-progress input are reset by unrelated
    updates (e.g. credits changing during a shift).
  - **Wasted work:** whole panels re-render when one number changed.
- **Interpolated values aren't escaped** (`UIWindow.js`, `FixtureRenderer.js`,
  `GoBacksWindow.js`). The data is local today, so the security risk is low. It becomes
  real with mods, player-named things, or Steam Workshop content, and any `<` or `&` in a
  name breaks the layout now.
- `WindowManager` modality is cooperative (it closes other windows) rather than a true
  modal layer.

## 🟠 11. Saves have a version number but no migration path

- `SaveManager` writes `version: 1`. The only migration is a one-off fill-in of fixture
  `type` in `FixtureLayout.js`.
- **The save shape is defined in at least 6 places:** `GameScene.serialize/applySave`,
  `ShopSave.validateShopSave`, `PlayerState`, `Market`, `Crate`, `SaveManager`.
- **Several things aren't saved at all:** the supply order draft and `ShiftClock` state
  (shifts aren't resumable, which is intended for now).
- After launch, every patch that changes the save shape risks breaking players' saves,
  and there's no structured way to upgrade them.

## 🟡 12. Tuning numbers and fixture data are hardcoded in JS

- **Balance values live in source code:** shift length and speed, market swing, delivery
  fee, pad capacity, hovercart capacity, fixture prices, sizes, and licenses, throw
  speed, drag, and push weights.
- **Every playtest tweak is a code edit,** and the numbers are scattered across 8+ files.
- **It's inconsistent with the project's own rule** (`AGENTS.md`): "Never hardcode item
  prices, dimensions, or license tiers in JS". Fixtures are exactly that.

## 🟡 13. Testing scene logic needs a Vite server and Phaser mocks

- **154 tests is a good number,** and the pure modules are tested cleanly.
- **Anything touching the scene needs a workaround:**
  - spin up Vite SSR,
  - stub `globalThis.Phaser`,
  - stub `DatabaseManager`,
  - fake physics bodies (`crate-physics.test.js` hand-writes ~100 lines of mock body).
- **This is a symptom of problem 2:** rules aren't separable from Phaser.
- **No test can run a full shift end to end,** which is what balance work actually needs.

## 🟡 14. Fine-grid pathfinding may need profiling on a fully expanded shop

- **Movement now uses heap-based A* on an 8-pixel grid** with a 50,000-node search cap;
  layout reachability still uses the separate grid flood fill.
- **Navigation obstacles are rebuilt for each route request.** This avoids a stale cache
  when the room changes, but may cost more as the shop expands and more employees work.
- **Profile a busy, fully expanded shop** before deciding whether obstacle caching or
  route reuse is needed.

## 🟡 15. Debug features live in production code paths

- `U` (unlock an expansion zone) and `G` (grid overlay) are bound in normal play.
- `DebugInfo` reads nearly every scene field.
- **Nothing is gated** by `import.meta.env.DEV` or a release flag, so players could find
  `U` and unlock a 5,000-credit zone for free.

## 🟡 16. Small duplication and leftovers

- **Rectangle overlap** is written three times (`CratePushing.js`, `FixtureHighlight.js`,
  `FixtureLayout.js`). Distance and tile-to-world math is repeated in several modules.
- **`boot.js` loads `iconset` into `rawIconset`** and never uses it.
- **`Crate.drop()` still multiplies velocity by `CRATE_THROW_MULTIPLIER`** only for old
  saves and old tests. `startThrow()` and `applySave()` have to undo it. That's
  leftover throw-tuning debt from recent work.
- **Crate collision handling runs `restockCrates.find()` per collision,** and the pickup
  hint scans every crate every frame. Cheap now, but it's linear-per-event work.

## 🟡 17. Documentation has drifted from the code

- **The bible** (Step 57) says the map never exceeds one screen and the camera never pans.
  `MapExpansionPlan.md` supersedes it, but the bible wasn't updated.
- **`MapExpansionPlan.md` is out of date:**
  - It describes drag-to-pan and "no player avatar yet."
  - It calls the file `GameScene.js`.
  - It says `Fixture` in `ShopInventory.js` supports "one hand-seeded demo shelf."
  - All of those are obsolete.
- ~~**`AGENTS.md`** says `StoreItem` doesn't capture `license`.~~ Fixed.
- **The bible's anchor-click movement** ("character pathfinding triggers UI upon
  arrival") describes a control scheme the game no longer uses (WASD).
- **Why it matters:** agents and contributors treat these docs as the source of truth,
  so stale docs cause wrong decisions.

## 🟡 18. One 1,470-line stylesheet

- **`space_dealer_window.css` holds every component's styles.** It has good CSS
  variables, but no per-component files or strict naming convention.
- **Collisions get harder to manage** as the Finances, Employees, and Handbook tabs
  arrive.

---

## What's genuinely good

These deserve credit and should survive any restructure:

- **The DOM/Canvas split** and Electron security settings.
- **Pure, well-tested logic modules:** `SupplyOrder`, `CratePushing`, `CustomerPooling`,
  `Market`, `ShiftClock`, `FixtureLayout` validation.
- **Thorough save validation,** atomic native saves, and explicit save-error windows.
- **`FixtureRegistry`** as the single owner of placed fixtures.
- **Item and license data in JSON**, behind `DatabaseManager`.
- **A healthy test count** (154) for a project this size.
- **Consistent comment style** after the documentation pass.
