import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Events, GAME_EVENTS } from "../js/core/Events.js";
import { createServer } from "vite";
import { PLAYER_BODY_HEIGHT, PLAYER_BODY_WIDTH } from "../js/logic/Player.js";

let server;
let cacheDirectory;
let Employee;
let nextTestShelfSlotId = 1;
let nextTestCrateId = 1;
let REGISTER_SERVICE_MS_PER_ITEM;
let EmployeeRenderer;
let EmployeeTraining;

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-employee-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "employee-test-stubs",
      enforce: "pre",
      resolveId(source) {
        if (source === "../scenes/boot.js") return "\0employee-test-database";
        if (source === "./CustomerSprites.js") return "\0employee-test-sprites";
      },
      load(id) {
        if (id === "\0employee-test-database") {
          return "export const database = { getItem: (id) => ({ id, slots: 1 }) };";
        }
        if (id === "\0employee-test-sprites") {
          return `export const CHARACTER_ORIGIN_Y = 50 / 64;
            export const CHARACTER_DISPLAY_SIZE = 64;
            export const standingFrame = (facing) => ({ down: 1, left: 4, right: 7, up: 10 })[facing];
            export const loadCharacterSheets = () => {};
            export const registerCharacterAnimations = () => {};
            export const showCharacterFacing = (sprite, facing, moving) => {
              sprite.shown = { facing, moving };
            };
            export const addCharacterSprite = (scene, x, y, textureKey, bodyWidth, bodyHeight) => {
              const sprite = scene.add.sprite(x, y, textureKey);
              scene.physics.add.existing(sprite);
              sprite.body.width = bodyWidth;
              sprite.body.height = bodyHeight;
              return sprite;
            };`;
        }
      },
    }],
  });
  ({ Employee, REGISTER_SERVICE_MS_PER_ITEM } = await server.ssrLoadModule("/js/logic/Employee.js"));
  ({ EmployeeRenderer } = await server.ssrLoadModule("/js/logic/EmployeeRenderer.js"));
  EmployeeTraining = await server.ssrLoadModule("/js/logic/EmployeeTraining.js");
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

test("employees require an injected store route interface", () => {
  assert.throws(
    () => new Employee({ id: "tavi_stock_clerk" }, null),
    /Employee requires a store interface with findPath/,
  );
});

function makeShelf(quantity = 0, capacity = 3, placementCount = 1) {
  const placements = Array.from({ length: placementCount }, () => ({
    id: `test-shelf-slot-${nextTestShelfSlotId++}`,
    itemId: "amo_01",
    quantity,
  }));
  return {
    id: "test-shelf",
    type: "shelf_budget_2x4",
    standPoint: { x: 100, y: 100 },
    placements,
    getContainerId(placement = null) {
      return placement?.id ?? this.id;
    },
    getLocation(placement) {
      return { kind: "shelf-slot", shelfId: this.id, slotId: placement?.id ?? null };
    },
    canTake() {
      return true;
    },
    canPut() {
      return true;
    },
    getRemainingUnitsFor(itemId, entry) {
      return this.placements
        .filter((placement) => itemId === placement.itemId &&
          (!entry || placement === entry))
        .reduce((sum, placement) => sum + Math.max(0, capacity - placement.quantity), 0);
    },
    add(itemId, amount, entry) {
      const placement = this.placements.find((candidate) =>
        itemId === candidate.itemId && (!entry || candidate === entry) &&
        candidate.quantity < capacity,
      );
      if (!placement) return 0;
      const accepted = Math.min(amount, capacity - placement.quantity);
      placement.quantity += accepted;
      return accepted;
    },
  };
}

function makeDeliveryCrate(quantity = 5) {
  return {
    id: `test-delivery-crate-${nextTestCrateId++}`,
    kind: "item",
    itemId: "amo_01",
    quantity,
    lockedToPad: true,
    isCarried: false,
    getContainerId() {
      return this.id;
    },
    getLocation() {
      if (this.lockedToPad) return { kind: "loading-pad", padId: "loading-pad" };
      if (this.stackedOnId) return { kind: "crate-stack", baseCrateId: this.stackedOnId };
      if (this.isCarried) return { kind: "carried", holderId: this.carrierId };
      return { kind: "world", x: this.sprite.x, y: this.sprite.y };
    },
    setCarriedBy(holderId) {
      this.carrierId = holderId;
      this.stackedOnId = null;
    },
    setStackedOn(baseCrateId) {
      this.isCarried = true;
      this.carrierId = null;
      this.stackedOnId = baseCrateId;
    },
    sprite: { x: 40, y: 40 },
    isStationary: () => true,
    isDropPositionClear: () => true,
    canTake() {
      return true;
    },
    canPut() {
      return true;
    },
    getFloorBounds(x = this.sprite.x, y = this.sprite.y) {
      return { left: x - 16, right: x + 16, top: y - 4, bottom: y + 14 };
    },
    getAvailableUnitsFor(itemId) {
      return itemId === this.itemId ? this.quantity : 0;
    },
    remove(itemId, amount) {
      const removed = Math.min(this.getAvailableUnitsFor(itemId), amount);
      this.quantity -= removed;
      return removed;
    },
    add(itemId, amount) {
      if (itemId !== this.itemId) return 0;
      this.quantity += amount;
      return amount;
    },
    pickUp(_carrier, { holderId = "test-employee", stackedOnId = null } = {}) {
      this.isCarried = true;
      this.lockedToPad = false;
      if (stackedOnId) this.setStackedOn(stackedOnId);
      else this.setCarriedBy(holderId);
      return true;
    },
    followCarrier() {},
    drop(x, y) {
      this.sprite.x = x;
      this.sprite.y = y;
      this.isCarried = false;
      this.carrierId = null;
      this.stackedOnId = null;
    },
    lockToPad() { this.lockedToPad = true; },
    destroy() { this.destroyed = true; },
  };
}

