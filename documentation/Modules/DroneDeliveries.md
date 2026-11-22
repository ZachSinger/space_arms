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
- Once the crate has every item it needs, it turns a different color (one we haven't used yet).
- Set the finished crate on the pad next to the Drone Terminal. It ships itself and you are
  paid immediately.

## Deadlines
- Orders can be filled any time, even after hours.
- Most orders need to be filled before the next day (the day after the order is received).

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
- Orders come in by chance, much like how customers are generated, except factions don't matter.
  An order can arrive at any time.
- Remote orders are generally larger than most customer orders.
- The Drone Terminal and its pad are already placed in the starting backroom, next to the shipping
  crate area. This keeps remote-order work off the sales floor while keeping the terminal and
  incoming stock nearby.

## Approved terminal animation (delivery lab)

Use the delivery lab's Fast timing, 60 ms per picture, for all six mechanical stages when
integrating the approved terminal art into gameplay. The terminal screen is a separate
continuously animated overlay; its animation must not follow the doors, platform or crate lid.
The lab uses this timing by default. See [DebugPlaytesting.md](../DebugPlaytesting.md) for the
sprite sheets and screen alignment.

The delivery crate's light is red while its order is missing any item and turns green once the
crate holds every item the order needs (requested by Zach).

## Implemented first-pass tuning (not confirmed by Zach)

The following values are implementation picks to make the feature playable, not agreed design.
They should be reviewed against the game's balance before they are treated as final:

- Each scheduled customer arrival is a 1% chance for a remote order. Customer factions do not
  affect the order.
- Orders contain 2–4 product types, with 3–8 of each. Products are limited to items covered by
  the shop's current supplier licenses.
- Shipping pays the order's market value plus 30%.
- Shipping grants one store reputation per product type. Cancelling or expiring loses the same
  amount.
- An order received on one day expires at the end of the following day.
- A complete order crate turns teal.
- When an order arrives, a short bell chime plays, the bottom bar says where to find its item
  list and crate, and the order card glows for 6 seconds.
- An order card sits in the top-left corner while an order is open. It shows the deadline,
  payout, how many items are packed, and for each product: packed/needed, which rooms' shelves
  and crates hold it and how many, and a warning when the shop has fewer than still needed.
  Its last line says what to do next. Clicking its heading shrinks it to one line for the rest
  of the session.
- While the player carries the order crate, a bobbing teal diamond marks each shelf and crate
  stack holding a product the order still needs.
