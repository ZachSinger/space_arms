# TODO

Current unfinished work. Add new tasks when identified; remove entries when they are
completed or no longer relevant.

## Current shop

- [ ] Check the first-pass money balance during real shifts: whether each contract and expansion
      takes a sensible amount of saving, and whether fixtures, wages, and delivery fees still matter
      later on. Run `node scripts/balance-audit.mjs` for the modeled numbers.
- [ ] Check shop-level progression and customer traffic as reputation and stock change
      across normal shifts; adjust level thresholds and customer counts if needed. The
      intended starting pace is one level per fully served, penalty-free shift for the
      first four shifts, then slower progression. See [StoreLevel.md](documentation/StoreLevel.md).
- [ ] Check employee shelf-stocking times at each training level during normal shifts,
      including their trips between crates and shelves, and adjust speeds if needed.
- [ ] Check customer shopping-list growth during normal shifts and adjust its first-pass
      reputation milestones after measuring reputation gains and losses over multiple shifts.
- [ ] Test controls with physical Xbox and PlayStation controllers and on Steam Deck.
      Adjust stick feel, dash timing, menu navigation, and button prompts as needed.
- [ ] Check how movement, crate handling, the camera, and checkout feel during a
      10-minute game session.
- [x] Let the player assign employees to hovercarts, and make employees use a hovercart
      when it helps (for example, moving several crates between the backroom and shelves).
- [ ] Add a first-shift tutorial for ordering products, collecting deliveries, stocking
      shelves, and setting prices. Wait until the map and core loop are close to final.
- [ ] Finish room map-making in Tiled once the layouts are final.
- [ ] Make shelves and registers customizable, with greyscale art that is easy to tint.
- [ ] Let players redecorate with different floors, walls, and doors.
- [ ] Add a redecorating mode that hides shelves, registers, and all other fixtures,
      showing only the walls, floors, and doors, so changes to them are easy to see.
- [ ] When a crate ships out, add a short delay and a small window with an animation of the
      crate flying through space away from the space station.
- [ ] Redo the end of day. Right now it has no real effect, feels pointless, and interrupts play.
- [ ] Make each day 5 minutes long again.
- [ ] Fix how wide shelves look when they are turned sideways.
- [ ] When the player orders crates, add a wait and a delivery the player can see, instead of
      the crates just appearing.
- [ ] Show a small visual cue every time the player makes money, such as a little popup
      showing the amount earned.
- [ ] Replace or get rid of the top HUD bar, which looks bad. Before removing it, make sure
      every piece of information and every button it has is still available somewhere else.
- [ ] Add a space drive-thru window. A customer pulls up and places an order with the player
      at a terminal; the player then gathers the order from the shop, sends it out through a
      vacuum tube, and takes the customer's payment.
- [ ] Add multiple save file slots. Track how long the player has played each save, and
      show on every save the date and time it was last saved and its total play time.

## Planned modules after the base shop

- [ ] Add gunsmithing.
- [ ] Add gear and weapon repair.
- [ ] Add vehicle sales.
- [ ] Add vehicle repair.
- [ ] Add security, including thieves and a minigame to stop them. This is postponed until
      the player can leave the shop.
- [ ] Add more ways to customize the shop, including tinting.
- [ ] Add a character creator so players can customize their shopkeeper.
- [ ] Add a [Shooting Range](documentation/modules/ShootingRange.md) with paid customer
      lanes, firearm tuning, and stairs down to the range.
- [ ] Add the new [Hovercart](documentation/modules/Hovercart.md) at Shop Level 7: a
      chargeable cart that follows the player and carries stacks of crates.
- [x] Finish [Presentation Level](documentation/modules/Presentation.md): 8 purchasable
      hologram decorations raise presentation, with distinct-design variety and floor-crate penalties.
      Decoration prices and points remain provisional development defaults.
- [x] Add [Customer Experience](documentation/modules/CustomerExperience.md): customers
      quietly rate visits, some leave funny reviews, and the Manager's Tablet shows the store's
      rating and every review. Unlocks after the second shift.
- [ ] Finish Delivery Drones: little bots that put accepted remote orders together from stock
      in the shop and ship them, plus a Deliveries tab on the Manager's Tablet. The bots need
      more work, including their appearance and how they move and handle items. Open questions
      are in [DeliveryDroneQuestions](documentation/modules/DeliveryDroneQuestions.md).

## Other ideas

- [ ] Consider Steam achievements.
- [ ] Add Steam co-op as a post-launch update: one player hosts and a friend works in the
      host's shop, with saving and ending the day reserved for the host. The host owns the
      game state. First version works: the friend walks around the host's shop as the Red
      partner (Steam invites or a home-network address). Next: partner jobs (crates, register,
      stocking), the pause rule, and the open questions. Plan, how to test, and questions:
      `documentation/Modules/SteamCoop.md`.
