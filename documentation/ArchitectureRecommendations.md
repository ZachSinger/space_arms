# Architecture Recommendations

How an experienced JS game developer would likely structure _Space Arms Dealer_ if they
knew, before writing any code, what we know now. Every item below is tied to something
the game actually needs. Nothing here is a rewrite for its own sake.

Companion document: [CodebaseCritique.md](./CodebaseCritique.md) (what's weak today).

## What we know now that we didn't at the start

These are the facts that drive every recommendation below:

- **More NPC types are coming.** Employees (bible Part 6) haul crates, stock shelves, work
  the register, take breaks, and have their own backpacks. Shoplifters and a Military
  faction are stretch goals. Customers are only the first kind of NPC.
- **Items move between many containers:** loading pad crates, floor crates, the hovercart,
  shelf slots, storage lockers, the Go-Backs bin, customer carts, and soon employee
  backpacks.
- **The game is UI-heavy.** The Manager's Tablet already has 5 working tabs, with
  Employees, Finances, and Handbook still to come. Add checkout, Go-Backs, fixtures,
  dialogue, settings, and "God Window" tutorials.
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

## 4. One container model for every item location

Every place an item can sit should implement the same interface:

```js
interface Container {
  canAccept(itemId, qty) -> { ok, reason }
  add(itemId, qty)
  remove(itemId, qty)
  entries() -> [{ itemId, qty, ... }]
}
```

- **Implementations:** `PoolContainer` (hovercart, Go-Backs, lockers, employee backpacks,
  customer carts), `ShelfContainer` (spatial grid slots), `CrateContainer`.
- **One `transfer(from, to, itemId, qty)` function** owns all movement rules: capacity,
  stacking, license checks, and the resulting events. Right-click to cart, stocking from
  the cart, delivering a crate to a locker, a customer grabbing an item, and an employee
  restocking all go through it.
- **Result:** one place to fix bugs and one place for employees to call. The UI shows
  the same `reason` text everywhere.

---

## 5. Fixtures as data + behaviour components

- **Move `FIXTURE_TYPES` to `data/Fixtures.json`**, alongside items and licenses. Prices,
  sizes, textures, capacities, and license requirements become data.
- **Give fixtures components instead of `kind`/`instanceof` checks:**

  | Component | Used by |
  |---|---|
  | `Stockable` (shelf grid) | shelves, racks |
  | `Storage` (pool) | lockers |
  | `Register` (queue + checkout) | registers |
  | `Interactable` (E-prompt, opens window) | all |
  | `Footprint` (blocks nav, placement rules) | all |

- **New fixture types become JSON entries**, for example a weapon rack with tag
  restrictions (bible Step 22) or a security scanner for the theft stretch goal. They
  don't need new `if (kind === …)` branches scattered through the scene.

---

## 6. Events and a single state root

The bible (Step 3) called for a Master State + Event Bus. We built the state part halfway
and never built the bus.

**Single state root.** One `GameState` object owns economy, inventory, fixtures, crates,
market, shift, orders, and (later) employees. Save = `serialize(GameState)`.

**Domain events.** A typed event bus carries game moments:

```
SaleCompleted, CustomerAngered, CustomerHitByCrate, CrateDelivered, ItemStocked,
ShelfEmptied, ShiftOpened, ShiftSoftClosed, ShiftEnded, OrderPlaced, LicenseBought …
```

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

**Control mode as a state machine.** Today, separate flags (`carriedCrate`,
`fixturePlacement.active`, `operatingRegister`, `startingShift`, `loadFailed`, window
state) are re-checked in many methods. Instead, use one `ControlMode` stack:

```
Walking → Carrying → Placing → AtRegister → ModalWindow → Cutscene/Loading
```

Each mode declares which inputs it handles. Entering a window pushes `ModalWindow`;
closing pops it. "Can I press Space right now?" is answered in exactly one place.

**Interactables registry.** Shelves, crates, the register, doors, and later employees
register an interaction with:

- a range,
- a priority,
- a key (E / Space / Q / click),
- a hint label ("Item x5 | Space: Pick up").

One system picks the best target each frame and drives the context message area. That
replaces hand-written nearest-crate and register-prompt logic. Adding a new interactable
becomes a registration, not a scene edit.

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

| # | Step | Unblocks |
|---|---|---|
| 1 | Production build + packaging + `checkJs` | Shipping; catching contract bugs |
| 2 | Event bus + `ControlMode` stack + interactables registry | Tutorials, audio, cleaner input; shrinks `GameScene` |
| 3 | Container interface + `transfer()` | Employees, consistent UI messages |
| 4 | Fixtures to JSON + components | New fixture types without code edits |
| 5 | Extract the sim layer out of `GameScene`, plus `SimClock` | Fast tests, fast-forward, simpler saves |
| 6 | Agent/task system + `JobBoard` + `NavGrid` | **Employees** (the next big feature) |
| 7 | UI components (Preact/Signals), CSS split | Finances, Employees, Handbook tabs |
| 8 | Tuning data + debug panel, save migrations, strings table | Balancing, post-launch patches |
