# Inventory Catalog & Category Planning

## The Tag Taxonomy

### Group A: Primary Tags (The "What is it?")

Drives UI filtering and physical shelf compatibility (e.g., Weapon Racks vs. Armor Mannequins).

- `Firearm`
- `Melee`
- `Ammunition`
- `Attachment`
- `Armor`
- `Apparel`
- `Tool`
- `Survival`

### Group B: Tier & Condition Tags (The "Who wants it?")

Drives Faction purchasing power and AI desire logic.

- `Surplus` (Low-tier / Used)
- `Standard` (Mid-tier / Reliable)
- `High-Tier` (High-end / Pro)
- `Rare` (Hard to find / Highly sought)
- `Cutting-Edge` (Latest and Greatest)
- `Old` (Vintage or heavily worn)

### Group C: Sub-Type Tags (The "Flavor & Pairing")

Drives specific AI logic (e.g., Mercenaries refusing duplicate sub-types, ammo matching).

- **Combat:** `Pistol`, `Rifle`, `Heavy`, `Blade`, `Blunt`
- **Utility:** `Mining`, `Salvage`, `Repair`, `Medical`, `Labor`, `Exploration`
- **Apparel/Armor Function:** `Pressurized`, `Casual`
- **Consumable:** `Ration`, `Filter`
- **Specialty:** `Luxury`, `Souvenir`
- **Body Slot:** `Head`, `Torso`, `Legs`, `Feet`, `Hands`, `Suit`
- **Attachment Slot:** `Sight`, `Grip`, `Stock`, `Magazine`, `Tactical`, `Barrel`

## 2. Faction Demand Mapping (MVP Baseline)

- **Scavengers:** Target `Surplus` and `Old` tags across all Primary categories. High impulse buy rates for `Survival` and `Apparel`.
- **Mercenaries:** Target `Firearm`, `Ammunition`, and `Armor` with `Standard`, `High-Tier`, or `New` tags. Will dynamically seek matching `Ammunition` sub-types for any `Firearm` purchased.
- **Explorers:** Target `Tool` and `Survival` categories. Will occasionally buy `Standard` `Firearms` for defense.
