# Customer Pooling

The customer pool is the set of customers scheduled to arrive during one shift.
It is determined once, when the shift starts, then shuffled into an arrival
order. Arrivals are spread mostly evenly across the shift with some random
variation.

## 1. Determine the total pool

### Active factions

A faction is **active** only if the player holds a license for at least one item
that faction cares about (an item that can appear on that faction's Primary
list). Store this as a set of active factions on the player state, and
recalculate it whenever a license is acquired (and when a save loads). Inactive
factions get no customers: nobody goes to a burger joint for motorcycle parts.

Every MVP faction has at least one license with no faction-reputation
requirement (Scavengers: Scrap-Yard Ballistics; Mercenaries: Standard
Munitions; Explorers: Basic Rations & Water), so a faction can always be
activated and cannot be permanently locked out.

Store reputation sets the store's baseline traffic. Stock and employees adjust
that total. The first-pass tuning values are in `CustomerPooling.js`.

`Pre-Stock Pool = Store Rep Curve x Employee Scaler`

`Calculated Pool = Pre-Stock Pool x Overall Stock Scaler`

`Scheduled Customer Count = max(Calculated Pool, Number of Active Factions)`

The pool is a target for the shift, not a promise that every customer will enter:
the existing in-store capacity can still turn away a scheduled arrival.
Round the calculated pool to a whole customer before applying the minimum. The
minimum is one customer per active faction (zero to three for the MVP).

## 2. Allocate customers to groups

The total pool is split between non-faction customers and each faction. Faction
customers are part of the total. Faction reputation and faction stock change
the mix, not the calculated pool; the guaranteed minimum can raise a smaller
calculated pool to ensure every faction is represented.

- Reserve one customer for each active faction before allocating the
  remainder. This guarantees at least one scheduled visitor from every active
  faction each shift, regardless of faction reputation or faction stock.
- Allocate the remaining customers among non-faction customers and active factions
  according to their attraction weights.
- Attraction weights:
  - Non-faction weight = 1 (fixed).
  - Active faction weight = Shelf Assortment Score x Faction Rep Multiplier.
  - Shelf Assortment Score = min(1, distinct eligible item types assigned to
    shelves / 3). Eligible means it can appear on that faction's Primary list.
    Assigned slots count even when sold out, matching the buy-list rule. No
    assigned eligible types means a score of 0: only the guaranteed visitor comes.
  - Faction Rep Multiplier is 1.0 at zero faction rep, bounded between 0.5 and
    2.0. The first-pass curve reaches those limits at -250/+250 faction rep; tune
    it after observing reputation changes over playtested shifts.
- Example: two eligible shelf types at zero rep = 2/3; at max rep = 4/3.
- Ceiling: with all three factions maxed (weight 2 each), factions get at most
  6 of every 7 non-reserved customers, so non-faction customers are always at
  least ~14% of a large pool. Small pools can be all faction because of the
  guaranteed visitors.
- Round group counts so they add up to the scheduled customer count. The
  reserved faction visitors cannot be rounded away; rotate remaining ties
  between groups so a small pool does not repeatedly disadvantage the same
  group.

The faction-reputation range and attraction weights are starting values to tune
through playtesting. If the faction roster changes, the minimum pool must
increase to guarantee one visitor per active faction.

## 3. Avoiding faction dead ends

- Faction reputation never reduces an active faction's reserved minimum share.
  Even at zero or negative reputation, that faction can still send customers.
- A faction can only be active if the player is licensed to sell something it
  wants. If a customer from an active faction finds none of those items
  assigned to shelves, they leave without a reputation penalty and show a
  hint about the kind of stock they want.
- If eligible shelf slots exist but their stock is sold out, existing Primary
  shortage rules apply. Assigned, sold-out slots still define the store's
  assortment. Restocking eligible items lets the player recover through sales.
- Faction-specific licenses may depend on faction reputation, but each faction
  has a starting license that does not, so low reputation cannot deactivate a
  faction or block it from being activated.

## Scalers

All numerical values below are initial tuning values, not final balance.

### Store Rep Curve

- First-pass baseline: 8 customers at store rep 0 or lower, 10 at 10 rep,
  13 at 25, 16 at 50, and 20 at 100. Interpolate between these points.
- Beyond the final table range, let traffic continue to grow at a diminishing
  rate:

  `Base = Last Table Value + Growth x ln(1 + (Rep - Last Threshold) / Softness)`

- `Growth` controls how much reputation beyond the table is worth; `Softness`
  controls how quickly those gains diminish.
- Clamp very low or negative reputation to the table's lowest range. Store
  reputation always contributes some baseline traffic; it cannot shut the
  store off.

### Overall Stock Scaler

- Compare available units on store shelves (not storage) with the units
  customers in the potential pool are expected to buy.
- `Expected Demand = Pre-Stock Pool x Average Units Per Customer`
- Average units per customer is a weighted average of the customer groups'
  expected shopping-list sizes, using their current attraction weights.
- `Coverage = Shelf Stock Units / Expected Demand`
- `Overall Stock Scaler = clamp(Coverage, 0.5, 1.25)`
- Starting average units per customer: neutral 2, Scavengers 3.5,
  Mercenaries 3, Explorers 2. Derive and tune these from
  `CustomerBuyLists.js`.
- The 0.5 floor preserves some traffic at low stock; the 1.25 ceiling lets
  well-stocked shelves help without replacing reputation as the main driver.
- Faction-specific shelf assortment also influences the *allocation* weights,
  not this total-pool calculation. Do not multiply the total by faction stock
  a second time.

### Employee Scaler

Apply the same employee scaler once to the total pool:

`Employee Scaler = 1 + Max Employee Bonus x (1 - Falloff ^ Employees)`

- Starting values: `Max Employee Bonus = 1.0`, `Falloff = 0.8`; the scaler
  approaches but never exceeds 2.0.
- Example: 0 employees = 1.00x, 1 = 1.20x, 2 = 1.36x, 3 = 1.49x,
  5 = 1.67x, 10 = 1.89x.
- Each hire increases traffic less than the previous one, and staff alone
  cannot grow the pool without limit. Wages are an additional cost.
- The employee system is not implemented yet, so the current employee count is
  0 and this scaler remains 1.0.

## Arrivals

- Calculate the pool once at shift start; changes in reputation, stock, or
  staffing during the shift affect the next shift's pool.
- Create the day's non-faction and faction customers from the allocated counts,
  then shuffle them together into one arrival order.
- Schedule arrivals at mostly even intervals over the shift with random
  variation (up to 35% of the interval), rather than a fixed repeating interval.
- The store's existing in-store capacity may turn away arrivals when it is full.
