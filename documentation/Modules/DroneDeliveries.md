# Drone Deliveries (module)

## Overview
The Drone Terminal lets you fill orders from remote customers from the start of the game.
- Drone Deliveries are generally larger orders and are very profitable.
- They generally have a very high chance of positive reputation gain.
- The only way to lose reputation on a drone delivery is to not deliver it, or to cancel the
  order before it expires.

## Filling an order
- Each order produces a special kind of crate. With one drone, only one order is open at a time.
- Carry the order crate and grab the required stock from shelves or from existing crates:
  - **From crates:** each press of E pulls one needed item from a nearby crate, if any.
  - **From shelves:** press E next to the shelf. Without opening the shelf screen, it pulls one
    of the needed items into the crate, if the shelf has any.
- Its light stays red while any items are missing and turns green when all items are packed.
- Set the finished crate on the pad next to the Drone Terminal. It ships itself and you are
  paid immediately.

## Deadlines
- A new order arrives as an **offer** at the Drone Terminal. Accept it to get its crate, or
  decline it. An offer only waits a limited number of days, then goes away on its own.
- Declining an offer, or letting it go away, never costs reputation.
- Once accepted, an order must be shipped within a set number of days. Missing that deadline
  costs store reputation.
- Orders can be filled any time, even after hours.

## Order crates are special
- These are the only crates in the game that can hold more than one kind of item.
- The only way to take items out is to **reset** or **cancel** that crate's order from the
  terminal. Either one packs the items and puts them in your backroom, just like Go-Backs.
  - **Reset:** unpacks and deletes the crate (the order stays open).
  - **Cancel:** does the same, and also gets rid of the order.
- The game ties each order's crate to its order with a unique ID, so it never treats that
  crate like a regular item crate and never confuses it with another order's crate.

## Confirmed by Zach
- Remote orders are available from the start of the game, not a later unlock.
- The shop has one drone, so only one remote order can be open at a time.
- Orders come in by chance on the shift clock, from people who are not in the store. An order
  can arrive at any time during a shift.
- Each in-game hour of a shift is a 15% chance for a new order offer.
- Orders use products from any supplier contract the store's level allows buying, whether or
  not the store owns that contract yet.
- Offers only exist for a limited number of days, and accepted orders must be filled within a
  limited number of days. Not accepting an offer never loses reputation; failing to fill an
  accepted order in time loses store reputation.
- Orders scale with store level: more orders, and more varied orders, at higher levels.
- Remote orders are generally larger than most customer orders.
- The Drone Terminal and its pad are already placed in the top-right corner of the starting
  backroom, against the back wall. This keeps remote-order work off the sales floor while keeping
  the terminal and incoming stock nearby.

## Approved terminal art in gameplay

The gameplay terminal uses the approved door and platform animation at Fast speed, 60 ms per
picture. The order crate uses its approved dark art and animates its lid as it arrives and when
items are packed. The crate's separate red or green light shows whether the order is complete.
The screen scrolls continuously on its own, independently of the doors, platform, and crate lid.
See [DebugPlaytesting.md](../DebugPlaytesting.md) for the sprite sheets and screen alignment.

The terminal post and pad both block people. The pad is drawn on the floor layer, so it never
covers the player. Crates can occupy the pad's surface without colliding with its people blocker.

The delivery crate's light is red while its order is missing any item and turns green once the
crate holds every item the order needs (requested by Zach).

## Implemented first-pass tuning (not confirmed by Zach)

The following values are implementation picks to make the feature playable, not agreed design.
They should be reviewed against the game's balance before they are treated as final:

- An offer waits at the terminal for 2 days, counting the day it arrives (an offer that
  arrives on Day 3 goes away at the end of Day 4).
- An accepted order must ship within 3 days, counting the day it is accepted (accepted on
  Day 4, due by the end of Day 6).
- With one drone, only one accepted order can be open at a time. Its Accept buttons are
  greyed out until it ships or is cancelled; offers can still arrive and wait meanwhile.
- Up to 1 offer can wait at once for store levels 1–10, 2 for 11–20, 3 for 21–30, 4 for
  31–40, and 5 from level 41. The hourly roll is skipped while every offer slot is full.
- Orders contain 2–3 product types for store levels 1–10, up to 4 for 11–20, 5 for 21–30,
  and 6 from level 31, with 3–8 of each. Higher levels also allow more supplier contracts,
  which adds more different products to choose from.
- Shipping pays the order's market value plus 30%.
- Shipping grants one store reputation per product type. Cancelling an accepted order or
  missing its deadline loses the same amount.
- The starting backroom has four usable floor columns rather than two, with its depth,
  Loading Pad size, and door position unchanged. This is mockup A's first-pass width, not a
  width selected by Zach; later backroom upgrades still add two columns each.
- When an offer arrives, a short bell chime plays, the bottom bar says to accept or decline it
  at the Drone Terminal, and the order card glows for 6 seconds. While no order is accepted,
  the card only says how many offers are waiting; while one is, its last line says how many
  more offers are waiting.
- An order card sits in the top-left corner while an order is open. It shows the deadline,
  payout, how many items are packed, and for each product: packed/needed, which rooms' shelves
  and crates hold it and how many, and a warning when the shop has fewer than still needed.
  Its last line says what to do next. Clicking its heading shrinks it to one line for the rest
  of the session.
- While the player carries the order crate, a bobbing teal diamond marks each shelf and crate
  stack holding a product the order still needs.
