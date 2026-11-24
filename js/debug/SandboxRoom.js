// ==========================================
// FILE: SandboxRoom.js
// ==========================================
// DEV "Shelf Test Room": a throwaway shop for testing shelf layouts and customer walking.
// Everything is unlocked, money is plentiful, nothing is ever saved, and a small panel can
// send customers, fill every shelf, and count anyone who gives up on reaching somewhere.
import { database } from "../scenes/boot.js";
import { EXPANSION_ORDER, BACKROOM_GRID_Y } from "../logic/RoomLayout.js";
import { FIXTURE_SNAP_STEP, FIXTURE_TYPES, validateFixtureLayout } from "../logic/FixtureLayout.js";
import { SHOP_LEVEL_TIERS } from "../logic/ShopProgression.js";
import { sourceItems } from "../logic/InventoryTransfer.js";

const SANDBOX_CREDITS = 1000000;
const SEND_GAP_MS = 700;
// Front-of-line customers are served this long after reaching the counter.
const AUTO_CHECKOUT_DELAY_MS = 600;
const RECENT_TROUBLE_SHOWN = 5;

/**
 * Stands one of every shelf type along the top wall, left to right, each pushed as far up
 * as the placement rules allow, so wall gaps can be compared at a glance.
 * @param {Phaser.Scene} scene
 */
function placeOneOfEachShelf(scene) {
  const salesZones = scene.room.zones.filter((zone) => !zone.locked && zone.gridY < BACKROOM_GRID_Y);
  const roomLeft = Math.min(...salesZones.map((zone) => zone.gridX));
  const roomRight = Math.max(...salesZones.map((zone) => zone.gridX + zone.gridW));
  const roomTop = Math.min(...salesZones.map((zone) => zone.gridY));
  let cursor = roomLeft;
  for (const [typeId, type] of Object.entries(FIXTURE_TYPES)) {
    if (type.kind !== "shelf") continue;
    let best = null;
    for (let gx = cursor; gx + type.w <= roomRight; gx += 1) {
      for (let gy = roomTop - 1; gy < roomTop + 2; gy += FIXTURE_SNAP_STEP) {
        if (!scene.fixtureSystem.checkPlacement(typeId, gx, gy, 0).valid) continue;
        if (!best || gy < best.gy) best = { gx, gy };
        break;
      }
    }
    if (!best) continue;
    const entry = { id: scene.fixtures.nextId(typeId), type: typeId, gx: best.gx, gy: best.gy, rotation: 0 };
    scene.fixtureSystem.spawn(entry);
    const layout = scene.fixtures.layout();
    scene.fixtureSystem.applyLayout(layout, validateFixtureLayout(layout, scene.fixtureSystem.layoutOptions()));
    cursor = best.gx + type.w + 1;
  }
}

/**
 * DEV test areas start with the top store level, a million credits, every contract signed,
 * and every floor expansion open.
 * @param {Phaser.Scene} scene
 */
export function unlockEverything(scene) {
  const { gameState } = scene;
  gameState.batch(() => {
    gameState.reputation.setShopLevel(SHOP_LEVEL_TIERS[SHOP_LEVEL_TIERS.length - 1].level);
    gameState.economy.add(SANDBOX_CREDITS, { category: "loans", label: "Test room money" });
    for (const license of database.getAllLicenses()) gameState.catalog.sign(license.id);
    scene.catalogSystem.recalculateActiveFactions();
    for (const zoneId of EXPANSION_ORDER) {
      if (scene.room.zones.find((zone) => zone.id === zoneId)?.locked) scene.fixtureSystem.openZone(zoneId);
    }
  });
  scene.cameraRig.refresh();
}

/**
 * @param {Phaser.Scene} scene - the game scene, started with { sandbox: true }
 * @returns {{ noteGaveUp: (customer: object, reason: string) => void, destroy: () => void }}
 */
