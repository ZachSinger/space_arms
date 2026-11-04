# TODO

Running task list. Consult this before deciding what to work on. Add to it any time we
notice something that needs doing but isn't being done right now.

## Playtest follow-ups
- [x] Give fixture movement/placement priority over UI windows: while moving a fixture,
      hovering a window should make it nearly transparent and allow placement through
      it. Restore the window when the pointer leaves it or the fixture is placed.
- [x] Fix Derringer stack size (now 3, matching the other small pistols).
- [x] Balance early license prices against their catalogs: rations 25 credits, mods 75
      credits, apparel/ammo 100 credits, armor/melee 200 credits, and tools 250 credits.
- [x] Rethink register UI:
  - [x] Fix reopening after closing the register window; currently requires leaving the
        register and entering it again.
  - [x] Only open the scan window when there are actually items to scan.
  - [x] Make the scan window rectangular, with items riding a belt left to right into a
        red scanner bar. Go-Backs moved to Q at the register.
- [x] Make crates collide with one another.
- [x] Moving throws start at the held position at the player's speed, accelerate briefly
      to pull away, then slow down quickly (about 210 pixels total travel, stopping in
      about one second at walking speed). Keep the departing crate drawn
      above the player until clear. Stationary drops land beside the player; blocked
      releases stay carried. Launches pause correctly and survive save/load.
- [x] Loading pad crates stay locked on their spots until picked up. Once picked up, a
      crate can't be dropped or thrown back onto the pad (it bounces off the edge).
- [x] Walking into a resting crate pushes it (`CratePushing.js`). Dead center pushes it
      straight ahead; the further off to one side it is, the more it's pushed sideways, and
      one that only clips your path is pushed only sideways, out of the way. Each crate in the row
      slows you more (60%, 40%, 25% speed); 4 in a row can't be pushed. A crate that hits
      a wall stops you too. Loading pad crates block you like walls.
- [x] Improve first-shift pacing: shortened shifts from ten to five minutes,
      keeping the same customer pool and doubling arrival frequency.
- [x] Start with a much smaller shelf: a two-tile 2x1 starter shelf.
- [x] Redo player-facing game messages: show a large, readable banner below the HUD for
      2.5 seconds instead of tiny text above the player. Keep customer reactions anchored
      to the customer.
- [x] Remove routine crate pickup/drop confirmations. Show the eligible nearby crate's
      contents and a Space pickup hint in the message area below the HUD, not over the
      player. Warnings take priority, then the current hint returns.
- [x] Spell out "credits" in all money labels and tooltips; do not abbreviate it as "c".
- [x] Turn stock ordering into a real order instead of one crate per click
      (`SupplyOrder.js`, Supply tab):
  - Add crates to an order with - / +, then place the whole order at once.
  - Up to 9 crates per order (one full loading pad), and never more than the free spots
    on the loading pad.
    Both limits are always shown in the order summary, and + stops at the limit.
  - Each order costs a flat 25 credit delivery fee on top of the stock.
  - Reject additions the player cannot afford, including the existing order and delivery
    fee, with a warning banner and error buzz. Leave the order unchanged.
  - If an order can't be placed, the reason is written in the summary (pad full, not
    enough credits) instead of a popup message.

## Saving
- [x] HUD SAVE button: manually save while the store is closed, with explicit success
      confirmation and the existing save-error/retry window on failure. Disabled during
      a shift or while a save is in progress; closed-store autosaves remain enabled.

## Fixture zones
- [x] Registers and shelves can only be placed on sales-floor zones (`salesFloor: true` in
      `RoomLayout.js`); storage fixtures can go anywhere. Older saves with a register or
      shelf in the back still load, so the fixture can be moved out.

## Shelf stacking
- [x] `stackSize` now means how many units fit in one shelf slot (max 10), capped by the
      shelf's `stackDepth` (10). The old "12 ÷ stackSize" rule left small items like
      Nutri-Synth paste (15) fitting 0 per slot, so they silently couldn't be shelved.
      The item picker shows "Fits N per slot" / "Too bulky for this shelf", and old saves
      move any stack over the new cap into the Go-Backs bin on load.

## Debug Tools
- [x] Desktop HUD "Debug Info": numbered full-window PNG screenshots and readable
      live-state reports in local playtest sessions, with recent events/errors and
      customer-pool calculations. See `documentation/DebugPlaytesting.md`.