function makeEmployee({
  shelfQuantity = 0,
  shelfCapacity = 3,
  shelfPlacementCount = 1,
  crateQuantity = 5,
  jobPriorities = ["register", "stock_shelves"],
  hasRegister = false,
  trashcans = [{ id: "trash-near", type: "trash_can", gx: 2, gy: 1 }],
} = {}) {
  const shelf = makeShelf(shelfQuantity, shelfCapacity, shelfPlacementCount);
  const crate = makeDeliveryCrate(crateQuantity);
  const transfers = [];
  const completedSales = [];
  const eventBus = new Events();
  eventBus.on(GAME_EVENTS.INVENTORY_TRANSFERRED, (event) => transfers.push(event));
  const registerFixture = hasRegister ? { id: "register", sprite: {} } : null;
  const registerLine = [];
  const scene = {
    areas: { arrivalIn: () => ({ x: 20, y: 20 }) },
    eventBus,
    fixtures: {
      shelves: () => [shelf],
      register: () => registerFixture,
      registers: () => registerFixture ? [registerFixture] : [],
      ofKind: (kind) => kind === "trash" ? trashcans : [],
    },
    employees: [],
    restockCrates: [crate],
    floorStacks: new Map(),
    syncFloorStacks() {},
    crateSystem: { syncFloorStacks() {}, motionPaused: false },
    player: { sprite: {} },
    showShopMessage() {},
    findPath: () => [],
    getBehindRegisterPoint: () => ({ x: 80, y: 80 }),
    gameState: {
      staff: { jobPriorities: { tavi_stock_clerk: jobPriorities } },
      shop: { changed() {} },
    },
    refreshShelfStockDisplay() {},
    add: {
      sprite: (x, y, textureKey) => ({
        x,
        y,
        texture: { key: textureKey },
        anims: { stop() {} },
        setTexture(key, frame) { this.texture.key = key; this.frame = frame; return this; },
        setTint() { return this; },
        setDepth() { return this; },
        setVisible(visible) { this.visible = visible; return this; },
        destroy() {},
      }),
    },
    physics: {
      add: {
        existing(sprite) {
          sprite.body = {
            velocity: { x: 0, y: 0 },
            setVelocity(x, y) { this.velocity = { x, y }; },
            reset(x, y) { sprite.x = x; sprite.y = y; this.setVelocity(0, 0); },
          };
        },
      },
    },
    employeeGroup: { add() {}, remove() {} },
  };
  scene.createEmployeeSprite = (x, y, texture, width, height) => {
    const sprite = scene.add.sprite(x, y, texture);
    scene.physics.add.existing(sprite);
    sprite.body.width = width;
    sprite.body.height = height;
    scene.employeeGroup.add(sprite);
    return sprite.setDepth(3);
  };
  scene.removeEmployeeSprite = (sprite) => scene.employeeGroup.remove(sprite, false);
  scene.checkoutSystem = {
    operatingRegister: false,
    lineFor: () => registerLine,
    anyRegisterLineWaiting: () => registerLine.length > 0,
    isPlayerOperating: () => scene.checkoutSystem.operatingRegister,
    goBacksReservedRectangles: () => [],
    findGoBacksSpot: (crate, reserved) => reserved.some((rect) =>
      rect.left < 96 && rect.right > 96 && rect.top < 6560 && rect.bottom > 6560)
      ? null : { x: 96, y: 6560, inBackroom: true },
    completeEmployeeCheckout(employee, customer) {
      completedSales.push({ employee, customer });
      return true;
    },
  };
  const employee = new Employee({
    id: "tavi_stock_clerk",
    name: "Tavi",
  }, scene);
  employee.scene = scene;
  scene.employees = [employee];
  return { employee, shelf, crate, transfers, completedSales };
}

test("employees request routes sized for their own collision bodies", () => {
  const { employee } = makeEmployee();
  let requestedBodySize;
  employee.scene.findPath = (...args) => {
    requestedBodySize = args[4];
    return [];
  };

  assert.equal(employee.walkTo({ x: 120, y: 80 }, "TO_SHELF"), true);
  assert.deepEqual(requestedBodySize, {
    width: PLAYER_BODY_WIDTH,
    height: PLAYER_BODY_HEIGHT,
    avoidStoreDoor: true,
  });
});

