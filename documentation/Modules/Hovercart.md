# Hovercart (module)

> Note: an older, different hovercart (a stock bin with upgrades) was removed from the game
> earlier. This is a new design and does not bring that one back.

## Overview
- Unlocks at Store Level 7. Bought once, for 1,500, in the Equipment section of the Manager's
  Tablet Layout tab, while the store is closed. The price is a starting guess.
- A floating platform about as wide as a crate that holds a stack of up to 3 crates at first.
- It follows the player. Each crate on it slows it down, but it does its best to keep up.
- You can still hold three crates yourself while using it.

## Buying it
- Its charger goes in the top-left corner of the backroom. That corner must be clear of
  fixtures, floor crates, and the player to buy it, and fixtures can't be placed there after.
- The Level 7 news at the end of a shift mentions it, and the Handbook's Level Rewards list it.
- The purchase shows on the day's receipt as "Bought equipment: Hovercart".

## Saving
- A save remembers that you own it and which crates are on it, not its battery or position.
- Loading a save with crates on the cart puts it next to you, switched on with a full battery
  and its crates still on it. Otherwise it loads docked on its charger with a full battery.

The DEV Crate Test Room gives you the cart for free, with a battery that never runs out and
endless stamina, for testing. Nothing there is saved.

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
- It only follows you directly while it's in the same room as you. Once you leave the room,
  it stops chasing you and heads for the door you left through, then follows you on the other
  side. It never jumps across the map to catch up.
- It goes through doors the way you do: the door slides open as it comes near, it glides into
  the doorway, comes out of the matching door on the other side, and floats out after you. If
  you're still standing just inside, it waits in the doorway until you step clear, so it never
  ends up on top of you or past you.
- It steers around floor crates instead of shoving them. If a crate sits right in front of the
  door, it pulls up beside the crate and slips through the door anyway.
- In your room it retraces your footsteps, cutting straight to the furthest spot along them it
  can reach without bumping anything. If it gets stuck, or stops getting closer to where you are
  right now (whether you're standing still or walking), it plans its own way around for a moment
  and then goes back to your footsteps. Where you squeezed past a corner too tight for the cart
  (like the end of a shelf), it plans its own way around instead of trying to follow you there.
- The DEV Crate Test Room has a maze of sideways shelves on the lower sales floor, entered at the
  far right end, for testing how the cart gets around shelves.
- Being close only counts if nothing stands between you. A cart right behind the register from
  you still comes around to your side.
- It plans its route with a little room to spare around fixtures like the register and racks,
  so it rounds their corners instead of catching on them. It only cuts it close in gaps too
  narrow to pass otherwise.

## Bumping into it
- It's solid: you can never walk over it, whether it's on, out of battery, or docked.
- Walking into it pushes it like a single floor crate, always at the one-crate push speed
  (60% of walking), no matter how many crates are on it or in your hands.
- Docked on its charger it doesn't move. Facing the docked cart counts as facing the
  charger, so you can still turn it on.
- While you carry it over your head it doesn't bump into anything.

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