- [x] Tile-grid overlay (G key, `GameScene.toggleDebugGrid`): draws a 1px line every
      TILE_SIZE across the whole authored map (including locked/not-yet-built zones), on
      top of everything else. Added after discovering the Storage Fixture's lockers (and,
      slightly, the sales shelf) weren't actually sitting on tile boundaries -- their
      positions were computed as a fractional percentage of the zone's raw pixel
      width/height, which only lines up with the grid by coincidence. Use this any time a
      fixture looks even slightly off to confirm it before chasing the wrong cause -- see
      `gridAlignedCenter()` in game.js for the correct way to position one instead.

## Art / Assets
- [ ] Sound effects for hitting customers with boxes.
- [ ] Emoticons for customers.
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
      explorer-skewed (+22 of the 32) -- this also affects visual faction membership for
      thrown-crate reputation penalties. See
      `scripts/extract_eighth_gen_sprites.py`.

## Known Issues
- [x] Supply orders no longer jump the list to the top: refreshing prices, availability,
      and stock counts preserves the Supply list's scroll position.
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
- [x] ~~Manual pause (P key / HUD button) only froze the displayed clock -- customers and
      arrivals kept moving/spawning~~ -- `GameScene.update()` now skips player/customer
      updates while a started shift is paused, and scheduled arrivals use the paused shift
      clock so they stop until the shift resumes.
- [x] ~~Image-only checkout cards had no card frame at all, just a floating image with a
      hover glow~~ -- the image-only change (previous round) was only supposed to drop the
      name/price text and the small separate icon box, not the card's own bordered/
      background frame (which it lost anyway, since that came from a shared `.item-card`
      base class the new markup no longer used). Gave `.checkout-item-card` its own
      border/background directly so each item is still visually "in a card", same as
      elsewhere in the UI, just without text content.
- [x] ~~Shelf placement item picker showed the whole catalog~~ -- you could pick an item
      to place on the shelf that you weren't actually carrying. Filtered
      `FixtureRenderer.itemPickerHTML` to only the player's own hovercart stock.
- [x] ~~Supply tab only listed items already stocked somewhere, so a fixture that starts
      completely empty (both now do) had nothing orderable at all, ever~~ -- genuinely
      broken, not a design choice. `GameScene.getRestockableItems`/`orderRestockCrate` now
      work off the bible's actual Step 29/48 model instead: the whole catalog, filtered
      only by whether the player has a signed Supplier License for that item
      (`playerState.activeLicenses.has(item.license)`) -- affordability is still checked
      separately per-order, same as before. `StoreItem` (`Items.js`) exposes `license` now
      (it was in `Items.json` the whole time, just never read). `lic_start_surplus` is
      free (0 credits, 0 reputation required) specifically so there's always at least one
      immediately-signable contract to get the loop started from a brand new game.
- [x] ~~Storage lockers (3 doors, one `locker_storage` image) were actually one single
      Fixture sharing one combined capacity pool~~ -- visually they're 3 separate lockers,
      and they're supposed to actually be 3 separate storage spaces, not one pool that
      just happens to render with 3 doors. Split into `this.storageLockers` -- 3
      genuinely independent `StorageFixture` instances (each its own 1x2 world footprint,
      capacity 20, no shared state at all), each drawn with its own dedicated
      `locker_single.png` placed directly adjacent to the next, so the art still reads as
      one bank of lockers. (First attempt cropped 3 fixtures to thirds of the same combined
      `locker_storage.png` texture instead -- looked bad, replaced with real single-door
      art provided afterward.) `FixtureWindow` titles now read "LOCKER 1"/"LOCKER
      2"/"LOCKER 3" so they're distinguishable when opened.