test("staff keep their own uniform and raise their arms only while carrying a crate", () => {
  const { employee, crate } = makeEmployee();
  assert.equal(employee.sprite.texture.key, "employee_tavi");
  employee.startNextTask();
  employee.updateFacing();
  assert.equal(employee.sprite.texture.key, "employee_tavi");
  employee.arriveAtDestination();
  employee.updateFacing();
  assert.equal(employee.sprite.texture.key, "employee_tavi_carry");
  employee.currentFacing = "left";
  employee.sprite.body.setVelocity(-120, 0);
  employee.updateFacing();
  assert.deepEqual(employee.sprite.shown, { facing: "left", moving: true });
  employee.stockCrateOnShelf();
  employee.standStill();
  assert.equal(employee.sprite.texture.key, "employee_tavi_carry");
  employee.arriveAtDestination();
  assert.equal(crate.isCarried, false);
  employee.updateFacing();
  assert.equal(employee.sprite.texture.key, "employee_tavi");
});

test("a stock clerk stocks a sold-out item before topping up one that's still on the shelf", () => {
  const { employee, shelf, crate } = makeEmployee({ shelfQuantity: 1, shelfPlacementCount: 2 });
  shelf.placements[1].itemId = "amo_02";
  shelf.placements[1].quantity = 0;
  const soldOutCrate = Object.assign(makeDeliveryCrate(5), { itemId: "amo_02" });
  employee.scene.restockCrates = [crate, soldOutCrate];
  const job = employee.findStockingJob();
  assert.equal(job.crate, soldOutCrate);
  assert.equal(job.placement, shelf.placements[1]);
});

test("a stock clerk takes a delivery crate straight to its matching shelf spot", () => {
  const { employee, shelf, crate, transfers } = makeEmployee();
  employee.startNextTask();

  assert.equal(employee.state, "TO_CRATE");
  assert.equal(employee.currentJob.placement, shelf.placements[0]);
  employee.arriveAtDestination();
  assert.equal(employee.state, "TO_SHELF");

  employee.stockCrateOnShelf();
  assert.equal(shelf.placements[0].quantity, 3);
  assert.equal(crate.quantity, 2);
  assert.equal(employee.state, "TO_RETURN_CRATE");
  assert.equal(crate.isCarried, true);
  employee.arriveAtDestination();
  assert.equal(crate.lockedToPad, false);
  assert.equal(employee.state, "IDLE");
  assert.deepEqual(transfers, [
    {
      itemId: "amo_01",
      quantity: 3,
      source: "loading-pad",
      destination: "shelf",
      sourceId: crate.id,
      destinationId: shelf.placements[0].id,
      sourceLocation: { kind: "carried", holderId: "tavi_stock_clerk" },
      destinationLocation: { kind: "shelf-slot", shelfId: shelf.id, slotId: shelf.placements[0].id },
    },
  ]);
});

test("a stock clerk returns a partly used crate and takes it to another open shelf spot", () => {
  const { employee, shelf, crate } = makeEmployee({
    crateQuantity: 6,
    shelfCapacity: 3,
    shelfPlacementCount: 2,
  });

  employee.startNextTask();
  employee.arriveAtDestination();
  employee.stockCrateOnShelf();
  assert.equal(shelf.placements[0].quantity, 3);
  assert.equal(crate.quantity, 3);
  assert.equal(employee.state, "TO_RETURN_CRATE");
  employee.arriveAtDestination();
  assert.equal(crate.lockedToPad, false);

  employee.startNextTask();
  assert.equal(employee.currentJob.placement, shelf.placements[1]);
  employee.arriveAtDestination();
  employee.stockCrateOnShelf();

  assert.deepEqual(shelf.placements.map(({ quantity }) => quantity), [3, 3]);
  assert.equal(employee.state, "TO_TRASHCAN");
  employee.arriveAtDestination();
  assert.equal(crate.destroyed, true);
});

test("a stock clerk does not take stock for a shelf slot reserved by another employee", () => {
  const { employee, shelf } = makeEmployee({
    crateQuantity: 10,
    shelfCapacity: 3,
    shelfPlacementCount: 2,
  });
  employee.scene.employees.push({
    currentJob: { placement: shelf.placements[1] },
  });

  employee.startNextTask();
  employee.arriveAtDestination();
  assert.equal(employee.currentJob.placement, shelf.placements[0]);
  assert.equal(employee.state, "TO_SHELF");
});

test("a stock clerk stocks from loose crates resting anywhere, returned loose", () => {
  const { employee, shelf, crate } = makeEmployee();
  crate.lockedToPad = false;
  employee.startNextTask();
  assert.equal(employee.state, "TO_CRATE");
  employee.arriveAtDestination();
  assert.equal(employee.state, "TO_SHELF");
  employee.stockCrateOnShelf();
  assert.equal(shelf.placements[0].quantity, 3);
  assert.equal(employee.state, "TO_RETURN_CRATE");
  employee.arriveAtDestination();
  assert.equal(crate.lockedToPad, false, "a loose crate is set back down loose, not pad-locked");
});

