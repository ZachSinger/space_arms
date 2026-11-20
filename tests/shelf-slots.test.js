import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { transferItems } from "../js/logic/InventoryTransfer.js";
import { Crate } from "../js/logic/Crate.js";
import { moveShelfCrateItem } from "../js/logic/LiveShelfStocking.js";
import { getShelfBoxes } from "../js/logic/ShelfBoxLayout.js";
import { getBudgetShelfArt } from "../js/logic/BudgetShelfArt.js";

let server;
let cacheDirectory;
let InventoryPool;
let ShelfFixture;
let ShelfStockingWindow;
let nextTestCrateId = 1;

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-shelf-slots-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "shelf-slots-test-stubs",
      enforce: "pre",
      resolveId(source) {
        if (source === "../scenes/boot.js") return "\0shelf-slots-test-database";
      },
      load(id) {
        if (id === "\0shelf-slots-test-database") {
          return `export const database = { getItem: (id) => ({ id, name: id, image: "item.png", tags: ["Firearm"], dimensions: { w: id === "wpn_hvy_01" ? 4 : 1, h: 1 }, boxSize: id === "wpn_hvy_01" ? 20 : 1, slots: 1, stackSize: id === "paste" ? 15 : 4 }) };`;
        }
      },
    }],
  });
  ({ InventoryPool } = await server.ssrLoadModule("/js/logic/InventoryPool.js"));
  ({ ShelfFixture } = await server.ssrLoadModule("/js/logic/ShelfFixture.js"));
  ({ ShelfStockingWindow } = await server.ssrLoadModule("/js/logic/ShelfStockingWindow.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

test("sold-out shelf slots keep their spot until deliberately removed while empty", () => {
  const shelf = new ShelfFixture({ displayGrid: { w: 2, h: 1 }, stackDepth: 4 });
  const slot = shelf.placeItem("amo_01", 0, 0);
  shelf.add("amo_01", 1);

  assert.equal(shelf.takeItem(slot), "amo_01");
  assert.equal(shelf.remove("amo_01", 5), 1);
  assert.equal(slot.quantity, 0);
  assert.deepEqual(shelf.placements, [slot]);
  assert.equal(shelf.findAvailableSlot(), null);
  assert.equal(shelf.canPlaceAt(0, 0, 1, 1), false);

  assert.equal(shelf.add("amo_01", 2), 2); // restocking refills the same slot
  assert.equal(shelf.removeEmptyPlacement(slot), false);
  shelf.remove("amo_01", 2);
  assert.equal(shelf.removeEmptyPlacement(slot), true);
  assert.deepEqual(shelf.placements, []);
});

test("shelf slot IDs survive moving and saving, and new slots get unused IDs", () => {
  const shelf = new ShelfFixture({
    id: "shelf-stable",
    displayGrid: { w: 2, h: 1 },
    stackDepth: 4,
  });
  const slot = shelf.placeItem("amo_01", 0, 0);
  const slotId = slot.id;
  shelf.detachPlacement(slot);
  assert.equal(shelf.attachPlacement(slot, 1, 0, false), true);

  const restored = new ShelfFixture({
    id: shelf.id,
    displayGrid: shelf.displayGrid,
    stackDepth: shelf.stackDepth,
    placements: shelf.placements,
    nextPlacementId: shelf.nextPlacementId,
  });
  assert.equal(restored.placements[0].id, slotId);
  assert.notEqual(restored.placeItem("amo_01", 0, 0).id, slotId);

  const legacy = new ShelfFixture({
    id: "shelf-legacy",
    displayGrid: { w: 2, h: 1 },
    stackDepth: 4,
    placements: [{ itemId: "amo_01", gx: 0, gy: 0, w: 1, h: 1, rotated: false, quantity: 0 }],
  });
  assert.equal(legacy.placements[0].id, "shelf-slot:shelf-legacy:1");
  assert.equal(legacy.placeItem("amo_01", 1, 0).id, "shelf-slot:shelf-legacy:2");
});

function itemCrate(itemId, quantity) {
  return Object.assign(Object.create(Crate.prototype), {
    id: `test-crate-${nextTestCrateId++}`,
    kind: "item",
    itemId,
    quantity,
  });
}

test("live stocking uses twenty units per space and selects the highest matching crate", () => {
  const shelf = new ShelfFixture({ displayGrid: { w: 2, h: 2 }, stackDepth: 10, handsOn: true });
  const ammo = itemCrate("amo_01", 20);
  const heavy = itemCrate("wpn_hvy_01", 2);
  const crates = [ammo, heavy];
  assert.equal(moveShelfCrateItem(shelf, crates, 0, 0, false).moved, 1);
  const placement = shelf.placements[0];
  assert.deepEqual([placement.w, placement.h, placement.quantity], [1, 1, 1]);
  assert.equal(shelf.getPlacementCapacity(placement), 1);
  assert.equal(moveShelfCrateItem(shelf, crates, 0, 0, false).moved, 0);
  assert.equal(heavy.quantity, 1);

  assert.equal(moveShelfCrateItem(shelf, [ammo], 1, 0, false).moved, 1);
  for (let index = 1; index < 20; index++) {
    assert.equal(moveShelfCrateItem(shelf, crates, 1, 0, false).moved, 1);
  }
  assert.equal(ammo.quantity, 0);
  assert.equal(ammo.itemId, null);
  assert.equal(shelf.placements[1].quantity, 20);
  assert.equal(moveShelfCrateItem(shelf, crates, 1, 0, false).moved, 0);
});

test("pulling uses empty or matching crates and shares live quantities with customers", () => {
  const shelf = new ShelfFixture({ displayGrid: { w: 2, h: 2 }, stackDepth: 10, handsOn: true });
  const placement = shelf.placeItem("amo_01", 0, 0, false, 3);
  const empty = itemCrate(null, 0);
  const wrong = itemCrate("wpn_hvy_01", 1);
  assert.equal(moveShelfCrateItem(shelf, [empty, wrong], 0, 0, true).moved, 1);
  assert.equal(empty.itemId, "amo_01");
  assert.equal(empty.quantity, 1);
  assert.equal(wrong.quantity, 1);
  assert.equal(shelf.takeItem(placement), "amo_01");
  assert.equal(moveShelfCrateItem(shelf, [empty, wrong], 0, 0, true).moved, 1);
  assert.equal(moveShelfCrateItem(shelf, [empty, wrong], 0, 0, true).moved, 0);
  assert.equal(empty.quantity, 2);
  assert.equal(placement.quantity, 0);
  // A sold-out space only takes its own item until it's cleared.
  const refused = moveShelfCrateItem(shelf, [wrong], 0, 0, false);
  assert.deepEqual([refused.moved, refused.reservedFor], [0, "amo_01"]);
  assert.equal(shelf.placements[0], placement);
  assert.equal(moveShelfCrateItem(shelf, [wrong, empty], 0, 0, false).moved, 1);
  assert.equal(placement.quantity, 1);
  shelf.takeItem(placement);
  assert.equal(shelf.removeEmptyPlacement(placement), true);
  assert.equal(moveShelfCrateItem(shelf, [wrong], 0, 0, false).moved, 1);
  assert.equal(shelf.placements[0].itemId, "wpn_hvy_01");
});

test("Q in the shelf window picks which carried crate stocks an empty space next", () => {
  const shelf = new ShelfFixture({ displayGrid: { w: 3, h: 2 }, stackDepth: 10, handsOn: true });
  shelf.placeItem("amo_03", 1, 0, false, 1);
  const bottom = itemCrate("amo_01", 3);
  const empty = itemCrate(null, 0);
  const top = itemCrate("amo_03", 3);
  const crates = [bottom, empty, top];
  const view = Object.assign(Object.create(ShelfStockingWindow.prototype), {
    uiWindow: { isOpen: true },
    scene: { crateSystem: { getStockableCrates: () => crates } },
    refresh() {},
  });
  assert.equal(view.getStockingCrate(), top);
  view.chooseNextCrate();
  assert.equal(view.getStockingCrate(), bottom, "skips the empty crate");
  // The chosen crate fills an empty space even though another crate is higher.
  assert.equal(moveShelfCrateItem(shelf, crates, 0, 0, false, null, view.getStockingCrate()).moved, 1);
  assert.equal(shelf.placements.find((entry) => entry.gx === 0).itemId, "amo_01");
  // A space holding another item still takes the crate that matches it.
  assert.equal(moveShelfCrateItem(shelf, crates, 1, 0, false, null, bottom).moved, 1);
  assert.equal(top.quantity, 2);
  view.chooseNextCrate();
  assert.equal(view.getStockingCrate(), top, "wraps back to the top");
  view.chooseNextCrate();
  bottom.quantity = 0;
  assert.equal(view.getStockingCrate(), top, "falls back to the top when the chosen crate runs out");
});

test("the shelf window marks every space matching carried items and updates as crates change", () => {
  const shelf = new ShelfFixture({ displayGrid: { w: 3, h: 2 }, stackDepth: 10, handsOn: true });
  shelf.placeItem("amo_01", 0, 0, false, 20);
  shelf.placeItem("wpn_pis_05", 1, 0, false, 0);
  shelf.placeItem("amo_03", 2, 0, false, 2);
  shelf.placeItem("amo_01", 0, 1, false, 0);
  const ammoCrate = itemCrate("amo_01", 2);
  const otherCrate = itemCrate("wpn_pis_05", 1);
  const crates = [ammoCrate, otherCrate];
  const cells = Array.from({ length: 6 }, () => {
    const classes = new Set();
    return {
      dataset: {},
      classList: {
        toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
      replaceChildren() {},
      setAttribute() {},
      appendChild() {},
    };
  });
  const view = Object.assign(Object.create(ShelfStockingWindow.prototype), {
    uiWindow: { isOpen: true },
    scene: { crateSystem: { getStockableCrates: () => crates } },
    fixture: shelf,
    art: getBudgetShelfArt(2, 3),
    selected: null,
    cells,
    status: {},
    stickers: [],
  });
  const marked = () => cells.map((cell) => cell.classList.contains("matches-stockable"));
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ style: {} }) };
  try {
    view.refresh();
    assert.deepEqual(marked(), [true, true, false, true, false, false]);

    assert.equal(moveShelfCrateItem(shelf, [otherCrate], 1, 0, false).moved, 1);
    view.refresh();
    assert.deepEqual(marked(), [true, false, false, true, false, false]);

    assert.equal(moveShelfCrateItem(shelf, [otherCrate], 2, 0, true).moved, 1);
    view.refresh();
    assert.deepEqual(marked(), [true, false, true, true, false, false]);

    crates.splice(0, crates.length, itemCrate("amo_01", 0));
    view.refresh();
    assert.deepEqual(marked(), [false, false, false, false, false, false]);

    crates.length = 0;
    view.refresh();
    assert.deepEqual(marked(), [false, false, false, false, false, false]);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("shelf price stickers show each stocked space's price, turn sold out, and hide on empty spaces", () => {
  const shelf = new ShelfFixture({ displayGrid: { w: 3, h: 2 }, stackDepth: 10, handsOn: true });
  shelf.placeItem("amo_01", 0, 0, false, 5);
  shelf.placeItem("amo_03", 1, 0, false, 0);
  const prices = { amo_01: 1234.5, amo_03: 9 };
  const fakeElement = () => {
    const classes = new Set();
    return {
      dataset: {},
      style: {},
      hidden: false,
      textContent: "",
      children: [],
      classList: {
        toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
      replaceChildren() {},
      setAttribute() {},
      appendChild(child) { this.children.push(child); },
    };
  };
  const stickers = Array.from({ length: 6 }, fakeElement);
  const view = Object.assign(Object.create(ShelfStockingWindow.prototype), {
    uiWindow: { isOpen: true },
    scene: { crateSystem: { getStockableCrates: () => [] }, catalogSystem: { getStorePrice: (itemId) => prices[itemId] } },
    fixture: shelf,
    art: getBudgetShelfArt(2, 3),
    selected: null,
    cells: Array.from({ length: 6 }, fakeElement),
    status: {},
    stickers,
  });
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => fakeElement() };
  try {
    view.refresh();
    assert.equal(stickers[0].hidden, false);
    assert.equal(stickers[0].textContent, "1,234.50");
    assert.equal(stickers[0].classList.contains("sold-out"), false);
    assert.equal(stickers[1].textContent, "9.00");
    assert.equal(stickers[1].classList.contains("sold-out"), true);
    assert.equal(stickers[1].children[0].textContent, "SOLD OUT");
    assert.equal(stickers[2].hidden, true);

    prices.amo_01 = 1000;
    view.refresh();
    assert.equal(stickers[0].textContent, "1,000.00");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("every box size fits all shelf spaces and front boxes disappear before back boxes", () => {
  for (const rows of [2, 3]) for (const columns of [2, 3, 4]) {
    const art = getBudgetShelfArt(rows, columns);
    for (const size of [1, 2, 3, 4, 6, 8, 10, 14, 20]) {
      for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < columns; gx++) {
        const quantity = Math.floor(20 / size);
        const boxes = getShelfBoxes(art, gx, gy, size, quantity);
        assert.equal(boxes.length, quantity);
        for (const box of boxes) {
          assert.ok(box.x >= art.columns[gx][0] && box.x + box.width <= art.columns[gx][1]);
          assert.ok(box.y >= art.rows[gy][0] && box.y + box.height <= art.rows[gy][1]);
        }
        assert.deepEqual(getShelfBoxes(art, gx, gy, size, quantity - 1), boxes.slice(0, -1));
      }
    }
  }
});

test("stackSize is units per slot, capped by the shelf's depth, so small items always fit", () => {
  const shelf = new ShelfFixture({ displayGrid: { w: 2, h: 1 }, stackDepth: 10 });
  assert.equal(shelf.getPlacementCapacity({ itemId: "amo_01" }), 4);
  assert.equal(shelf.getPlacementCapacity({ itemId: "paste" }), 10);

  const slot = shelf.placeItem("paste", 0, 0);
  assert.ok(slot);
  assert.equal(slot.quantity, 1);
  assert.equal(shelf.add("paste", 20), 9);
});

test("shared transfers stock a specific shelf slot and return items to an inventory pool", () => {
  const shelf = new ShelfFixture({ displayGrid: { w: 2, h: 1 }, stackDepth: 4 });
  const slot = shelf.placeItem("amo_01", 0, 0, false, 0);
  const pool = new InventoryPool({
    id: "test-stock-pool",
    capacity: 3,
    stock: [{ itemId: "amo_01", quantity: 2 }],
  });
  assert.equal(pool.id, "test-stock-pool");

  assert.equal(transferItems(pool, shelf, "amo_01", 1, {
    destinationEntry: slot,
  }).moved, 1);
  assert.equal(slot.quantity, 1);
  assert.equal(pool.findStockEntry("amo_01").quantity, 1);

  assert.equal(transferItems(shelf, pool, "amo_01", 1, {
    sourceEntry: slot,
  }).moved, 1);
  assert.equal(slot.quantity, 0);
  assert.equal(pool.findStockEntry("amo_01").quantity, 2);
});
