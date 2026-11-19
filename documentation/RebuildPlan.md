# Rebuild Plan — Rebuilding in Place

The detailed plan for the "rebuild in place" option from [ProjectAudit.md](./ProjectAudit.md).
We move the game onto a new structure one system at a time. The game keeps working after
every step.

Each phase starts with **In plain words** (what's happening and why) and then gives the
technical steps. Part 6 at the end lists what an independent review found wrong with the
first draft and how the plan changed because of it.

---

## Part 1 — Ground rules

1. **No gameplay changes during the rebuild.** Crate throws, walking speed, queue spacing,
   prices, timings: everything should feel the same afterwards. If a step changes how the game
   plays, that's a bug in the step. New features wait until the phase they depend on is done
   (see Part 4).
2. **Small steps, each one finished.** Every step ends with all tests passing, the build
   working, and the game starting and running a shift.
3. **Save files keep working.** A save from before the rebuild must load after every step,
   and must still load after being saved again.
4. **Commit after every step** to git, so any step can be undone on its own.
5. **Move code, then improve it, never both at once.** First move a system out unchanged.
   Clean it up in a separate step.
6. **Delete as we go.** Once a system has moved, the old copy is deleted within that phase. A
   short-lived "forwarding" stub is allowed while callers switch over; it must be gone by the
   end of the phase.
7. **Keep the old tests' checks.** When a test has to change because code moved, only the
   setup changes. What it checks (the inputs and expected results) stays the same.
8. **Short feel checks where automation can't see.** Automated checks cover most steps. After
   any step that touches walking, crate physics, controls, or the camera, there's a required
   5-minute check with exact steps (for example: "throw a crate at a customer; stack 3 crates
   and pick the middle one; tuck behind the register with a controller"). No full playtests.

### Safety nets (built in Phase 0)

| Net | What it catches |
|---|---|
| Existing 618 unit tests | Rule mistakes (prices, stacking, saves, reputation) |
| Golden save files | Old saves that stop loading, load wrong, or break after re-saving |
| Scripted shift (headless browser, normal speed) | Crashes, stalls, or quiet failures during real play |
| Targeted scenarios (headless browser) | Specific feel-sensitive things: throws, stack selection, register tuck, staff jobs |
| Type checking + linter | Typos and calls to things that no longer exist after a move |
| Performance baseline | Steps that quietly make frames slower |
| Build + packaged-app check | Missing art, broken asset copying, the real desktop app failing to start or save |

---

## Part 2 — Where we're going

### Folder layout

```
js/
  core/        Shared building blocks with no game rules: events, clock and pause,
               seeded random numbers, tuning loader, html helper.
  state/       Saved game data and the functions that change it. No Phaser, no page.
    migrations/  One file per save-format upgrade step.
  systems/     Rules that run over time: shift, customer flow, checkout, supply, market,
               fixtures, staff jobs.
  world/       Phaser side: areas and doors, fixture sprites, crate bodies, characters'
               bodies and walking, camera, messages.
  actors/      Shared movement core plus customer and employee behaviour.
  input/       Input contexts, held modifiers (Gear Modifier), tap vs. hold.
  interaction/ What each interactable offers; the hint bar and button presses read the same answer.
  ui/          Menus, tablet tabs, HUD, checkout, handbook.
  modules/     Add-ons: cleaning/ now; later shooting-range/, drones/, hovercart/, presentation/.
  debug/       Debug tools (kept in dev builds), labs and sandbox (never in the real game).
  scenes/      Thin Phaser scenes that create the pieces above and connect them.
data/tuning/   Balancing numbers, one file per area.
styles/        tokens.css + one stylesheet per window.
```

### The core ideas

**1. One game state, with an honest boundary.**
Everything that gets saved is reachable from one `GameState` made of slices:
`economy`, `reputation`, `catalog`, `market`, `staff`, `calendar`, `shop`, `crates`, `trash`.
Each slice has `serialize()` and `hydrate()`, and only its own functions may change it.

- Pure-data slices (money, reputation, contracts, staff records, market) hold their data
  directly.
- **Physical things** (crates and anything Phaser's physics moves) keep their position and
  motion in the world layer. Their slice holds a stable ID, what they contain, and where they
  sit (floor, stack, held, pad), and takes a **snapshot** from the world at save time. This
  keeps the physics feel exactly as it is.
- Loading happens in stages: read file → upgrade old formats → **check the whole save** (cross-
  slice rules like "ledger day matches market day", "fixtures fit the unlocked rooms") →
  build the complete new state → only then rebuild the world and tell the UI. A bad save
  can't half-load.

**2. Systems with explicit dependencies.**
Each system is created with exactly what it needs:
`new CheckoutSystem({ state, events, clock, tuning, registers })`. Nothing reaches up into the
scene. Tests build a system with small fakes of its listed dependencies.

**3. Commands are calls, facts are events, decisions are rules.**
- *Commands*: direct calls to the owning system (`checkout.startSession()`).
- *Facts*: events after a change has finished (`sale-completed`, `trash-dropped`). Listeners
  never see a half-finished change.
- *Decisions*: when an add-on must be able to change an outcome **before** it happens, the
  owning system runs a list of rules first. Example: the reputation from a sale is worked out,
  then each rule may adjust it (Presentation: "no gain if presentation is too low"), then it's
  applied, then `reputation-changed` fires. Events alone can't do this; a listener can only
  react after the reputation was already given.
- UI change notifications are **batched**: many changes in one frame cause one redraw. Every
  listener has an "unsubscribe" so closed menus stop listening.

**4. Areas and doors.**
The shop is one Phaser world split into **areas** with IDs (`shop`, `backroom`, later `range`)
linked by **portals** (the backroom door now; stairs later). Today the game decides "am I in
the backroom?" from a height cutoff and a yes/no flag. That becomes "which area is this
point in", used by the camera, placement, saves, interaction, and pathfinding. Everything stays
in one Phaser scene; no new scenes are needed.

**5. Shared movement core.**
Customers and employees share one `Mover`: follow a path, slide around corners, notice being
stuck, re-plan, give up. It has hooks for the differences (employees' teleport waypoints,
skill-based speed, job-specific recovery). Their decision-making stays as it is until
movement is proven identical. Turning behaviour into reusable "activities" happens later and
only if a real feature needs it (employees who clean, range shooters).

**6. Containers, with permissions.**
This builds on the existing transfer helper rather than replacing it. Every stock holder
(shelf slot, crate, pad, Go-Backs, customer cart, later drone crates) is a container with:
- a stable ID and exactly one location (a crate is in one place only);
- **permissions** for putting in and taking out, which may depend on context (a drone crate
  accepts only items its order still needs, up to the amount needed, and lets nothing out
  except through reset/cancel);
- capacity and single-item or mixed rules;
- placement details where needed (which shelf slot).

Stock enters the game only from **sources** (supply deliveries, Go-Backs repack) and leaves
only through **sinks** (sales, drone shipments). The check is "every change is a transfer,
source, or sink", not "the total never changes".

**7. Input contexts and actions.**
- **Input layer:** which mode you're in (walking, menu, placing, register), which keys are
  held (the Gear Modifier), and whether a press was a tap or a hold. It sorts out conflicts once:
  Shift already dashes and the left bumper already zooms, so the plan decides here how the
  Gear Modifier shares or takes those buttons.
- **Action layer:** each interactable lists what it offers for the current input state
  (`getActions(player, input)`), with player-facing reasons when something isn't available.
  The hint bar and the button press use the **same** answer, so hints can't lie.

**8. Hands vs. reach.**
"Crates in your hands" (affects speed, register access, saving) and "crates you can stock
from right now" (hands, plus later the hovercart if it's parked next to you) are two separate
lists. The shelf menu uses the second, and updates instantly if the hovercart drifts away.

**9. Modules plug in.**
A module folder registers what it adds: state slice, systems, interactables, rules, tuning,
HUD stat, handbook topic, customer traits, save upgrade steps. The shape is **pulled out of
Cleaning** in Phase 8, then checked on paper against Shooting Range, Drone Deliveries, and
Presentation before it's final.

### Standards
- **Types and lint:** plain JavaScript with JSDoc types checked by TypeScript (`checkJs`).
  Strict checking turns on folder by folder as code moves in.
- **Tuning:** balancing numbers move into `data/tuning/*.json` **when their system is
  extracted** (not all at once), with a description and allowed range for each value.
- **Menus:** one `html` template helper that escapes text automatically, and one "bind after
  render" pattern. Converted window by window.
- **Saves:** one version number with an ordered upgrade chain (see Phase 2).
- **Random numbers:** one seeded source for gameplay randomness. Replays repeat exactly only
  on the same machine and browser, which is enough for our tests.

---

## Part 3 — The phases

Sizes are in working sessions like the ones we've been doing. Phase 7 (menus) can run any
time after Phase 1. Everything else is in order.

### Phase 0 — Safety nets and cleanup (3 sessions)

**In plain words:** set up the checks that tell us we broke something, before we move anything.

1. **Baseline:** commit current work, tagged `pre-rebuild`.
2. **Commands:** `npm test` (all tests), `npm run check` (types + lint, warnings only for old
   code).
3. **Golden saves:** 6–8 saves from the current game in `tests/golden-saves/`:
   - a new game;
   - mid-game with employees and crates;
   - a big expanded shop;
   - a save with trash;
   - a save from before the contract split;
   - a save with a crate in mid-air and crates carried and stacked;
   - an older-layout save that triggers the retired-fixture refund.

   Each test does load → check details → save → load again → check the same details. The
   details include money, refunds, contracts, every shelf's stock, crate contents and places,
   staff, and trash.
4. **Scripted shift at normal speed:** start a game with the debug quickstart, stock shelves,
   run a full shift, then End Day. It checks:
   - no errors;
   - sales happen;
   - the share of customers who gave up or got stuck stays within a set limit;
   - employees finish their jobs;
   - stock totals match sales;
   - End Day works.

   A second run does the same with two employees. (Normal speed takes a few minutes, which is
   fine for a check that runs on every phase, not every edit.)
5. **Targeted scenarios:**
   - throw a crate and hit a customer;
   - pick the middle crate from a stack of three;
   - tuck behind the register;
   - an employee stocks a shelf and puts an empty crate away;
   - trash is dropped and binned.
6. **Performance baseline:** average and worst frame time with 12 customers and 3 employees
   in a fully expanded shop.
7. **Build checks:** `npm run build` and a packaged-app check that launches the desktop app,
   saves, and reloads. Write down how to get the art that isn't stored in git (so a fresh
   checkout can build).
8. **Delete unused code:** `CapacityGauge`, `DialogueWindow`, `ShelfIconDisplay`,
   `ShelfStockDisplay` and their tests.
9. **Automatic checks on GitHub:** unit tests + type/lint checks on every push. The browser
   and packaged-app checks run locally, because they need the art that isn't in git.

**Done when:** all of the above pass on the baseline.

### Phase 1 — Core building blocks (2 sessions)

**In plain words:** build the small shared tools everything else uses.

1. `core/Events.js`: replaces `EventBus`. It keeps today's event names and adds:
   - one list of every event and its data;
   - events fire only after a change finishes;
   - batched UI notifications;
   - unsubscribe.
2. `core/Clock.js`: pause, shift time, and fixed-size steps. Real-time timers (`Date.now`,
   `setTimeout` in checkout and elsewhere) move onto it so pause applies everywhere.
3. `core/Random.js`: seeded random numbers; replace `Math.random` and Phaser random calls in
   gameplay code.
4. **Fast-forward test:** once the clock and random numbers are in, the scripted shift gets a
   fast mode. It runs several normal-size steps per frame (so physics behaves the same), not
   one big step. The normal-speed version is kept as the reference.
5. `core/Tuning.js`: the loader with range checks. No numbers move yet; that happens per system.
6. `core/html.js`: the escaping template helper.

**Done when:** pause stops every timer, the same seed gives the same shift on the same machine,
and fast and normal runs give matching results.

### Phase 2 — Save foundations and the pure-data state (3 sessions)

**In plain words:** give saving one clean path and one way to upgrade old saves. Then move the
parts of the game state that have nothing to do with the map (money, reputation, contracts,
staff records, market) into the new state. The map-related parts move in Phase 3, one at a
time, as their code moves.

1. **Upgrade chain:** detect which format a file is in (outer `version: 1` plus inner
   `layoutVersion` plus field checks), translate it to one `saveVersion`, then run each upgrade
   step once, in order:
   - today's layout-version steps;
   - the retired-fixture refund;
   - the contract split;
   - shelf overflow.

   The storage key stays the same, and every combination of formats that exists today is
   listed and tested.
2. **Whole-save check** after upgrading and before anything is applied. Today's cross-slice
   checks from `ShopSave` move here unchanged.
3. **Staged loading:** build the full new state off to the side, then swap it in, then
   rebuild the world, then notify.
4. `GameState` with `economy`, `reputation`, `catalog`, `staff`, `calendar`, `market` slices
   carved out of `PlayerState` and `Market`. Shop, crates, and trash are still saved through the
   old code for now, behind the same save function.
5. HUD and menus listen to slice changes instead of being refreshed by hand.

**Done when:** golden saves pass the load → save → load check, and `PlayerState` is gone.

### Phase 3 — Splitting the shop file (7–9 sessions)

**In plain words:** take the 4,500-line shop file apart, one job at a time. For areas with
saved data, the data moves into the game state in the same step.

Order: least connected first.

| Step | New home | What moves |
|---|---|---|
| 3.1 | `debug/` | Debug keys, debug buttons, quickstart (dev builds only); sandbox and UI lab (labs, never in the real game) |
| 3.2 | `world/Messages.js` | On-screen and floating messages, save-error display |
| 3.3 | `systems/ShiftSystem.js` | Start, close, and end shift; End Day; soft close; summaries |
| 3.4 | `systems/SupplySystem.js` | Supply orders, Loading Pad, deliveries |
| 3.5 | `world/Areas.js` | Areas, portals, the backroom, doors, going in and out. Replaces the height cutoff and the yes/no flag with area IDs |
| 3.6 | `world/CameraRig.js` | Zoom, follow, per-area camera |
| 3.7 | `state/shop` + `systems/FixtureSystem.js` + `world/FixtureViews.js` | Zones, expansions, fixtures, placement, buying and selling. **The shop slice moves to the new state here** |
| 3.8 | `systems/CustomerFlow.js` | Arrivals, scheduling, customer pool, exits |
| 3.9 | `systems/CheckoutSystem.js` | Register sessions, queue, tuck, payment results |
| 3.10a | `world/CrateWorld.js` | Crate bodies, throwing, pushing, separation, pad escape (the physics side, unchanged) |
| 3.10b | `state/crates` + `systems/CrateSystem.js` | Carrying, stacks, pick and drop rules, stable crate IDs, save snapshots. **The crates slice moves here** |
| 3.11 | `modules/cleaning/` (first draft) | Trash, bin, cleanliness, highlight. **The trash slice moves here** |
| 3.12 | `world/Navigation.js` | Walk grid, path requests, reachability, routes between areas through portals |

**Each step:**
1. Write characterization tests first for anything the step touches that has no test yet.
2. Move the code unchanged and give it explicit dependencies.
3. Move its balancing numbers into tuning (same values; a test compares them to the old ones).
4. Switch the tests' setup to build the new piece. The checks stay the same.
5. Run the tests, golden saves, scripted shift, and the relevant scenarios. Run the feel check
   if the step touched walking, crates, controls, or the camera. Commit.

**After 3.7, stop and re-estimate.** It's the first step that moves saved map data. How long
it took tells us whether the rest of the plan's sizes are right.

> **Re-estimate after 3.7:** 3.1?3.7 took about as long as planned, and 3.7 (the first saved map
> data move) went through with old saves loading and resaving exactly as before. `game.js` is down
> to about 3,300 lines. The steps left in Phase 3 are the biggest pieces still in it (customers,
> the register, crates), so Phase 3 stays at the top of its range. The total stays about
> **32?34 sessions**. Feel check owed for 3.5?3.7: walking in and out of the backroom, zoom, moving
> a fixture, and buying an expansion.

**Done when:** `game.js` only creates and connects systems (target under 500 lines), and
tests don't need to fake the whole shop.

**Milestone check:** a 5-minute feel check (walk, stock, throw, register, backroom, End Day).

### Phase 4 — Shared movement core (3 sessions)

**In plain words:** customers and employees walk using two separate copies of the same
walking code. Make one shared version with room for their differences.

1. Pull `Mover` out of the customer code, with hooks for arriving, using portals, and
   failing. Customers keep their exact numbers.
2. Put employees on it using the hooks (teleport waypoints, skill speed, job recovery).
3. Characters stop calling the scene directly. They use a narrow "store" interface the
   systems provide.
4. *(Optional, only when a feature needs it.)* Turn behaviour into reusable activities;
   merge the customer and employee art loaders.

**Done when:** one walking implementation, characters don't touch the scene, the scripted
shift's give-up and stuck counts are unchanged, and the walking feel check passes.

### Phase 5 — Input contexts, actions, and hints (3 sessions)

**In plain words:** today the hint bar is a long hand-written list of situations, and every
button has its own if-chain. Give input one place that knows what mode you're in and which
buttons are held. Then have every interactable describe its own actions, so hints always
match what the button does.

1. `input/`: contexts (walking, menu, placing, register, paused), held modifiers, and tap
   vs. hold, with today's timings. Decide the Gear Modifier's buttons here, including the
   conflict with dash (Shift) and zoom (left bumper). This is a design question for the owner
   **Default:** keep the planned Shift / left bumper bindings. They act as the Gear Modifier
   only when combined with a crate action while a parked hovercart is in reach; otherwise
   Shift remains dash and the bumpers remain zoom. This is a design question for the owner
   before the code starts.
2. `interaction/`: `getActions(player, input)` per interactable, with target choice per
   action (an action can target something other than what you're facing, such as the
   hovercart).
3. Convert in order: doors, register, trashcan, trash, shelves, crates (the biggest), fixture
   move.
4. The handbook's controls list comes from the same action list.
5. Today's hint wording tests pass word for word. Tests check that the hint shown and the
   action run are the same, for each case.

**Done when:** the old hint and interact functions are gone, a new interactable needs no
edits outside its own file, and the controls feel check passes.

### Phase 6 — Containers (3 sessions)

**In plain words:** every place that holds stock has its own rules today. Give them all one
set of rules, ready for drone crates (mixed items, locked until reset or cancel) and the
hovercart (crates you can stock from without holding them).

1. Grow the existing transfer helper into the container rules (Part 2, idea 6): IDs, one
   location, put-in and take-out permissions, capacity, mixed or single, slot details.
2. Sources and sinks for deliveries, Go-Backs, sales.
3. A test that runs thousands of random moves and checks that every change was a transfer,
   source, or sink.
4. Split "crates in your hands" from "crates you can stock from" (Part 2, idea 8).

**Done when:** nothing changes stock except through the container rules.

**Milestone check:** a 5-minute feel check (stocking from crates and the pad, Go-Backs, checkout).

### Phase 7 — Menus and styles (3 sessions, any time after Phase 1)

**In plain words:** menus are built two different ways and share one 3,000-line style file.
Use one way, and give each window its own style file. Done one window at a time.

1. Per window: switch to the `html` helper; each tablet tab gets the same shape (draw, bind,
   redraw when its data changes).
2. Split the stylesheet into `tokens.css` + one file per window; remove unused rules and the
   forced overrides.
3. Screenshot comparison per window before and after, with fixed fonts, window size, and
   animations off, and a small tolerance.

**Done when:** every window uses one pattern and every screenshot matches.

### Phase 8 — Modules plug in (2 sessions)

**In plain words:** finish turning Cleaning into a self-contained add-on, and use it to set the
pattern for every future add-on.

1. Pull the plug-in shape out of Cleaning.
2. Check it on paper against:
   - **Shooting Range:** a new area, stairs portal, lanes, range customers, no entry after 1800;
   - **Drone Deliveries:** orders, locked mixed crates, terminal, pad;
   - **Presentation:** a reputation rule that blocks gains but not losses.

   Change the shape wherever one of them doesn't fit.
3. Write `documentation/ModuleGuide.md`, and update `AGENTS.md` with the new structure.

**Done when:** turning Cleaning off in one line removes it cleanly, and all three paper checks fit.

### Phase 9 — Performance and build size (2 sessions)

**In plain words:** make the slow parts fast, measured against the Phase 0 baseline.

1. Per-frame work only when something changes (shelf glow, hints, pool refresh).
2. Pathfinding: cache the walk grid per layout, reuse paths, and limit searches per frame.
   Only coarsen the grid if measurements demand it and the scripted shift shows the same routes.
3. The slow fixture-placement overlay.
4. Icons: shrink them to display size and pack them into atlases. The build's art copier
   learns about atlases.

**Done when:**
- frame times beat the baseline;
- the game's files (not the installer) are under 15 MB;
- the packaged-app check passes.

**Final milestone check:** a 10-minute feel check across the whole game.

### Total

About **31–33 sessions**, re-estimated after step 3.7. Phases 0–3 give the biggest payoff.
After Phase 3, any finished phase is a safe place to pause and build features.

---

## Part 4 — How the planned features fit

| Feature | Can start after | Why |
|---|---|---|
| Cleaning slice 2 (dirt, mop bucket) | Phase 5 | Dirt marks and the mop bucket are interactables. "Press E to fill the gauge" is a hold action |
| Employees who clean | Phase 4 | A new job on the shared movement core |
| Presentation | Phase 3 (checkout) + Phase 8 | Decorations are fixtures with a value. The "no gain if too low" rule is a reputation rule |
| Drone Deliveries | Phase 6 | Locked mixed crates tied to an order ID; filling from nearby crates and shelves are actions |
| Hovercart | Phases 4, 5, 6 | Follows you on the shared movement core; Gear Modifier in the input layer; "can stock from" list |
| Shooting Range | Phases 3 (areas), 4, 8 | New area plus stairs portal; range customers route between areas |
| Pricing revamp | Phase 3 (customer flow) | Price reactions become tuning and one system |
| Co-op multiplayer | After all phases | Only realistic once state, commands, and randomness are centralized. Not promised by this plan |

---

## Part 5 — Risks

| Risk | How we contain it |
|---|---|
| A move quietly changes how something feels | Move unchanged first; scripted shift with give-up limits; targeted scenarios; feel checks after walking, crate, control, and camera steps |
| Old saves break | Format detection, upgrade chain, whole-save check, staged loading, load → save → load golden tests |
| Tests lose their meaning when rewritten | Only setup changes; characterization tests are written before each move |
| The plan's sizes are wrong | Re-estimate after step 3.7; any finished phase after Phase 3 is a safe pause |
| Over-designing | Ideas are pulled from existing code. Activities and art-loader merging only happen when a feature needs them. The plug-in shape comes from Cleaning and is checked against three real designs |
| Added layers slow frames | Batched notifications; physics sync kept separate from UI events; baseline checked after Phases 3, 4, and 9 |
| A fresh checkout can't build | Art setup written down in Phase 0; browser and packaged-app checks run locally |

---

## Part 6 — Review findings and what changed

An independent review of the first draft found these problems. All are fixed above.

| # | Problem in the first draft | Change |
|---|---|---|
| 1 | Moving map data (fixtures, crates) into the new state *before* splitting the shop file wasn't realistic, because that data is tangled with sprites and physics | Phase 2 now covers only map-free data. Map data moves in Phase 3, in the same step as its code (3.7, 3.10b, 3.11) |
| 2 | The 10× scripted shift needed a clock and seeded random numbers that didn't exist yet, and simply speeding up time would change how customers walk versus how patient they are | Phase 0 uses normal speed. Fast mode arrives in Phase 1, using several normal-size steps per frame. "Repeatable" now means on the same machine |
| 3 | "One sale and the shift ended" can pass while customers are quietly getting stuck and giving up | The scripted shift checks give-up and stuck limits, staff jobs, and stock totals. Targeted scenarios were added. Required 5-minute feel checks after walking, crate, control, and camera steps |
| 4 | Saves have two version numbers plus field-based fixes, and the save loader rejects unknown versions; "one version number" skipped how to get there | Phase 2 starts with format detection and an ordered upgrade chain. Golden tests do load → save → load and cover refunds, the contract split, mid-air crates, and stacks |
| 5 | Some save checks span several parts (ledger day vs. market day), so per-part checks would miss them | Whole-save check after upgrading, and staged loading so bad saves can't half-apply |
| 6 | Putting hovercart crates in the "held" list would also slow you down and block the register | "Crates in your hands" and "crates you can stock from" are separate lists |
| 7 | The container idea had no way to say "drone crates accept only what the order needs and let nothing out", and replaced a helper that already works | Containers grow from the existing helper and gain put-in/take-out permissions, IDs, and one location. Sources and sinks replace "the total never changes" |
| 8 | The Gear Modifier is a held key, not a button, and Shift and the left bumper are already used | New input layer (contexts, held modifiers, tap vs. hold) before actions. The button choice is flagged as an owner decision |
| 9 | "Second room like the backroom" doesn't work: the backroom is detected by a height cutoff and a yes/no flag | Areas with IDs and portals (step 3.5), used by camera, placement, saves, interaction, and pathfinding |
| 10 | Merging customer and employee walking also tried to rewrite their behaviour, and employees' differences are more than different numbers | Shared movement core with hooks first. Behaviour rewrite is optional and feature-driven |
| 11 | Rewriting old tests during moves could quietly delete what they check | Only test setup changes; characterization tests are written before each move |
| 12 | Change notifications could cause repeated redraws and show half-finished changes | Events fire after changes finish; UI notifications are batched; listeners can unsubscribe |
| 13 | Presentation must stop reputation gains *before* they happen; an event fires too late | "Rules" extension point for decisions, checked against Presentation in Phase 8 |
| 14 | "Move every number", "strict types everywhere", and "every menu at once" were hidden big jobs | Tuning, strict types, and menus are now done per system or per window. Estimate re-checked after step 3.7 |
| 15 | Fresh checkouts can't build (art is not in git), and browser tests can't check the real desktop app | Art setup is written down; a packaged-app check is added; the 15 MB goal is defined as game files. `AGENTS.md` gets updated |

Net effect on size: **24–32 → 31–33 sessions**, mostly from the interleaved Phase 3, the new
input layer, and stronger save work.