test("a stock clerk unstacks a pile from the top and restacks the leftover", () => {
  const { employee, shelf, crate: base } = makeEmployee({ crateQuantity: 9 });
  base.lockedToPad = false;
  const top = makeDeliveryCrate(5);
  top.lockedToPad = false;
  top.isCarried = true; // a crate on a pile rides the crate below it
  const scene = employee.scene;
  scene.floorStacks = new Map([[base, [top]]]);
  scene.syncFloorStacks = () => {};

  employee.startNextTask();
  assert.equal(employee.currentJob.crate, top, "the pile is taken from the top");
  employee.arriveAtDestination();
  assert.equal(employee.state, "TO_SHELF");
  assert.equal(scene.floorStacks.has(base), false, "the top crate left its pile");

  employee.stockCrateOnShelf(); // shelf fits 3 of its 5, so 2 come back
  assert.equal(shelf.placements[0].quantity, 3);
  assert.equal(top.quantity, 2);
  assert.equal(employee.state, "TO_RETURN_CRATE");
  employee.arriveAtDestination();
  assert.deepEqual(scene.floorStacks.get(base), [top], "the leftover goes back on its pile");
  assert.equal(top.lockedToPad, false);
});

test("a stock clerk waits when no matching delivery crate or shelf space is available", () => {
  const noStock = makeEmployee({ crateQuantity: 0 });
  noStock.employee.startNextTask();
  assert.equal(noStock.employee.state, "TO_BREAKROOM");
  assert.equal(noStock.employee.currentJob, null);

  const fullShelf = makeEmployee({ shelfQuantity: 3 });
  fullShelf.employee.startNextTask();
  assert.equal(fullShelf.employee.state, "TO_BREAKROOM");
  assert.equal(fullShelf.employee.currentJob, null);
});

test("employees walk into the backroom to take a break and return when work opens", () => {
  const { employee, crate } = makeEmployee({ crateQuantity: 0 });

  employee.startNextTask();
  assert.equal(employee.state, "TO_BREAKROOM");
  employee.update(16);
  assert.equal(employee.state, "ON_BREAK");
  assert.equal(employee.sprite.visible, false);

  crate.quantity = 5;
  crate.lockedToPad = true;
  employee.update(100);
  assert.equal(employee.state, "TO_CRATE");
  assert.equal(employee.sprite.visible, true);
});

test("an employee heading to break finishes walking and can clock out after closing", () => {
  const { employee } = makeEmployee({ crateQuantity: 0 });
  employee.sprite.x = 100;
  employee.scene.findPath = () => [{
    x: 90, y: 20, teleportTo: { x: 20, y: 20 },
  }];
  employee.startNextTask();
  employee.requestClockOut();

  employee.update(100);
  assert.equal(employee.state, "TO_BREAKROOM");
  assert.ok(employee.sprite.body.velocity.x < 0);
  assert.equal(employee.isReadyToClockOut(), false);

  employee.sprite.x = 90;
  employee.update(100);
  assert.deepEqual({ x: employee.sprite.x, y: employee.sprite.y }, { x: 20, y: 20 });
  employee.update(100);
  assert.equal(employee.state, "ON_BREAK");
  assert.equal(employee.sprite.visible, false);
  assert.equal(employee.isReadyToClockOut(), true);
});

test("an employee on break serves customers who reach the register after closing", () => {
  const { employee, completedSales } = makeEmployee({ crateQuantity: 0, hasRegister: true });
  employee.startNextTask();
  employee.update(16);
  assert.equal(employee.state, "ON_BREAK");

  employee.requestClockOut();
  const customer = { cart: [{ itemId: "amo_01", price: 4 }] };
  employee.scene.checkoutSystem.lineFor(employee.scene.fixtures.register()).push(customer);
  employee.update(100);
  assert.equal(employee.state, "TO_REGISTER");
  assert.equal(employee.currentJob.customer, customer);
  assert.equal(employee.sprite.visible, true);
  assert.equal(employee.isReadyToClockOut(), false);

  employee.beginRegisterService();
  employee.update(REGISTER_SERVICE_MS_PER_ITEM);
  assert.deepEqual(completedSales, [{ employee, customer }]);
  assert.equal(employee.isReadyToClockOut(), true);
});

test("an employee heading to break can turn around to serve a customer after closing", () => {
  const { employee } = makeEmployee({ crateQuantity: 0, hasRegister: true });
  employee.sprite.x = 100;
  employee.startNextTask();
  employee.requestClockOut();
  const customer = { cart: [{ itemId: "amo_01", price: 4 }] };
  employee.scene.checkoutSystem.lineFor(employee.scene.fixtures.register()).push(customer);

  employee.update(100);
  assert.equal(employee.state, "TO_REGISTER");
  assert.equal(employee.currentJob.customer, customer);
  assert.equal(employee.isReadyToClockOut(), false);
});

test("an employee on break waits while the player is using the register", () => {
  const { employee } = makeEmployee({ crateQuantity: 0, hasRegister: true });
  employee.startNextTask();
  employee.update(16);
  employee.requestClockOut();
  employee.scene.checkoutSystem.lineFor(employee.scene.fixtures.register()).push({ cart: [{ itemId: "amo_01", price: 4 }] });
  employee.scene.checkoutSystem.operatingRegister = true;

  employee.update(100);
  assert.equal(employee.state, "ON_BREAK");
  assert.equal(employee.sprite.visible, false);

  employee.scene.checkoutSystem.operatingRegister = false;
  employee.update(16);
  assert.equal(employee.state, "TO_REGISTER");
  assert.equal(employee.sprite.visible, true);
});

