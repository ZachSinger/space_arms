# Space Arms Dealer Simulation - Master Technical & Design Blueprint (Updated Steps 1-68)

## Current Stretch Goals List (Post-MVP)
* **Active Theft / Security Mini-Game:** Physical interception of shoplifters on the canvas.
* **The Military Faction:** A fourth customer demographic with unique bulk/high-tier purchasing habits.
* **Faction-Specific Rewards:** Tangible bonuses or unlocks for maximizing reputation with specific groups.
* **Alternative Bankruptcy / Bailout Systems:** Debt spirals or faction loans to prevent a soft-lock game over.
* **Advanced Supplier Discovery System:** Actively researching/discovering new suppliers beyond the default list.

---

## Part 1: Core Architecture & Time
* **Step 1: Platform & Tech Stack:** PC Desktop (Electron using Vite, vanilla HTML/CSS/JS frontend, and Phaser 3 canvas). The UI and Canvas are strictly decoupled.
* **Step 2: Time Management:** Real-time simulation using Galactic Time Code (GTC) with a "Manual Toggle". Shifts reach soft close after 12 GTC hours at a **Static Speed**, or 5 minutes of unpaused play; time pauses entirely when closed, allowing infinite downtime for management.
* **Step 3: The MVP Bridge:** Powered by a Master State (single source of truth) and an Event Bus to handle communication between the "dumb" UI and the Canvas.

## Part 2: Spatial Organization & Stock
* **Step 4: Item Data Contract:** Items possess `baseDimensions` (w, h), `isRotated` toggles, `supportedDisplayTypes`, and a `stack` value (how many units of stack depth on a display this item consumes). 
* **Step 47: Item Granularity (Tags):** Items use Unique Branded Assets (e.g., "Aulin NT Assault Rifle") categorized by combinative Tags (e.g., `[Weapon]`, `[Surplus]`).
* **Step 5: Fixture Data Contract:** Shelves feature `gridDimensions`, a `displayType`, and a `stackDepth` capacity (the most units a single slot on this fixture can hold). Each item's `stackSize` is how many of that item fit in one slot (max 10), capped by the shelf's `stackDepth`. For example, a Rifle with a `stackSize` of 3 fills a slot at 3; a paste tube with a `stackSize` of 10 fills it at 10. Stacked items show an "xN" badge instead of rendering overlapping sprites. The shelf's placement/display grid is tile-derived: two uniform visual slots per floor tile in each direction. Each stocked placement is drawn in-world as one mostly opaque dark block with a category-colored outline, spanning the item's existing `dimensions`, with an `xN` quantity label; do not draw one sprite per unit.
* **Step 22: Hybrid Fixtures:** Universal shelves hold anything that fits physically; specialized displays (e.g., weapon racks) restrict items by Tag but offer massive space efficiency.
* **Step 41: Build Mode:** While the store is closed, use MOVE in the Manager Tablet's Fixtures or Layout tab to rearrange fixtures, or carry a fixture crate and press E to place it. Left-click confirms; right-click or Escape cancels. WASD/arrows pan during placement. Fixtures snap to unlocked floor; placement preserves entrances, the loading area, connected walkways, clear fixture fronts, and register access/queue space.
* **Fixture Purchasing & Crating:** The Fixtures tab lists prices and required fixture licenses. Buying delivers a distinct fixture crate to the Loading Pad. Empty fixtures can be crated only while the store is closed; the crate appears where the fixture stood. Fixture crates can be carried, dropped, thrown, saved, and placed, but cannot be stocked in storage. The only register cannot be crated.
* **Step 63: Reorganizing Loaded Fixtures:** Fixtures move with their entire contents intact, without using hovercart capacity or spawning crates. The original position remains unchanged until a valid placement is confirmed.

## Part 3: Procurement & Logistics
* **Step 10: The Loading Pad & Abstracted Inventory:** Ordered stock spawns as physical crates on an outdoor Loading Pad. Crates must be hauled inside via chained anchor pathfinding. 
* **Hovercart (Backpack) Abstracted Model:** The hovercart is an abstract character/employee inventory size rather than a physical moving entity on the map. 
* **Step 62: Empty Crates:** Utilizes the "Abstracted Box" approach for the MVP—the moment the last item is removed from a crate into inventory, the empty crate instantly despawns.
* **Step 42: Backroom Storage:** Item crates can be dumped on the floor (clogging pathing) or placed on Storage Fixtures, which share the inventory array logic for easy drag-and-drop management. Fixture crates cannot be stocked in Storage Fixtures.
* **Step 29: Unified Market:** All unlocked items populate in a single, unified DOM catalog.
* **Step 45: Supplier Discovery (MVP):** All potential supplier contracts, including fixture licenses, are fully visible from Day 1 in the Tablet, but remain un-interactable until specific reputation thresholds are met. The starting fixture license covers the compact shelf, locker, and register types; the large universal shelf needs the Expanded Fixture Supply contract. A new game starts with lockers and a register but no shelves, so the first shelf is bought from the Fixtures tab.
* **Step 48: Contract-Driven Demand:** Customers only expect (and penalize you for missing) items from Supplier Contracts you have *actively signed and paid for*.

