# Space Arms Dealer - Agent Instructions

## Communication Style

The project owner has severe ADHD and difficulty holding context across long responses. Follow these rules:
- Answer the literal question asked, directly and first. Don't bury the answer in surrounding explanation.
- Keep replies brief. One topic per response — don't combine multiple topics or go on tangents.
- Avoid long, detail-heavy explanations spanning several subjects at once. If more detail is genuinely needed, offer it rather than dumping it by default.
- Never answer indirectly or make the owner ask a follow-up just to get a plain yes/no/which-one answer.
- Explain work like a manager's briefing: state what is changing, why it matters to the game, and what the owner will notice. Assume the owner does not know the code or its current implementation; explain technical terms in plain language instead of relying on code-based examples.
- Mention build or tooling warnings only when they affect the game or require the owner's attention. If one must be mentioned, immediately explain what it means and whether the owner needs to act.
- Make suggested playtests concrete: say exactly what to do in the game and what should happen.
- Unless the user says otherwise, don't end at a dead end: continue unfinished requested work, or briefly suggest one concrete next step. If a decision is needed, ask one focused question instead.

## Project Overview

_Space Arms Dealer_ is a PC desktop shop-sim built for Steam: Electron shell, Phaser 3 + vanilla ES6 JavaScript, HTML5 Canvas, custom CSS. Diegetic retro-futuristic CRT terminal aesthetic driven by `styles/space_dealer_window.css`.

Design is specified in detail in `documentation/` — consult it before inventing new mechanics:
- `documentation/space_arms_dealer_bible.md`: core gameplay loops (shifts, factions, checkout, supplier contracts).
- `documentation/TagTaxonomy.md` / `documentation/Items.md`: tagging rules and item attributes.

## Architecture

- **Electron shell** (`main.js`, `preload.cjs`): native window/display-mode control and save-file I/O via `contextBridge`. `contextIsolation: true`, `nodeIntegration: false` — keep it that way.
- **Frontend** (served by Vite at `http://localhost:5173` in dev; the packaged app loads the built `dist/` through the `app://game/` protocol in `main.js`): Phaser 3 scenes (`js/scenes/`) own the canvas "world" simulation (shelves, customers, pathfinding). DOM windows (`js/logic/UIWindow.js`, `WindowManager.js`) own all heavy interactive UI (inventory, dialogue, settings, contracts). **These two layers are strictly decoupled** — don't render game-logic UI inside the Phaser canvas.
- **Data layer** (`data/*.json` + `js/logic/DatabaseManager.js`): static item/license/icon definitions. Never hardcode item prices, dimensions, or license tiers in JS — query them through `DatabaseManager`.
- **State** (`js/logic/PlayerState.js`): single source of truth for mutable runtime state (credits, reputation, licenses). All mutations go through its methods (`addCredits`, `addReputation`, etc.) — renderers must never mutate state directly.

## Build and Test

- `npm install` — install deps.
- `npm run dev` — Vite dev server (`localhost:5173`); open it directly in a browser for fast iteration without Electron.
- `npm start` — launches Electron pointed at `localhost:5173`; **requires `npm run dev` already running**.
- `npm run build` — Vite build into `dist/`; the `copy-runtime-assets` plugin in `vite.config.js` copies `data/` and only the `img/` files referenced by data JSON or bundled JS (fails if one is missing).
- `npm run package` — build plus electron-builder; produces `release\win-unpacked\Space Arms Dealer.exe`, which runs without the dev server. Needs the gitignored `img/Icons_Extracted/` art present locally. Saves stay in `%APPDATA%\space-arms-dealer` for both dev and packaged builds.
- Run regression tests with `node --test tests/*.test.js` (PowerShell: `node --test (Get-ChildItem tests -Filter '*.test.js').FullName`). No linter or formatter is configured.

## Conventions

- Only three MVP factions exist: **Scavengers**, **Mercenaries**, **Explorers**. No "Military" faction yet (it's a documented stretch goal).
- New UI surfaces must subclass/instantiate `UIWindow` and register with `WindowManager`; use existing CSS classes/variables in `space_dealer_window.css` (CRT scanlines, retro-window borders) rather than new styling patterns.
- Scanlines must always render **below** text/images in z-order, never on top.
- Body font is monospace (`"Courier New", monospace`) to match the CRT terminal look — don't remove/override this globally.
- Code comments follow `documentation/CodeDocumentation.md` (module/class/function blocks, inline rules, ≤ 20% comment budget).

## Current State Gotchas (read before touching related code)

- `SaveManager.js` is wired into the title/game scenes. Save only off-shift; Continue restores preparation state, not an active shift. `ShopSave.js` validates snapshots; fixture geometry must also pass `FixtureLayout.js` before restoration. Browser and Electron saves are separate.
- Placed fixtures live only in `scene.fixtures` (`js/logic/FixtureRegistry.js`) — look them up there (`get`, `shelves()`, `stockHolders()`, `register()`, `displayName()`); never keep separate references. Types are in `FIXTURE_TYPES` (`FixtureLayout.js`).
- The Manager's Tablet (`js/logic/ManagerTablet.js`) hosts Inventory, Contracts, Supply, Fixtures, and Layout content. Fixture purchases, licenses, fixture crates, placement, and empty-fixture crating use the fixture catalog and registry; rearrangement and crate-up are only available while closed. Employee, Finances, and Handbook (`js/logic/HandbookRenderer.js`) have real content; when a game rule changes, update the matching Handbook text.
- `StoreItem` (`js/logic/Items.js`) exposes the item's required Supplier License id as `license` (or `null`).
- `SaveManager` requires subsystems to implement `serialize()` and `applySave(data)`. Preserve existing listeners when applying restored player state.