test("an employee on break does not start new stocking work after closing", () => {
  const { employee, crate } = makeEmployee({ crateQuantity: 0 });
  employee.startNextTask();
  employee.update(16);
  employee.requestClockOut();
  crate.quantity = 5;

  employee.update(100);
  assert.equal(employee.state, "ON_BREAK");
  assert.equal(employee.sprite.visible, false);
  assert.equal(employee.isReadyToClockOut(), true);
  assert.equal(crate.quantity, 5);
});

test("an employee heading to break does not start new stocking work after closing", () => {
  const { employee, crate } = makeEmployee({ crateQuantity: 0 });
  employee.sprite.x = 100;
  employee.startNextTask();
  employee.requestClockOut();
  crate.quantity = 5;

  employee.update(100);
  assert.equal(employee.state, "TO_BREAKROOM");
  assert.equal(employee.currentJob, null);
  assert.ok(employee.sprite.body.velocity.x < 0);
  assert.equal(crate.quantity, 5);
});

test("clocking out carries a partly stocked delivery into the backroom, freeing the Loading Pad", () => {
  const { employee, shelf, crate } = makeEmployee();
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.requestClockOut();
  employee.stockCrateOnShelf();
  assert.equal(shelf.placements[0].quantity, 3);
  assert.equal(crate.quantity, 2);
  assert.equal(employee.state, "TO_RETURN_CRATE");
  assert.equal(employee.isReadyToClockOut(), false);
  employee.arriveAtDestination();
  assert.deepEqual(crate.sprite, { x: 96, y: 6560 });
  assert.equal(crate.lockedToPad, false);
  assert.equal(employee.isReadyToClockOut(), true);
});

test("a stock clerk carries an empty crate to the nearest trashcan", () => {
  const far = { id: "trash-far", type: "trash_can", gx: 10, gy: 1 };
  const near = { id: "trash-near", type: "trash_can", gx: 2, gy: 1 };
  const { employee, crate } = makeEmployee({ crateQuantity: 3, trashcans: [far, near] });
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.stockCrateOnShelf();

  assert.equal(employee.state, "TO_TRASHCAN");
  assert.equal(employee.currentJob.trashcan, near);
  assert.equal(crate.isCarried, true);
  employee.arriveAtDestination();
  assert.equal(crate.destroyed, true);
  assert.equal(employee.state, "IDLE");
});

test("staff skip routing to same-room spots that cannot beat the best walk, keeping ties and doors exact", () => {
  const { employee } = makeEmployee();
  employee.sprite.body.center = { x: 0, y: 0 };
  const calls = [];
  const routes = new Map();
  employee.scene.findPath = (fromX, fromY, toX, toY) => {
    calls.push(`${toX},${toY}`);
    return routes.has(`${toX},${toY}`) ? routes.get(`${toX},${toY}`) : [];
  };
  employee.scene.areas.areaAt = (x) => x >= 1000 ? "upstairs" : "shop";

  const blocked = { x: 10, y: 0 };
  const tieFirst = { x: 0, y: 30 };
  const tieSecond = { x: 30, y: 0 };
  const far = { x: 200, y: 0 };
  routes.set("10,0", null);
  let result = employee.findClosestSpot([far, tieSecond, blocked, tieFirst]);
  assert.equal(result.spot, tieSecond, "equal walks keep the earliest listed spot");
  assert.deepEqual(calls, ["10,0", "30,0", "0,30"], "the far spot is never routed");

  calls.length = 0;
  const upstairs = { x: 1005, y: 0 };
  routes.set("1005,0", [{ x: 2, y: 0, teleportTo: { x: 1000, y: 0 } }]);
  result = employee.findClosestSpot([tieSecond, upstairs]);
  assert.equal(result.spot, upstairs, "a short walk through a door still wins");
  assert.equal(result.length, 7);
  assert.deepEqual(calls, ["1005,0"], "a same-room spot farther than the door walk is skipped");
});

test("employees reach tight corners before turning and cap their final movement step", () => {
  const { employee } = makeEmployee();
  employee.state = "TO_TRASHCAN";
  employee.destination = { x: 28, y: 100 };
  employee.path = [{ x: 28, y: 20 }];
  employee.followPath(100);
  assert.equal(employee.path.length, 1, "an 8px-away corner is not skipped");
  assert.equal(employee.sprite.body.velocity.x, 80, "cannot overshoot the corner on a long frame");
  assert.equal(employee.sprite.body.velocity.y, 0);
  employee.sprite.x = 24;
  employee.followPath(100);
  assert.equal(employee.path.length, 1, "even a corner within 6px must be reached");
  assert.equal(employee.sprite.body.velocity.x, 40);
  employee.sprite.x = 28;
  employee.followPath(16);
  assert.equal(employee.path.length, 0);
});

