# Rebuild Baseline

Measurements and safety nets captured from the game **before** the rebuild (git tag `pre-rebuild`).
Every rebuild step must keep these passing. See [RebuildPlan.md](./RebuildPlan.md).

## How to check

| Command | What it checks | Where it runs |
|---|---|---|
| `npm test` | All unit tests, including the golden saves | Locally and on GitHub |
| `npm run check` | Type check and lint | Locally and on GitHub |
| `npm run check:game` | Plays the real game in a hidden Edge window (below) | Locally only |

`npm run check:game` needs the game art in `img/`, which is kept out of git. Copy the `img/`
folder from an existing working copy (or regenerate it with the scripts in `scripts/`) before
running it. Add `--quick` for shorter shifts, or `--only=shift`, `--only=scenarios`,
`--only=replay`, `--only=speed`.

Run `node scripts/browser/check-optional-cleaning.mjs` to check the real game with Cleaning
disabled and enabled, including the trashcan, customers, HUD, and saved trash.

The production build optimizes item pictures while leaving the source art untouched. After
building, `npm run check:build` checks the pictures and Phase 9's 15,000,000-byte size limit.

## Browser checks

- **Scripted shifts** (no staff, then two staff): a real shift at normal speed, then the clock jumps
  to closing. Checks: no errors, sales happen (when staff work the register), at most a quarter of customers give up, stock adds up
  (start − sold = end), everyone leaves, End Day works, and save → load → save changes nothing.
- **Scenarios**: a thrown crate hits a customer and costs reputation; taking the middle crate out
  of a three-high stack; stepping behind each register and back out; an employee refills an empty
  shelf space and gets rid of the empty crate; trash is picked up and binned; every golden save
  loads and resaves exactly as before.
- **Replay**: the same seeded stretch of a busy shift is played twice, once at normal pace (one game
  step per frame) and once fast-forwarded (twelve normal-size steps per frame). Where everyone
  stands, sales, money, and trash must match exactly. Games started with a `seed` replay their
  dice rolls; without one, each session picks its own.

## Golden saves

`tests/golden-saves/` holds seven real saves made by the pre-rebuild game
(`scripts/browser/make-golden-saves.mjs`, never rerun after the rebuild starts):

| Save | What it covers |
|---|---|
| new-game | A brand new shop |
| mid-game | Two shelves, one staff member, one shift played, a delivery on the pad |
| expanded-shop | Every expansion open |
| trash | Trash on the floor |
| crates-in-motion | Crates stacked on the floor, three carried, one mid-throw |
| before-contract-split | Saved before contracts were split up |
| older-layout | Previous save version: retired shelf, retired fixture crate, retired contract, old hovercart, removed employee job (all refunded) |

Each has a `.expected.json` (what the save checker makes of it) and a `.resaved.json` (what the
game saves right after loading it).

## Speed baseline

Busy shop: every expansion open, 6 shelves, 3 staff, a full store (6 customers, the store's cap),
about 30 loose crates. Work the game does per frame (updating and drawing), three runs:

| Run | Average | Slowest 1% | Worst single frame |
|---|---|---|---|
| 1 | 5.78 ms | 16.40 ms | 40.0 ms |
| 2 | 3.57 ms | 14.10 ms | 105.6 ms |
| 3 | 5.76 ms | 15.70 ms | 49.6 ms |

The speed test fails above **9 ms average** or **25 ms for the slowest 1%** (about 1.5× baseline).
The occasional worst-frame spike is recorded but not checked; it should shrink, not grow.

### Shared walk-grid check

The navigation cache reuses room-floor checks across different routes, but still checks current
fixture obstacles and each character's clearance. A changed room walkability key or floor-check
function clears it; rooms without a key do not cache floor cells.

A real-game comparison ran 100 obstructed searches across three nearby start/end pairs, clearing
the route cache before each search to measure floor reuse alone. All paths matched exactly:

| Floor-cell reuse | Floor checks | Total search time |
|---|---|---|
| Off | 147,420 | 42.7 ms |
| On | 11 | 29.9 ms |

Times vary between runs. Regression tests cover shared straight-walk checks, changed floors,
removed cache keys, moved fixtures, and different character sizes.
