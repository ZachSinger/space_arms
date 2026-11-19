import assert from "node:assert/strict";
import test from "node:test";
import {
  getCleanlinessMax, getCleanlinessScore, judgeCleanliness, rollCleanlinessTolerance,
} from "../js/modules/cleaning/Litter.js";
import { CleaningSystem } from "../js/modules/cleaning/CleaningSystem.js";
import { Trash } from "../js/state/slices/Trash.js";
import { AREA } from "../js/world/Areas.js";

test("cleanliness maximum grows with sales floor expansions and shop levels past 5", () => {
  assert.equal(getCleanlinessMax({ salesExpansions: 0, shopLevel: 1 }), 20);
  assert.equal(getCleanlinessMax({ salesExpansions: 0, shopLevel: 5 }), 20);
  assert.equal(getCleanlinessMax({ salesExpansions: 2, shopLevel: 8 }), 20 + 40 + 6);
});

test("trash costs 1 point, dirt 2, and the score never drops below 0", () => {
  assert.equal(getCleanlinessScore(20, 3), 17);
  assert.equal(getCleanlinessScore(20, 3, 2), 13);
  assert.equal(getCleanlinessScore(20, 30), 0);
});

test("explorers are the pickiest and scavengers the least, with walk-out always below upset", () => {
  const lowest = (faction) => rollCleanlinessTolerance(faction, () => 0);
  const highest = (faction) => rollCleanlinessTolerance(faction, () => 0.999);
  const order = ["scavengers", null, "mercenaries", "explorers"];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(lowest(order[i]).upsetBelow > lowest(order[i - 1]).upsetBelow);
    assert.ok(lowest(order[i]).walkOutBelow > lowest(order[i - 1]).walkOutBelow);
  }
  for (const faction of order) assert.ok(highest(faction).walkOutBelow < lowest(faction).upsetBelow);
});

test("a customer is fine, upset, or walks out depending on the store's cleanliness percent", () => {
  const tolerance = { upsetBelow: 70, walkOutBelow: 30 };
  assert.equal(judgeCleanliness(70, tolerance), "fine");
  assert.equal(judgeCleanliness(69, tolerance), "upset");
  assert.equal(judgeCleanliness(29, tolerance), "walk-out");
});

test("cleaning owns floor trash, keeps held trash in the score, and saves it at the player", () => {
  const sprite = {
    setScale() { return this; },
    setDepth() { return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    destroy() { this.destroyed = true; },
  };
  const shop = {
    textures: { exists: () => true },
    add: { image: () => ({ ...sprite }) },
    room: {
      zones: [{ id: "sales_floor", gridX: 0, gridY: 0, gridW: 4, gridH: 4, salesFloor: true, locked: false }],
      isWalkable: () => true,
    },
    fixtures: { all: () => [], ofKind: () => [] },
    areas: { playerArea: AREA.SHOP },
    player: {
      currentFacing: "down",
      sprite: { x: 100, y: 100, depth: 2, body: { center: { x: 100, y: 100 }, bottom: 112 } },
    },
    checkoutSystem: { operatingRegister: false },
    gameState: { trash: new Trash(), reputation: { shopLevel: 5 } },
    showGameMessage() {},
  };
  const cleaning = new CleaningSystem(shop);

  assert.equal(cleaning.dropTrash(96, 96), true);
  const piece = cleaning.trash.pieces[0];
  assert.equal(shop.gameState.trash.pieces.length, 1);
  assert.equal(cleaning.pickUpTrash(piece), true);
  assert.equal(shop.gameState.trash.pieces.length, 0);
  assert.equal(cleaning.getCleanliness().score, 19);
  assert.deepEqual(cleaning.serializeTrash(), [{ kind: piece.kind, x: 100, y: 112 }]);
  assert.equal(cleaning.throwAwayHeldTrash(), true);
  assert.equal(cleaning.getCleanliness().score, 20);
});
