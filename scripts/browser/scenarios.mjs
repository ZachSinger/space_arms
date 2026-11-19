// ==========================================
// FILE: scenarios.mjs
// ==========================================
// Short, targeted checks of fiddly behaviors in the real game (documentation/RebuildPlan.md,
// Phase 0). Each scenario returns a list of failures; an empty list means it passed.
// Every reach into the game's insides goes through the small `game` helpers at the top, so
// when the rebuild moves things around only those helpers need updating.
import { readFile, readdir } from "node:fs/promises";

const GOLDEN = new URL("../../tests/golden-saves/", import.meta.url);

// --- Game helpers (the only place scenarios touch game internals) ---

async function freshShop(h, { employees = [] } = {}) {
  await h.newGame();
  await h.game((scene, staff) => {
    scene.gameState.reputation.shopLevel = 5;
    scene.gameState.economy.credits += 20000;
    scene.debugTools.quickstart({ shelfCount: 2, itemCount: 8 });
    for (const id of staff) scene.gameState.hireEmployee(id);
  }, employees);
}

// Puts the player at a spot and hands them crates (item id, how many in each).
const placePlayer = (h, spot) => h.game((scene, { x, y, facing }) => {
  scene.player.teleportTo(x, y);
  if (facing) scene.player.forceFacing(facing);
}, spot);

const giveCrates = (h, quantities) => h.game((scene, amounts) => {
  const itemId = scene.fixtures.shelves()[0].placements[0].itemId;
  for (const quantity of amounts) {
    const crate = scene.createItemCrate(itemId, quantity, scene.player.sprite.x, scene.player.sprite.y);
    crate.pickUp(scene.player.sprite);
    scene.addCarriedCrate(crate);
  }
  scene.syncCarriedCrate();
}, quantities);

// The centre of an open shop-floor tile with open floor on both sides and walkable floor
// above it (where the player can stand facing down at it).
const openFloor = (h) => h.game((scene) => {
  const zone = scene.room.zones.find((candidate) => candidate.salesFloor && !candidate.locked);
  const open = (gx, gy) => [0.2, 0.5, 0.8].every((fx) => [0.2, 0.5, 0.8].every((fy) =>
    scene.isOpenTrashSpot((gx + fx) * 64, (gy + fy) * 64)));
  for (let gy = zone.gridY + zone.gridH - 1; gy > zone.gridY; gy -= 1) {
    for (let gx = zone.gridX + 1; gx < zone.gridX + zone.gridW - 1; gx += 1) {
      if (open(gx - 1, gy) && open(gx, gy) && open(gx + 1, gy) && open(gx, gy - 1)) {
        return { x: (gx + 0.5) * 64, y: (gy + 0.5) * 64 };
      }
    }
  }
  throw new Error("No open floor found");
});

// --- Scenarios ---

