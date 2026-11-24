# Drone Deliveries (module)

## Overview
The Drone Terminal lets you fill orders from remote customers from the start of the game.
- Drone Deliveries are generally larger orders and are very profitable.
- They generally have a very high chance of positive reputation gain.
- The only way to lose reputation on a drone delivery is to not deliver it, or to cancel the
  order before it expires.

## Filling an order
- Each accepted order has its own special crate. Several orders can remain accepted at once;
  each keeps its own deadline, contents, payment, and reputation.
- Choose an accepted order in the terminal's ORDER tab to bring up its crate. Other crates
  can wait inside the terminal, or stay wherever the player left them. Only one delivery crate
  can be carried at a time, alongside ordinary stock crates.
- Carry the order crate and grab the required stock from shelves or from existing crates:
  - **From crates:** each press of E pulls one needed item from a nearby crate, if any.
  - **From shelves:** press E next to the shelf. Without opening the shelf screen, it pulls one
    of the needed items into the crate, if the shelf has any.
- Its light stays red while any items are missing and turns green when all items are packed.
- The crate's lid opens when it first rises and stays open while carried or put down elsewhere.
  It closes only when the completed crate is back on the terminal and accepted for shipping.
- Set the finished crate on the pad next to the Drone Terminal. It ships itself and you are
  paid immediately.

## Deadlines
- A new order arrives as an **offer** at the Drone Terminal. Accept it to get its crate, or
  decline it. An offer only waits a limited number of shifts, then goes away on its own.
- Each day has exactly one shift (End Day must be clicked before the next shift can start), so
  "Day N" on the terminal is also the shift a deadline ends with.
- Declining an offer, or letting it go away, never costs reputation.
- Once accepted, an order must be shipped within a set number of shifts. Missing that deadline
  costs store reputation.
- The terminal and order tracker show deadlines as time remaining, such as "Expires in 2 days"
  or "Due today".
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
- The shop has one drone, but several remote orders can be accepted at once. The terminal
  handles one crate at a time.
- Orders come in by chance on the shift clock, from people who are not in the store. An order
  can arrive at any time during a shift.
- Each in-game hour of a shift is a 15% chance for a new order offer.
- Orders use products from any supplier contract the store's level allows buying, whether or
  not the store owns that contract yet.
- Offers only exist for a limited number of shifts, and accepted orders must be filled within a
  limited number of shifts. Not accepting an offer never loses reputation; failing to fill an
  accepted order in time loses store reputation.
- Orders scale with store level: more orders, and more varied orders, at higher levels.
- Remote orders are generally larger than most customer orders.
- The Drone Terminal and its pad are already placed in the top-right corner of the starting
  backroom, against the back wall. This keeps remote-order work off the sales floor while keeping
  the terminal and incoming stock nearby.

## Approved terminal art in gameplay

The gameplay terminal uses the approved door and platform animation at Fast speed, 60 ms per
picture. The order crate uses its approved dark art, opens its lid as it arrives, and closes
it when accepted for shipping. The crate's separate red or green light shows whether the order is complete.
The screen scrolls continuously on its own, independently of the doors, platform, and crate lid.
When an order ships, the screen shows three dots filling in for about a second, then a blinking
green thumbs up with a short four-note jingle, then goes back to scrolling.
See [DebugPlaytesting.md](../DebugPlaytesting.md) for the sprite sheets and screen alignment.

Picking up a delivery crate leaves the platform raised and the hatch open. Accepting or
choosing another order lowers the platform without closing the hatch, pauses briefly, and
raises the next crate. A crate left on the platform waits inside the terminal during a swap;
carried crates and crates left elsewhere are not moved. Choosing a carried order clears the
platform for its return. Shipping lowers the closed crate, and the hatch stays open while any
accepted orders remain. Only after the last accepted order ships, is cancelled, or expires
does the terminal lower its empty platform and close the hatch.

The terminal post and pad both block people. The pad is drawn on the floor layer, so it never
covers the player. Crates can occupy the pad's surface without colliding with its people blocker.

The delivery crate's light is red while its order is missing any item and turns green once the
crate holds every item the order needs (requested by Zach).

## Implemented first-pass tuning (not confirmed by Zach)

The following values are implementation picks to make the feature playable, not agreed design.
They should be reviewed against the game's balance before they are treated as final:

- An offer waits at the terminal for 2 shifts, counting the shift it arrives in (an offer that
  arrives during the Day 3 shift goes away when the Day 4 shift ends).
- An accepted order must ship within 3 shifts, counting the shift it is accepted in (accepted
  during the Day 4 shift, due by the end of the Day 6 shift).
- Accepting another offer keeps earlier accepted orders open and selects the new crate.
  The ORDER tab lets the player switch between accepted orders.
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

## Delivery Drone Delivery Drones (picks by Copilot, not confirmed by Zach)

Zach asked for little bots that pack accepted remote orders and ship them, plus an app that
adds a Deliveries tab to the Manager's Tablet. The questions in DeliveryDroneQuestions.md were
not answered, so every value below is an implementation pick:

- Sold once in the Layout tab under Equipment for 5,000, from Shop Level 10. Nothing is placed
  in the store, and they can be bought at any time.
- They pack one item every 1.5 seconds into the oldest accepted order, and only start an order
  once the store holds every item it still needs.
- They take stock from crates before shelves, and backroom stock before sales floor stock.
  They never take from a carried crate or from crates still locked on the Loading Pad, and the
  order card says to move those crates into the store.
- They only pack order crates that are inside the Drone Terminal or on its drone pad, and ship
  a finished crate straight from the terminal.
- They work at any time, including after hours. They have no sprites; progress shows on the
  order card and in the Deliveries tab.
- The Deliveries tab appears only after buying the drones. It lists accepted orders with their
  packing progress and drone status, lets the player reset or cancel any of them, and shows
  offers to accept or decline.