## Part 4: The Checkout Flow (Updated)
* **Step 6: The Grab & Queue:** Customers snapshot an item's price into their virtual cart when grabbing it off the physical shelf. They then path to the register to wait in queue.
* **Step 53: Visualizing Patience:** Customers in line display color-coded emote bubbles that escalate in urgency as their patience drains. Ringing up *any* customer globally resets the patience timer for the next person in line.
* **Step 54: The Checkout Interface:** Pressing E at the register (a prompt shows **E: Activate Register** / **Q: Go-Backs** in range) steps the player behind the counter. The scan window opens only while a customer has items, and can't be closed until they're done; leaving the register is the only way out. Items ride a conveyor belt toward a red scanner bar on the right and queue against it. The player clicks (or drag-hovers) each one to "scan" it, triggering a beep as it slides over the scanner.
* **Step 55: Receiving Payment:** Multiple lore currencies exist (M-Scrips, Vouchers), but all exact change is simplified to standard Galactic Credits. For card payments, the player types the exact total on the numpad. For cash, the UI shows the "Change Owed," which the player types or drags out.
* **Step 12: The Go-Backs Bin:** If a customer's patience hits zero, they leave angry and abandon their cart. These items teleport to an infinite-capacity "Go-Backs" bin, opened as its own window from the register UI. Items leave the bin only by being loaded into the hovercart, then restocked manually.

## Part 5: Shift Mechanics & Economics
* **Step 11: The Soft Close:** At hour 12, doors lock to new foot traffic, but the shift doesn't end until the register queue drops to zero.
* **Step 43: Finances Tab & End Day:** The shift ends silently. The player manually opens the Finances Tab to click "End Day," which deducts wages, updates the calendar, and provides the itemized receipt. This button becomes "Start Shift" for the next day.
* **Step 52: Market Fluctuation & Pricing:** Item market prices scramble dynamically *only* when the player clicks "End Day," allowing stress-free repricing during closed hours. Customers spawn with randomized price tolerance multipliers and will reject items if the markup exceeds their threshold.
* **Step 32 & 68: Bankruptcy & Wages:** Employee wages are paid upfront at the start of the shift, even if it dips funds into the red. If funds fall below zero due to automated deductions, players cannot make new purchases. Running out of sellable stock while negative results in an unrecoverable game-over soft-lock.

## Part 6: Employees & Automation
* **Step 19: The Hiring Pool:** Static roster of hand-crafted aliens with fixed S-F stat grades (Stock Speed, Checkout Speed, Attitude). Training costs exponentially more per rank and renders the employee unavailable for one full shift.
* **Step 17 & 18: Scheduling & Clocking Out:** Employees are budgeted for 3 to 12-hour shifts. When their hours end, they politely finish their immediate micro-interaction before pathing off the canvas.
* **Step 13 & 50: Task Priorities (MVP):** Employees evaluate a top-to-bottom customizable task list: *Work Register*, *Stock Shelves*, and *Load Storage*. Every employee can do all three jobs; their saved priority order decides which available job they take first.
* **Step 14 & 15: Employee Logistics:** Hired staff utilize their own independent inventory capacity ("backpack") to move locker stock to shelf slots. For *Load Storage*, they move delivered item crates from the Loading Pad into lockers.
* **Step 16: Empty Stock Alerts:** If backroom stock is missing, the AI skips the shelf and pings the UI with an "Out of Stock" notification. They do not auto-purchase goods.
* **Step 65, 66 & 67: Break Room & Behavior:** Employees walk in like customers at shift start. When all tasks are fulfilled, they vanish into a blind "break room" door on the wall. The moment a qualifying task opens, they react immediately, stepping out to resume work.