- [x] ~~Shelf placement UI highlighted every valid anchor cell green at once~~ -- looked
      like one solid block of taken-up space, not "here's everywhere a 2x1 item COULD go."
      Confusing in practice -- a 2x1 item on a 4x2 grid highlighting 6 cells read as
      "this takes up 1x4" (or "2x3" rotated), not its real 2x1 shape. Replaced with a real
      hover preview instead (`FixtureWindow.showPlacementPreview`): the item's own image,
      at its actual w x h footprint, anchored wherever the cursor currently is -- green if
      it fits there, red if not (clamped visually at the grid's edge so an out-of-bounds
      hover doesn't blow out into an extra implicit CSS grid track). Clicking confirms at
      the last hovered anchor, not necessarily the literal cell under the cursor (the
      preview itself can span multiple cells and has `pointer-events: none` so hover still
      reads the cell underneath it). Removed `ShelfFixture.getValidPlacementCells`, which
      only existed for the old all-cells-highlighted approach.

## Bigger Features Not Yet Built (from the bible)
- [x] Off-shift rearrangement of the existing shelf, three lockers, and register through
      Manager Tablet Fixtures/Layout MOVE controls. Grid-snapped previews reject overlaps,
      blocked access, disconnected floor, doors/loading-area obstruction, and insufficient
      register queue space. Contents stay attached; right-click/Escape cancels.
- [x] Off-shift autosaving and title-screen Continue. Saves fixture positions/stock,
      hovercart, crates, player economy/licenses, prices/market, and unlocked rooms.
      Electron uses an atomic user-data save file; browser uses localStorage.
      Continue restores closed-shop preparation; active shifts resume the last checkpoint.
- [x] Manager Tablet Inventory now shows only owned items, with Storage and Stock unit
      counts. Storage includes all lockers, the hovercart, and unemptied crates (on the
      Loading Pad, carried, or dropped). Stock totals all placements on sales shelves,
      including stacks temporarily lifted in move mode. Counts refresh on transfers,
      ordering/delivery, and customers taking shelf stock; zero-total items disappear.
- [x] Space picks up a nearby stopped crate, or drops the carried crate without unpacking
      it; moving when dropping throws it in the movement direction. Crates slow to a stop
      and bounce off walls and fixtures
      (including the register), without blocking players or customers. Their motion pauses
      with the shift. Space can pick them up again once their velocity reaches zero,
      including partially emptied crates.
- [x] Thrown crates hitting customers cost 1 store reputation and 1 reputation with the
      customer's faction, if any. Faction membership currently follows the character's
      sprite group; other groups are neutral. Each customer can be hit once per throw,
      including across bounces. Dropped, stopped, carried, and paused crates do no harm.
- [x] Player avatar (`js/logic/Player.js`): WASD/arrow movement, collides with walls/
      fixtures but not customers (bible Step 30/58), camera now follows it instead of the
      old drag-to-pan placeholder. Needed as a prerequisite for the physical procurement
      loop below (hauling crates requires a player who can walk to them).
- [x] Procurement MVP (Step 10): a `loading_pad` RoomLayout zone, a `Crate` class, and a
      real Supply tab (`SupplyRenderer.js`) that orders more stock for whatever the one
      demo fixture already sells. Ordering spends credits and spawns a crate at the
      Loading Pad; press Space near it to pick it up, carry it to the shelf, press E to
      deliver (restocks that item). Deliberately simplified vs. the bible's full vision --
      logged below, not yet built:
  - [x] ~~No backroom intermediate storage stage yet -- crates go straight from the Loading
        Pad to the sales-floor shelf, skipping Storage Fixtures / the Storeroom entirely~~
        -- see the new Storage Shelving entry below; crates can now be delivered to either
        fixture depending on which one the player is standing near.
  - [ ] Only fixtures already assigned to an item can be restocked by ordering -- ordering
        itself still doesn't let you introduce a brand new item type on the spot (that's
        what assigning an empty block to a Fixture window now does instead -- see below --
        but the two are still separate actions, not unified into one flow yet).
  - [ ] Restock pricing is a hidden, fixed per-item 40-60% of base (`Market.getSupplyCost`,
        `RESTOCK_QUANTITY` in game.js), not a real Supplier Contract
        pricing model (bible Step 45/48).
  - [ ] No employee auto-hauling (bible Step 14/15) -- the player has to do every haul by
        hand for now.
  - [x] ~~No Hovercart/backpack capacity model at all~~ -- see the new Hovercart entry
        below. Crates themselves still carry a flat RESTOCK_QUANTITY (5) with no
        carrying-capacity limit when hauled from the Loading Pad -- the Hovercart only
        governs transfers between fixtures (shelf <-> storage) via FixtureWindow, not the
        Loading-Pad-to-fixture crate flow, which is a separate, not-yet-unified path (see
        below).
