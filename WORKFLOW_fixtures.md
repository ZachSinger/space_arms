# Workflow: Fixture Purchasing, Crating, and Licensing (temporary)

Keep this file until every step is complete. Do not invent additional fixture types; confirm
the list with the user before adding any.

## Status

### 1. Fixture types and instances — DONE
- Fixture types are cataloged in `js/logic/FixtureLayout.js`.
- Placed fixture instances are owned by `js/logic/FixtureRegistry.js`.
- Saves migrate the original fixture entries and preserve fixture types.

### 2. Fixture crates — DONE
- Fixture crates use a distinct generated graphic and can be carried, dropped, thrown, saved,
  and restored.
- Fixture crates cannot be stocked in storage.

### 3. Place fixtures from crates — DONE
- Carry a fixture crate and press E to enter the shared fixture placement mode.
- Placement uses the existing layout validation. Cancelling leaves the crate carried.

### 4. Crate up empty fixtures — DONE
- Empty fixtures can be crated only while the store is closed; the crate appears where the
  fixture stood.
- Fixtures with stock cannot be crated, and the last register is protected.

### 5. Buy fixtures — PARTIAL
- The Fixtures tab can purchase shelves and lockers; purchases arrive as crates at the Loading
  Pad. This was verified in the live shop. The already-placed register is treated as unique
  and cannot currently be purchased.
- **Remaining:** agree on which additional fixture types, if any, belong in the game before
  implementing or pricing them.

### 6. Fixture licenses — PARTIAL
- The starting fixture license is active for new and existing players and covers the current
  shelf, locker, and register types. Contracts can describe fixture unlocks.
- **Remaining:** add higher-tier fixture licenses only after the user confirms which real
  fixture types they should unlock. No vending-machine fixture is part of the game.

### 7. Wrap-up — DONE for the current fixture set
- `AGENTS.md`, `TODO.md`, and the design bible have been updated. The test suite passes and the
  production build succeeds.
- Live playthrough with the current shelf and locker types: purchased both, placed the shelf,
  stocked it, confirmed crating is blocked while stocked, emptied and crated it, then saved and
  reloaded. Both fixture crates were restored.
- The temporary plan remains until Steps 5 and 6 are complete.

## Confirmed decisions

1. New fixture licenses appear in the Contracts tab.
2. Crating an empty fixture spawns its crate where it stood; the player carries it by hand.
3. Fixture placement and crating require the store to be closed.
4. Fixture crates use generated artwork.
5. Selling fixtures back for partial credit is later work and remains in `TODO.md`.
6. Do not add a vending-machine fixture; that was an unsupported guess and has been removed.
