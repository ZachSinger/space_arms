# Code Documentation Style

Short, repeatable comment blocks. Comments explain **what a thing is for and why**, never
restate the code. Each block or pattern documents exactly **one** thing.

## Budget

- Comments should stay well under the code: aim for **≤ 20%** of a file's lines.
- Don't document what the name and signature already say. `setPaused(paused)` needs nothing.
- No history or changelogs ("added after...", "used to..."). That belongs in `TODO.md`.

## 1. Module Top Block

First lines of every source file. Banner, then 1–4 lines on the module's job.

```js
// ==========================================
// FILE: Crate.js
// ==========================================
// A physical cargo crate holding ordered stock or one fixture. Can be carried, thrown,
// pushed, and locked to the loading pad.
// See also: CratePushing.js (player pushing), SupplyOrder.js (where crates come from).
```

- `See also:` is optional; use it only for close collaborators that aren't obvious from imports.

## 2. Class Top Block

JSDoc block directly above the class. One-line summary, then up to 2 lines of ownership or
lifecycle. No property lists.

```js
/**
 * One crate in the world: its contents, sprite, and physics body.
 * Created by deliveries and fixture crating; destroyed when emptied or unpacked.
 */
export class Crate {
```

- If the module holds only one class and the module block already says it all, skip this.

## 3. Function Pattern

Only document functions whose purpose, inputs, or side effects aren't obvious from the name.

**Has one or more parameters → JSDoc block.** Summary first. Every param gets a type; add a
description only when the name and type aren't enough. Add `@returns` only when the return
value isn't obvious.

```js
/**
 * Release a carried crate while walking: it starts at the player's speed, then pulls away.
 * @param {Phaser.GameObjects.Sprite} carrierSprite - the player throwing it
 * @param {number} velocityX - px/s
 * @param {number} velocityY - px/s
 */
startThrow(carrierSprite, velocityX, velocityY) {
```

```js
/**
 * @param {Map<string, number>} order - item id -> number of crates
 * @returns {{ total: number, problem: string | null, canPlace: boolean }}
 */
export function summarizeSupplyOrder(order, context) {
```

**No parameters → `//` line comment(s)** directly above.

```js
// True only when both velocity components are exactly zero.
isStationary() {
```

## 4. Inline Conventions

- **Why, not what.** Comment the reason, the gotcha, or the game rule behind a line.
- **Above the line**, not trailing. Exception: short trailing notes on a single value
  (`return null; // not in front of the mover`).
- **Units on tuning constants:** `px`, `ms`, `px/s`, `px/s²`, `credits`.
  ```js
  const THROW_ACCELERATION_MS = 160;
  // Peak throw speed as a multiple of the player's walking speed.
  const THROW_PEAK_MULTIPLIER = 2.5;
  ```
- **Related constants** share one comment above the group.
- **Section dividers** in long files (300+ lines) group related methods:
  ```js
  // --- Crate pickup and throwing ---
  ```
- **`TODO:`** only with a matching `TODO.md` entry.

## Scope

Applies to all source under `js/`, plus `main.js`, `preload.cjs`, and `SaveManager.js`.
Tests are excluded; their test names already describe intent.
