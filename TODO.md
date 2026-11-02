# TODO

Running task list. Consult this before deciding what to work on. Add to it any time we
notice something that needs doing but isn't being done right now.

## Art / Assets
- [ ] `att_stk_08` (Blackwood Ordnance Counter-Weight Stock) is using a placeholder image
      (`_Bonus_Variety/attachments_stocks/stock-tech-black-blue-orb.png`), not real art made
      for this specific item. Replace with a proper generated icon.
- [ ] No dedicated player sprite exists yet -- `Player.js` reuses one customer character's
      art (tinted cyan to stand out). Replace with real player-specific art eventually.
- [ ] At least one extracted customer sprite has a leftover crop/bleed artifact (a thin
      vertical line baked into the image) -- confirmed in
      `img/Icons_Extracted/Customers/mercenary_01_right.png`. Not yet audited across all 84
      customer sprites; worth a spot-check/re-extraction pass.

## Known Issues
- Dead-end bug: `this.fixture` (the one demo shelf) is seeded with a fixed 14 total items
  and nothing ever restocks it, not even between shifts (`startNextShift()` doesn't touch
  it). Once sold out, the store can never sell anything again for the rest of the game.
  Needs the Procurement system (see below) to fix.

## Bigger Features Not Yet Built (from the bible)
- [x] Player avatar (`js/logic/Player.js`): WASD/arrow movement, collides with walls/
      fixtures but not customers (bible Step 30/58), camera now follows it instead of the
      old drag-to-pan placeholder. Needed as a prerequisite for the physical procurement
      loop below (hauling crates requires a player who can walk to them).
- [ ] Procurement: Loading Pad, physical crates, hauling them inside, backroom storage
      (Step 10, 42, 62) -- the next priority; also the fix for the dead-end bug above.
- [ ] Customer patience bubbles + Go-Backs cart (Step 53/12)
- [ ] Pre-shift pricing / Start Shift flow (Step 44/52)
- [ ] Employees: hiring, Work Register / Stock Shelves tasks (Step 13-19)
- [ ] More fixtures / Build Mode (Step 22/41)
- [ ] Factions: Scavengers/Mercenaries/Explorers demand & reputation (Step 24-28, 49, 51)
- [x] Manager's Tablet UI: unified tabbed window shell built (`js/logic/ManagerTablet.js`),
      Inventory + Contracts tabs have real content. Remaining tabs (Employee, Supply,
      Fixtures, Layout, Finances, Handbook) still just show a "COMING SOON" placeholder
      until each one's own system exists -- see below.
- [ ] Employee tab: needs the Employee/Hiring system to exist first (Step 13-19 above)
- [ ] Supply tab: needs the Supplier/Procurement system to exist first (Part 3)
- [ ] Fixtures tab: needs Build Mode / fixture purchasing to exist first (Step 22/41)
- [ ] Layout tab: needs a shop-floor layout/move-fixtures tool to exist first (Step 63)
- [ ] Finances tab: needs the End Day / itemized receipt flow to exist first (Step 43)
- [ ] Handbook tab: needs actual handbook/reference content written (Step 36)
- [ ] `npm run build` is not verified to produce a working production build (see AGENTS.md)
