# Architecture Recommendations

How an experienced JS game developer would likely structure _Space Arms Dealer_ if they
knew, before writing any code, what we know now. Every item below is tied to something
the game actually needs. Nothing here is a rewrite for its own sake.

Companion document: [CodebaseCritique.md](./CodebaseCritique.md) (what's weak today).

## What we know now that we didn't at the start

These are the facts that drive every recommendation below:

- **More NPC types are coming.** Employees can now run the register, stock shelves, and
  move delivered item crates into storage, following each hire's saved job priorities.
  Hauling loose crates from the floor, employee schedules, and breaks remain future work;
  shoplifters and a Military faction are stretch goals. Customers are only the first kind
  of NPC.
- **Items move between many containers:** loading pad crates, floor crates, the hovercart,
  shelf slots, storage lockers, the Go-Backs bin, customer carts, and employee backpacks.
- **The game is UI-heavy.** The Manager's Tablet already has 5 working tabs, with
  the Employee tab now supporting hiring and staff information. Finances and Handbook
  remain to come. Add checkout, Go-Backs, fixtures, dialogue, settings, and "God Window"
  tutorials.
- **Many systems react to the same moments.** A sale or an angry customer touches
  reputation, money, sound, floating text, debug logs, the shift summary, and (soon)
  tutorials and music.
- **The map grows** through zone unlocks, and fixtures move between shifts.
- **The game ships on Steam** as a desktop app, with saves that must survive updates.
- **Balance needs constant tuning:** prices, shift length, market swings, physics feel.

---

## 1. Framework: keep Electron + Phaser 3 + DOM UI

**Verdict: keep it.** Switching engines now would cost months and gain little.

- **DOM for UI is a real strength here.** This is a menu-heavy management sim. HTML/CSS
  beats canvas UI or most engine UI toolkits for tables, tabs, forms, scrolling lists,
  and text-size accessibility.
- **Phaser 3 fits a top-down 2D sim.** We use it for rendering, tile walls, and simple
  arcade collisions, which is exactly its sweet spot.
- **Electron is proven on Steam** (several commercial titles ship this way). It costs
  ~150 MB of download size, which is acceptable.

**With hindsight**, many experienced developers would have chosen **Godot** for its scene
editor, tilemap/navigation tools, and export pipeline. That's a fair choice for a new
project, but it isn't a reason to switch now. Its UI tools are weaker for this game's
heavy menus.

**Changes I _would_ make to the stack:**

| Change | Why |
|---|---|
| **Type checking** via `// @ts-check` + the JSDoc we just added, run with `tsc --noEmit` (`checkJs`). Optionally migrate to TypeScript later. | The codebase passes the scene and plain objects everywhere. Types catch broken contracts (save shape, fixture interface, item payloads) before playtesting does. The new JSDoc makes this almost free. |
| **A small UI component library**: Preact with Signals (or lit-html at minimum). | Replaces hand-written `innerHTML` templates with escaped-by-default components and targeted re-rendering. Signals also give us reactive state (see §6). |
| **A real production build** (`vite.config.js` + `electron-builder` or Electron Forge) and a Steamworks binding (e.g. `steamworks.js`). | The game can't ship today (see Critique §1). Packaging problems found late are expensive. |

---

## 2. Split the simulation from the presentation

**The single biggest structural change.**

Today, game rules live inside the Phaser scene (`GameScene`, ~1,950 lines, 62 fields).
Instead:

```
sim/        Pure JS. No Phaser, no DOM. Owns all game state and rules.
            Shop, Inventory, Customers, Employees, Market, Shift, Orders...
view/       Phaser. Draws the sim, reads input, plays animations.
ui/         DOM. Tablet, windows, HUD. Reads sim state, sends commands.
platform/   Electron/browser: saving, display settings, Steam.
```

- **The sim advances on a fixed tick** (e.g. 20 Hz), independent of frame rate. The view
  interpolates between ticks.
- **The view never changes game state directly.** It sends commands (`stockItem`,
  `throwCrate`, `placeFixture`) to the sim.
- **Physics stays in the view layer** where it's purely visual (crate sliding, bounces).
  The sim only cares about results such as "crate came to rest at x,y" or "crate hit
  customer 12".

**Why this pays off for this game:**

- **Employees** become a sim concept that doesn't need Phaser to reason about work.
- **Saving** becomes "serialize the sim," with no hunting through scene fields.
- **Tests** run the actual rules in plain Node, with no Vite SSR server or Phaser mocks.
  This makes "simulate a full shift" balance tests possible.
- **Pause and speed controls** become one number on the sim clock (see §8).

---

## 3. One agent system for every NPC

Customers, employees, shoplifters, and future factions are all "agents that walk
somewhere and do something." Build one shared foundation:

- **`Agent`**: position, movement, pathing, reservations, and an inventory (customer
  cart or employee backpack).
- **Behaviour as a task queue or small state machine per role.** Example tasks: `GoTo`,
  `TakeFromShelf`, `QueueAtRegister`, `HaulCrate`, `StockShelf`, `WorkRegister`, `Leave`.
- **Roles combine tasks:**
  - Customer: `GoTo shelf → TakeFromShelf → … → QueueAtRegister → Leave`.
  - Employee: picks the top available job from a priority list (bible Step 13/50).
- **A central `ReservationService`** for shelf access points, register queue spots, and
  crates being hauled, so two agents never claim the same spot or crate.
- **A `JobBoard`**: the sim posts jobs ("slot 3 on shelf B is empty", "crate on pad",
  "register unattended"), and idle employees claim them. This is the standard pattern
  for colony and management sims (RimWorld, Two Point Hospital) and directly matches the
  bible's "task priorities" and "break room" design.

Customers today are a 535-line class that calls into the scene directly. Employees
written the same way would duplicate most of it.

---

## 4. One transfer rule for item locations

`InventoryTransfer.transferItems` now handles player stock moves between the hovercart,
Go-Backs, shelves/lockers, and item crates. The containers expose the quantities and
capacity needed by the shared operation:

```js
interface TransferContainer {
  getAvailableUnitsFor(itemId)
  getRemainingUnitsFor(itemId)
  add(itemId, qty)
  remove(itemId, qty)
}
```

- The helper checks available stock and destination capacity, moves only what fits, restores
  any unaccepted units, and emits `inventory-transferred`.
- Shelf-slot placement passes the exact slot, so stocking one shelf stack can't spill into
  another. Existing player-facing messages are unchanged.
- Customer carts now use the same operation when taking one item from a shelf; their existing
  one-of-each shopping rule and price snapshot are unchanged.
- Items in abandoned customer carts now use the same operation when returned to Go-Backs.
- Employee stock clerks use the same operation to move stock from lockers into their
  backpacks and then onto shelf slots.

---

## 5. Fixtures as data + behaviour components

- **Done:** fixture definitions live in `data/Fixtures.json`, alongside items and licenses.
  Prices, sizes, textures, capacities, and license requirements are data; `FixtureLayout`
  continues to provide the same lookup and placement rules.
- The budget shelf (1 tile, 2x2 slots, 10 units per slot) costs 150 credits, the cheapest fixture; the
  compact shelf costs 300 credits; the large shelf costs 2,000 credits. The Fixtures
  menu identifies shelving, storage, and checkout equipment and shows each floor footprint.
  Shelf and locker interaction covers the full front width, within 110 pixels of the front
  edge; side/back positions cannot select a neighboring fixture. Clicking and crate
  delivery use the same rule as E.
- **Give fixtures components instead of `kind`/`instanceof` checks:**

  | Component | Used by |
  |---|---|
  | `Stockable` (shelf grid) | shelves, racks |
  | `Storage` (pool) | lockers |
  | `Register` (queue + checkout) | registers |
  | `Interactable` (E-prompt, opens window) | all |
  | `Footprint` (blocks nav, placement rules) | all |

- **Still to do:** new behavior such as weapon racks with tag restrictions (bible Step 22)
  or a security scanner for the theft stretch goal still needs fixture behavior components
  and currently requires code branches. Once components are in place, new fixture types can
  use data entries instead of adding branches.

---

## 6. Events and a single state root

The bible (Step 3) called for a Master State + Event Bus. The bus now publishes customer
outcomes, shift changes, crate pickup/drop/delivery, fixture opening, register entry/exit,
and inventory transfers. The single state root remains future work.

**Single state root.** One `GameState` object owns economy, inventory, fixtures, crates,
market, shift, orders, and (later) employees. Save = `serialize(GameState)`.

**Current events.** `GAME_EVENTS` carries these game moments:

```
CUSTOMER_HIT_BY_CRATE, CUSTOMER_LEFT_ANGRY, CUSTOMER_MISSING_PRIMARY,
CUSTOMER_SALE_COMPLETED, CRATE_PICKED_UP, CRATE_DROPPED, CRATE_DELIVERY_RESULT,
FIXTURE_OPENED, INVENTORY_TRANSFERRED, REGISTER_SESSION_STARTED,
REGISTER_SESSION_ENDED, SHIFT_STARTED, SHIFT_ENDED
```

Other moments such as shelf-empty notifications and supplier orders remain future events.

**Listeners subscribe instead of being called inline.** The sale code shouldn't know
about audio, floating text, debug logs, or the shift summary:

- `AudioDirector`: sound effects and the shift-state music crossfade (bible Step 37).
- `FeedbackPresenter`: banners, floating text, emote bubbles.
- `ShiftStats`: the end-of-shift summary and finances data.
- `TutorialDirector`: "God Windows" that teach a mechanic the first time it happens
  (bible Step 36/44).
- `DebugInfo`: the playtest event log.

**Reactive UI.** With Preact Signals (§1), UI binds to state slices and re-renders only
what changed. That replaces today's `subscribe` + full `innerHTML` refresh.

---

## 7. Input and interaction as explicit systems

**Control mode as a state machine.** `ControlMode` now resolves the active profile from
the current game state and gates hotkeys and player movement in one place. It prioritizes
loading, fixture placement, blocking windows, register operation, carrying, then walking:

```
Loading > Placing > ModalWindow > AtRegister > Carrying > Walking
```

Each mode declares which actions it allows. Opening or closing a window automatically
changes the resolved mode; only checkout and Go-Backs windows during register operation
remain part of the register profile. Modal windows block gameplay hotkeys and movement.
"Can I press Space right now?" is answered in exactly one place.

**Interactables registry.** Implemented for the current shelves/lockers, crates, and
register. Live sources describe which actions each target supports, how range and priority
are measured, and what prompt to show:

- supported action (interact, pick up, or open Go-Backs),
- usable distance and priority when targets overlap,
- hint text such as "Item x5 | Space: Pick up".

The registry chooses the best valid target for E, Space, or Q and supplies the crate and
register prompts. This replaces the separate nearest-crate and register-range searches.
Doors and employees can use the same system when those interactions are added.

**Key rebinding.** Map actions (`Interact`, `PickUp`, `OpenTablet`) to keys in one table.
Steam players expect rebinding, and it's nearly free with an action map.

---

## 8. Time, pause, and speed

- **One `SimClock` with a `timeScale`.** 0 = paused, 1 = normal, 2–3 = fast-forward (a
  near-universal feature in management sims).
- **Every system reads simulation time from it:** customers, crates, patience, the
  market, and employees. Today, pause is handled separately per subsystem (crate freeze
  flag, clock pause, zeroing customer velocities).
- **Bonus:** a fixed-tick, seeded sim enables **replays and repeatable bug reports**. A
  playtest "Debug Info" capture could include the seed and command log.

---

## 9. World, navigation, and geometry services

- **A `NavGrid` service** owns walkability and updates itself when fixtures move or zones
  unlock (events from §6). Agents re-path when their path is invalidated.
- **A* with a binary heap** (or a mature library like `pathfinding`/`easystarjs`) instead
  of BFS with `Array.shift()`. This matters once the map grows and 5+ employees path
  continuously.
- **Flow fields** for the shared exit, door, and register targets if customer counts get
  large. Optional; measure first.
- **One `geometry.js`** for rectangle overlap, distance, and tile↔world conversion. These
  are currently duplicated in 3+ modules.

---

## 10. Data-driven tuning

- **Move tuning numbers into `data/Tuning.json`:** shift length, market swing, delivery
  fee, pad size, hovercart capacity, throw speed/drag, push weights, patience, and arrival
  rates. Bundle it with the game; validate on load.
- **Hot-reload in dev** and a **debug tuning panel** (sliders) so feel can be tuned while
  playing. Today, every balance tweak is a code edit plus reload, which is most of what
  this project's playtest loop actually is.

---

## 11. Saving built for a shipped game

- **Versioned migrations:** `migrations[1→2]`, `migrations[2→3]`, … applied in order on
  load. Each migration is a small pure function with its own test. Players' saves must
  survive every patch.
- **Schema validation** (e.g. a small schema library or generated validators) instead of
  hand-written checks spread across `ShopSave.js` and each class.
- **Multiple slots and a backup of the previous save**, with Steam Cloud in mind.
- **Save only from the sim layer** (§2), so the save shape lives in one place.

---

## 12. Content and presentation pipeline

- **Strings in one table** (`data/strings/en.json`) if localization is ever likely.
  Moving strings out is cheap now and painful after the Tablet is fully built.
- **Audio assets + `AudioDirector`** listening to events. Keep the synthesized effects
  as placeholders.
- **CSS split by component** (`hud.css`, `tablet.css`, `checkout.css`, …) with the shared
  CRT variables in one base file. This pairs naturally with UI components (§1).
- **Debug tools behind a dev flag** (`import.meta.env.DEV`) so they're stripped from
  release builds.

---

## What we got right (keep these)

- **The DOM/Canvas split.** The core decision was correct.
- **Items and licenses in JSON** behind `DatabaseManager`.
- **Pure, testable logic modules:** `SupplyOrder`, `CratePushing`, `CustomerPooling`,
  `Market`, `ShiftClock`, `FixtureLayout` validation. These are the template for the sim
  layer in §2.
- **Thorough save validation** and atomic native saves with explicit error windows.
- **`FixtureRegistry`** as the single owner of placed fixtures.
- **`PlayerState` subscriptions.** The right idea; §6 generalizes it.
- **Electron security settings** (`contextIsolation`, narrow `preload` bridge).
- **Authoring the max map up front** and unlocking zones (`MapExpansionPlan.md`).

---

## Suggested order

Ordered by what unblocks upcoming features. Each step leaves the game working.

The first employee slice is in place: one hireable employee, provisional hiring and
per-shift wage costs, register service, shelf restocking, crate-to-locker storage loading,
editable saved task priorities, and wage reporting. Hauling loose crates from the floor,
schedules, training, skill grades, and break-room behavior remain future work.

| # | Step | Unblocks |
|---|---|---|
| 1 | Production build + packaging + `checkJs` | Shipping; catching contract bugs |
| 2 | Expand event-bus listeners and move remaining direct consequences behind them | Tutorials, audio, cleaner input; shrinks `GameScene` |
| 3 | **Done:** extend shared stock transfers to customers and employees | Consistent stock movement |
| 4 | **Partly done:** fixtures to JSON; add behavior components | New fixture types without code edits |
| 5 | Extract the sim layer out of `GameScene`, plus `SimClock` | Fast tests, fast-forward, simpler saves |
| 6 | Expand employee automation with shared agents, tasks, and navigation | Loose-crate hauling, schedules, skill grades, and more staff |
| 7 | UI components (Preact/Signals), CSS split | Finances and Handbook tabs |
| 8 | Tuning data + debug panel, save migrations, strings table | Balancing, post-launch patches |
