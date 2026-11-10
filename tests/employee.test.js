import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventBus, GAME_EVENTS } from "../js/logic/EventBus.js";
import { createServer } from "vite";

let server;
let cacheDirectory;
let Employee;
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
          return "export const pickRandomCustomerCharacter = () => ({ facingTextures: { down: 'down', up: 'up', left: 'left', right: 'right' } });";
        }
      },
    }],
  });
  ({ Employee } = await server.ssrLoadModule("/js/logic/Employee.js"));
  ({ EmployeeRenderer } = await server.ssrLoadModule("/js/logic/EmployeeRenderer.js"));
  EmployeeTraining = await server.ssrLoadModule("/js/logic/EmployeeTraining.js");
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

function makeShelf(quantity = 0, capacity = 3, placementCount = 1) {
  const placements = Array.from({ length: placementCount }, () => ({
    itemId: "amo_01",
    quantity,
  }));
  return {
    type: "shelf_starter_2x1",
    standPoint: { x: 100, y: 100 },
    placements,
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

function makeLocker(quantity = 5) {
  const entry = { itemId: "amo_01", quantity };
  return {
    type: "locker_single",
    standPoint: { x: 40, y: 40 },
    stock: [entry],
    getAvailableUnitsFor(itemId) {
      return itemId === entry.itemId ? entry.quantity : 0;
    },
    getRemainingUnitsFor() {
      return 20;
    },
    remove(itemId, amount) {
      const removed = Math.min(this.getAvailableUnitsFor(itemId), amount);
      entry.quantity -= removed;
      return removed;
    },
    add(itemId, amount) {
      if (itemId !== entry.itemId) return 0;
      entry.quantity += amount;
      return amount;
    },
  };
}

function makeEmployee({
  shelfQuantity = 0,
  shelfCapacity = 3,
  shelfPlacementCount = 1,
  lockerQuantity = 5,
  jobPriorities = ["register", "stock_shelves", "load_storage"],
  hasRegister = false,
} = {}) {
  const shelf = makeShelf(shelfQuantity, shelfCapacity, shelfPlacementCount);
  const locker = makeLocker(lockerQuantity);
  const transfers = [];
  const completedSales = [];
  const eventBus = new EventBus();
  eventBus.on(GAME_EVENTS.INVENTORY_TRANSFERRED, (event) => transfers.push(event));
  const scene = {
    backroomDoor: { x: 20, y: 20 },
    backroomExitFront: { x: 20, y: 20 },
    eventBus,
    fixtures: {
      shelves: () => [shelf],
      stockHolders: () => [shelf, locker],
      register: () => hasRegister ? { id: "register" } : null,
    },
    employees: [],
    registerLine: [],
    operatingRegister: false,
    restockCrates: [],
    findPath: () => [],
    getBehindRegisterPoint: () => ({ x: 80, y: 80 }),
    completeEmployeeCheckout(employee, customer) {
      completedSales.push({ employee, customer });
      return true;
    },
    playerState: {
      employeeJobPriorities: { tavi_stock_clerk: jobPriorities },
      notifyListeners() {},
    },
    refreshLockerCapacityDisplay() {},
    refreshShelfStockDisplay() {},
    add: {
      image: (x, y) => ({
        x,
        y,
        setDisplaySize() { return this; },
        setTint() { return this; },
        setDepth() { return this; },
        setTexture() { return this; },
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
  const employee = new Employee(scene, {
    id: "tavi_stock_clerk",
    name: "Tavi",
    backpackCapacity: 10,
  });
  scene.employees = [employee];
  return { employee, shelf, locker, transfers, completedSales };
}

test("a stock clerk takes only the shelf's free quantity from a locker and fills that slot", () => {
  const { employee, shelf, locker, transfers } = makeEmployee();
  employee.startNextTask();

  assert.equal(employee.state, "TO_STORAGE");
  assert.equal(employee.currentJob.placement, shelf.placements[0]);
  employee.takeStockFromLocker();
  assert.equal(locker.stock[0].quantity, 2);
  assert.equal(employee.backpack.getAvailableUnitsFor("amo_01"), 3);
  assert.equal(employee.state, "TO_SHELF");

  employee.stockShelf();
  assert.equal(shelf.placements[0].quantity, 3);
  assert.equal(employee.backpack.usedCapacity(), 0);
  assert.equal(employee.state, "IDLE");
  assert.deepEqual(transfers, [
    {
      itemId: "amo_01",
      quantity: 3,
      source: "locker",
      destination: "employee-backpack",
    },
    {
      itemId: "amo_01",
      quantity: 3,
      source: "employee-backpack",
      destination: "shelf",
    },
  ]);
});

test("a stock clerk carries enough stock to fill multiple open shelf slots per trip", () => {
  const { employee, shelf, locker } = makeEmployee({
    lockerQuantity: 10,
    shelfCapacity: 3,
    shelfPlacementCount: 2,
  });

  employee.startNextTask();
  employee.takeStockFromLocker();

  assert.equal(employee.backpack.getAvailableUnitsFor("amo_01"), 6);
  assert.equal(locker.stock[0].quantity, 4);

  employee.stockShelf();
  assert.equal(shelf.placements[0].quantity, 3);
  assert.equal(employee.backpack.getAvailableUnitsFor("amo_01"), 3);

  employee.startNextTask();
  assert.equal(employee.currentJob.placement, shelf.placements[1]);
  employee.stockShelf();

  assert.deepEqual(shelf.placements.map(({ quantity }) => quantity), [3, 3]);
  assert.equal(employee.backpack.usedCapacity(), 0);
});

test("a stock clerk does not take stock for a shelf slot reserved by another employee", () => {
  const { employee, shelf } = makeEmployee({
    lockerQuantity: 10,
    shelfCapacity: 3,
    shelfPlacementCount: 2,
  });
  employee.scene.employees.push({
    currentJob: { placement: shelf.placements[1] },
  });

  employee.startNextTask();
  employee.takeStockFromLocker();

  assert.equal(employee.currentJob.placement, shelf.placements[0]);
  assert.equal(employee.backpack.getAvailableUnitsFor("amo_01"), 3);
});

test("a stock clerk waits when no matching locker stock or shelf space is available", () => {
  const noStock = makeEmployee({ lockerQuantity: 0 });
  noStock.employee.startNextTask();
  assert.equal(noStock.employee.state, "TO_BREAKROOM");
  assert.equal(noStock.employee.currentJob, null);

  const fullShelf = makeEmployee({ shelfQuantity: 3 });
  fullShelf.employee.startNextTask();
  assert.equal(fullShelf.employee.state, "TO_BREAKROOM");
  assert.equal(fullShelf.employee.currentJob, null);
});

test("employees walk into the backroom to take a break and return when work opens", () => {
  const { employee, locker } = makeEmployee({ lockerQuantity: 0 });

  employee.startNextTask();
  assert.equal(employee.state, "TO_BREAKROOM");
  employee.update(16);
  assert.equal(employee.state, "ON_BREAK");
  assert.equal(employee.sprite.visible, false);

  locker.stock[0].quantity = 5;
  employee.update(100);
  assert.equal(employee.state, "TO_STORAGE");
  assert.equal(employee.sprite.visible, true);
});

test("an employee heading to break finishes walking and can clock out after closing", () => {
  const { employee } = makeEmployee({ lockerQuantity: 0 });
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
  const { employee, completedSales } = makeEmployee({ lockerQuantity: 0, hasRegister: true });
  employee.startNextTask();
  employee.update(16);
  assert.equal(employee.state, "ON_BREAK");

  employee.requestClockOut();
  const customer = { cart: [{ itemId: "amo_01", price: 4 }] };
  employee.scene.registerLine.push(customer);
  employee.update(100);
  assert.equal(employee.state, "TO_REGISTER");
  assert.equal(employee.currentJob.customer, customer);
  assert.equal(employee.sprite.visible, true);
  assert.equal(employee.isReadyToClockOut(), false);

  employee.beginRegisterService();
  employee.update(1000);
  assert.deepEqual(completedSales, [{ employee, customer }]);
  assert.equal(employee.isReadyToClockOut(), true);
});

test("an employee heading to break can turn around to serve a customer after closing", () => {
  const { employee } = makeEmployee({ lockerQuantity: 0, hasRegister: true });
  employee.sprite.x = 100;
  employee.startNextTask();
  employee.requestClockOut();
  const customer = { cart: [{ itemId: "amo_01", price: 4 }] };
  employee.scene.registerLine.push(customer);

  employee.update(100);
  assert.equal(employee.state, "TO_REGISTER");
  assert.equal(employee.currentJob.customer, customer);
  assert.equal(employee.isReadyToClockOut(), false);
});

test("an employee on break waits while the player is using the register", () => {
  const { employee } = makeEmployee({ lockerQuantity: 0, hasRegister: true });
  employee.startNextTask();
  employee.update(16);
  employee.requestClockOut();
  employee.scene.registerLine.push({ cart: [{ itemId: "amo_01", price: 4 }] });
  employee.scene.operatingRegister = true;

  employee.update(100);
  assert.equal(employee.state, "ON_BREAK");
  assert.equal(employee.sprite.visible, false);

  employee.scene.operatingRegister = false;
  employee.update(16);
  assert.equal(employee.state, "TO_REGISTER");
  assert.equal(employee.sprite.visible, true);
});

test("an employee on break does not start new stocking work after closing", () => {
  const { employee, locker } = makeEmployee({ lockerQuantity: 0 });
  employee.startNextTask();
  employee.update(16);
  employee.requestClockOut();
  locker.stock[0].quantity = 5;

  employee.update(100);
  assert.equal(employee.state, "ON_BREAK");
  assert.equal(employee.sprite.visible, false);
  assert.equal(employee.isReadyToClockOut(), true);
  assert.equal(locker.stock[0].quantity, 5);
});

test("an employee heading to break does not start new stocking work after closing", () => {
  const { employee, locker } = makeEmployee({ lockerQuantity: 0 });
  employee.sprite.x = 100;
  employee.startNextTask();
  employee.requestClockOut();
  locker.stock[0].quantity = 5;

  employee.update(100);
  assert.equal(employee.state, "TO_BREAKROOM");
  assert.equal(employee.currentJob, null);
  assert.ok(employee.sprite.body.velocity.x < 0);
  assert.equal(locker.stock[0].quantity, 5);
});

test("clocking out waits for locker space before returning stock", () => {
  const { employee, locker } = makeEmployee();
  employee.backpack.add("amo_01", 1);
  locker.getRemainingUnitsFor = () => 0;
  employee.requestClockOut();
  employee.update(1000);

  assert.equal(employee.state, "IDLE");
  assert.equal(employee.isReadyToClockOut(), false);
  assert.equal(employee.backpack.getAvailableUnitsFor("amo_01"), 1);

  locker.getRemainingUnitsFor = () => 20;
  employee.update(1000);
  assert.equal(employee.state, "TO_RETURN");
  employee.finishReturningStock();
  assert.equal(locker.stock[0].quantity, 6);
  assert.equal(employee.isReadyToClockOut(), true);
});

test("the register is the first job when Tavi's priority order puts it first", () => {
  const { employee, completedSales } = makeEmployee({ hasRegister: true });
  const customer = { cart: [{ itemId: "amo_01", price: 4 }] };
  employee.scene.registerLine.push(customer);

  employee.startNextTask();
  assert.equal(employee.state, "TO_REGISTER");
  assert.equal(employee.currentJob.customer, customer);

  employee.beginRegisterService();
  assert.equal(employee.state, "SERVING_REGISTER");
  employee.updateRegisterService(1000);
  assert.equal(employee.state, "IDLE");
  assert.deepEqual(completedSales, [{ employee, customer }]);
});

test("trained skills speed up only their own stocking trips, delivery trips, and register service", () => {
  const { employee } = makeEmployee({ hasRegister: true });
  employee.data.skillLevels = { stock_shelves: 2, load_storage: 3, register: 5 };
  employee.destination = { x: 120, y: 20 };
  for (const [state, expectedSpeed] of [
    ["TO_STORAGE", 144], ["TO_SHELF", 144], ["TO_RETURN", 144],
    ["TO_CRATE", 180], ["TO_STORAGE_CRATE", 180], ["TO_BREAKROOM", 120],
  ]) {
    employee.state = state;
    employee.followPath();
    assert.equal(employee.sprite.body.velocity.x, expectedSpeed);
    assert.equal(employee.sprite.body.velocity.y, 0);
  }
  const customer = { cart: [{ itemId: "amo_01", price: 4 }, { itemId: "amo_01", price: 4 }] };
  employee.scene.registerLine = [customer];
  employee.currentJob = { jobId: "register", customer };
  employee.beginRegisterService();
  assert.equal(employee.registerServiceRemainingMs, 1000);
});

test("loading storage moves a delivered crate into a locker and removes an empty crate", () => {
  const { employee, locker } = makeEmployee({
    jobPriorities: ["load_storage", "stock_shelves", "register"],
  });
  let lockerSpace = 20;
  locker.getRemainingUnitsFor = () => lockerSpace;
  const crateStock = { itemId: "amo_01", quantity: 4 };
  const crate = {
    kind: "item",
    lockedToPad: true,
    itemId: "amo_01",
    quantity: 4,
    sprite: { x: 40, y: 40 },
    getAvailableUnitsFor(itemId) {
      return itemId === crateStock.itemId ? crateStock.quantity : 0;
    },
    remove(itemId, amount) {
      const removed = Math.min(this.getAvailableUnitsFor(itemId), amount);
      crateStock.quantity -= removed;
      this.quantity = crateStock.quantity;
      return removed;
    },
    add(itemId, amount) {
      if (itemId !== crateStock.itemId) return 0;
      crateStock.quantity += amount;
      this.quantity = crateStock.quantity;
      return amount;
    },
    pickUp() {
      this.isCarried = true;
      this.lockedToPad = false;
      return true;
    },
    followCarrier() {},
    drop() { this.isCarried = false; },
    lockToPad() { this.lockedToPad = true; },
    destroy() { this.destroyed = true; },
  };
  employee.scene.restockCrates = [crate];

  employee.startNextTask();
  assert.equal(employee.state, "TO_CRATE");
  employee.arriveAtDestination();
  assert.equal(employee.state, "TO_STORAGE_CRATE");
  lockerSpace = 2;
  employee.loadCrateIntoStorage();

  assert.equal(locker.stock[0].quantity, 7);
  assert.equal(crate.quantity, 2);
  assert.equal(crate.destroyed, undefined);
  assert.equal(crate.lockedToPad, true);
  assert.deepEqual(employee.scene.restockCrates, [crate]);

  lockerSpace = 20;
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.loadCrateIntoStorage();

  assert.equal(locker.stock[0].quantity, 9);
  assert.equal(crate.destroyed, true);
  assert.deepEqual(employee.scene.restockCrates, []);
  assert.deepEqual(employee.state, "IDLE");
});

test("the employee panel lists all three jobs in the saved priority order", () => {
  const html = EmployeeRenderer.generateHTML({
    hiredEmployeeIds: ["tavi_stock_clerk"],
    activeEmployeeIds: [],
    employeeJobPriorities: {
      tavi_stock_clerk: ["load_storage", "register", "stock_shelves"],
    },
    credits: 1000,
    canHire: true,
    shopLevel: 1,
  });
  assert.ok(html.indexOf("1. Load storage") < html.indexOf("2. Run register"));
  assert.ok(html.indexOf("2. Run register") < html.indexOf("3. Stock shelves"));
  assert.match(html, /data-employee-priority-job="load_storage"/);
  assert.match(html, /data-employee-priority-job="load_storage" data-employee-priority-direction="1"\s+aria-label/);
});

test("the employee panel switches staff on and off shift, only between shifts", () => {
  const options = {
    hiredEmployeeIds: ["tavi_stock_clerk"],
    activeEmployeeIds: [],
    employeeJobPriorities: { tavi_stock_clerk: ["register", "stock_shelves", "load_storage"] },
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
  assert.doesNotMatch(off, /data-train-employee-job="register" disabled/);

  const training = EmployeeRenderer.generateHTML({ ...options, employeeTraining: { tavi_stock_clerk: "register" } });
  assert.match(training, /IN TRAINING: NOT AVAILABLE/);
  assert.doesNotMatch(training, /data-employee-shift-id/);
});

test("the employee panel shows skill levels and training commitments", () => {
  const options = {
    hiredEmployeeIds: ["tavi_stock_clerk"], activeEmployeeIds: [],
    employeeJobPriorities: {}, credits: 1000, canHire: true, shopLevel: 4,
    employeeSkills: { tavi_stock_clerk: { register: 2, stock_shelves: 1, load_storage: 1 } },
  };
  const html = EmployeeRenderer.generateHTML({
    ...options, trainingConfirmation: { employeeId: "tavi_stock_clerk", jobId: "register" },
  });
  assert.match(html, /Run register: Level 2\/5/);
  assert.match(html, /20% faster register service/);
  assert.match(html, /375 credits now/);
  assert.match(html, /After training, wages become 60 credits/);
  assert.doesNotMatch(html, /Rehiring/);
  assert.match(html, /data-confirm-employee-training/);
  const booked = EmployeeRenderer.generateHTML({
    ...options, employeeTraining: { tavi_stock_clerk: "register" },
  });
  assert.match(booked, /Away next shift; wages are still paid/);
  assert.match(booked, /IN TRAINING/);
  assert.match(booked, /data-train-employee-job="register" disabled/);
});

test("skill milestones make register and crate handling twice as fast and raise stocking capacity", () => {
  const { getEmployeeJobSpeed, getEmployeeCarryCapacity } = EmployeeTraining;
  for (const jobId of ["register", "load_storage"]) {
    assert.equal(getEmployeeJobSpeed({ [jobId]: 3 }, jobId), 1.5);
    assert.equal(getEmployeeJobSpeed({ [jobId]: 5 }, jobId), 2);
  }
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(getEmployeeCarryCapacity),
    [10, 15, 25, 30, 35],
  );
  const html = EmployeeRenderer.generateHTML({
    hiredEmployeeIds: ["tavi_stock_clerk"],
    activeEmployeeIds: [],
    employeeJobPriorities: {},
    credits: 5000,
    canHire: true,
    shopLevel: 4,
    employeeSkills: {
      tavi_stock_clerk: { register: 3, stock_shelves: 5, load_storage: 5 },
    },
  });
  assert.match(html, /50% faster register service/);
  assert.match(html, /Carries 35 items per trip/);
  assert.match(html, /100% faster delivery-crate trips/);
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
  assert.match(locked, /can't have employees yet/);
  assert.match(locked, /Shop Level 4/);
  assert.match(locked, /60 store reputation/);
  assert.match(locked, /Employees hired: 0 of 0/);
  assert.match(locked, /data-hire-employee-id="kel_supply_runner"[\s\S]*?disabled/);
  assert.match(locked, />\s*FULL\s*<\/button>/);

  const unlocked = EmployeeRenderer.generateHTML({ ...options, shopLevel: 4 });
  for (const id of ["tavi_stock_clerk", "kel_supply_runner"]) {
    assert.doesNotMatch(unlocked, new RegExp(`data-hire-employee-id="${id}"[^>]*disabled`));
  }
  assert.match(unlocked, /Hiring cost: 250 credits/);
  assert.doesNotMatch(unlocked, /Hiring cost: (?!250 )/);
  assert.match(unlocked, />\s*HIRE\s*<\/button>/);
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