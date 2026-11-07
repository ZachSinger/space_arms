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
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

function makeShelf(quantity = 0, capacity = 3) {
  const placement = { itemId: "amo_01", quantity };
  return {
    type: "shelf_starter_2x1",
    standPoint: { x: 100, y: 100 },
    placements: [placement],
    getRemainingUnitsFor(itemId, entry) {
      return entry === placement && itemId === placement.itemId
        ? Math.max(0, capacity - placement.quantity)
        : 0;
    },
    add(itemId, amount, entry) {
      if (entry !== placement || itemId !== placement.itemId) return 0;
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
  lockerQuantity = 5,
  jobPriorities = ["register", "stock_shelves", "load_storage"],
  hasRegister = false,
} = {}) {
  const shelf = makeShelf(shelfQuantity);
  const locker = makeLocker(lockerQuantity);
  const transfers = [];
  const completedSales = [];
  const eventBus = new EventBus();
  eventBus.on(GAME_EVENTS.INVENTORY_TRANSFERRED, (event) => transfers.push(event));
  const scene = {
    backroomDoor: { x: 20, y: 20 },
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
        destroy() {},
      }),
    },
    physics: {
      add: {
        existing(sprite) {
          sprite.body = { setVelocity() {} };
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

test("a stock clerk waits when no matching locker stock or shelf space is available", () => {
  const noStock = makeEmployee({ lockerQuantity: 0 });
  noStock.employee.startNextTask();
  assert.equal(noStock.employee.state, "IDLE");
  assert.equal(noStock.employee.currentJob, null);

  const fullShelf = makeEmployee({ shelfQuantity: 3 });
  fullShelf.employee.startNextTask();
  assert.equal(fullShelf.employee.state, "IDLE");
  assert.equal(fullShelf.employee.currentJob, null);
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
  });
  assert.ok(html.indexOf("1. Load storage") < html.indexOf("2. Run register"));
  assert.ok(html.indexOf("2. Run register") < html.indexOf("3. Stock shelves"));
  assert.match(html, /data-employee-priority-job="load_storage"/);
});
