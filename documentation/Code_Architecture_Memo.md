# Space Arms Dealer Simulator - Code Architecture Memo

## 1. Core Principles & Tech Stack
The codebase is built on **Vanilla ES6 JavaScript** adhering to strict modular boundaries, operating within a Vite/Electron environment with a Phaser 3 game canvas.

*   **Strict Decoupling:** The UI (HTML/DOM) and the Game Engine (Phaser 3 Canvas) are completely isolated. They do not directly mutate each other's data structures or rendering loops.
*   **Single Source of Truth:** All global gameplay metrics (Credits, Reputation, Licensing, Active Shifts) live exclusively inside the central state manager (`PlayerState`).
*   **Pub/Sub Event Bus Model:** Communication between DOM UI windows, controllers, and the game canvas must pass through reactive subscriptions or event dispatchers. Components never tightly couple to one another.

## 2. State Management (`PlayerState.js`)
The `PlayerState` class acts as the central nervous system of the simulation.
*   **Data Contracts:** Explicitly tracks `credits` (permitting negative balances for debt mechanics), `globalReputation`, faction standings, and unlocked supplier contracts.
*   **Subscription Architecture:** UI components do not poll the state on a timer. They subscribe via callback functions (`playerState.subscribe((state) => this.render(state))`). 
*   **Mutation Control:** State values can only be modified via explicit class methods (`addCredits()`, `spendCredits()`, `addReputation()`). These methods automatically trigger `notifyListeners()` to refresh all connected UI elements instantly.

## 3. UI Window & Module Architecture (`UIWindow.js`, `WindowManager.js`)
To maintain consistency across all floating management windows:
*   **Modular Classes:** Windows are instantiated as independent JavaScript classes (`UIWindow`) configured via configuration objects (`{ id, title, contentHTML, width, height, x, y }`).
*   **DOM Injection:** UI classes handle their own DOM element creation, appending them cleanly into the central `#ui-layer`.
*   **Window Management:** The `WindowManager` handles dynamic z-index layering, active focus states, window dragging physics, and keyboard accessibility (such as closing active windows via the `Escape` key).

## 4. Data Handling & Parsing
*   Static data (items, licenses) is stored in raw JSON format (`Items.json`, `Licenses.json`).
*   **`DatabaseManager.js`:** Fetches and parses raw JSON arrays into strongly-typed class models (`StoreItem`) cached within internal JavaScript `Map` structures for $O(1)$ lookup performance.

## 5. The Harness Workflow (Mandatory Development Protocol)
During development, features must be prototyped and tested inside isolated `.html` files known as **Harnesses**.
*   **The Workbench Rule:** A harness is a temporary testing sandbox, not the final application bundle.
*   **No Inline Production Code:** Raw business logic, complex UI classes, or state controllers must **never** be written inline inside a harness script or style block. They must be written as decoupled ES6 modules in `js/` and imported.
*   **Centralized Stylesheets:** Harnesses must reference central stylesheets (`Styles/space_dealer_window.css`) rather than inventing local styling rules.

## 6. Phaser 3 Integration Guidelines
*   The Phaser canvas manages world rendering, spatial pathfinding, and physical shelving (`z-index: 1`).
*   DOM windows sit above the canvas (`z-index: 10+`) with pointer-events toggled to ensure click-through isolation where appropriate.
```eof