test("a blocked employee promptly replans from its actual physics position", () => {
  const { employee } = makeEmployee();
  employee.state = "TO_TRASHCAN";
  employee.destination = { x: 100, y: 100 };
  employee.path = [];
  employee.sprite.body.center = { x: 30, y: 25 };
  employee.sprite.body.blocked = { right: true };
  const calls = [];
  employee.scene.findPath = (...args) => { calls.push(args); return [{ x: 30, y: 80 }]; };
  employee.followPath(16);
  assert.deepEqual(calls[0], [30, 25, 100, 100, {
    width: PLAYER_BODY_WIDTH, height: PLAYER_BODY_HEIGHT, avoidStoreDoor: true,
  }]);
  assert.equal(employee.sprite.body.velocity.x, 0);
  assert.equal(employee.sprite.body.velocity.y, 120);
});

test("delivery leftovers fill a backroom stack before using an empty floor spot", () => {
  const { employee, crate } = makeEmployee();
  const base = makeDeliveryCrate(9);
  base.lockedToPad = false;
  base.sprite = { x: 96, y: 6560 };
  employee.scene.restockCrates.push(base);
  employee.scene.checkoutSystem.findGoBacksSpot = () => assert.fail("Stacking must be attempted before empty floor");
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.stockCrateOnShelf();
  assert.equal(employee.currentJob.returnBase, base);
  employee.arriveAtDestination();
  assert.deepEqual(employee.scene.floorStacks.get(base), [crate]);
  assert.equal(crate.isCarried, true);
  assert.equal(employee.scene.restockCrates.includes(crate), false);
});

test("full stacks and Loading Pad crates cannot be return targets", () => {
  const { employee, crate } = makeEmployee();
  const fullBase = makeDeliveryCrate(9);
  fullBase.lockedToPad = false;
  const padCrate = makeDeliveryCrate(9);
  employee.scene.restockCrates.push(fullBase, padCrate);
  employee.scene.floorStacks.set(fullBase, [makeDeliveryCrate(), makeDeliveryCrate()]);
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.stockCrateOnShelf();
  assert.equal(employee.currentJob.returnBase, null);
  assert.deepEqual(employee.currentJob.returnPosition, { x: 96, y: 6560 });
  employee.arriveAtDestination();
  assert.equal(employee.scene.floorStacks.get(fullBase).length, 2);
  assert.equal(crate.lockedToPad, false);
});

test("an employee replans a return if the chosen stack fills while they are carrying", () => {
  const { employee, crate } = makeEmployee();
  const base = makeDeliveryCrate(9);
  base.lockedToPad = false;
  employee.scene.restockCrates.push(base);
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.stockCrateOnShelf();
  employee.scene.floorStacks.set(base, [makeDeliveryCrate(), makeDeliveryCrate()]);
  employee.arriveAtDestination();
  assert.equal(employee.state, "TO_RETURN_CRATE");
  assert.equal(crate.isCarried, true);
  assert.equal(employee.currentJob.returnBase, null);
  employee.arriveAtDestination();
  assert.equal(employee.scene.restockCrates.includes(crate), true);
});

test("a full backroom and sales floor never make staff drop a crate on their own feet", () => {
  const { employee, crate } = makeEmployee();
  employee.scene.checkoutSystem.findGoBacksSpot = () => null;
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.stockCrateOnShelf();
  assert.equal(employee.state, "WAITING_CRATE_RETURN");
  assert.equal(crate.isCarried, true);
  assert.equal(employee.isCarryingCrate(), true);
  assert.equal(employee.isReadyToClockOut(), false);
  employee.scene.checkoutSystem.findGoBacksSpot = () => ({ x: 96, y: 6560, inBackroom: true });
  employee.update(1000);
  assert.equal(employee.state, "TO_RETURN_CRATE");
});

test("unreachable return spots keep the crate with its employee until a safe route opens", () => {
  const { employee, crate } = makeEmployee();
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.scene.findPath = () => null;
  employee.stockCrateOnShelf();
  assert.equal(employee.state, "WAITING_CRATE_RETURN");
  assert.equal(employee.currentJob.crate, crate);
  assert.equal(crate.isCarried, true);
});

test("the register is the first job when Tavi's priority order puts it first", () => {
  const { employee, completedSales } = makeEmployee({ hasRegister: true });
  const customer = { cart: [{ itemId: "amo_01", price: 4 }] };
  employee.scene.checkoutSystem.lineFor(employee.scene.fixtures.register()).push(customer);

  employee.startNextTask();
  assert.equal(employee.state, "TO_REGISTER");
  assert.equal(employee.currentJob.customer, customer);

  employee.beginRegisterService();
  assert.equal(employee.state, "SERVING_REGISTER");
  employee.updateRegisterService(REGISTER_SERVICE_MS_PER_ITEM);
  assert.equal(employee.state, "IDLE");
  assert.deepEqual(completedSales, [{ employee, customer }]);
});

