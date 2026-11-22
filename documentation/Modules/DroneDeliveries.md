# Drone Deliveries (module)

## Overview
Once unlocked, the Drone Terminal lets you fill orders from remote customers.
- Drone Deliveries are generally larger orders and are very profitable.
- They generally have a very high chance of positive reputation gain.
- The only way to lose reputation on a drone delivery is to not deliver it, or to cancel the
  order before it expires.

## Filling an order
- Each order produces a special kind of crate. You can have multiple orders at once; each
  order gets its own crate.
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

## Proposed first version (not yet confirmed by Zach)
These answers fill gaps the notes above leave open. They are first-pass picks to build and
playtest, not agreed design; any of them can change.

- **Unlock:** Shop Level 10, alongside the third staff slot, when employees can start running
  the floor. It becomes a Shop Level unlock with no contract to sign.
- **Terminal and pad:** one fixture, the Drone Terminal with its pad attached, bought and placed
  like a register. One per shop. Price: 3,000, about two shifts of profit at Level 10.
- **How orders arrive:** a new order appears on the terminal at the start of each day, with up to
  3 open at once. The player gets a message when one arrives.
- **What's in an order:** 2 to 4 different products, 3 to 8 of each, chosen only from products
  the player already has contracts for.
- **Pay:** the market price of everything in the order plus 30%, paid when the crate ships.
- **Reputation:** shipping adds reputation equal to the number of products in the order. Letting
  an order expire or cancelling it costs the same amount.
- **Deadline:** an order expires when the day after it arrived ends, as the notes say.
- **Finished crate color:** a teal not used by any other crate.
