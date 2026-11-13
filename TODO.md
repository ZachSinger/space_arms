# TODO

Running task list. Consult this before deciding what to work on. Add to it any time we
notice something that needs doing but isn't being done right now.

## Base-loop follow-ups
- [x] Fixed closing when an employee is walking to the backroom: they finish walking or
      turn back for a waiting customer, so they cannot prevent the shift from ending.
- [x] Fixed closing when an employee is already on break: they return to the register for
      customers still in the store, unless the player is already working the register.
- [x] Prevent shelf placement mode from starting in the backroom. Keep the shelf carried
      and explain that shelves belong on the sales floor.
- [x] Fixed shelf fixture crates vibrating while carried. Their position is now synced
      after the player's final position for each frame is applied.
- [x] Batch employee shelf restocking across multiple open shelf stacks. They previously
      picked up only enough to fill one stack per trip, even when their backpack and
      nearby shelf space had room for more.
- [x] Check landing-pad unloading with Load storage first. In a clean shift, Tavi moved
      four 5-unit crates (20 units total) into an empty 20-slot locker in about 20
      seconds. No stall occurred while that storage had room.
- [x] Lock Tavi's hiring until Shop Level 4. Existing hires remain employed.
- [x] Let the player temporarily close and reopen the store during a shift. New customer
      arrivals pause and resume later, customers already inside keep shopping, their
      patience pauses, and the shift clock keeps running.
- [x] Add paid, ordered backroom expansion purchases at Shop Levels 13, 20, and 27.
      They cost credits, can only be bought while the store is closed, and replace the
      free B debug unlock.
- [ ] Play at least three shifts from a new game without debug keys. Check whether sales
      cover stock orders and wages, customers are served through closing, and saving and
      continuing between shifts works.
- [ ] Page Up / Page Down still zoom the sales floor while the player is in the backroom.
      In the backroom they should zoom only the backroom window instead.
- [x] Decide what happens if wages put the player in debt and they run out of sellable
      stock. For now, an emergency loan in the Finances tab tops credits up to 1,000; the
      player owes 25% extra, repaid from 25% of each later day's sales (provisional numbers).
- [x] Expand the employee roster beyond Tavi with additional Shop Level unlocks.
- [x] Employee training: three job skills, Levels 1-5, paid courses that take one paid shift
      away. Skills permanently raise wages.
- [x] All employees start identical (same price, wage, skills, and carry amount); Shop Levels
      raise how many can be hired at once. Each course costs more than that employee's last,
      whichever skill it trains. Stock shelves training also raises carry amount.
- [x] Add employee skill milestones: Run register and Load storage reach 1.5x normal speed
      at Level 3 and 2x at Level 5; Stock shelves carries 25 items at Level 3 and 35 at Level 5.
- [x] Employee shift scheduling: each hired employee is On Shift (works, paid) or Off Shift
      (stays home, unpaid, keeps skills). Firing is removed. Trainees are unavailable for
      their training shift (still paid) whatever their setting.
- [x] Add a brief closing beat when the last customer leaves, with the shift's customer
      totals and a reminder that END DAY opens the receipt. Stays up for five seconds.
- [x] Customers can buy 1-3 units of the same item, filling their wanted quantity across
      stocked shelf placements without exceeding available stock.
- [x] Cash collection requires a new mouse press after scanning; a held scan gesture
      cannot sweep up the customer's bills and coins when the screen changes.
- [x] Give the player more breathing room at the register. The playtest was fun and
      profitable, but the player had to close the store once per day and rarely got time
      away from checkout to restock or manage the shop. Customers now loiter in the store
            a bit, which helped a lot; revisit if it comes back.
- [x] Customers browse before buying: they pause at each shelf to look before taking items,
      and sometimes wander to another stocked shelf first. They skip empty shelves.
- [x] Hovercart upgrades are locked behind Shop Levels 3, 8, 14, 21, and 28.
- [x] Contracts tab lists signable contracts first and already-signed ones last.
- [x] Only the player's lower body collides, so their head can overlap a shelf or counter
      drawn above them instead of snagging on it.
- [x] Controller support: walking, dashing, every action, and a menu highlight for every
      window, with on-screen prompts that switch to controller buttons.
