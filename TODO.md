# TODO

Running task list. Consult this before deciding what to work on. Add to it any time we
notice something that needs doing but isn't being done right now.

## Art / Assets
- [ ] `att_stk_08` (Blackwood Ordnance Counter-Weight Stock) is using a placeholder image
      (`_Bonus_Variety/attachments_stocks/stock-tech-black-blue-orb.png`), not real art made
      for this specific item. Replace with a proper generated icon.
- [ ] No dedicated player sprite exists yet -- `Player.js` reuses one customer character's
      art (tinted cyan to stand out). Replace with real player-specific art eventually.
- [x] Checkout scan cards simplified to just the item's own image -- no name/price text,
      no separate small "icon" box/border (`CheckoutRenderer.js`/`.checkout-item-image`).
- [x] ~~Crop/bleed artifact in `mercenary_01_right.png`~~ -- moot, Sixth Generation customer
      art was fully replaced by Seventh Generation (see below); the file no longer exists.
- [x] Customer art upgraded Sixth -> Seventh Generation: 32 characters (128 images) kept
      from 8 of the 10 new sheets (excluded 2 that were in a different, chunkier pixel-art
      sub-style). Higher hit rate this time -- all 40 characters reviewed passed the
      same-character-across-all-4-facings check (vs 21/40 last generation). See
      `scripts/extract_seventh_gen_sprites.py`.
- [x] Customer roster expanded with Eighth Generation: +32 more characters (128 images)
      from 8 of the 9 new sheets (excluded 1 in that same chunkier pixel-art sub-style).
      All 36 characters reviewed passed the facing-consistency check. Added to (not
      replacing) the existing roster, now 64 characters/256 images total. Heavily
      explorer-skewed (+22 of the 32) -- purely cosmetic/no gameplay impact, but worth
      knowing if customer variety ever looks lopsided. See
      `scripts/extract_eighth_gen_sprites.py`.

## Known Issues
- [x] ~~Dead-end bug: `this.fixture` never restocks~~ -- fixed by the Procurement MVP below.
      The player can now order more stock (Supply tab), haul the resulting crate in from
      the Loading Pad, and deliver it to the shelf, indefinitely.
- [x] ~~Crate delivery had no feedback~~ -- picking up/delivering a crate (or trying to and
      failing, e.g. too far from the shelf) now shows a brief floating text confirmation
      (`GameScene.showFloatingText`), so it's no longer silent/ambiguous whether it worked.
- [x] ~~Register could be operated from anywhere on the map~~ -- `openRegisterWindow()`/
      `startCheckout()` now require the player to be standing at `registerQueueAnchor`
      (see `isPlayerNearRegister`). Superseded the original walk-away-based auto-close
      with a proper session model -- see below.
- [x] ~~Player had no collision with the register (walked straight through it)~~ -- the
      register now has its own static physics body (`drawRegister`), collided only against
      the player (not `obstacleGroup`, which is shared with `customerGroup` -- customers
      still need to stand almost flush against it to queue, which a shared solid body
      would've blocked).
- [x] ~~No keyboard way to operate the register~~ -- pressing E now also tries the register
      (`tryOpenRegister()`) if nothing closer (a crate) is in range, in addition to the
      existing click-to-open.
- [x] ~~No room to stand behind the register to operate it~~ -- there genuinely isn't (the
      register sits close against the north wall; the real floor gap is ~11px, far less
      than the player's own body height). Instead of moving the register (which would've
      broken the register-queue's own tuned spacing budget against the south wall),
      `beginRegisterSession()`/`endRegisterSession()` teleport the player behind the
      counter (facing it) and disable their physics body + input entirely for the
      duration -- a disabled body can't collide at all, which is also the answer to "how
      do we avoid collision problems doing this." Pressing E again toggles them back out.
- [x] ~~Entering the register was too strict/finicky~~ -- `REGISTER_INTERACT_RANGE` bumped
      70 -> 130; was measured from `registerQueueAnchor`, which only trivially passed for a
      dead-center approach from directly south, not any other angle.
- [x] ~~Completing a sale ejected the player from the register (not just on the last
      customer -- every single one)~~ -- `CheckoutWindow.confirmPayment()` used to
      unconditionally call `uiWindow.close()` on every successful payment, which (once the
      register-session teleport existed) ejected the player every time, then
      re-teleported them back in for the next customer. Now the caller
      (`GameScene.startCheckout`'s `onComplete`) decides: refresh the window in place for
      the next customer, or explicitly hide it if none are left -- either way, standing
      behind the counter is no longer tied to the window being open at all. The player can
      now enter the register at any time (even with an empty queue) and only sees the
      item-scanning window once there's actually something to scan (auto-opens the moment
      a customer joins while already standing there).
- [x] ~~Game auto-started a shift the instant the scene loaded~~ -- the store now starts
      closed (`ShiftClock.started = false`, HUD shows "CLOSED") and shows a "START SHIFT"
      button directly in the persistent HUD bar (replacing the PAUSE button, which has
      nothing to do yet either) rather than a popped-up modal window, before any customers
      can spawn.
- [x] ~~No real entrance/exit~~ -- customers used to spawn/despawn in an arbitrary strip of
      floor right next to the backroom doorway. There's now an actual door
      (`TileRoom.openDoorway`, `door_light_blank_wide`) carved into the Sales Floor's south
      exterior wall; customers spawn just inside it and walk back to it to leave.
- [x] ~~Delivering a carried crate to the shelf was too finicky, and the floating-text
      feedback explaining why was gone before it could be read~~ -- shelf delivery used to
      share Crate's own tight 56px pickup radius, measured from one single fixed pixel in
      front of the shelf (`shelfStandPoint`), so approaching from almost any angle but
      dead-center silently failed. Gave it its own, more forgiving `SHELF_INTERACT_RANGE`
      (110px, same reasoning as the register's own range bump). Also made
      `showFloatingText` itself more legible generally: bigger bold font, and it now holds
      fully visible for a beat before fading, instead of starting to fade immediately on
      spawn.
- [x] ~~Manual pause (P key / HUD button) only froze the displayed clock -- customers (and
      the spawn timer) kept moving/spawning~~ -- `GameScene.update()` now skips
      `player.update()`/`customer.update()` entirely and zeroes velocity while
      `shiftClock.isPaused && shiftClock.started`, and `spawnTimer.paused` is now
      continuously synced to the clock's actual running state (manually paused, soft-
      closed, or the very first shift not yet started) instead of a one-way flag that only
      ever got set by soft-close.
- [x] ~~Image-only checkout cards had no card frame at all, just a floating image with a
      hover glow~~ -- the image-only change (previous round) was only supposed to drop the
      name/price text and the small separate icon box, not the card's own bordered/
      background frame (which it lost anyway, since that came from a shared `.item-card`
      base class the new markup no longer used). Gave `.checkout-item-card` its own
      border/background directly so each item is still visually "in a card", same as
      elsewhere in the UI, just without text content.

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
  - [ ] No Hovercart/backpack capacity model at all (bible Step 10/63: "an abstract
        character/employee inventory size, not a physical moving entity"). Crates currently
        carry a flat RESTOCK_QUANTITY (5) with no carrying-capacity limit of any kind.
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
