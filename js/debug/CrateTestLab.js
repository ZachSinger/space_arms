// ==========================================
// FILE: CrateTestLab.js
// ==========================================
// DEV "Crate Test Lab": the real shop with a few dozen item crates, single and stacked, on the sales
// floor and in the backroom, for trying out picking up, carrying, stacking, and stocking, plus a
// shelf maze for testing how three linked hovercarts follow the player around fixtures.
// Nothing is saved. The panel can refill the floor or clear it.
import { database } from "../scenes/boot.js";
import { AREA } from "../world/Areas.js";
import { FLOOR_STACK_MAX } from "../logic/CrateStack.js";
import { TILE_SIZE } from "../logic/RoomLayout.js";
import { validateFixtureLayout } from "../logic/FixtureLayout.js";
import { getCrateOrderQuantity } from "../logic/SupplyOrder.js";
import { sourceItems } from "../logic/InventoryTransfer.js";
import { unlockEverything } from "./SandboxRoom.js";
import { controlLabel } from "../input/InputDevice.js";
import { HOVERCART_CHARGER_TYPE, getLegacyChargerSpot } from "../modules/hovercart/HovercartRules.js";
import { Hovercart } from "../modules/hovercart/Hovercart.js";

const STEP_X = 56;
const STEP_Y = 52;
// Empty floor kept around every stack so there is always a way to walk between them.
const CLEARANCE = 10;
// Doors and the player's spot stay clear by this much.
const KEEP_CLEAR = TILE_SIZE * 1.5;
// Stack heights cycle through this pattern so every height from 1 to the max shows up.
const HEIGHTS = [1, 3, 2, 3, 1, 2];
// Enough crates to fill all three carts, even when chargers limit backroom space.
const STACKS_PER_AREA = 10;

// Shelf maze on the lower sales floor for testing how the hovercart gets around fixtures.
// A long shelf wall closes off the top. Below it, walls of sideways shelves (solid almost
// top to bottom, unlike upright shelves people walk behind) alternately hang from that wall
// and stand on the room's bottom wall, so walkers have to weave up and down between them.
// [type, tile x, tile y, rotations to try].
const MAZE_LONG = "shelf_budget_3x4";
const MAZE_MID = "shelf_budget_3x3";
const MAZE_TOP_ROW_Y = 6;
const MAZE_BOTTOM_Y = 12;
const MAZE_PLAN = [
  ...Array.from({ length: 15 }, (_, i) => [MAZE_LONG, 1 + i * 2, MAZE_TOP_ROW_Y, [2]]),
  ...[5, 11, 17, 23].flatMap((gx) => [
    [MAZE_LONG, gx, MAZE_TOP_ROW_Y + 1, [1, 3]],
    [MAZE_MID, gx, MAZE_TOP_ROW_Y + 3, [1, 3]],
  ]),
  ...[8, 14, 20, 26].flatMap((gx) => [
    [MAZE_LONG, gx, MAZE_BOTTOM_Y - 2, [1, 3]],
    [MAZE_MID, gx, MAZE_BOTTOM_Y - 3.625, [1, 3]],
  ]),
];
// Small nudges tried when a planned spot breaks a placement rule.
const MAZE_NUDGES = [[0, 0], [0, 0.125], [0, -0.125], [0.125, 0], [-0.125, 0], [0, 0.25], [0, -0.25]];

/** Places the shelf maze, skipping any shelf the shop's placement rules won't allow. */
function buildShelfMaze(scene) {
  const { fixtureSystem, fixtures } = scene;
  for (const [type, gx, gy, rotations] of MAZE_PLAN) {
    const spot = rotations
      .flatMap((rotation) => MAZE_NUDGES.map(([dx, dy]) => [gx + dx, gy + dy, rotation]))
      .find(([x, y, rotation]) => fixtureSystem.checkPlacement(type, x, y, rotation).valid);
    if (!spot) continue;
    const [x, y, rotation] = spot;
    fixtureSystem.spawn({ id: fixtures.nextId(type), type, gx: x, gy: y, rotation });
    const layout = fixtures.layout();
    fixtureSystem.applyLayout(layout, validateFixtureLayout(layout, fixtureSystem.layoutOptions()));
  }
  scene.gameState.shop.changed();
}

/** Items with art, spread across categories so crates come in every tint. */
function labItems() {
  const byTag = new Map();
  for (const item of database.getAllItems()) {
    const key = item.tags?.[0] ?? "other";
    if (!byTag.has(key)) byTag.set(key, []);
    byTag.get(key).push(item);
  }
  const lists = [...byTag.values()];
  const mixed = [];
  for (let index = 0; mixed.length < 24 && lists.some((list) => list[index]); index += 1) {
    for (const list of lists) if (list[index]) mixed.push(list[index]);
  }
  return mixed.slice(0, 24);
}

