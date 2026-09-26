# Space Arms Dealer Simulator - UI Architecture Memo

## 1. Core Workflow & Philosophy
The user interface is built using **Vanilla HTML/CSS/JavaScript** and is strictly decoupled from the Phaser 3 game canvas.
*   **The Canvas Layer:** Manages pathfinding, pawns, physical stock shelves, and world rendering (`z-index: 1`).
*   **The DOM UI Layer:** Manages all floating windows, inventory management, point-of-sale registers, and the Manager's Tablet (`z-index: 10+`).
*   **The Harness Workflow:** Isolated `.html` workbenches are used for rapid component testing. Harnesses must never bundle raw production code inline; they must load decoupled ES6 modules and reference central stylesheets.

## 2. The Tokenization Protocol (Strict Enforcement)
Visual consistency and readability depend entirely on strict adherence to design tokens. **Violating these rules breaks interfacelegibility.**

### Token Reuse Rules
1.  **Strict Token Adherence:** Developers and designers must *always* reuse existing CSS variables (`--var`) defined in `space_dealer_window.css`.
2.  **Explicit Permission Required:** Creating a brand new style or color hex requires explicit team and user approval.
3.  **Mandatory Tokenization of New Styles:** The moment a new visual style, spacing rule, or color variant is approved, it **must** immediately be codified into a token within `space_dealer_window.css` to ensure future reuse across all windows.

### Approved Core Design Tokens
*   `--color-bg-base`: `#090d16` (Deep space base background)
*   `--color-panel`: `#0f172a` (Window and panel background surfaces)
*   `--color-border-subtle`: `#334155` (Inactive boundaries and dividers)
*   `--color-border-active`: `#38bdf8` (Active focus states and selected tabs)
*   `--color-accent`: `#0284c7` (Primary interactive elements)
*   `--color-text-main`: `#e2e8f0` (Primary readable text — **Mandatory for all critical stats, labels, and numbers**)
*   `--color-text-muted`: `#94a3b8` (Secondary flavor text only)

### Semantic & Feedback Tokens
*   **Credits / Positive Balance:** `#10b981` (Luminous Emerald Green)
*   **Reputation / Gold Metrics:** `#fbbf24` (Luminous Amber/Gold)
*   **Deficit / Danger / Errors:** `#ef4444` (High-contrast Danger Red)

## 3. Accessibility & High-Contrast Mandate
*   **No Low-Contrast Text:** Dark text on dark backgrounds is strictly forbidden. All readable text, numbers, symbols, and logs must use high-contrast foreground tokens (`--color-text-main`, `#ffffff`, `#10b981`, `#fbbf24`).
*   **Scanline Texture Rule:** CRT scanlines (`--scanline-pattern`) are baked exclusively into the background layers of panels, slots, and buttons. They must always render *behind* text and icons to ensure pixel-perfect legibility.
*   **Focus States:** All interactive buttons and tabs must feature a visible `:focus-visible` outline utilizing `--color-border-active`.

## 4. Window & Layout Hierarchy
*   **Draggable Windows:** Floating windows utilize `.retro-window` and can be dragged via their `.retro-window-header` handles.
*   **Z-Index Management:** Handled dynamically via the `WindowManager` class to ensure active windows always sit on top of inactive ones.
*   **Keyboard Accessibility:** Pressing `Escape` closes the active window; focus states support full `Tab` navigation.