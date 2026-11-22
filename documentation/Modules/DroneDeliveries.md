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

## Proposed first version (not yet confirmed by Zach)
These fill gaps the notes above leave open. They are first-pass picks, not agreed design.

- **What's in an order:** only products you already have contracts for, and more of them than a
  typical customer buys (exact size to be tuned in playtests).
- **Pay:** the market price of everything in the order plus 30%, paid when the crate ships.
- **Reputation:** shipping adds reputation; letting an order expire or cancelling it costs the
  same amount.
- **Finished crate color:** a teal not used by any other crate.