- [ ] Try the controller on a real Xbox/PlayStation pad (so far only tested with a
      simulated one), including the Steam Deck.
- [ ] Fine-tune the controller after real-pad playtesting: stick feel, dash timing, menu
      highlight movement, and button prompts.
- [ ] Add controller configuration and button-remapping options.
- [ ] Test the settings available from the main menu.

## Progression
- [x] New shops start at 0 reputation. Store and faction reputation changes are tallied
      during the shift and applied once when it ends; Finances shows the pending change.
- [x] Add provisional reputation thresholds for Shop Levels 1-30. Earned levels stay
      unlocked if reputation later falls; older level-capped saves catch up to earned reputation.
- [x] Implement the planned rewards at Shop Levels 2-30, including assigning every
      supplier contract to a level, fixture licenses, staff, and sales-floor and backroom
      expansions.
- [x] Level 5, 9, 17, 24, and 30 unlock sales-floor expansions for purchase in order.
      Each costs credits, requires the listed Shop Level, and can only be bought while
      the store is closed.
- [x] Level 13, 20, and 27 unlock paid backroom expansions for purchase in order while
      the store is closed.
- [ ] Playtest the [Store Level roadmap](documentation/StoreLevel.md) and adjust reputation
      thresholds, especially whether 15 is reasonable by the end of the first shift.