function keepClearSpots(scene, carts) {
  return [
    scene.storeDoor,
    scene.player.sprite,
    ...carts.map((cart) => cart.dock),
    ...scene.areas.portals.map((portal) => portal.front),
  ].filter(Boolean).map(({ x, y }) => ({ x, y }));
}

/**
 * @param {Phaser.Scene} scene - the game scene, started with { sandbox: true, lab: "crates" }
 * @returns {{ noteGaveUp: () => void, destroy: () => void }}
 */
export function setupCrateTestLab(scene) {
  const { gameState, crateSystem } = scene;
  unlockEverything(scene);
  buildShelfMaze(scene);
  const hovercartSystem = scene.gameModules.get("hovercart");
  const charger = getLegacyChargerSpot();
  if (!hovercartSystem.chargers().length &&
    scene.fixtureSystem.checkPlacement(HOVERCART_CHARGER_TYPE, charger.gx, charger.gy).valid) {
    scene.fixtureSystem.placeFree(HOVERCART_CHARGER_TYPE, charger.gx, charger.gy);
  }
  const hovercart = hovercartSystem.sync();
  if (!hovercart) throw new Error("Crate lab: no room for the hovercart charger.");
  const carts = [hovercart];
  for (const offsetY of [0, 2]) {
    const gx = charger.gx + 2;
    const gy = charger.gy + offsetY;
    if (!scene.fixtureSystem.placeFree(HOVERCART_CHARGER_TYPE, gx, gy)) {
      throw new Error("Crate lab: no room for all three hovercart chargers.");
    }
    const fixture = hovercartSystem.chargers().find((entry) => entry.gx === gx && entry.gy === gy);
    if (!fixture) throw new Error("Crate lab: missing hovercart charger.");
    carts.push(new Hovercart(scene, fixture, { secondary: true }));
  }
  hovercartSystem.upgrades = { speed: 3, length: 3, battery: 6 };
  for (const cart of carts) {
    cart.setUpgrades(hovercartSystem.upgrades);
    cart.battery = cart.batteryCapacity;
    cart.infiniteBattery = true;
  }
  const cartColliders = [];
  for (let i = 0; i < carts.length; i += 1) {
    for (let j = i + 1; j < carts.length; j += 1) {
      cartColliders.push(scene.physics.add.collider(carts[i].cart, carts[j].cart));
    }
  }
  const links = scene.add.graphics();
  const updateCarts = (time, delta) => {
    const active = carts.filter((cart) => cart.active);
    for (let index = 0; index < carts.length; index += 1) {
      const cart = carts[index];
      const position = active.indexOf(cart);
      const target = position > 0 ? active[position - 1].cart : null;
      if (cart.followTarget !== target) {
        cart.followTarget = target;
        cart.trail = [];
        cart.trailArea = null;
        cart.trailTarget = null;
        cart.path = null;
      }
      if (cart.secondary) cart.update(time, delta);
    }
    const player = scene.player.sprite;
    const available = carts.filter((cart) => cart.isOut());
    scene.hovercart = available.sort((a, b) =>
      Phaser.Math.Distance.Between(player.x, player.y, a.cart.x, a.cart.y) -
      Phaser.Math.Distance.Between(player.x, player.y, b.cart.x, b.cart.y))[0] ?? hovercart;
    links.clear().lineStyle(2, 0x7dd3fc, 0.8);
    for (let index = 1; index < active.length; index += 1) {
      const first = active[index - 1].cart;
      const second = active[index].cart;
      if (scene.areas.areaAt(first.x, first.y) !== scene.areas.areaAt(second.x, second.y)) continue;
      links.lineBetween(first.x, first.y, second.x, second.y);
    }
    links.setDepth(active.length ? Math.min(...active.map((cart) => cart.cart.depth)) - 0.02 : 0);
  };
  scene.events.on("update", updateCarts);
  // Temporary while testing the cart in the maze.
  scene.player.infiniteStamina = true;
  const items = labItems();
  for (const item of items) gameState.catalog.priceIfUnset(item.id, gameState.market.getPrice(item.id));

  const makeCrate = (item, x, y) => {
    const crate = crateSystem.createItemCrate(item.id, 0, x, y, { id: crateSystem.createId() });
    const quantity = getCrateOrderQuantity(item);
    sourceItems(crate, item.id, quantity, {
      sourceId: `crate-lab-${crate.id}`,
      sourceLocation: { kind: "crate-lab" },
      eventBus: scene.eventBus,
      sourceName: "crate lab",
      destinationName: "crate",
    });
    return crate;
  };

  const clear = () => {
    for (const cart of carts) cart.clearCrates();
    for (const crate of crateSystem.getFloorCrates()) crate.destroy();
    crateSystem.restockCrates.length = 0;
    crateSystem.floorStacks.clear();
    crateSystem.markedStackBase = null;
    gameState.crates.changed();
  };

  const fill = () => gameState.batch(fillNow);
  const fillNow = () => {
    clear();
    const avoid = keepClearSpots(scene, carts);
    let placed = 0;
    let stacks = 0;
    for (const areaId of [AREA.SHOP, AREA.BACKROOM]) {
      const bounds = scene.areas.boundsFor(areaId);
      const areaStart = stacks;
      for (let y = bounds.y + STEP_Y; y < bounds.y + bounds.height - STEP_Y / 2; y += STEP_Y) {
        for (let x = bounds.x + STEP_X / 2; x < bounds.x + bounds.width - STEP_X / 2; x += STEP_X) {
          if (stacks - areaStart >= STACKS_PER_AREA) break;
          if (avoid.some((spot) => Math.hypot(spot.x - x, spot.y - y) < KEEP_CLEAR)) continue;
          const item = items[(placed + stacks) % items.length];
          const base = makeCrate(item, x, y);
          base.sprite.body.enable = false; // not its own obstacle while checking the spot
          const fits = base.isDropPositionClear(x, y, scene.player.sprite, CLEARANCE);
          base.sprite.body.enable = true;
          if (!fits) {
            base.destroy();
            continue;
          }
          base.drop(x, y, 0, 0, crateSystem.motionPaused);
          crateSystem.restockCrates.push(base);
          const height = Math.min(HEIGHTS[stacks % HEIGHTS.length], FLOOR_STACK_MAX);
          const above = [];
          for (let level = 1; level < height; level += 1) {
            const crate = makeCrate(items[(placed + stacks + level) % items.length], x, y);
            crate.pickUp(base.sprite, { stackedOnId: base.id });
            above.push(crate);
          }
          if (above.length) crateSystem.floorStacks.set(base, above);
          placed += height;
          stacks += 1;
        }
      }
    }
    crateSystem.syncFloorStacks();
    gameState.crates.changed();
    gameState.shop.changed();
    render(placed);
  };

  const panel = document.createElement("div");
  panel.className = "sandbox-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Crate Test Lab controls");
  panel.style.cssText = [
    "position:fixed", "right:12px", "top:84px", "z-index:50", "width:240px",
    "padding:10px", "background:rgba(15,23,42,0.92)", "border:1px solid #38bdf8",
    "color:#e2e8f0", "font:13px monospace", "display:flex", "flex-direction:column", "gap:6px",
    "pointer-events:auto",
  ].join(";");
  panel.innerHTML = `
    <strong style="color:#38bdf8">CRATE TEST LAB</strong>
    <span>Nothing here is saved.</span>
    <span>Three fully upgraded hovercarts start in the backroom. Turn them on at their chargers or use Launch carts below. They link together and follow you.</span>
    <span>The shelves on the lower sales floor form a maze for testing the linked carts.</span>
    <span>Stand next to a cart, hold ${controlLabel("dash", "keyboard")} (L1 on a controller), and press ${controlLabel("putDown", "keyboard")} to put a crate on it or ${controlLabel("crate", "keyboard")} to take one off. Each holds 6 crates. You use the nearest cart.</span>
    <span>Battery and stamina are unlimited here.</span>
    <span data-count role="status" aria-live="polite"></span>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button type="button" class="hud-pause-btn" data-refill>Refill crates</button>
      <button type="button" class="hud-pause-btn" data-clear>Clear crates</button>
      <button type="button" class="hud-pause-btn" data-launch>Launch carts</button>
    </div>
  `;
  document.getElementById("ui-layer").appendChild(panel);
  const countEl = panel.querySelector("[data-count]");
  function render(count) {
    countEl.textContent = `${count} crates on the floor`;
  }

  const onClick = (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-refill")) fill();
    else if (button.hasAttribute("data-launch")) {
      for (const cart of carts) if (!cart.isOut()) cart.toggleAtStation();
    }
    else if (button.hasAttribute("data-clear")) {
      clear();
      render(0);
    }
    if (event.detail > 0) button.blur();
  };
  panel.addEventListener("click", onClick);

  fill();
  return {
    carts,
    noteGaveUp() {},
    destroy() {
      panel.removeEventListener("click", onClick);
      panel.remove();
      scene.events.off("update", updateCarts);
      links.destroy();
      for (const collider of cartColliders) collider.destroy();
      for (const cart of carts.slice(1)) cart.destroy();
      hovercartSystem.uninstall();
      if (carts.includes(scene.hovercart)) scene.hovercart = null;
      scene.player.infiniteStamina = false;
    },
  };
}