## Part 7: Factions, Customers, & Spawning
* **Step 24: Accumulative Spawning:** The total daily customer pool scales upward. Global Reputation dictates baseline traffic, while Faction reputations *add* their distinct members to the pool.
* **Step 49: Foot Traffic:** Baseline traffic acts as a direct multiplier of Global Store Reputation.
* **Step 51: Reputation Math:** Flat 1-to-1 ratio (+1 for success, -1 for anger/fail). Faction customers apply this dual-tick to both their specific Faction and the Global pool simultaneously.
* **Step 12: Intent + Impulse:** Customers build Primary and randomized Optional lists only from item types assigned to shelf slots (including sold-out slots), and visit each relevant shelf. A missing Primary item costs one penalty total: -1 store reputation, plus -1 faction reputation for faction customers. They still buy available Primary items; they leave without buying if none of their Primary items are in stock. Missing Optional items have no penalty. List sizes are currently small and fixed by faction while reputation thresholds await playtesting.
* **Step 25-28: The Factions:**
  * *Scavengers:* Buy low-tier/surplus. Larger Optional lists (impulse buyers). Use M-Scrips.
  * *Mercenaries:* Buy mid/high-tier Firearms, Ammunition, and Armor. Have a larger Primary list, seek matching ammunition for purchased firearms, and refuse duplicate weapon types.
  * *Explorers:* Seek Tools and Survival gear (either can fill their Primary list); may also buy Standard Firearms. Use Vouchers.
* **Customer Traits:** A customer's personality is built from traits (`js/logic/CustomerTraits.js`). Every customer has their group as a trait (Scavenger, Mercenary, or Explorer) and may also get personality traits:
  * *Wanderer (30% chance):* Besides the shelves holding what they want, also browses about half of the store's other shelves, walking them in a random order. More shelves means more wandering.
  * *Impatient (25% chance):* Waits in line 40% less time before leaving angry. The patience bubble scales to their shorter fuse.
  * *Browser (30% chance, only in a well-stocked store):* Can only appear once the store has at least 4 shelves or at least 8 different items on its shelves. Adds 2 extra items to their might-also-buy list, picked from anything on the shelves, even outside their group's usual taste. They still won't pay above their price limit.
  * Traits aren't shown to the player. They exist to mix up encounters; new traits get added to the pool as we think of them.
  * Traits can have appearance conditions (like Browser's) so they only join the pool once the store meets them.

## Part 8: The Manager's Tablet & UI
* **Step 40: Tablet Tabs:** The central DOM UI features tabs for Inventory, Employee, Contract, Supply, Fixtures, Layout, Finances, and the Handbook.
* **Supply Tab Shelf Badges:** Items that already have a shelf spot get a colored badge and edge: red "SOLD OUT ON YOUR SHELVES", amber "RUNNING LOW" (under half full), or green "ON YOUR SHELVES". These sort to the top, most urgent first, so restocking is quick.
* **Tablet at the Register:** Opening the Manager's Tablet hides the checkout window without losing scanned items or payment progress. Arriving customers cannot open checkout over the Tablet. The shop keeps running and waiting customers still lose patience. Closing the Tablet restores checkout for the front customer if the player is still operating the register; if that customer left, checkout starts for the next customer instead.
* **Step 36 & 46: Feedback & Manuals:** Contextual "God Windows" teach mechanics once. On-canvas feedback uses clean Emote Bubbles. The Employee Manual/Handbook acts as a permanent reference guide.
* **Step 44: MVP Onboarding:** Minimalist pre-shift tutorial via God Windows teaching the procurement-to-shelf loop (buy rifles, grab from pad, inventory, stock, set price, start shift).
* **Step 35: Screen Real Estate:** Absolute-positioned HTML windows float over a 100% full-screen canvas viewport.
* **Step 57: Camera Control (MVP):** The physical shop floor will never expand beyond the size of a single monitor screen. There is no camera panning or scrolling for the MVP.
* **Modal Windows & Anchors:** UI windows act as strict modals (clicking outside does not close them). Closing requires an `Esc` key or a dedicated close button. Anchor-based movement relies on clicking an item, shelf, crate, or register; character pathfinding triggers the relevant UI *only upon arrival*, and anchor-clicking is disabled while any window is open.

## Part 9: Visuals, Physics & Save Data
* **Step 30 & 58: Player Collision & Input:** No dynamic entity collision (pawns glide through each other). The player avatar operates at the highest Z-index (9999) to remain visible.
* **Step 38: Aesthetics:** Clean, flat-shaded 2D RimWorld-style vector pawns with no complex skeletal walk cycles to ensure lean animation logic.
* **Step 37: Audio:** Dynamic crossfading music tied directly to the Shift State (Pre-Shift, Active Shift, Post-Shift).
* **Step 34: Data Persistence:** Autosaving runs only off-shift and checkpoints before opening a shift. Continue restores a closed shop at the public entrance, including fixture positions/contents, hovercart, floor/carried crates, credits, reputation, licenses, store prices, market day/prices/supplier rates, and unlocked rooms. Mid-shift exits resume the last off-shift checkpoint, not active customers. Electron saves atomically to `savegame.json` in its user-data directory; browser play uses localStorage (separate saves). Save/load failures are shown explicitly, and New Game requires confirmation before replacing a save.