test("trained skills speed up only their own stocking trips, delivery trips, and register service", () => {
  const { employee } = makeEmployee({ hasRegister: true });
  employee.data.skillLevels = { stock_shelves: 2, register: 5 };
  employee.destination = { x: 120, y: 20 };
  for (const [state, expectedSpeed] of [
    ["TO_SHELF", 144], ["TO_CRATE", 144], ["TO_BREAKROOM", 120],
  ]) {
    employee.state = state;
    employee.followPath();
    assert.equal(employee.sprite.body.velocity.x, expectedSpeed);
    assert.equal(employee.sprite.body.velocity.y, 0);
  }
  const customer = { cart: [{ itemId: "amo_01", price: 4 }, { itemId: "amo_01", price: 4 }] };
  employee.scene.checkoutSystem.lineFor(employee.scene.fixtures.register()).push(customer);
  employee.currentJob = { jobId: "register", register: employee.scene.fixtures.register(), customer };
  employee.beginRegisterService();
  // Two items at level 5 register speed (2.0x): half the per-item time each.
  assert.equal(employee.registerServiceRemainingMs, REGISTER_SERVICE_MS_PER_ITEM);
});

test("the employee panel offers one selected priority for each saved job order", () => {
  const options = {
    hiredEmployeeIds: ["tavi_stock_clerk"],
    activeEmployeeIds: [],
    employeeJobPriorities: {
      tavi_stock_clerk: ["stock_shelves", "register"],
    },
    credits: 1000,
    canHire: true,
    shopLevel: 4,
  };
  const stocking = EmployeeRenderer.generateHTML(options);
  assert.match(stocking, /data-employee-priority-job="register" aria-pressed="false"/);
  assert.match(stocking, /data-employee-priority-job="stock_shelves" aria-pressed="true"/);
  assert.match(stocking, />Prioritize Register<\/button>/);
  assert.match(stocking, />Prioritize Stocking<\/button>/);

  const register = EmployeeRenderer.generateHTML({
    ...options, employeeJobPriorities: { tavi_stock_clerk: ["register", "stock_shelves"] },
  });
  assert.match(register, /data-employee-priority-job="register" aria-pressed="true"/);
  assert.match(register, /data-employee-priority-job="stock_shelves" aria-pressed="false"/);
  const duringShift = EmployeeRenderer.generateHTML({ ...options, canHire: false });
  assert.match(duringShift, /data-employee-priority-job="register" aria-pressed="false"\s+disabled/);
  assert.match(duringShift, /data-employee-priority-job="stock_shelves" aria-pressed="true"\s+disabled/);

  const twoEmployees = EmployeeRenderer.generateHTML({
    ...options,
    hiredEmployeeIds: ["tavi_stock_clerk", "sera_floor_assistant"],
    shopLevel: 7,
    employeeJobPriorities: {
      tavi_stock_clerk: ["register", "stock_shelves"],
      sera_floor_assistant: ["stock_shelves", "register"],
    },
  });
  assert.match(twoEmployees, /data-employee-priority-id="tavi_stock_clerk"\s+data-employee-priority-job="register" aria-pressed="true"/);
  assert.match(twoEmployees, /data-employee-priority-id="sera_floor_assistant"\s+data-employee-priority-job="stock_shelves" aria-pressed="true"/);
});

