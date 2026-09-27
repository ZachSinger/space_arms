# Space Arms Dealer - GitHub Copilot Instructions

## 1. Project Overview & Environment

- **Project:** _Space Arms Dealer_, a PC desktop simulation game built for Steam.
- **Runtime & Stack:** Electron wrapper, Phaser 3 / Vanilla JavaScript (ES6+), HTML5 Canvas, and custom CSS.
- **Aesthetic:** Diegetic retro-futuristic CRT computer terminal UI driven by `styles/space_dealer_window.css`.

---

## 2. Codebase Architecture & File Roles

Copilot must respect the existing modular architecture:

- `data/`: Static game balance and entity definitions.
  - `Items.json`: Catalog of weapons, munitions, consumables, and dimensions.
  - `Licenses.json`: Manufacturer tiers, faction restrictions, and purchase criteria.
  - `IconSet.json`: Sprite sheet tile mappings and atlas coordinates.
- `js/`: Core game systems and logic.
  - `DatabaseManager.js`: Ingests and queries static datasets from `/data/`.
  - `PlayerState.js`: Single source of truth for runtime mutable player state (Galactic Credits, faction reputation, inventory, unlocked licenses).
  - `UIWindow.js` & `WindowManager.js`: Modular windowing library managing draggable, focusable, and dockable CRT viewports.
  - `*Renderer.js` (`InventoryRenderer.js`, `LicenseRenderer.js`): Pure display controllers. Reads data/state to render contents inside `UIWindow` containers.
  - `HUDController.js` & `Debugger.js`: Top-level orchestration and runtime diagnostics.
- `documentation/`: Definitive design specs. Consult these for feature scope:
  - `space_arms_dealer_bible.md`: Core gameplay loops (12/24h shifts, factions, tactile checkout, supplier contracts).
  - `TagTaxonomy.md` & `Items.md`: Tagging rules and weapon attributes.

---

## 3. Implementation Rules & Guardrails

1. **Data Decoupling (No Hardcoded Stats):**
   - Never hardcode item prices, dimensions, damages, or license tiers in JS logic.
   - Query all static entity attributes through `DatabaseManager.js` referencing IDs in `data/Items.json` or `data/Licenses.json`.

2. **State Mutation Discipline:**
   - Renderers like `InventoryRenderer.js` must never directly mutate inventory arrays or credit counts.
   - All state mutations must flow through explicit methods on `PlayerState.js` (e.g., `PlayerState.addCredits()`, `PlayerState.transferItem()`).

3. **Window System & UI Lifecycle:**
   - New interfaces must instantiate through `WindowManager.createWindow()` or subclass `UIWindow.js`.
   - Use CSS classes and custom CSS variables defined in `styles/space_dealer_window.css` for borders, CRT scanlines, and typography.
   - Maintain compatibility with standalone harnesses in `html/harnesses/`.

4. **Game Design Alignment:**
   - Adhere strictly to the three MVP factions: **Scavengers**, **Mercenaries**, and **Explorers**.
   - Maintain physical inventory constraints (grid dimensions, stack depth, hovercart slots) as specified in `documentation/space_arms_dealer_bible.md`.