- [x] Storage Shelving + real capacity-pool storage (bible Step 42): the Storeroom is
      now a proper walled-off backroom (a `door_blast_keypad_01` door in its own east
      wall, sealed via the new `TileRoom.addWall`, since two already-unlocked zones never
      auto-wall against each other -- see `TileRoom.needsWallAt`) with a `locker_storage`
      Storage Fixture inside it, completely empty to start. `StorageFixture`
      (`ShopInventory.js`, renamed from the original `Fixture` once the sales shelf got
      its own completely different model -- see below) models one shared total `capacity`
      number (e.g. 20 "slots") instead of unlimited quantity -- every item in
      `Items.json` has its own `slots` value (1-5, derived from its `dimensions`
      footprint: small stuff like ammo/attachments/pistols costs 1, bulky armor/heavy
      weapons costs 4-5), and stocking it eats that many units out of the fixture's
      shared pool. Any item can be stocked anywhere there's room -- no pre-assignment/
      configuration step needed. This is the correct model for a Storage Fixture
      specifically (a flexible overflow/staging locker, not a real storefront display) --
      see the Sales Shelf entry below for why the real sales shelf needed something
      completely different instead. `FixtureWindow`/`FixtureRenderer` show a capacity bar
      + a plain list of whatever's currently stocked; walk up and press E (or click it)
      to open it. Stock gets there via ordering (Supply tab) + hauling + delivering a
      crate (`GameScene.tryDeliverCarriedCrate`), or via the Hovercart (see below).
