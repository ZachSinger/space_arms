# TODO

Current unfinished work. Add new tasks when identified; remove entries when they are
completed or no longer relevant.

## Current shop

- [ ] Check shop-level progression and customer traffic as reputation and stock change
      across normal shifts; adjust level thresholds and customer counts if needed. The
      intended starting pace is one level per fully served, penalty-free shift for the
      first four shifts, then slower progression. See [StoreLevel.md](documentation/StoreLevel.md).
- [ ] Check employee shelf-stocking times at each training level during normal shifts,
      including their trips between crates and shelves, and adjust speeds if needed.
- [ ] Make customers' lists of products they came to buy grow with reputation. Decide
      when they grow after measuring reputation gains and losses over multiple shifts.
- [ ] Test controls with physical Xbox and PlayStation controllers and on Steam Deck.
      Adjust stick feel, dash timing, menu navigation, and button prompts as needed.
- [ ] Check how movement, crate handling, the camera, and checkout feel during a
      10-minute game session.
- [ ] Add a first-shift tutorial for ordering products, collecting deliveries, stocking
      shelves, and setting prices. Wait until the map and core loop are close to final.
- [ ] Finish [Cleaning](documentation/modules/Cleaning.md) by adding dirt marks, the Mop
      Bucket fixture, and mopping. Trash and employee trash cleanup already work.

## Art and sound

- [ ] Improve the floor, wall, and room art near the end of the project; Tiled map-making
      is deferred until then.
- [ ] Add a sound effect when a thrown box hits a customer.
- [ ] Replace the placeholder icon for the Blackwood Ordnance Counter-Weight Stock
      (`att_stk_08`) with artwork made for that item.

## Planned modules after the base shop

- [ ] Add gunsmithing.
- [ ] Add gear and weapon repair.
- [ ] Add vehicle sales.
- [ ] Add vehicle repair.
- [ ] Add security, including thieves and a minigame to stop them. This is postponed until
      the player can leave the shop.
- [ ] Add more ways to customize the shop, including tinting.
- [ ] Add a [Shooting Range](documentation/modules/ShootingRange.md) with paid customer
      lanes, firearm tuning, and stairs down to the range.
- [ ] Add [Drone Deliveries](documentation/modules/DroneDeliveries.md): remote orders packed
      into special mixed-item crates and shipped from a terminal pad.
- [ ] Add the new [Hovercart](documentation/modules/Hovercart.md) at Shop Level 7: a
      chargeable cart that follows the player and carries stacks of crates.
- [ ] Add [Presentation Level](documentation/modules/Presentation.md): customers expect
      decorations, and low presentation blocks reputation gains. The design is unfinished.

## Other ideas

- [ ] Consider Steam achievements.
- [ ] Add Steam co-op as a post-launch update: one player hosts and a friend works in the
      host's shop, with saving and ending the day reserved for the host. The host owns the
      game state. Start with a local two-window prototype, then add Steamworks lobbies,
      invites, and peer-to-peer transport.