## Post-base-loop module concepts
- [ ] Gunsmithing.
- [ ] Repair for gear and weapons.
- [ ] Vehicle sales.
- [ ] Vehicle repair.
- [ ] Security: introduce thieves and a minigame to stop them. **Postponed until the player
      can leave the shop** (until then, there's little for a thief to exploit).
- [ ] Ways to customize the shop.

## Playtest follow-ups
- [x] Cash drawer mockup: all customers pay cash, with unlimited 1/5/10/20 credit bills
      and 1/5/10/25/50 cent coins. The customer first holds out their cash over a blurred
      screen as soon as scanning ends (no keypad), and each piece is clicked or swept to take it; about 1 in 4 pay exact, skipping change.
      In the drawer, click adds change, right-click removes it, and Space
      hands it over. Drawer pieces show bare numbers, and the total line shows the
      amount paid in green. Wrong change is refused; the first mistake warns, later mistakes
      cost store reputation. Market/store prices, decimal keypad, balances, receipts,
      and saves support cents; existing whole-credit saves keep their original values.
- [x] Mix cash and card customers at checkout (about half each). Cash customers keep the
      hand-over and change flow; card customers enter the total on the keypad.
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
      a wall stops you too. Loading pad crates block you like walls. An overlapping player
      can step out of a crate, but can't walk through it, including while carrying a crate.
- [x] Improve first-shift pacing: shortened shifts from ten to five minutes,
      keeping the same customer pool and doubling arrival frequency.
- [x] Start with a much smaller shelf: a two-tile 2x1 starter shelf. (Superseded: new games now start with no shelves; the compact shelf is bought from the Fixtures tab. Placement checks preserve customer access to the register and both sides of the backroom entrance.)
- [x] Let players turn fixtures: press R while placing or moving any fixture, including the register. Its front, keep-clear squares, customer line, and cashier spot turn with it, so shelves can line the bottom and side walls. Shelves use temporary, tile-sized overhead graphics with dark stock surfaces and a light front edge, including in placement previews. Lockers and registers still reuse rotated art until direction-specific art exists.
- [x] Freer fixture placement, stage 1: fixtures move on an 8-pixel grid with the mouse or controller, and saves keep their positions. A fixture facing down can tuck its back up to half a tile into the wall behind it. Placement still checks floor-square access and shoppers stand half a tile from the fixture's front, lined up with it.
- [x] Freer placement, stage 2: customers and staff follow smooth, collision-aware routes around fixtures instead of aiming only for floor-square centers, so fixtures placed between squares no longer block extra space and shoppers can approach any valid counter position.
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
- [ ] Speed up the `\` fixture-placement overlay. It can take about 10 seconds to finish
      filling in; revisit it later since it is a debug aid.
- [x] Desktop HUD "Debug Info": numbered full-window PNG screenshots and readable
      live-state reports in local playtest sessions, with recent events/errors and
      customer-pool calculations. See `documentation/DebugPlaytesting.md`.
- [x] Spawn-customer debug key (Y key): lets one random customer in right away.
- [x] Quickstart debug key (K key, before any shelf is placed): signs Basic Rations, places
      a Budget Shelf near the door full of the four cheapest items, adds a third locker,
      and charges for all of it.
- [x] Tile-grid overlay (G key, `GameScene.toggleDebugGrid`): draws a 1px line every
      TILE_SIZE across the whole authored map (including locked/not-yet-built zones), on
      top of everything else. Added after discovering the Storage Fixture's lockers (and,
      slightly, the sales shelf) weren't actually sitting on tile boundaries -- their
      positions were computed as a fractional percentage of the zone's raw pixel
      width/height, which only lines up with the grid by coincidence. Use this any time a
      fixture looks even slightly off to confirm it before chasing the wrong cause -- see
      `gridAlignedCenter()` in game.js for the correct way to position one instead.

## Art / Assets
- [x] Replace the shelves' placeholder shapes with proper shelf artwork. The Budget Shelf
      uses purple, facing-specific art; the remaining shelves use their registered
      overhead metal-shelf illustrations.
- [ ] Show how stocked each Budget Shelf is (front view) using box art from the box art
      catalog, placed per shelf slot by how full that slot is. Tune it on the title screen's
      DEV screen first.
- [x] Create artwork for the cash bills and coins used at checkout.
- [x] Create artwork for the Explorer Travel Chit: a programmable plasteel device
      with a screen, textured housing, and an octagonal shape.
- [ ] Map art is placeholder and looks bad. Replace the floor, wall, and room art; Tiled
      map-making is intentionally deferred until the end of the project.
- [ ] Sound effects for hitting customers with boxes.
- [x] Brief, event-based customer emoticons: show one at a time for being priced out,
      missing primary stock, leaving angry, or completing a purchase of 3+ items. Each
      lasts about 2 seconds and each event only triggers once per customer.
- [ ] `att_stk_08` (Blackwood Ordnance Counter-Weight Stock) is using a placeholder image
      (`_Bonus_Variety/attachments_stocks/stock-tech-black-blue-orb.png`), not real art made
      for this specific item. Replace with a proper generated icon.
      - [x] Replace the cyan-tinted customer placeholder with the blue-jacket mechanic from the
      local character sheets, including four-direction walking and standing frames.
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
- [x] Customer art replaced with animated walking characters: 90 one-character sheets from
      the local 48px pack, each checked for a full walk cycle in all four directions.
      Sorted by look: 19 Mercenaries, 27 Explorers, 11 Scavengers, plus 15 civilians and
      18 androids with no faction. Employees use the same characters (still green-tinted).
      Left out: robots/drones, unfinished gray sketches, zombies, kids, and the player's
      mechanic. The old 256 still images (`CustomerSpriteManifest.json`) are retired; see
      `data/CustomerCharacterManifest.json` and `js/logic/CustomerSprites.js`.
- [x] Shop entrance art replaced: two glass doors from the local 48px pack sit side
      by side across the two-tile doorway, drawn at the characters' pixel scale. The left
      door is the way in: it opens only to let an arriving customer through. The right door
      is the way out: it opens when the player or a departing customer walks up to it.
      Customers appear at the left door and leave through the right (`js/logic/SlidingDoor.js`).
- [x] Sales floor re-skinned from the TileSetB map (`TileSetB.tmx`), at the characters'
      pixel size: riveted border around whatever part of the shop is unlocked (it moves
      outward as expansions are bought), a lit back wall, and a doormat. The two front
      doors became one animated double door that customers both enter and leave through;
      the backroom door is an animated glass door that slides open when the player walks up.
- [x] Register art replaced with a purple checkout desk (computer, card keypad, card reader)
      from the corporate interior props, at the characters' pixel size. The pack only drew
      its front, so the back and both side views were drawn to match. With customers lining
      up below it, they see the back of the screen; the cashier side shows the screen.
- [x] Redo the backroom's art to match the new sales floor: the backroom uses the BackroomA
  look (lavender back wall, floor with edges and a bottom lip), a black border boxes in the
  unlocked part and follows upgrades, and the exit is the animated glass door at the top right.
- [x] Replace the single locker's oversized art with a narrow purple locker at the player's
  scale, with upright art and four-frame opening/closing animations for all four facings.
  Its solid collision matches the cabinet, while a walkable character-sized standing area
  follows its front. Two-pixel placement lets lockers touch side by side.
- [x] Compact the starting backroom to the loading pad's exact floor width and half its
  previous height. The pad fills the bottom floor; the outside black border follows each
  width upgrade without moving the pad or animated exit.

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
      (`TileRoom.openDoorway`, `door_light_blank_wide`) carved into the Sales Floor's north
      exterior wall (moved from the south wall so the shop can expand downward; see
      `getStoreDoorCell`); customers spawn just inside it and walk back to it to leave.
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
- [x] ~~Shelf window: "+ ADD ITEM" opened a separate picker list~~ -- removed. Clicking an
      item in the shelf window's hovercart list now starts placing it directly. The shelf
      grid is centered and labeled "THIS SHELF"; the hovercart has a title and a hint.
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
      2"/"LOCKER 3" so they're distinguishable when opened. New games now start with two
      lockers; existing saves keep all of their lockers.
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
- [x] Off-shift rearrangement of shelves, lockers, and the register through
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
  - [x] Decided: ordering a new product and giving it shelf space stay separate actions.
        Any product covered by a signed supplier contract can be ordered before it has
        a shelf spot.
  - [x] Decided: supplier prices stay as they are (a fixed per-item percentage of a hidden
        base price, shown per crate). No contract-based pricing model is planned.
  - [x] ~~No employee auto-hauling (bible Step 14/15)~~ -- hired employees with the
        "Load storage" job now carry delivered crates from the Loading Pad into lockers
        on their own (`Employee.js`, `EmployeeJobs.js`).
  - [x] ~~No Hovercart/backpack capacity model at all~~ -- see the new Hovercart entry
        below. Crates themselves still carry a flat RESTOCK_QUANTITY (5) with no
        carrying-capacity limit when hauled from the Loading Pad. The player can now choose
        to unpack a carried crate into the Hovercart, so the crate's contents use its capacity.
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
      (15 spaces in new games; Equipment upgrades add 5 spaces at a time up to 40 for
      200/300/400/500/600 credits. Old 10-space carts load at 15; 20-space and upgraded
      carts keep their capacity and contents). `FixtureWindow` shows the
      open fixture's stock AND the hovercart's own stock side by side, each row with a
      TAKE (fixture -> hovercart) or STOCK (hovercart -> fixture) button that moves 1 unit
      at a time, disabled the instant the receiving side has no room left for that item.
      The player can deliver a crate directly to a shelf or locker, or unpack it into the
      Hovercart and stock a fixture later. The HUD gained a live `HOVERCART x/y`
      readout next to Credits/Reputation. Employees now carry stock in their own backpacks.
      Moving 1 unit per click is intended (decided; no bulk-transfer input planned).
  - [x] While carrying a stock crate, press Q (or Y on a controller) to unpack as much as
        fits into the hovercart. Any remainder stays in the box.
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
- [x] Single-file register line: runs straight out from the counter until blocked, then
  turns toward the door (planRegisterQueue); the first customer stands at the counter like
  the player does behind it, and everyone is spaced evenly along the line.
- [x] Shelf-lined checkout aisles: the line may stand in front of shelves; routes start and
  end on open floor so customers leaving the counter back out instead of cutting behind it.
- [x] Customer patience bubbles + Go-Backs bin (Step 53/12/51): queued customers show a
      colored bubble (green `...` > yellow `!` > red `!!`) as their 40s real-time patience
      (`PATIENCE_MS` in Customer.js) drains; it pauses with the game and while the player is
      ringing that customer up, and each completed sale resets the next in line. At zero they
      leave angry (-1 store rep, -1 faction rep) and their cart goes to the unlimited
      `PlayerState.goBacks` bin (saved, counted as owned stock). The bin is its own window,
      opened from the register UI's GO-BACKS BIN button (the register now shows an idle view
      when nobody's in line). Clicking a bin item loads 1 into the hovercart -- the only way
      out of the bin.
- [x] Go-Backs bin works like a take-only locker (TAKE moves 1 unit into the hovercart; nothing
      can be put back in). A yellow "!" above the player shows while anything is in the bin.
- [x] Inventory tab shows how many items are in active customers' carts, updating when they
      shop or finish checkout; abandoned carts move to Go-Backs as before.
- [x] Item pricing (Step 52): `Market.js` keeps each item's hidden base (`baseCost`) and a
      galactic market price that moves up to ±10% per day at End Day, clamped to 50%-200%
      of base. Inventory tab shows MARKET and an editable PRICE (defaults to market when
      first ordered). Customers get a random 1.0-1.3x markup tolerance and skip items
      priced above it; carts snapshot the store price. Supply cost doesn't follow the
      market: it's a hidden per-item 40-60% of base, so it can't be divided back into base.
- [x] Cheap prices reward customers: if any unrequested shelf item is at least 10% below
      market, each customer has a 50% chance to add one as an extra purchase. They show a
      happy face when they buy any bargain; discounts do not grant extra reputation.
- [x] Price editing buttons: +10% / -10% (at least 1 credit where possible), and "Set to
      market" (current avg market price).
- [ ] Pre-shift Start Shift onboarding flow (Step 44). **Deferred until the map and core
      loop are close to final**; a tutorial built on the placeholder map would need redoing.
- [x] Employees: hiring, Work Register / Stock Shelves tasks (Step 13-19). Tavi the
      Stock Clerk can be hired from the Employee tab (250 credits, 50 credits in wages
      paid automatically at each shift start). Each employee has a reorderable job
      priority list: run register, stock shelves, load storage. Employees walk the shop,
      serve the register line, refill assigned shelf slots from lockers via a backpack,
      haul delivered crates into lockers, and return unplaced stock to lockers when
      clocking out. Hired staff and job priorities save and load (`Employee.js`,
      `EmployeeJobs.js`, `EmployeeRenderer.js`, `data/Employees.json`).
- [x] Fixture purchasing, fixture crates, off-shift placement/crating, and fixture licenses
      (Steps 22/41; fixture catalog in `js/logic/FixtureLayout.js`).
- [x] Sell empty placed fixtures and fixture crates for half price while closed, with
      confirmation and a separate receipt entry. Fixtures containing stock and the only
      register cannot be sold.
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
- [x] Faction currencies (Steps 25-28): most Scavengers pay in M-Scrips (120 per credit,
      bills only) and most Explorers unlock a Chit by entering its arrow code.
- [x] Faction sale reputation (Step 51): a completed sale tallies +1 store reputation and
      +1 reputation with the customer's faction. Gains and losses apply at shift end.
- [x] Manager's Tablet UI: unified tabbed window shell built (`js/logic/ManagerTablet.js`),
      Inventory + Employee + Contracts + Supply + Fixtures + Equipment + Layout +
      Finances + Handbook tabs have real content.
- [x] Employee tab: hiring, wages, and per-employee job priority ordering (see the
      Employees entry above).
- [x] Fixtures tab: purchase licensed fixtures, place/crate fixtures, move existing fixtures,
      and sell empty fixtures or fixture crates.
- [x] Equipment tab: buy hovercart upgrades directly without a license.
- [x] Layout tab: safe off-shift fixture placement with autosave status (Step 63)
- [x] Finances tab + End Day (Step 43): when a shift ends, a blinking END DAY button replaces
      START SHIFT in the top bar and opens the Finances tab. The tab shows today's itemized
      receipt (every sale, stock order, delivery fee, fixture purchase/resale, equipment
      upgrade, license, hire, and wage) and
      the previous day's final receipt. END DAY moves to the next day and changes market prices;
      the next shift can't start until the day is ended. Wages are still paid at shift start
      (Step 32), not at End Day. Money changes must go through `PlayerState.addCredits` /
      `spendCredits` with a receipt entry (`js/logic/DayLedger.js`).
- [x] Handbook tab (Step 36): topic pages for running the store, ordering, stocking,
      customers & register, prices & money, licenses, employees, level rewards, and controls
      (`js/logic/HandbookRenderer.js`). Level rewards are read from the game's own unlock data.
      Update the Handbook text whenever a rule it describes changes.
- [x] Letting staff go: available between shifts from the Employee tab. The one-time hiring
      cost is not refunded; future shift wages stop.
- [x] `npm run package` builds a stand-alone Windows exe (`release\win-unpacked`); verified title, Continue into the shop, and all item images load without the dev server