export const scenarios = {
  async "thrown crate hits a customer"(h) {
    await freshShop(h);
    const before = await h.game((scene) => {
      let hits = 0;
      scene.eventBus.on("customer-hit-by-crate", () => { hits += 1; });
      window.__hits = () => hits;
      scene.spawnCustomer();
      // Reputation changes wait in a pending tally until End Day.
      return scene.gameState.reputation.pending.global;
    });
    // Customers stand still while browsing a shelf: the easiest moment to aim.
    await h.page.waitForFunction(() => window.__game.scene.getScene("scene-game").customers[0]?.state === "BROWSING",
      null, { timeout: 30000 });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await giveCrates(h, [5]);
      const thrown = await h.game((scene) => {
        const target = scene.customers[0]?.sprite;
        if (!target) return false;
        const sides = [[-110, 0, "right"], [110, 0, "left"], [0, -110, "down"], [0, 110, "up"]];
        const step = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
        for (const [dx, dy, facing] of sides) {
          const x = target.x + dx;
          const y = target.y + dy;
          if (!scene.isOpenTrashSpot(x, y) || !scene.isOpenTrashSpot(target.x + dx / 2, target.y + dy / 2)) continue;
          scene.player.teleportTo(x, y);
          scene.player.forceFacing(facing);
          scene.player.sprite.body.setVelocity(step[facing][0] * 220, step[facing][1] * 220);
          if (scene.throwTopCrate()) return true;
        }
        return false;
      });
      if (!thrown) break;
      await h.wait(1200);
      if (await h.page.evaluate(() => window.__hits())) break;
    }
    const after = await h.game((scene) => ({ hits: window.__hits(), reputation: scene.gameState.reputation.pending.global }));
    const failures = [];
    if (after.hits < 1) failures.push("no customer was hit by a thrown crate");
    else if (!(after.reputation < before)) failures.push(`hit didn't cost reputation (${before} -> ${after.reputation})`);
    return failures;
  },

  async "pick the middle crate out of a three-high stack"(h) {
    await freshShop(h);
    const spot = await openFloor(h);
    await placePlayer(h, { x: spot.x, y: spot.y - 70, facing: "down" });
    const result = await h.game((scene, at) => {
      const itemId = scene.fixtures.shelves()[0].placements[0].itemId;
      const [bottom, middle, top] = [1, 2, 3].map((quantity) => scene.createItemCrate(itemId, quantity, at.x, at.y));
      bottom.drop(at.x, at.y, 0, 0, false);
      scene.restockCrates.push(bottom);
      scene.floorStacks.set(bottom, [middle, top]);
      scene.syncFloorStacks();
      const tookMiddle = scene.pickUpFromStack({ base: bottom, crates: [bottom, middle, top], marked: middle }, false);
      const left = [bottom, ...(scene.floorStacks.get(bottom) ?? [])].map((crate) => crate.quantity);
      const held = scene.getCarriedCrates().map((crate) => crate.quantity);
      const tookBottomWithAbove = scene.pickUpFromStack(
        { base: bottom, crates: [bottom, ...(scene.floorStacks.get(bottom) ?? [])], marked: bottom }, true);
      return { tookMiddle, left, held, tookBottomWithAbove, heldAfter: scene.getCarriedCrates().map((crate) => crate.quantity),
        stillOnFloor: scene.restockCrates.includes(bottom) };
    }, spot);
    const failures = [];
    if (!result.tookMiddle) failures.push("couldn't pick up the middle crate");
    if (JSON.stringify(result.left) !== "[1,3]") failures.push(`stack after taking the middle: ${JSON.stringify(result.left)}`);
    if (JSON.stringify(result.held) !== "[2]") failures.push(`held after taking the middle: ${JSON.stringify(result.held)}`);
    if (!result.tookBottomWithAbove) failures.push("couldn't pick up the rest of the stack");
    if (JSON.stringify(result.heldAfter) !== "[2,1,3]") failures.push(`held after taking the rest: ${JSON.stringify(result.heldAfter)}`);
    if (result.stillOnFloor) failures.push("bottom crate stayed on the floor");
    return failures;
  },

  async "stepping behind each register and back out"(h) {
    await freshShop(h);
    const results = await h.game((scene) => scene.fixtures.ofKind("register").map((register) => {
      const point = scene.getBehindRegisterPoint(register);
      scene.player.teleportTo(point.x, point.y);
      const start = { x: scene.player.sprite.x, y: scene.player.sprite.y };
      scene.beginRegisterSession(register);
      const inside = { on: scene.operatingRegister, input: scene.player.inputEnabled,
        nearX: Math.abs(scene.player.sprite.x - point.x) < 2, nearY: Math.abs(scene.player.sprite.y - point.y) < 64,
        depth: register.sprite.depth, playerDepth: scene.player.sprite.depth };
      const depthBefore = scene.registerDepthBeforeTuck;
      scene.endRegisterSession();
      return { id: register.id, inside, depthBefore, restoredDepth: register.sprite.depth,
        back: Math.hypot(scene.player.sprite.x - start.x, scene.player.sprite.y - start.y) < 2,
        off: !scene.operatingRegister && scene.player.inputEnabled };
    }));
    const failures = [];
    if (!results.length) failures.push("no registers found");
    for (const result of results) {
      if (!result.inside.on || result.inside.input) failures.push(`${result.id}: didn't lock the player behind the counter`);
      if (!result.inside.nearX || !result.inside.nearY) failures.push(`${result.id}: player not at the counter`);
      if (!result.back || !result.off) failures.push(`${result.id}: player not returned and freed afterwards`);
      if (result.depthBefore != null && result.restoredDepth !== result.depthBefore) {
        failures.push(`${result.id}: counter drawing order not restored`);
      }
    }
    return failures;
  },

  async "employee restocks a shelf and gets rid of the empty crate"(h) {
    await freshShop(h, { employees: ["tavi_stock_clerk"] });
    const target = await h.game((scene) => {
      const shelf = scene.fixtures.shelves()[0];
      const placement = shelf.placements[0];
      placement.quantity = 0;
      scene.placeSupplyOrder(new Map([[placement.itemId, 1]]));
      scene.gameState.shop.changed();
      return { shelfId: shelf.id, itemId: placement.itemId };
    });
    await h.game((scene) => scene.shift.start());
    const deadline = Date.now() + 90000;
    let state = null;
    while (Date.now() < deadline) {
      await h.wait(1000);
      state = await h.game((scene, { shelfId, itemId }) => {
        const shelf = scene.fixtures.shelves().find((candidate) => candidate.id === shelfId);
        const quantity = shelf.placements.filter((placement) => placement.itemId === itemId)
          .reduce((sum, placement) => sum + placement.quantity, 0);
        const employee = scene.employees[0];
        return { quantity, carrying: employee?.isCarryingCrate() ?? false, state: employee?.state ?? null,
          looseEmpties: scene.restockCrates.filter((crate) => crate.kind === "item" && crate.quantity === 0).length };
      }, target);
      if (state.quantity > 0 && !state.carrying) break;
    }
    const failures = [];
    if (!state || state.quantity === 0) failures.push("the employee never refilled the empty shelf space");
    else if (state.carrying) failures.push(`the employee was still carrying a crate (${state.state})`);
    if (state?.looseEmpties) failures.push(`${state.looseEmpties} empty crates were left on the floor`);
    return failures;
  },

  async "trash is picked up and thrown in the trashcan"(h) {
    await freshShop(h);
    const spot = await openFloor(h);
    const result = await h.game((scene, at) => {
      const can = scene.fixtures.ofKind("trash")[0];
      if (!can) return { error: "no trashcan in the shop" };
      const before = scene.getCleanliness();
      scene.player.teleportTo(at.x, at.y - 64);
      scene.player.forceFacing("down");
      const { center } = scene.player.sprite.body;
      if (!scene.dropTrash(center.x, center.y + 22)) return { error: "couldn't drop trash in front of the player" };
      const dirty = scene.getCleanliness();
      scene.handleInteract();
      return { before: before.trashCount, dirty: dirty.trashCount, holding: Boolean(scene.heldTrash) };
    }, spot);
    if (result.error) return [result.error];
    // Walk up to the trashcan from below and face it.
    const binned = await h.game((scene) => {
      const can = scene.fixtures.ofKind("trash")[0];
      for (const [facing, ox, oy] of [["up", 0.5, 1.6], ["down", 0.5, -0.6], ["left", 1.6, 0.5], ["right", -0.6, 0.5]]) {
        scene.player.teleportTo((can.gx + ox) * 64, (can.gy + oy) * 64);
        scene.player.forceFacing(facing);
        if (scene.isNearTrashcan()) break;
      }
      scene.handleInteract();
      const near = scene.isNearTrashcan();
      scene.handleInteract();
      return { near, held: Boolean(scene.heldTrash), count: scene.getCleanliness().trashCount };
    });
    const failures = [];
    if (result.dirty !== result.before + 1) failures.push("dropping trash didn't lower cleanliness");
    if (!result.holding) failures.push("pressing interact facing the trash didn't pick it up");
    if (!binned.near) failures.push("couldn't stand facing the trashcan");
    if (binned.held) failures.push("the trash stayed in hand at the trashcan");
    if (binned.count !== result.before) failures.push("cleanliness didn't recover after binning");
    return failures;
  },

  async "golden saves load and resave the same as before the rebuild"(h) {
    const failures = [];
    const files = (await readdir(GOLDEN)).filter((file) => file.endsWith(".resaved.json"));
    for (const file of files) {
      const name = file.replace(".resaved.json", "");
      const save = JSON.parse(await readFile(new URL(`${name}.json`, GOLDEN), "utf8"));
      const expected = JSON.parse(await readFile(new URL(file, GOLDEN), "utf8"));
      await h.loadSave(save);
      const actual = await h.game((scene) => JSON.parse(scene.lastSavedSnapshot));
      const diff = firstDifference(expected, actual);
      if (diff) failures.push(`${name}: ${diff}`);
    }
    return failures;
  },
};

// A crate still flying when the game saved keeps moving for a frame or two after loading.
const MOVING = /^save\.crates\.\d+\.(x|y|velocityX|velocityY|launch|flight)\b/;

function firstDifference(expected, actual, path = "save") {
  if (Object.is(expected, actual)) return null;
  if (typeof expected === "number" && typeof actual === "number" && MOVING.test(path) &&
    Math.abs(expected - actual) <= 24) return null;
  if (typeof expected !== typeof actual || expected === null || actual === null || typeof expected !== "object") {
    return `${path} was ${JSON.stringify(expected)}, now ${JSON.stringify(actual)}`;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    const diff = firstDifference(expected[key], actual[key], `${path}.${key}`);
    if (diff) return diff;
  }
  return null;
}

export async function runScenarios(h, only = null) {
  const results = [];
  for (const [name, run] of Object.entries(scenarios)) {
    if (only && !name.includes(only)) continue;
    const errorsBefore = h.errors().length;
    let failures;
    try {
      failures = await run(h);
    } catch (error) {
      failures = [`crashed: ${error.message}`];
    }
    failures.push(...h.errors().slice(errorsBefore).map((problem) => `${problem.type}: ${problem.text}`));
    results.push({ name, failures });
  }
  return results;
}
