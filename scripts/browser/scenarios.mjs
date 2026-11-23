// ==========================================
// FILE: scenarios.mjs
// ==========================================
// Short, targeted checks of fiddly behaviors in the real game (documentation/RebuildPlan.md,
// Phase 0). Each scenario returns a list of failures; an empty list means it passed.
// Every reach into the game's insides goes through the small `game` helpers at the top, so
// when the rebuild moves things around only those helpers need updating.
import { readFile, readdir } from "node:fs/promises";
import { DatabaseManager } from "../../js/logic/DatabaseManager.js";
import { upgradeContractSplit } from "../../js/state/migrations/contractSplit.js";
import { migratePreWarAmmoContract } from "../../js/state/migrations/preWarAmmoContract.js";
import { repriceScrapAutopistol } from "../../js/state/migrations/scrapAutopistolPrice.js";
import { SHOP_LAYOUT_VERSION } from "../../js/state/migrations/index.js";
import { addRegisterAssignments } from "../../js/state/migrations/registerAssignments.js";
import { rebalanceItemPrices } from "../../js/state/migrations/moneyRebalance.js";

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
    const crate = scene.crateSystem.createItemCrate(itemId, quantity, scene.player.sprite.x, scene.player.sprite.y);
    crate.pickUp(scene.player.sprite);
    scene.crateSystem.addCarriedCrate(crate);
  }
  scene.crateSystem.syncCarriedCrate();
}, quantities);