test("the employee panel switches staff on and off shift, only between shifts", () => {
  const options = {
    hiredEmployeeIds: ["tavi_stock_clerk"],
    activeEmployeeIds: [],
    employeeJobPriorities: { tavi_stock_clerk: ["register", "stock_shelves"] },
    credits: 1000,
    canHire: true,
    shopLevel: 4,
  };
  const ready = EmployeeRenderer.generateHTML(options);
  assert.match(ready, /data-employee-shift-on="true" aria-pressed="true"/);
  assert.match(ready, /data-employee-shift-on="false" aria-pressed="false"/);
  assert.match(ready, />\s*ON SHIFT\s*<\/button>/);
  assert.match(ready, />\s*OFF SHIFT\s*<\/button>/);
  assert.doesNotMatch(ready, /LET GO|fire|TAKE OFF|PUT ON/i);
  const duringShift = EmployeeRenderer.generateHTML({ ...options, canHire: false });
  assert.match(duringShift, /data-employee-shift-on="false" aria-pressed="false"\s+disabled/);

  const off = EmployeeRenderer.generateHTML({ ...options, offShiftEmployeeIds: ["tavi_stock_clerk"] });
  assert.match(off, /Off Shift: stays home and isn't paid/);
  assert.match(off, /data-employee-shift-on="false" aria-pressed="true"/);

  const training = EmployeeRenderer.generateHTML({ ...options, employeeTraining: { tavi_stock_clerk: "register" } });
  assert.match(training, /AWAY: NOT AVAILABLE/);
  assert.match(training, /Away next shift; wages are still paid/);
  assert.doesNotMatch(training, /data-employee-shift-id/);
});

test("the hiring and staff panels show compact levels without training controls", () => {
  const options = {
    hiredEmployeeIds: ["tavi_stock_clerk"], activeEmployeeIds: [],
    employeeJobPriorities: {}, credits: 1000, canHire: true, shopLevel: 4,
    employeeSkills: { tavi_stock_clerk: { register: 2, stock_shelves: 1 } },
  };
  const html = EmployeeRenderer.generateHTML(options);
  assert.ok(html.indexOf("Staff to Hire") < html.indexOf("Your Staff"));
  assert.equal((html.match(/class="divider-thick employee-panel-divider"/g) || []).length, 1);
  assert.ok(html.indexOf("employee-panel-divider") < html.indexOf('data-employee-scroll="hiring"'));
  assert.match(html, /Sera<\/h3>[\s\S]*?Register:1<\/span>[\s\S]*?Stock:1<\/span>/);
  assert.match(html, /Tavi<\/h3>[\s\S]*?Register:2<\/span>[\s\S]*?Stocking:1<\/span>/);
  assert.match(html, /employee-candidate-wage">50<\/div>/);
  assert.match(html, /employee-hire-cost">250<\/div>/);
  assert.doesNotMatch(html, /Skills:|data-train-employee|data-confirm-employee-training|credits per shift/);
  assert.doesNotMatch(html.slice(html.indexOf("Your Staff")), /On Shift: works and is paid each shift/);
});

test("skill levels speed up shelf stocking and register service", () => {
  const { getEmployeeJobSpeed } = EmployeeTraining;
  assert.equal(getEmployeeJobSpeed({ register: 3 }, "register"), 1.5);
  assert.equal(getEmployeeJobSpeed({ register: 5 }, "register"), 2);
  assert.equal(getEmployeeJobSpeed({ stock_shelves: 3 }, "stock_shelves"), 1.4);
  assert.equal(getEmployeeJobSpeed({ stock_shelves: 5 }, "stock_shelves"), 1.8);
  const html = EmployeeRenderer.generateHTML({
    hiredEmployeeIds: ["tavi_stock_clerk"],
    activeEmployeeIds: [],
    employeeJobPriorities: {},
    credits: 5000,
    canHire: true,
    shopLevel: 4,
    employeeSkills: {
      tavi_stock_clerk: { register: 3, stock_shelves: 5 },
    },
  });
  assert.match(html, /Register:3<\/span>/);
  assert.match(html, /Stocking:5<\/span>/);
});

test("the employee panel explains the Shop Level 4 staff limit before anyone can be hired", () => {
  const options = {
    hiredEmployeeIds: [],
    activeEmployeeIds: [],
    employeeJobPriorities: {},
    credits: 1000,
    canHire: true,
  };
  const locked = EmployeeRenderer.generateHTML({ ...options, shopLevel: 1 });
  assert.match(locked, /can(?:'|&#39;)t have employees yet/);
  assert.match(locked, /Shop Level 4/);
  assert.match(locked, /72 store reputation/);
  assert.match(locked, /Hired: 0 of 0/);
  assert.match(locked, /data-hire-employee-id="kel_supply_runner"[\s\S]*?disabled/);
  assert.match(locked, />\s*FULL\s*<\/button>/);

  const unlocked = EmployeeRenderer.generateHTML({ ...options, shopLevel: 4 });
  for (const id of ["tavi_stock_clerk", "kel_supply_runner"]) {
    assert.doesNotMatch(unlocked, new RegExp(`data-hire-employee-id="${id}"[^>]*disabled`));
  }
  const hireCosts = [...unlocked.matchAll(/class="type-description employee-hire-cost">([^<]+)<\/div>/g)]
    .map(([, cost]) => cost);
  assert.deepEqual(hireCosts, Array(6).fill("250"));
  assert.match(unlocked, />\s*HIRE\s*<\/button>/);

  const unaffordable = EmployeeRenderer.generateHTML({ ...options, shopLevel: 4, credits: 249.75 });
  assert.match(unaffordable, /You need 0\.25 more/);
  assert.doesNotMatch(unaffordable, /credits/i);
  assert.match(unaffordable, /data-hire-employee-id="tavi_stock_clerk"\s+disabled/);
});

test("each staff-limit Shop Level allows one more hire", () => {
  const options = {
    activeEmployeeIds: [],
    employeeJobPriorities: {},
    credits: 10000,
    canHire: true,
  };
  const others = ["sera_floor_assistant", "dax_stock_clerk", "ivo_shop_assistant", "rhea_senior_clerk"];
  [7, 10, 15, 18, 23].forEach((level, index) => {
    const hired = ["tavi_stock_clerk", ...others.slice(0, index)];
    const full = EmployeeRenderer.generateHTML({
      ...options, hiredEmployeeIds: hired, offShiftEmployeeIds: ["tavi_stock_clerk"], shopLevel: level - 1,
    });
    assert.match(full, new RegExp(`Reach Shop Level ${level}`));
    assert.match(full, /data-hire-employee-id="kel_supply_runner"[^>]*disabled/);
    const open = EmployeeRenderer.generateHTML({ ...options, hiredEmployeeIds: hired, shopLevel: level });
    assert.doesNotMatch(open, /data-hire-employee-id="kel_supply_runner"[^>]*disabled/);
  });
});

test("an employee reaching a door waypoint steps through to the other side", () => {
  const { employee } = makeEmployee();
  const resets = [];
  employee.sprite.body.reset = (x, y) => { resets.push({ x, y }); employee.sprite.x = x; employee.sprite.y = y; };
  employee.sprite.x = 20;
  employee.sprite.y = 20;
  employee.path = [{ x: 20, y: 20, teleportTo: { x: 900, y: 96 } }];
  employee.destination = { x: 900, y: 300 };
  employee.followPath();
  assert.deepEqual(resets, [{ x: 900, y: 96 }]);
  assert.equal(employee.path.length, 0);
});