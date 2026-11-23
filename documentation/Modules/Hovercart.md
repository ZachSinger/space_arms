# Hovercart (module)

> Note: an older, different hovercart (a stock bin with upgrades) was removed from the game
> earlier. This is a new design and does not bring that one back.

## Overview
- Purchasable at Store Level 7.
- A floating platform about as wide as a crate that holds a stack of up to 3 crates at first.
- It follows the player. Each crate on it slows it down, but it does its best to keep up.
- You can still hold three crates yourself while using it.

The DEV Crate Test Room has a non-saving prototype of the cart and its charger for testing crate
transfers, stacking, and the battery. It uses the selected wall-post and floor-dock charger
design. The level unlock, purchase, and upgrades are not part of this prototype.

## Counting as held crates
- When it's not moving (it has finished approaching you), its crates count as a stack you're
  holding.
- In a shelf screen, its crates count as if you were holding them, so you can stock from up to
  8 crates at once.
- The crate cards in the bottom right list the hovercart's crates under an "ON HOVERCART"
  heading, below the crates in your hands. While the cart is too far away, those cards are greyed
  out and the heading says so; once it is close enough they look normal again. Crates in your
  hands are never greyed out.

## Following behavior
- It only moves after you've gotten a few steps away. It must always get close enough to be
  used, but it shouldn't fidget every time you move at all.

## Gear Modifier button
- Shift on keyboard (L1 or equivalent on a controller).
- Holding it while using the normal crate controls (pick up or put down, single crates or the
  whole stack) does that action with the hovercart instead of the floor, other stacks, etc.
- Only works when the hovercart is near you and not moving.

## Battery and charging station
- The hovercart has a very limited battery and must charge at its charging station.
- The station is where you turn the hovercart on and off. Face it and press E (same rules as a
  door: you must actually face it, not be far off-center) to activate the hovercart so it
  follows you.
- A full battery holds 300 energy. While the cart is on, it uses energy every second:

  | Crates on cart | Sitting still | Moving |
  |---|---|---|
  | 0 | 1 | 4 |
  | 1 | 2 | 6 |
  | 2 | 3 | 8 |
  | 3 | 4 | 10 |

  So moving with 3 crates empties a full battery in 30 seconds.
- It charges only while docked at its station: empty to full in 60 seconds (a starting guess).
- The charge shows in three places: a bar under the cart, the charger's screen, and a
  HOVERCART gauge in the top bar while the cart is off its charger.
- When the battery runs out, the cart drops to the floor where it is and stops following.
  You can still take crates off it but not put any on. Once it has no crates on it and your
  hands are empty, face it and press E to pick it up and carry it over your head. You can't
  handle crates while carrying it. Take it to its station and press E to dock it and charge.

## Upgrades
- **Length:** each upgrade adds more crate space (amounts not decided yet; it starts at 3).
- **Speed:** can be upgraded until it follows at full running speed (the speed you'd have
  holding no crates).