// The centre of an open shop-floor tile with open floor on both sides and walkable floor
// above it (where the player can stand facing down at it).
const openFloor = (h) => h.game((scene) => {
  const zone = scene.room.zones.find((candidate) => candidate.salesFloor && !candidate.locked);
  const open = (gx, gy) => [0.2, 0.5, 0.8].every((fx) => [0.2, 0.5, 0.8].every((fy) =>
    scene.cleaningSystem?.isOpenTrashSpot((gx + fx) * 64, (gy + fy) * 64)));
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
      scene.customerFlow.spawn();
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
          if (!scene.cleaningSystem?.isOpenTrashSpot(x, y) || !scene.cleaningSystem?.isOpenTrashSpot(target.x + dx / 2, target.y + dy / 2)) continue;
          scene.player.teleportTo(x, y);
          scene.player.forceFacing(facing);
          scene.player.sprite.body.setVelocity(step[facing][0] * 220, step[facing][1] * 220);
          if (scene.crateSystem.dropTopCrate(true)) return true;
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
      const [bottom, middle, top] = [1, 2, 3].map((quantity) => scene.crateSystem.createItemCrate(itemId, quantity, at.x, at.y));
      bottom.drop(at.x, at.y, 0, 0, false);
      scene.restockCrates.push(bottom);
      scene.floorStacks.set(bottom, [middle, top]);
      scene.crateSystem.syncFloorStacks();
      const tookMiddle = scene.crateSystem.pickUpFromStack({ base: bottom, crates: [bottom, middle, top], marked: middle }, false);
      const left = [bottom, ...(scene.floorStacks.get(bottom) ?? [])].map((crate) => crate.quantity);
      const held = scene.crateSystem.getCarriedCrates().map((crate) => crate.quantity);
      const tookBottomWithAbove = scene.crateSystem.pickUpFromStack(
        { base: bottom, crates: [bottom, ...(scene.floorStacks.get(bottom) ?? [])], marked: bottom }, true);
      return { tookMiddle, left, held, tookBottomWithAbove, heldAfter: scene.crateSystem.getCarriedCrates().map((crate) => crate.quantity),
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
      const point = scene.checkoutSystem.behindRegisterPoint(register);
      scene.player.teleportTo(point.x, point.y);
      const start = { x: scene.player.sprite.x, y: scene.player.sprite.y };
      scene.checkoutSystem.beginRegisterSession(register);
      const inside = { on: scene.checkoutSystem.operatingRegister, input: scene.player.inputEnabled,
        nearX: Math.abs(scene.player.sprite.x - point.x) < 2, nearY: Math.abs(scene.player.sprite.y - point.y) < 64,
        depth: register.sprite.depth, playerDepth: scene.player.sprite.depth };
      const depthBefore = scene.checkoutSystem.registerDepthBeforeTuck;
      scene.checkoutSystem.endRegisterSession();
      const center = scene.player.sprite.body.center;
      const exit = register.backExitPoint ?? start;
      const exitTarget = register.backExitPoint ? center : scene.player.sprite;
      return { id: register.id, inside, depthBefore, restoredDepth: register.sprite.depth,
        back: Math.hypot(exitTarget.x - exit.x, exitTarget.y - exit.y) < 2,
        off: !scene.checkoutSystem.operatingRegister && scene.player.inputEnabled };
    }));
    const failures = [];
    if (!results.length) failures.push("no registers found");
    for (const result of results) {
      if (!result.inside.on || result.inside.input) failures.push(`${result.id}: didn't lock the player behind the counter`);
      if (!result.inside.nearX || !result.inside.nearY) failures.push(`${result.id}: player not at the counter`);
      if (!result.back || !result.off) failures.push(`${result.id}: player not let out the back and freed afterwards`);
      if (result.depthBefore != null && result.restoredDepth !== result.depthBefore) {
        failures.push(`${result.id}: counter drawing order not restored`);
      }
    }
    return failures;
  },

  async "walking into the backroom and back out with a crate"(h) {
    await freshShop(h);
    await giveCrates(h, [3]);
    const result = await h.game((scene) => {
      const goThrough = (area) => {
        const portal = scene.areas.portals.find((candidate) => candidate.area === area);
        scene.player.teleportTo(portal.door.x, portal.door.y + 40);
        scene.player.forceFacing("up");
        const found = scene.areas.nearbyPortal() === portal;
        scene.interactionSystem.handleInteract();
        const crate = scene.crateSystem.getCarriedCrates()[0];
        const { x, y } = scene.player.sprite;
        return { found, area: scene.areas.playerArea, window: scene.cameraRig.backroomCamera.visible,
          crateFollowed: Boolean(crate) && Math.hypot(crate.sprite.x - x, crate.sprite.y - y) < 80 };
      };
      return { inward: goThrough("shop"), outward: goThrough("backroom") };
    });
    const failures = [];
    const { inward, outward } = result;
    if (!inward.found) failures.push("the backroom door didn't answer from in front of it");
    if (inward.area !== "backroom" || !inward.window) failures.push("going in didn't put the player in the backroom window");
    if (!inward.crateFollowed) failures.push("the carried crate didn't come into the backroom");
    if (!outward.found) failures.push("the backroom's exit didn't answer from in front of it");
    if (outward.area !== "shop" || outward.window) failures.push("going out didn't return the player to the shop");
    if (!outward.crateFollowed) failures.push("the carried crate didn't come back out");
    return failures;
  },

  async "registered room stairs use E, shared routes, and the framed camera"(h) {
    await freshShop(h);
    const source = await openFloor(h);
    await placePlayer(h, { ...source, facing: "right" });
    await h.wait(100);
    const setup = await h.game((scene) => {
      const source = { x: scene.player.sprite.x, y: scene.player.sprite.y };
      const front = { x: 8320, y: 128 };
      const removeArea = scene.areas.registerArea("test-room", {
        title: "TEST ROOM",
        getBounds: () => ({ x: 8192, y: 0, width: 256, height: 256 }),
        isWalkable: (gx, gy) => gx >= 128 && gx < 132 && gy >= 0 && gy < 4,
        walkabilityKey: () => "test-floor",
      });
      const removePortals = scene.areas.registerPortalPair(
        { area: "shop", door: source, front: source, hint: "Go downstairs",
          standingBounds: { x: source.x - 16, y: source.y - 16, width: 32, height: 32 } },
        { area: "test-room", door: front, front, hint: "Go upstairs",
          standingBounds: { x: front.x - 16, y: front.y - 16, width: 32, height: 32 } },
      );
      scene.testRoomCleanup = () => {
        if (scene.areas.playerArea === "test-room") {
          scene.areas.goThrough(scene.areas.portalBetween("test-room", "shop"));
        }
        removePortals();
        removeArea();
      };
      const path = scene.navigation.findPath(source.x, source.y, front.x + 32, front.y);
      return { routed: path?.some((point) => point.teleportTo?.x === front.x) ?? false };
    });
    const failures = [];
    try {
      if (!setup.routed) failures.push("the shared route did not include the stairs");
      await h.page.keyboard.press("e");
      await h.wait(300);
      const entered = await h.game((scene) => ({
        area: scene.areas.playerArea,
        visible: scene.cameraRig.backroomCamera.visible,
        title: scene.cameraRig.backroomFrame.textContent,
        cameraMatches: scene.cameraRig.cameraAt(scene.player.sprite.x, scene.player.sprite.y) ===
          scene.cameraRig.backroomCamera,
      }));
      if (entered.area !== "test-room") failures.push("E did not enter the registered room");
      if (!entered.visible || entered.title !== "TEST ROOM" || !entered.cameraMatches) {
        failures.push("the framed camera did not show the registered room");
      }
      await h.page.keyboard.press("e");
      await h.wait(300);
      const left = await h.game((scene) => ({
        area: scene.areas.playerArea, visible: scene.cameraRig.backroomCamera.visible,
      }));
      if (left.area !== "shop" || left.visible) failures.push("E did not return to the shop view");
    } finally {
      await h.game((scene) => { scene.testRoomCleanup(); delete scene.testRoomCleanup; });
    }
    return failures;
  },

  async "employee restocks a shelf and gets rid of the empty crate"(h) {
    await freshShop(h, { employees: ["tavi_stock_clerk"] });
    const target = await h.game((scene) => {
      // Hiring puts Tavi on a register; take him off so stocking is his top job.
      scene.gameState.staff.assignRegister("tavi_stock_clerk", null);
      const shelf = scene.fixtures.shelves()[0];
      const placement = shelf.placements[0];
      placement.quantity = 0;
      scene.supply.placeOrder(new Map([[placement.itemId, 1]]));
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
      const before = scene.cleaningSystem.getCleanliness();
      scene.player.teleportTo(at.x, at.y - 64);
      scene.player.forceFacing("down");
      const { center } = scene.player.sprite.body;
      if (!scene.cleaningSystem.dropTrash(center.x, center.y + 22)) return { error: "couldn't drop trash in front of the player" };
      const dirty = scene.cleaningSystem.getCleanliness();
      scene.interactionSystem.handleInteract();
      return { before: before.trashCount, dirty: dirty.trashCount, holding: Boolean(scene.heldTrash) };
    }, spot);
    if (result.error) return [result.error];
    // Walk up to the trashcan from below and face it.
    const binned = await h.game((scene) => {
      const can = scene.fixtures.ofKind("trash")[0];
      for (const [facing, ox, oy] of [["up", 0.5, 1.6], ["down", 0.5, -0.6], ["left", 1.6, 0.5], ["right", -0.6, 0.5]]) {
        scene.player.teleportTo((can.gx + ox) * 64, (can.gy + oy) * 64);
        scene.player.forceFacing(facing);
        if (scene.fixtureSystem.getNearbyTrashcan()) break;
      }
      scene.interactionSystem.handleInteract();
      const near = Boolean(scene.fixtureSystem.getNearbyTrashcan());
      scene.interactionSystem.handleInteract();
      return { near, held: Boolean(scene.heldTrash), count: scene.cleaningSystem.getCleanliness().trashCount };
    });
    const failures = [];
    if (result.dirty !== result.before + 1) failures.push("dropping trash didn't lower cleanliness");
    if (!result.holding) failures.push("pressing interact facing the trash didn't pick it up");
    if (!binned.near) failures.push("couldn't stand facing the trashcan");
    if (binned.held) failures.push("the trash stayed in hand at the trashcan");
    if (binned.count !== result.before) failures.push("cleanliness didn't recover after binning");
    return failures;
  },

  async "golden saves load and preserve previous data"(h) {
    const failures = [];
    const files = (await readdir(GOLDEN)).filter((file) => file.endsWith(".resaved.json"));
    for (const file of files) {
      const name = file.replace(".resaved.json", "");
      const save = JSON.parse(await readFile(new URL(`${name}.json`, GOLDEN), "utf8"));
      const expected = await upgradeResaved(JSON.parse(await readFile(new URL(file, GOLDEN), "utf8")));
      await h.loadSave(save);
      const actual = await h.game((scene) => JSON.parse(scene.saves.lastSavedSnapshot));
      for (const fixture of actual.fixtures ?? []) {
        if (!Array.isArray(fixture.placements)) continue;
        if (!Number.isSafeInteger(fixture.nextPlacementId) ||
          fixture.placements.some((placement) => typeof placement.id !== "string" || !placement.id)) {
          failures.push(`${name}: shelf stock slots did not receive stable IDs`);
          break;
        }
      }
      const diff = firstDifference(withoutShelfSlotIds(expected), withoutShelfSlotIds(actual));
      if (diff) failures.push(`${name}: ${diff}`);
    }
    return failures;
  },

  async "Employee Test builds a Level 5 shop ready to hire"(h) {
    await h.newGame();
    const result = await h.game((scene) => {
      const ok = scene.debugTools.prepareEmployeeTesting();
      const { gameState } = scene;
      const shelves = scene.fixtures.shelves();
      const spots = shelves.flatMap((shelf) => shelf.placements);
      return {
        ok,
        level: gameState.reputation.shopLevel,
        day: gameState.calendar.day,
        money: gameState.economy.credits,
        shelves: shelves.length,
        spots: spots.length,
        emptySpots: spots.filter((spot) => spot.quantity <= 0).length,
        hired: gameState.hireEmployee("tavi_stock_clerk"),
        message: document.getElementById("game-message")?.textContent ?? "",
      };
    });
    const failures = [];
    if (!result.ok) failures.push("Employee Test did not run");
    if (result.level < 5) failures.push(`shop level ${result.level}, wanted at least 5`);
    if (result.day < 3) failures.push(`still on day ${result.day}; no shifts were played`);
    if (result.shelves < 1 || result.spots < 1) failures.push("no stocked shelves");
    if (result.emptySpots > 0) failures.push(`${result.emptySpots} empty shelf spots`);
    if (!result.hired) failures.push("could not hire an employee afterwards");
    console.log("Employee Test result:", JSON.stringify(result));
    return failures;
  },
};

