# Project Audit — November 18, 2026

A full check-up of Space Arms Dealer: how playable it is, what's built compared with what
was planned, how healthy the code is, and what a rewrite would take.

This replaces [CodebaseCritique.md](./CodebaseCritique.md) and
[ArchitectureRecommendations.md](./ArchitectureRecommendations.md) as the current picture.
Those two are still worth reading for background, but their numbers are out of date.

---

## 1. The short version

- **The game works.** The base shop loop (order stock, stock shelves, serve customers, end the
  day, grow the store) is complete and playable from a new game. All 618 automated tests pass
  and the release build succeeds.
- **The base game is about 80% finished; the post-base modules have barely started.** 148 to-do
  items are done and 37 are open. Of the 11 planned post-base modules, only Cleaning has
  started (1 of its 3 parts).
- **The code works but has grown in a way that will slow every new module down.** One file
  (`game.js`, the main shop scene) does almost everything. It was flagged as the #1 problem
  three days ago at about 1,950 lines; it's now about 4,500 lines with 223 functions.
- **My recommendation: rebuild in place, not a from-scratch rewrite.** Build the new structure
  next to the old one and move one system at a time, with the game playable after every step.
  A full rewrite would risk losing hundreds of small feel fixes we've tuned over many sessions.

---

## 2. Status as a playable build

| Area | State |
|---|---|
| Start a new game, play shifts, save and load | Works |
| Ordering stock, crates, carrying, throwing, stacking | Works, heavily tuned |
| Shelves, prices, customers, register (card, cash, Explorer Chit) | Works |
| Employees (register, stocking, putting crates away) | Works |
| Contracts, Store Levels, expansions, fixtures | Works |
| Manager's Tablet (all tabs), Handbook, Finances | Works |
| Controller support | Works on keyboard-simulated tests; **never tried on a real pad** |
| Packaging into a Windows .exe | Works (`npm run package`) |
| Cleaning, slice 1 (trash) | Works, needs a playtest |

**What stops it feeling like a finished base game:**

1. **Placeholder map art.** Floors, walls, and rooms look bad (open art to-do).
2. **Pricing is shallow.** The only decision is pressing "Mkt price" before each shift (new
   to-do).
3. **Shift pacing.** The player is tied to the register; the 7-minute day test is pending.
4. **No onboarding.** The start-of-game tutorial flow is deferred.
5. **Controller untested on real hardware**, and there's no button remapping.
6. **No Steam integration** (achievements, store page) yet.

---

## 3. Built vs. planned

### Base game (the bible, Steps 1–68)

Nearly all built. Still open from the bible: the pre-shift onboarding flow (Step 44) and
re-tuning customer shopping-list sizes. Employee training was removed during the menu cleanup
and is waiting on a design talk.

### Post-base modules

| Module | Design doc | Built |
|---|---|---|
| Cleaning | Yes | Trash part done; dirt/mop and employee cleaning not started |
| Shooting Range | Yes | Not started |
| Drone Deliveries | Yes | Not started |
| Hovercart (new design) | Yes | Not started |
| Presentation Level | Yes | Not started |
| Gunsmithing, Repair, Vehicle sales, Vehicle repair | No | Not started |
| Security / thieves | No | Postponed |
| Shop customization / tinting | No | Not started |
| Steam co-op | No | Not started |

### Bible stretch goals

None started: shoplifter mini-game, Military faction, faction rewards, alternative
bankruptcy (partly covered by the emergency loan), supplier discovery.

---

## 4. Code audit

### What's genuinely good (keep all of this)

- **618 tests that run in about 2 seconds.** That's a real safety net, and rare for a hobby game.
- **Money is handled in whole cents**, so totals never drift.
- **Saves are checked before they're loaded**, and broken saves are refused instead of
  corrupting the game.
