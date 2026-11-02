# TODO

Running task list. Consult this before deciding what to work on. Add to it any time we
notice something that needs doing but isn't being done right now.

## Art / Assets
- [ ] `att_stk_08` (Blackwood Ordnance Counter-Weight Stock) is using a placeholder image
      (`_Bonus_Variety/attachments_stocks/stock-tech-black-blue-orb.png`), not real art made
      for this specific item. Replace with a proper generated icon.
- [ ] No dedicated player sprite exists yet -- `Player.js` reuses one customer character's
      art (tinted cyan to stand out). Replace with real player-specific art eventually.
- [x] ~~Crop/bleed artifact in `mercenary_01_right.png`~~ -- moot, Sixth Generation customer
      art was fully replaced by Seventh Generation (see below); the file no longer exists.
- [x] Customer art upgraded Sixth -> Seventh Generation: 32 characters (128 images) kept
      from 8 of the 10 new sheets (excluded 2 that were in a different, chunkier pixel-art
      sub-style). Higher hit rate this time -- all 40 characters reviewed passed the
      same-character-across-all-4-facings check (vs 21/40 last generation). See
      `scripts/extract_seventh_gen_sprites.py`.

## Known Issues
- [x] ~~Dead-end bug: `this.fixture` never restocks~~ -- fixed by the Procurement MVP below.
      The player can now order more stock (Supply tab), haul the resulting crate in from
      the Loading Pad, and deliver it to the shelf, indefinitely.

## Bigger Features Not Yet Built (from the bible)
- [x] Player avatar (`js/logic/Player.js`): WASD/arrow movement, collides with walls/
      fixtures but not customers (bible Step 30/58), camera now follows it instead of the
      old drag-to-pan placeholder. Needed as a prerequisite for the physical procurement
      loop below (hauling crates requires a player who can walk to them).
- [x] Procurement MVP (Step 10): a `loading_pad` RoomLayout zone, a `Crate` class, and a
      real Supply tab (`SupplyRenderer.js`) that orders more stock for whatever the one
      demo fixture already sells. Ordering spends credits and spawns a crate at the
      Loading Pad; press E near it to pick it up, carry it to the shelf, press E again to
      deliver (restocks that item). Deliberately simplified vs. the bible's full vision --
      logged below, not yet built:
  - [ ] No backroom intermediate storage stage yet -- crates go straight from the Loading
        Pad to the sales-floor shelf, skipping Storage Fixtures / the Storeroom entirely
        (bible Step 42). `locker_storage.png`/`shelf_frame_*` art already exists, unused.
  - [ ] Only the one hardcoded demo fixture can be restocked (ordering an item it doesn't
        already stock is a no-op) -- there's no way to introduce a new item type or target
        a different/future fixture yet (needs Build Mode, Step 22/41).
  - [ ] Restock pricing is a flat `baseCost * 0.5` wholesale-factor guess
        (`WHOLESALE_FACTOR`/`RESTOCK_QUANTITY` in game.js), not a real Supplier Contract
        pricing model (bible Step 45/48).
  - [ ] No employee auto-hauling (bible Step 14/15) -- the player has to do every haul by
        hand for now.
- [ ] Customer patience bubbles + Go-Backs cart (Step 53/12)
- [ ] Pre-shift pricing / Start Shift flow (Step 44/52)
- [ ] Employees: hiring, Work Register / Stock Shelves tasks (Step 13-19)
- [ ] More fixtures / Build Mode (Step 22/41)
- [ ] Factions: Scavengers/Mercenaries/Explorers demand & reputation (Step 24-28, 49, 51)
- [x] Manager's Tablet UI: unified tabbed window shell built (`js/logic/ManagerTablet.js`),
      Inventory + Contracts + Supply tabs have real content. Remaining tabs (Employee,
      Fixtures, Layout, Finances, Handbook) still just show a "COMING SOON" placeholder
      until each one's own system exists -- see below.
- [ ] Employee tab: needs the Employee/Hiring system to exist first (Step 13-19 above)
- [ ] Fixtures tab: needs Build Mode / fixture purchasing to exist first (Step 22/41)
- [ ] Layout tab: needs a shop-floor layout/move-fixtures tool to exist first (Step 63)
- [ ] Finances tab: needs the End Day / itemized receipt flow to exist first (Step 43)
- [ ] Handbook tab: needs actual handbook/reference content written (Step 36)
- [ ] `npm run build` is not verified to produce a working production build (see AGENTS.md)