// A crate still flying when the game saved keeps moving for a frame or two after loading.
const MOVING = /^save\.crates\.\d+\.(x|y|velocityX|velocityY|launch|flight)\b/;

// The resaved snapshots predate later save upgrades; apply the same ones the unit tests do.
let database = null;
async function upgradeResaved(saved) {
  if (!database) {
    database = new DatabaseManager();
    const data = (name) => readFile(new URL(`../../data/${name}`, import.meta.url), "utf8").then(JSON.parse);
    database.loadItemsJSON(await data("Items.json"));
    database.loadLicensesJSON(await data("Licenses.json"));
  }
  const save = rebalanceItemPrices(addRegisterAssignments(repriceScrapAutopistol(
    migratePreWarAmmoContract(upgradeContractSplit(saved)), database)), database);
  return { ...save, layoutVersion: SHOP_LAYOUT_VERSION };
}

function withoutShelfSlotIds(save) {
  return {
    ...save,
    fixtures: save.fixtures?.map((fixture) => {
      if (!Array.isArray(fixture.placements)) return fixture;
      const withoutCounter = { ...fixture };
      delete withoutCounter.nextPlacementId;
      return {
        ...withoutCounter,
        placements: fixture.placements.map((placement) => {
          const withoutId = { ...placement };
          delete withoutId.id;
          return withoutId;
        }),
      };
    }),
  };
}

function firstDifference(expected, actual, path = "save") {
  if (Object.is(expected, actual)) return null;
  if (typeof expected === "number" && typeof actual === "number" && MOVING.test(path) &&
    Math.abs(expected - actual) <= 24) return null;
  if (typeof expected !== typeof actual || expected === null || actual === null || typeof expected !== "object") {
    return `${path} was ${JSON.stringify(expected)}, now ${JSON.stringify(actual)}`;
  }
  // Fields added to saves after a snapshot was taken aren't lost data, so only arrays must match exactly.
  const keys = new Set([...Object.keys(expected), ...(Array.isArray(expected) ? Object.keys(actual) : [])]);
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