export function setupSandboxRoom(scene) {
  const { gameState } = scene;
  unlockEverything(scene);
  placeOneOfEachShelf(scene);
  gameState.shop.changed();

  let sent = 0;
  let waitingOutside = 0;
  let sinceLastSendMs = SEND_GAP_MS;
  let gaveUp = 0;
  const trouble = [];

  const panel = document.createElement("div");
  panel.className = "sandbox-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Shelf Test Room controls");
  panel.style.cssText = [
    "position:fixed", "right:12px", "top:84px", "z-index:50", "width:260px",
    "padding:10px", "background:rgba(15,23,42,0.92)", "border:1px solid #38bdf8",
    "color:#e2e8f0", "font:13px monospace", "display:flex", "flex-direction:column", "gap:6px",
    "pointer-events:auto",
  ].join(";");
  panel.innerHTML = `
    <strong style="color:#38bdf8">SHELF TEST ROOM</strong>
    <span>Nothing here is saved.</span>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button type="button" class="hud-pause-btn" data-send="1">Send 1 customer</button>
      <button type="button" class="hud-pause-btn" data-send="10">Send 10 customers</button>
      <button type="button" class="hud-pause-btn" data-fill>Fill every shelf</button>
    </div>
    <span data-status role="status" aria-live="polite"></span>
    <ol data-trouble style="margin:0;padding-left:18px;color:#fca5a5"></ol>
  `;
  document.getElementById("ui-layer").appendChild(panel);
  const statusEl = panel.querySelector("[data-status]");
  const troubleEl = panel.querySelector("[data-trouble]");

  const render = () => {
    statusEl.textContent = `Sent: ${sent} · Waiting outside: ${waitingOutside} · ` +
      `In the shop: ${scene.customers.length} · Gave up: ${gaveUp}`;
    troubleEl.replaceChildren(...trouble.map((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      return item;
    }));
  };

  // Customers wait outside until the shop has room, then walk in a little apart.
  const letNextIn = (delta) => {
    sinceLastSendMs += delta;
    if (waitingOutside === 0 || sinceLastSendMs < SEND_GAP_MS || !scene.customerFlow.hasRoom()) return;
    const before = scene.customers.length;
    scene.customerFlow.spawn(null);
    if (scene.customers.length === before) return;
    sent += 1;
    waitingOutside -= 1;
    sinceLastSendMs = 0;
  };

  const fillShelves = () => {
    const items = database.getAllItems();
    for (const shelf of scene.fixtures.shelves()) {
      for (const placement of shelf.placements) {
        const quantity = shelf.getPlacementCapacity(placement) - placement.quantity;
        if (quantity <= 0) continue;
        const result = sourceItems(shelf, placement.itemId, quantity, {
          sourceId: `sandbox-stock-${placement.id}`,
          sourceLocation: { kind: "sandbox-stock", slotId: placement.id },
          destinationEntry: placement,
          eventBus: scene.eventBus,
          sourceName: "sandbox",
          destinationName: "shelf",
        });
        if (result.moved !== quantity) {
          throw new Error(`Sandbox could not fill shelf slot ${placement.id}.`);
        }
      }
      for (let gy = 0; gy < shelf.displayGrid.h; gy += 1) {
        for (let gx = 0; gx < shelf.displayGrid.w; gx += 1) {
          if (!shelf.canPlaceAt(gx, gy, 1, 1)) continue;
          const start = Math.floor(Math.random() * items.length);
          for (let offset = 0; offset < items.length; offset += 1) {
            const item = items[(start + offset) % items.length];
            const placement = shelf.placeItem(item.id, gx, gy, false, 0);
            if (!placement) continue;
            const quantity = shelf.getPlacementCapacity(placement);
            const result = sourceItems(shelf, item.id, quantity, {
              sourceId: `sandbox-stock-${placement.id}`,
              sourceLocation: { kind: "sandbox-stock", slotId: placement.id },
              destinationEntry: placement,
              eventBus: scene.eventBus,
              sourceName: "sandbox",
              destinationName: "shelf",
            });
            if (result.moved !== quantity) {
              throw new Error(`Sandbox could not fill shelf slot ${placement.id}.`);
            }
            gameState.catalog.priceIfUnset(item.id, gameState.market.getPrice(item.id));
            break;
          }
        }
      }
      scene.fixtureViews.refreshStockDisplay(shelf);
    }
    gameState.shop.changed();
    scene.messages.show("Test room: every shelf is full.");
  };

  const onClick = (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.send) {
      waitingOutside += Number(button.dataset.send);
      render();
    } else if (button.hasAttribute("data-fill")) fillShelves();
  };
  panel.addEventListener("click", onClick);

  // The cashier is automatic here, so a test never stalls waiting at a register.
  const frontWaits = new Map(); // register id -> ms its front customer has stood ready
  const checkoutTimer = scene.time.addEvent({
    delay: 100,
    loop: true,
    callback: () => {
      letNextIn(100);
      for (const register of scene.fixtures.registers()) {
        const front = scene.checkoutSystem.lineFor(register)[0];
        const spot = front?.queueTarget;
        const feet = front?.sprite.body?.center ?? front?.sprite;
        const waiting = front && front.state === "QUEUEING" && spot &&
          Math.hypot(feet.x - spot.x, feet.y - spot.y) < 8;
        const waitMs = waiting ? (frontWaits.get(register.id) ?? 0) + 100 : 0;
        frontWaits.set(register.id, waitMs);
        if (waitMs >= AUTO_CHECKOUT_DELAY_MS) {
          frontWaits.set(register.id, 0);
          scene.checkoutSystem.completeSandboxCheckout(front);
        }
      }
      render();
    },
  });

  render();
  return {
    noteGaveUp(customer, reason) {
      gaveUp += 1;
      const where = {
        SEEK_SHELF: "heading to a shelf",
        SEEK_REGISTER: "heading to the register",
        QUEUEING: "in the register line",
        LEAVING: "heading out the door",
      }[customer.state] ?? "walking";
      const { x, y } = customer.sprite.body?.center ?? customer.sprite;
      trouble.unshift(`${where}, ${reason} (at ${Math.round(x)}, ${Math.round(y)})`);
      trouble.length = Math.min(trouble.length, RECENT_TROUBLE_SHOWN);
      render();
    },
    destroy() {
      checkoutTimer.remove();
      panel.removeEventListener("click", onClick);
      panel.remove();
    },
  };
}
