// ==========================================
// FILE: RobotLab.js
// ==========================================
// DEV "Robot Lab": a throwaway shop at the level Robot Service opens, with a charging station
// already placed and one ready-made robot set to work, so robots can be watched without building
// one. Nothing is saved.
import { ROBOT_SERVICE_LEVEL } from "../logic/RobotServiceCatalog.js";
import { TILE_SIZE, getBackroomInteriorBounds } from "../logic/RoomLayout.js";
import { ROBOT_CHARGER_TYPE } from "../systems/RobotServiceSystem.js";
import { sinkItems } from "../logic/InventoryTransfer.js";
import { database } from "../scenes/boot.js";

const LAB_MONEY = 20000;
const LAB_ROBOT = {
  name: "Stocky",
  frame: "worker_frame",
  cell: "basic_cell",
  boards: ["stock_1", "self_charge_1"],
};

function placeCharger(scene) {
  const bounds = getBackroomInteriorBounds();
  for (let gy = Math.ceil(bounds.top / TILE_SIZE); gy * TILE_SIZE < bounds.bottom; gy += 0.5) {
    for (let gx = Math.ceil(bounds.left / TILE_SIZE); gx * TILE_SIZE < bounds.right; gx += 0.5) {
      if (scene.fixtureSystem.checkPlacement(ROBOT_CHARGER_TYPE, gx, gy).valid) {
        return scene.fixtureSystem.placeFree(ROBOT_CHARGER_TYPE, gx, gy);
      }
    }
  }
  return false;
}

// Empties the fullest shelf spot that isn't empty yet, so a stocking robot has a spot to refill.
function emptyShelfSpot(scene) {
  const spots = scene.fixtures.shelves().flatMap((shelf) =>
    shelf.placements.filter((placement) => placement.quantity > 0).map((placement) => ({ shelf, placement })));
  const target = spots.sort((a, b) => b.placement.quantity - a.placement.quantity)[0];
  if (!target) return null;
  const { shelf, placement } = target;
  const result = sinkItems(shelf, placement.itemId, placement.quantity, {
    sinkId: "robot-lab-empty",
    sinkLocation: { kind: "robot-lab" },
    sourceEntry: placement,
    eventBus: scene.eventBus,
    sourceName: "shelf",
    sinkName: "robot lab",
  });
  if (!result.moved) throw new Error("Robot Lab could not empty the shelf spot.");
  scene.fixtureViews.refreshStockDisplay(shelf);
  scene.gameState.shop.changed();
  return placement.itemId;
}

// Puts one crate of each shelf item on the loading pad, the same way a real order arrives.
function deliverCrates(scene) {
  const items = [...new Set(scene.fixtures.shelves().flatMap((shelf) =>
    shelf.placements.map((placement) => placement.itemId)))];
  const free = scene.supply.freePadSpots().length;
  const order = new Map(items.slice(0, free).map((itemId) => [itemId, 1]));
  return order.size > 0 && scene.supply.placeOrder(order);
}

/**
 * @param {Phaser.Scene} scene - the game scene, started with { sandbox: true, lab: "robots" }
 * @returns {{ noteGaveUp: () => void, destroy: () => void }}
 */
export function setupRobotLab(scene) {
  const { gameState } = scene;
  gameState.batch(() => {
    gameState.reputation.setShopLevel(ROBOT_SERVICE_LEVEL);
    gameState.economy.add(LAB_MONEY, { category: "loans", label: "Robot Lab money" });
  });
  scene.debugTools.quickstart({ shelfCount: 2, itemCount: 8 });
  scene.catalogSystem.recalculateActiveFactions();
  if (!placeCharger(scene)) throw new Error("Robot Lab: no room for the robot charging station.");
  gameState.batch(() => {
    for (const partId of [LAB_ROBOT.frame, LAB_ROBOT.cell, ...LAB_ROBOT.boards]) {
      gameState.robotService.addPart(partId);
    }
  });
  const robot = scene.managerTablet.robotServiceSystem.assemble(LAB_ROBOT);
  if (!robot) throw new Error("Robot Lab: the ready-made robot could not be assembled.");
  emptyShelfSpot(scene);
  deliverCrates(scene);
  gameState.shop.changed();

  const panel = document.createElement("div");
  panel.className = "sandbox-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Robot Lab controls");
  panel.style.cssText = [
    "position:fixed", "right:12px", "top:84px", "z-index:50", "width:220px",
    "padding:10px", "background:rgba(15,23,42,0.92)", "border:1px solid #38bdf8",
    "color:#e2e8f0", "font:13px monospace", "display:flex", "flex-direction:column", "gap:6px",
    "pointer-events:auto",
  ].join(";");
  panel.innerHTML = `
    <strong style="color:#38bdf8">ROBOT LAB</strong>
    <span>${robot.name} is ready. It carries crates from the loading pad into the backroom, refills any shelf spot that is completely empty, and goes to its charging station when its battery runs low.</span>
    <span>One shelf spot starts empty and a delivery is waiting on the loading pad. Press Start shift below to watch. Nothing here is saved.</span>
    <button type="button" class="hud-pause-btn" data-start-shift>Start shift</button>
    <button type="button" class="hud-pause-btn" data-empty-spot>Empty a shelf spot</button>
    <button type="button" class="hud-pause-btn" data-deliver>Deliver crates to the pad</button>
  `;
  document.getElementById("ui-layer").appendChild(panel);

  const onClick = (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    // Hand the keyboard back to the game so the player can still move.
    button.blur();
    if (button.hasAttribute("data-start-shift")) {
      if (scene.shift.running) scene.messages.show("The shift has already started.");
      else scene.shift.start();
    } else if (button.hasAttribute("data-empty-spot")) {
      const itemId = emptyShelfSpot(scene);
      if (!itemId) scene.messages.show("Every shelf spot is already empty.");
      else scene.messages.show(`Emptied the ${database.getItem(itemId)?.name ?? itemId} shelf spot.`);
    } else if (button.hasAttribute("data-deliver") && !deliverCrates(scene)) {
      scene.messages.show("The loading pad is full.");
    }
  };
  panel.addEventListener("click", onClick);

  return {
    noteGaveUp() {},
    destroy() {
      panel.removeEventListener("click", onClick);
      panel.remove();
    },
  };
}