- [x] Hovercart (bible Step 10/63: "an abstract character/employee inventory size, not a
      physical moving entity"): extracted the capacity-pool logic shared by every
      StorageFixture into a new base class (`InventoryPool.js` -- capacity + stock +
      add/remove/usedCapacity/etc.), and gave `PlayerState` its own instance
      (`HOVERCART_CAPACITY` = 10, smaller than a Storage Fixture's own capacity since it's
      one character's personal carry limit, not a whole locker). `FixtureWindow` shows the
      open fixture's stock AND the hovercart's own stock side by side, each row with a
      TAKE (fixture -> hovercart) or STOCK (hovercart -> fixture) button that moves 1 unit
      at a time, disabled the instant the receiving side has no room left for that item.
      This is what actually gives the Storage Fixture a purpose: haul a crate to Storage
      (or the shelf, whichever's closer/has room), then separately walk between the two
      moving units via the hovercart as needed. The HUD gained a live `HOVERCART x/y`
      readout next to Credits/Reputation. Known simplifications: only the player has a
      hovercart (no employees yet, Step 14/15); only 1 unit moves per click (no bulk-
      transfer input); crates from the Loading Pad still deliver straight into a fixture
      rather than routing through the hovercart first.
- [x] Sales Shelf: manual grid placement (bible Steps 4/5/22) -- NOT the same model as a
      Storage Fixture above. Originally built as a shared capacity pool (same as Storage),
      but that's wrong for a real storefront shelf: items need actual physical placement
      on a grid (Tarkov-style packing using each item's own `dimensions` w/h, optionally
      rotated 90 degrees), and "depth"/stack capacity is NOT shared across the fixture --
      each individual placement gets its own capacity, independently (originally the
      fixture's `stackDepth` divided by the item's `stackSize`; now the item's
      `stackSize` = units per slot, capped by `stackDepth` 10 -- see "Shelf stacking";
      each placement is capped independently, with no shared stock pool). New
      `ShelfFixture.js` models this:
      `displayGrid` (two visual slots per floor tile, derived from `gridDimensions`) + a
      flat `placements` array
      (`{itemId, gx, gy, w, h, rotated, quantity}`). `FixtureWindow`/`FixtureRenderer`
      gained a real placement UI: "+ ADD ITEM" opens the full catalog, picking one enters
      placement mode (every valid anchor cell for the item's current shape is highlighted
      green, a toolbar offers ROTATE/CANCEL), clicking a highlighted cell confirms it
      there. In-world stock is shown as one dark block with a category-colored outline per stocked placement,
      sized to the item's existing dimensions, with an `xN` label. A single graphics layer
      batches blocks per shelf; labels are per placement, never per unit. An existing
      placement still at 0 stock can be clicked away again to free up
      the space. Below the grid, a flat list of current placements (same TAKE-into-
      hovercart affordance as Storage) plus the hovercart section. Demo shelf starts
      completely empty (tile-derived grid, stackDepth 10). Found and fixed two real bugs building
      this: (1) CSS grid rows sized with `1fr` inside an unbounded-height container blew
      up to a runaway size the instant an item's image rendered -- fixed with fixed-px
      grid tracks instead; (2) giving `.fixture-cell` an explicit width/height clamped
      multi-column placements back down to one cell's worth of space despite spanning
      more grid tracks -- removed the explicit size so grid items stretch to fill their
      actual spanned area. Known simplification: `StorageFixture`'s `getOpenSlotsFor` and
      the shelf's `getOpenPlacementsFor` have very similar names/shapes but aren't
      actually unified into one shared concept -- duck-typed to the same small public API
      (`stock`/`add`/`remove`/`getRemainingUnitsFor`/etc.) so GameScene and FixtureWindow
      can treat both generically, but the internal models remain genuinely different.
- [x] Customer patience bubbles + Go-Backs bin (Step 53/12/51): queued customers show a
      colored bubble (green `...` > yellow `!` > red `!!`) as their 40s real-time patience
      (`PATIENCE_MS` in Customer.js) drains; it pauses with the game and while the player is
      ringing that customer up, and each completed sale resets the next in line. At zero they
      leave angry (-1 store rep, -1 faction rep) and their cart goes to the unlimited
      `PlayerState.goBacks` bin (saved, counted as owned stock). The bin is its own window,
      opened from the register UI's GO-BACKS BIN button (the register now shows an idle view
      when nobody's in line). Clicking a bin item loads 1 into the hovercart -- the only way
      out of the bin.
- [ ] Consider a separate Go-Backs minigame: scan go-backs items before they can be loaded
      into the hovercart.
- [ ] Inventory gap: items in a customer's cart (taken off the shelf, not yet sold or sent
      to Go-Backs) aren't counted in Inventory totals anywhere. Decide how to show them
      (e.g. an "in carts" count).
- [x] Item pricing (Step 52): `Market.js` keeps each item's hidden base (`baseCost`) and a
      galactic market price that moves up to ±10% per day at End Day, clamped to 50%-200%
      of base. Inventory tab shows MARKET and an editable PRICE (defaults to market when
      first ordered). Customers get a random 1.0-1.3x markup tolerance and skip items
      priced above it; carts snapshot the store price. Supply cost doesn't follow the
      market: it's a hidden per-item 40-60% of base, so it can't be divided back into base.
- [ ] Figure out the benefit of pricing below the average market price (happier
      customers? more sales?).
- [x] Price editing buttons: +10% / -10% (at least 1 credit where possible), and "Set to
      market" (current avg market price).
- [ ] Pre-shift Start Shift onboarding flow (Step 44)
- [ ] Employees: hiring, Work Register / Stock Shelves tasks (Step 13-19)
- [x] Fixture purchasing, fixture crates, off-shift placement/crating, and fixture licenses
      (Steps 22/41; fixture catalog in `js/logic/FixtureLayout.js`).
- [ ] Sell fixtures back for partial credit (after fixture purchasing/crating is built)
- [x] MVP faction customer buy lists (Steps 12, 25-28): primary items come from assigned
      shelf slots (including sold-out slots); customers visit multiple shelves, penalize
      once for missing primary stock, and leave if none of their primary items are in stock.
      Bonus items are randomized and missing bonus stock is free. Mercenaries seek matching
      ammo and avoid duplicate weapon types; Explorers pick Primaries from Tools and Survival gear equally;
      Scavengers get more impulse buys. Current fixed list sizes: neutral 1 Primary/0-2
      Bonus, Scavengers 1/2-3, Mercenaries 2/0-1, Explorers 1/0-2.
- [ ] Tune CustomerBuyLists.js reputation thresholds for expanding Primary list sizes after
      reputation gains/losses have been observed over multiple playtested shifts. Counts are
      intentionally fixed and small for now.
- [x] Reputation-driven customer pooling (Steps 24/49): customer counts and faction
      mix are calculated once at shift start, with licensed factions represented and
      arrivals scheduled across the shift. Tune traffic/reputation curves after playtesting.
- [ ] Remaining faction systems: faction-specific currencies (Steps 25-28).
- [x] Faction sale reputation (Step 51): a completed sale gives +1 store rep and +1 rep
      with the customer's faction. Rewards and penalties apply independently, when each happens.
- [x] Manager's Tablet UI: unified tabbed window shell built (`js/logic/ManagerTablet.js`),
      Inventory + Contracts + Supply + Fixtures + Layout tabs have real content.
      Remaining tabs (Employee, Finances, Handbook) still show a "COMING SOON" placeholder
      until each one's own system exists -- see below.
- [ ] Employee tab: needs the Employee/Hiring system to exist first (Step 13-19 above)
- [x] Fixtures tab: purchase licensed fixtures, place/crate fixtures, and move existing fixtures.
- [x] Layout tab: safe off-shift fixture placement with autosave status (Step 63)
- [ ] Finances tab: needs the End Day / itemized receipt flow to exist first (Step 43)
- [ ] Handbook tab: needs actual handbook/reference content written (Step 36)
- [ ] `npm run build` is not verified to produce a working production build (see AGENTS.md)