- **Game content lives in data files** (245 items, 71 contracts, fixtures, employees).
- **Electron is set up safely** (the game page can't touch the computer directly), and save
  files are written safely so a crash mid-save can't destroy them.
- **The tech choice is right.** Electron + Phaser for the shop + HTML for menus fits a
  menu-heavy shop sim. Changing engines would cost months and gain nothing.

### The problems, ranked by how much they'll hurt the coming modules

**1. One file runs the whole shop (critical).**
`js/scenes/game.js` is about 4,500 lines, has 223 functions, and sets about 224 pieces of
state. It holds at least 16 separate jobs: setup, input, camera, backroom, fixtures,
employees, saving, messages, debug tools, pathfinding, supply, trash, crates (about 670 lines
alone), the register (about 440), customer spawning (about 400), and the end of the day. Its
`create()` function alone is about 470 lines.
*Why it hurts:* every module (range, drones, hovercart) has to be wired into this one file,
so each feature makes the next one harder and riskier.

**2. Characters reach back into the shop file to get things done (critical).**
Customers and employees call shop functions directly and read the shop's lists. Employee code
touches the shop 55 times, customer code 43 times, and the tablet 50 times. Eighteen calls use
the "only if it exists" form (`scene.dropTrash?.()`), mostly so the fake shops in tests don't
crash.
*Why it hurts:* drones, hovercart, and shooting-range customers would each need this same
web of direct calls.

**3. Customers and employees each have their own walking and pathfinding (high).**
They're two separate implementations of "walk to a spot, get unstuck, try again." The hovercart
(follows you), drones, and range customers will need a third, fourth, and fifth copy unless
movement becomes one shared piece.

**4. No single place holds the game's state (high).**
Money and inventory live in `PlayerState`, prices in `Market`, crates and fixtures and trash in
the shop scene, and items in the database. Saving gathers from all of them. The event system
exists but is used for only a few events; most things call each other directly.
*Why it hurts:* every new module has to be hand-wired into saving, the end-of-day summary, and
the HUD.

**5. Items in containers follow different rules per container (high).**
Shelves, crates, the loading pad, Go-Backs, and customer carts each move stock their own way.
Drone Deliveries adds mixed-item crates, the first crate holding more than one kind of item,
and the hovercart adds "crates on a cart that count as held." Both stretch these rules.

**6. On-screen hints are hand-assembled (medium).**
The "E: Pick up the trash / Space: Throw your crate" lines are built by one long function
that checks every situation by hand. Each new tool (mop, hovercart's Gear Modifier button,
drone crate filling) has to be added there and kept in sync with what the buttons really do.
The throwing change today needed fixes in 3 places plus tests.

**7. Menus are built two different ways (medium).**
Some menus are written as text templates, others are built element by element. The single
stylesheet is now over 3,000 lines (it was 1,470 at the last critique) with 7 forced-override
rules.

**8. Tuning numbers are scattered (medium).**
Customer speed, employee timings, market swings, trash rates, and reputation penalties each
live in their own file. Balancing a module means hunting through many files.

**9. Saves have version numbers but upgrades are handled case by case (medium).**
Old-save fixes, like the contract split, are one-off flags. Each module adds a save section, so
this needs an orderly upgrade chain before the game ships to players with real saves.

**10. Leftovers and test fakes (low).**
- **Unused modules.** Four modules (about 480 lines) aren't used by the game any more:
  `CapacityGauge`, `DialogueWindow`, `ShelfIconDisplay`, `ShelfStockDisplay`.
- **Debug code in the main game.** Debug tools (`SandboxRoom`, `UiLab`, debug keys) live
  inside the real game code.
- **Test fakes tied to internals.** Many tests build fake shops that copy the shop file's
  internals, so moving code around breaks tests even when the game still works.
- **No quality checks.** There's no linter, no type checking, no "npm test" command, and no
  automatic checks.

### Performance

Nothing is measurably slow today, but several things will get worse as the shop grows:

- **The game does a lot of work 60 times a second.** It sorts people for drawing, checks every
  shelf, updates the hint text, refreshes the customer pool, schedules arrivals, and more. Much
  of that only needs to happen when something changes.
- **Pathfinding uses a very fine grid.** It works in 8-pixel steps and may check up to 50,000
  spots per search. With a full shop, many customers, employees, and drones, this is the first
  thing likely to stutter.
- **The fixture-placement overlay takes about 10 seconds to draw.** This is already a known
  to-do.
- **Item icons are oversized.** Each small icon is stored at up to 0.5 MB. Shrinking them and
  packing them into one sheet would cut the 51 MB build to a fraction and speed up loading.
- **The game code is one 2 MB file.** That's fine for a desktop game, but it would shrink
  with the cleanup.

---

## 5. What a rewrite would look like

### The target structure

1. **One game state, separate from the drawing code.** All money, stock, fixtures, crates,
   trash, staff, and time live in one place that knows nothing about Phaser. It can be saved
   in one go, tested without fake shops, and run faster than real time for balance testing.
2. **Systems instead of one big file.** Each job becomes its own system that runs every tick:
   economy, inventory, customers, staff, fixtures, crates, checkout, cleanliness, shift. Each
   new module is a new system, not new lines in a shared file.
3. **Modules plug in.** A module like the Shooting Range registers its own fixtures, its own
   kind of customer, its own tablet tab, its own save section, and its own tuning numbers.
   Nothing else has to be edited.
4. **One "character" with swappable behaviours.** Walking, pathfinding, and getting unstuck
   are written once. Customers, employees, range shooters, drones, and the hovercart are
   behaviours on top.
5. **One container rule.** Shelves, crates, carts, drone crates, and the hovercart are all
   "containers," with one move rule that handles mixed items where allowed.
6. **Hints come from actions.** Anything you can interact with declares what each button does
   right now. The bottom hint bar and the Handbook controls list are built from that, so they
   can never disagree with what the buttons do.
7. **One tuning file per area.** All the numbers for balancing are in data files, not code.
8. **Saves with an upgrade chain.** Every save version knows how to upgrade to the next one.
9. **One way to build menus**, plus a split stylesheet (one file per window).
10. **Quality tools:** type checking, a linter, `npm test`, and automatic checks.

### Option A: full rewrite from scratch

- **Effort:** roughly the size of what exists, about 21,000 lines of game code plus test
  rewrites. Expect something like 4–8 weeks of steady sessions before it plays as well as
  today's build.
- **Risk: high.** The game would be unplayable for weeks. Hundreds of tuned details (crate
  throw feel, register tuck, queue spacing, stacking rules, the many playtest fixes) would have
  to be rediscovered. Most rewrites of working games ship later and feel worse at first.

### Option B: rebuild in place (recommended)

Same end structure, built one step at a time, with the game playable and tests passing after
every step.

| Phase | What happens | Rough size |
|---|---|---|
| 0. Groundwork | Add type checking, a linter, `npm test`; delete the 4 unused modules; split the stylesheet | 1–2 sessions |
| 1. Game state | Create the single game state and move money, stock, and time into it; one save upgrade chain | 3–4 sessions |
| 2. Shared character | One walking/pathfinding base; customers and employees move onto it | 3–4 sessions |
| 3. Split the shop file | Pull crates, register, customer spawning, fixtures, trash, and saving out of `game.js` one at a time | 5–8 sessions |
| 4. Actions and hints | Interactables declare their actions; the hint bar builds itself | 2 sessions |
| 5. Containers | One container rule (needed before Drone Deliveries and the Hovercart) | 2–3 sessions |
| 6. Module plug-ins | Finish Cleaning as the first plugged-in module to prove the pattern | 2 sessions |
| 7. Performance | Coarser pathfinding, do work only when something changes, shrink icons | 1–2 sessions |

**Total:** roughly 20–27 sessions. It can pause after any phase. Phases 0–3 give most of the
benefit.

**What you'd notice as a player:** nothing should change during the rebuild. Each phase ends
with a playtest of the same shift to confirm it still feels the same.

### Why rebuild in place wins

- The game stays playable, so playtesting and design can keep going.
- The 618 tests stay as the safety net; they're adjusted as code moves instead of thrown away.
- If priorities change halfway, every finished phase is already an improvement.
- The coming modules (Drone Deliveries, Hovercart, Shooting Range) are what most need
  phases 1–5, so the order lines up with the roadmap.

### Suggested timing

Finish the current Cleaning playtest, then do **Phase 0 and Phase 1** before starting any new
module. Do phases 2–5 before Drone Deliveries and the Hovercart, since both depend on them.
