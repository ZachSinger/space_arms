import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Events, GAME_EVENTS } from "../js/core/Events.js";
import { createServer } from "vite";
import { PLAYER_BODY_HEIGHT, PLAYER_BODY_WIDTH } from "../js/logic/Player.js";
import { CleaningSystem } from "../js/modules/cleaning/CleaningSystem.js";
import { Staff } from "../js/state/slices/Staff.js";
import { StaffHovercarts } from "../js/modules/hovercart/StaffHovercarts.js";
import { getShopLevelRequirement, STAFF_LIMIT_LEVELS } from "../js/logic/ShopProgression.js";
import {
  EMPLOYEE_BASE_WAGE, EMPLOYEE_HIRE_COST, getEmployeeTrainingCost, getEmployeeTrainingOffer,
} from "../js/logic/EmployeeTraining.js";
import { formatMoneyAmount } from "../js/logic/Money.js";

let server;
let cacheDirectory;
let Employee;
let RobotWorker;
let nextTestShelfSlotId = 1;
let nextTestCrateId = 1;
let REGISTER_SERVICE_MS_PER_ITEM;
let REGISTER_SERVICE_MS_PER_CUSTOMER;
let TRASH_HANDLING_MS;
let MOP_STROKE_MS;
let STOCKING_MS_PER_ITEM;
let EmployeeRenderer;
let EmployeeTraining;
let StaffSystem;
let FixtureSystem;
let ShiftSystem;
let SupplySystem;

before(async () => {
  cacheDirectory = await mkdtemp(join(fileURLToPath(new URL("..", import.meta.url)), ".employee-test-"));
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
          return "export const database = { getItem: (id) => ({ id }) };";
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
  ({ Employee, TRASH_HANDLING_MS, MOP_STROKE_MS, STOCKING_MS_PER_ITEM } = await server.ssrLoadModule("/js/logic/Employee.js"));
  ({ RobotWorker } = await server.ssrLoadModule("/js/logic/RobotWorker.js"));
  ({ EmployeeRenderer } = await server.ssrLoadModule("/js/logic/EmployeeRenderer.js"));
  EmployeeTraining = await server.ssrLoadModule("/js/logic/EmployeeTraining.js");
  ({ REGISTER_SERVICE_MS_PER_CUSTOMER, REGISTER_SERVICE_MS_PER_ITEM } = EmployeeTraining);
  ({ StaffSystem } = await server.ssrLoadModule("/js/systems/StaffSystem.js"));
  ({ FixtureSystem } = await server.ssrLoadModule("/js/systems/FixtureSystem.js"));
  ({ ShiftSystem } = await server.ssrLoadModule("/js/systems/ShiftSystem.js"));
  ({ SupplySystem } = await server.ssrLoadModule("/js/systems/SupplySystem.js"));
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

test("robot movement and working speeds use their separate fitted skills", () => {
  const { employee } = makeEmployee();
  const robot = new RobotWorker({
    id: "robot-1", name: "Robot", frame: "lab_frame", cell: "lab_cell",
    boards: ["mod_stocking", "mod_scanning", "mod_counting", "mod_waste", "mod_mopping"]
      .map((board) => ({ board })),
  }, employee.store);
  assert.equal(robot.getWalkSpeed(), 120);
  assert.equal(robot.wasteCapacity(), 3);
  assert.equal(robot.stockingInterval(), 1000 / 2.4);
  const customer = {
    cart: [{ price: 0.99 }, { price: 1 }],
    checkoutPayment: { type: "cash", exact: false },
  };
  assert.equal(robot.registerServiceDuration(customer), 1000 * (2 / 1.2 + 4 / 1.2));
  customer.checkoutPayment.exact = true;
  assert.equal(robot.registerServiceDuration(customer), 1000 * (2 / 1.2));
  customer.checkoutPayment = { type: "card" };
  assert.equal(robot.registerServiceDuration(customer), 1000 * (2 / 1.2));
  customer.cart = [{ price: 0.99 }];
  customer.checkoutPayment = { type: "m-scrips", exact: false };
  assert.equal(robot.registerServiceDuration(customer), 1000 * (1 / 1.2 + 4 / 1.2));
});

function makeRobot(boards) {
  const { employee, crate, shelf, completedSales } = makeEmployee({ hasRegister: true, assignedToRegister: false });
  const robot = new RobotWorker({
    id: "robot-1", name: "Robot", frame: "lab_frame", cell: "lab_cell",
    boards: boards.map((board) => ({ board })),
  }, employee.store, { exitPoint: { x: 200, y: 20 } });
  employee.store.employees = [robot];
  return { robot, store: employee.store, crate, shelf, completedSales };
}

test("a depleted robot without a charging board returns and stays until fully charged", () => {
  const { robot, store } = makeRobot(["register_2"]);
  const station = {
    id: "robot-charger-1", type: "robot_charger", gx: 2, gy: 101, x: 192, y: 6560,
    sprite: {
      texture: { key: "robot-charging-station" },
      depth: 100,
      setTexture(key) { this.texture.key = key; },
    },
  };
  const original = store.fixtures.ofKind;
  store.fixtures.ofKind = (kind) => kind === "robot_charger" ? [station] : original(kind);
  robot.battery = 0;
  robot.startNextTask();
  assert.equal(robot.state, "ROBOT_TO_CHARGER");
  robot.update(16);
  assert.equal(robot.state, "ROBOT_TO_CHARGER");
  robot.arriveAtDestination();
  assert.equal(robot.state, "ROBOT_CHARGING");
  assert.equal(robot.sprite.visible, false);
  assert.equal(station.sprite.texture.key, "robot-charging-station_charging");
  assert.equal(robot.dockedVisual.sprite.x, station.x + 0.5);
  assert.equal(robot.dockedVisual.sprite.y, station.y - 1.5);
  const nextBatteryLevel = robot.dockedVisual.batteryLevel + 1;
  const nextBattery = nextBatteryLevel / 7 + 0.01;
  robot.update((nextBattery - robot.battery) * 1000 * robot.cell.charge / robot.cell.chargeRate);
  assert.equal(robot.dockedVisual.batteryLevel, nextBatteryLevel);
  assert.equal(robot.dockedVisual.sprite.texture.key, `robot_hover_bot_docked_${nextBatteryLevel}`);
  assert.equal(robot.state, "ROBOT_CHARGING");
  assert.equal(robot.outOfCharge, true);
  robot.update(60_000);
  assert.equal(robot.battery, 1);
  assert.equal(robot.outOfCharge, false);
  assert.equal(robot.state, "IDLE");
  assert.equal(station.sprite.texture.key, "robot-charging-station");
  assert.equal(robot.dockedVisual.sprite.texture.key, "robot_hover_bot_docked_idle");
  robot.startNextTask();
  assert.equal(robot.state, "TO_REGISTER");
  assert.equal(robot.dockedVisual, null);
  assert.equal(robot.sprite.visible, true);
});

test("robot delivery work carries a batch of crates and puts each down once", () => {
  const { robot, store, crate } = makeRobot(["stock_1", "mod_carry"]);
  const second = makeDeliveryCrate(2);
  const third = makeDeliveryCrate(2);
  store.restockCrates.push(second, third);
  store.checkoutSystem.findGoBacksSpot = (_crate, reserved) =>
    ({ x: 96 + reserved.length * 64, y: 6560, inBackroom: true });
  robot.startNextTask();
  assert.equal(robot.state, "ROBOT_TO_PAD");
  for (let index = 0; index < 3; index += 1) robot.arriveAtDestination();
  assert.equal(robot.cargo.length, 3);
  assert.equal(robot.state, "ROBOT_TO_DROP");
  for (let index = 0; index < 3; index += 1) robot.arriveAtDestination();
  assert.equal(robot.state, "IDLE");
  assert.deepEqual(new Set(store.restockCrates), new Set([crate, second, third]));
  assert.ok(store.restockCrates.every((item) => !item.isCarried && !item.lockedToPad));
});

test("robots reserve charging stations and try another when one cannot be reached", () => {
  const { robot, store } = makeRobot(["register_2"]);
  const stations = [
    { id: "charger-1", type: "robot_charger", gx: 2, gy: 101 },
    { id: "charger-2", type: "robot_charger", gx: 4, gy: 101 },
  ];
  const original = store.fixtures.ofKind;
  store.fixtures.ofKind = (kind) => kind === "robot_charger" ? stations : original(kind);
  const findClosest = robot.findClosestSpot.bind(robot);
  robot.findClosestSpot = (spots) => findClosest(spots.filter((spot) => spot.fixture?.id !== "charger-1"));
  robot.battery = 0;
  robot.startNextTask();
  assert.equal(robot.currentJob.station, stations[1]);

  const other = new RobotWorker({
    id: "robot-2", name: "Other", frame: "lab_frame", cell: "lab_cell",
    boards: [{ board: "register_2" }],
  }, store);
  store.employees.push(other);
  other.battery = 0;
  other.startNextTask();
  assert.equal(other.currentJob.station, stations[0]);
});

test("only on-shift robots spawn with their saved charge", () => {
  const { employee } = makeEmployee();
  const shop = employee.scene;
  shop.employeeStore = shop;
  shop.customers = [];
  shop.gameState.staff.working = () => [];
  shop.gameState.robotService = { robots: [
    { id: "robot-1", name: "Working", frame: "worker_frame", cell: "basic_cell",
      boards: [{ board: "register_1" }], battery: 0.6 },
    { id: "robot-2", name: "Resting", frame: "worker_frame", cell: "basic_cell",
      boards: [{ board: "register_1" }], onShift: false },
  ] };
  new StaffSystem(shop).spawnWorking();
  assert.equal(shop.employees.length, 1);
  assert.equal(shop.employees[0].data.id, "robot-1");
  assert.equal(shop.employees[0].battery, 0.6);
});

test("a cashier keeps working at low battery but automatically returns when depleted", () => {
  const { robot, store } = makeRobot(["self_charge_1", "register_2"]);
  const station = { id: "charger", type: "robot_charger", gx: 2, gy: 101 };
  const original = store.fixtures.ofKind;
  store.fixtures.ofKind = (kind) => kind === "robot_charger" ? [station] : original(kind);
  robot.startNextTask();
  robot.arriveAtDestination();
  assert.equal(robot.state, "AT_REGISTER");
  robot.battery = 0.1;
  const findClosest = robot.findClosestSpot.bind(robot);
  robot.findClosestSpot = () => null;
  robot.updateAtRegister(1000);
  assert.equal(robot.state, "AT_REGISTER");
  robot.findClosestSpot = findClosest;
  robot.updateAtRegister(1000);
  assert.equal(robot.state, "AT_REGISTER");
  robot.battery = 0;
  robot.update(1);
  assert.equal(robot.state, "ROBOT_TO_CHARGER");
});

function addRobotStation(store) {
  const station = {
    id: "charger", type: "robot_charger", gx: 2, gy: 101, x: 192, y: 6560,
    sprite: {
      texture: { key: "robot-charging-station" }, depth: 100,
      setTexture(key) { this.texture.key = key; },
    },
  };
  const original = store.fixtures.ofKind;
  store.fixtures.ofKind = (kind) => kind === "robot_charger" ? [station] : original(kind);
  return station;
}

test("station rest leaves for work even with a partial battery, but stays when fully charged and idle", () => {
  for (const battery of [0.2, 1]) {
    const { robot, store } = makeRobot(["self_charge_1", "register_1"]);
    const station = addRobotStation(store);
    const line = [];
    store.checkoutSystem.lineFor = () => line;
    robot.battery = battery;
    robot.startNextTask();
    assert.equal(robot.state, "ROBOT_TO_CHARGER");
    robot.arriveAtDestination();
    robot.update(1000);
    assert.equal(robot.state, "ROBOT_STANDBY");
    assert.equal(robot.sprite.visible, false);
    assert.equal(station.sprite.texture.key, battery < 1 ?
      "robot-charging-station_charging" : "robot-charging-station");
    line.push({ cart: [{}], checkoutPayment: { type: "card" } });
    const findPath = store.findPath;
    store.findPath = () => null;
    robot.update(1000);
    assert.equal(robot.state, "ROBOT_STANDBY");
    assert.equal(robot.currentJob.station, station);
    store.findPath = findPath;
    robot.update(1000);
    assert.equal(robot.state, "TO_REGISTER");
    assert.equal(robot.dockedVisual, null);
    assert.equal(robot.sprite.visible, true);
    if (battery < 1) assert.ok(robot.battery < 1);
  }
});

test("station rest turns back for new work before arriving at the station", () => {
  const { robot, store } = makeRobot(["self_charge_2", "register_1"]);
  addRobotStation(store);
  const line = [];
  store.checkoutSystem.lineFor = () => line;
  robot.startNextTask();
  assert.equal(robot.currentJob.standby, true);
  line.push({ cart: [{}], checkoutPayment: { type: "card" } });
  robot.update(1000);
  assert.equal(robot.currentJob.jobId, "register");
  assert.equal(robot.dockedVisual, null);
});

test("depleted robots wait for a free reachable station and retry a blocked route", () => {
  const { robot, store } = makeRobot(["register_2"]);
  const station = addRobotStation(store);
  const other = { data: { id: "other" }, currentJob: { jobId: "charge", station } };
  store.employees.push(other);
  const messages = [];
  store.showShopMessage = (message) => messages.push(message);
  robot.battery = 0;
  robot.update(1);
  robot.update(2000);
  assert.equal(robot.state, "ROBOT_WAIT_CHARGER");
  assert.equal(robot.battery, 0);
  assert.ok(messages.some((message) => message.includes("reachable charging station")));
  other.currentJob = null;
  robot.update(1000);
  assert.equal(robot.state, "ROBOT_TO_CHARGER");
  const findClosest = robot.findClosestSpot;
  robot.findClosestSpot = () => null;
  robot.handleBlockedRoute();
  robot.update(1000);
  assert.equal(robot.state, "ROBOT_WAIT_CHARGER");
  robot.findClosestSpot = findClosest;
  robot.update(1000);
  assert.equal(robot.state, "ROBOT_TO_CHARGER");
  robot.arriveAtDestination();
  robot.requestClockOut();
  robot.update(1000);
  assert.equal(robot.state, "ROBOT_CHARGING");
  assert.equal(robot.clockOutRequested, true);
});

test("a depleted stocking robot keeps its crate and puts it down once after fully recharging", () => {
  const { robot, store, crate } = makeRobot(["stock_1"]);
  addRobotStation(store);
  crate.lockedToPad = false;
  crate.sprite.y = 6560;
  robot.startNextTask();
  assert.equal(robot.state, "TO_CRATE");
  robot.arriveAtDestination();
  assert.equal(robot.state, "TO_SHELF");
  assert.equal(crate.isCarried, true);
  robot.battery = 0;
  robot.update(1);
  assert.equal(robot.state, "ROBOT_TO_CHARGER");
  assert.equal(robot.cargo[0].crate, crate);
  robot.arriveAtDestination();
  robot.update(60_000);
  assert.equal(robot.state, "ROBOT_TO_DROP");
  robot.arriveAtDestination();
  assert.equal(crate.isCarried, false);
  assert.equal(crate.quantity, 5);
  assert.equal(store.restockCrates.filter((entry) => entry === crate).length, 1);
  assert.equal(robot.cargo.length, 0);
});

test("a robot depleted while carrying an empty crate disposes of it after recharging", () => {
  const { robot, store, crate } = makeRobot(["stock_1"]);
  addRobotStation(store);
  crate.lockedToPad = false;
  crate.sprite.y = 6560;
  robot.startNextTask();
  robot.arriveAtDestination();
  crate.quantity = 0;
  robot.battery = 0;
  robot.update(1);
  robot.arriveAtDestination();
  robot.update(60_000);
  assert.equal(robot.state, "TO_TRASHCAN");
  robot.arriveAtDestination();
  assert.equal(crate.destroyed, true);
  assert.equal(robot.cargo.length, 0);
  assert.equal(store.restockCrates.includes(crate), false);
});

test("a closing register robot waits for shoppers and serves them before going home", () => {
  const { robot, store, completedSales } = makeRobot(["register_1"]);
  const shopper = { state: "SHOPPING", cart: [{ price: 1 }], checkoutPayment: { type: "card" } };
  const line = [];
  store.checkoutSystem.lineFor = () => line;
  store.checkoutSystem.completeEmployeeCheckout = (employee, customer) => {
    completedSales.push({ employee, customer });
    line.shift();
    return true;
  };
  robot.getClosingCustomers = () => [shopper];
  robot.requestClockOut();
  assert.equal(robot.state, "WAITING_REGISTER");
  line.push(shopper);
  robot.update(1000);
  assert.equal(robot.state, "TO_REGISTER");
  robot.arriveAtDestination();
  assert.equal(robot.state, "SERVING_REGISTER");
  robot.updateRegisterService(1000);
  assert.equal(completedSales.length, 1);
  shopper.state = "LEAVING";
  robot.updateAtRegister(1000);
  assert.equal(robot.state, "ROBOT_TO_HOME");
});

test("a robot cannot stock a nonempty shelf just because another empty shelf is unstockable", () => {
  const { robot, crate, shelf } = makeRobot(["stock_1"]);
  shelf.placements.push({ id: "second-slot", itemId: "other", quantity: 1 });
  crate.itemId = "other";
  crate.lockedToPad = false;
  crate.sprite.y = 6560;
  robot.startNextTask();
  assert.equal(robot.state, "IDLE");
  assert.equal(robot.currentJob, null);
});

test("a robot tries another empty shelf if the first one has no matching stock", () => {
  const { robot, crate, shelf } = makeRobot(["stock_1"]);
  shelf.placements.push({ id: "second-slot", itemId: "other", quantity: 0 });
  crate.itemId = "other";
  crate.lockedToPad = false;
  crate.sprite.y = 6560;
  robot.startNextTask();
  assert.equal(robot.state, "TO_CRATE");
  assert.equal(robot.currentJob.placement.id, "second-slot");
});

test("a robot running out of charge recovers carried stock without overlapping crates", () => {
  const { robot, store, crate } = makeRobot(["stock_1"]);
  let recovered = 0;
  store.gameState.goBacks = { takeFrom(source, itemId, quantity) {
    recovered += source.remove(itemId, quantity);
    return quantity;
  } };
  store.checkoutSystem.findGoBacksSpot = () => null;
  store.restockCrates = [];
  crate.pickUp(robot.sprite, { holderId: robot.data.id });
  robot.cargo = [{ crate, returnPosition: { x: 96, y: 6560 } }];
  robot.battery = 0;
  robot.update(1);
  robot.requestClockOut();
  assert.equal(robot.isDestroyed, true);
  assert.equal(recovered, 5);
  assert.equal(crate.destroyed, true);
  assert.equal(store.restockCrates.length, 0);
});

test("closing recovers a robot's stuck stocking crate rather than waiting forever", () => {
  const { robot, store, crate } = makeRobot(["stock_1"]);
  let recovered = 0;
  store.gameState.goBacks = { takeFrom(source, itemId, quantity) {
    recovered += source.remove(itemId, quantity);
    return quantity;
  } };
  store.checkoutSystem.findGoBacksSpot = () => null;
  store.restockCrates = [];
  crate.pickUp(robot.sprite, { holderId: robot.data.id });
  robot.currentJob = { jobId: "stock_shelves", crate };
  robot.state = "WAITING_CRATE_RETURN";
  robot.requestClockOut();
  assert.equal(robot.isDestroyed, true);
  assert.equal(recovered, 5);
});

test("a robot reaching its home can destroy its sprite during an update", () => {
  const { robot } = makeRobot(["register_1"]);
  robot.sprite.destroy = () => { delete robot.sprite.body; };
  robot.state = "ROBOT_TO_HOME";
  robot.path = [];
  robot.destination = { x: robot.sprite.x, y: robot.sprite.y };
  robot.onArriveAtDestination = () => robot.arriveAtDestination();
  assert.doesNotThrow(() => robot.update(16));
  assert.equal(robot.isDestroyed, true);
});

test("a robot holds a fixture crate safely until recovery space opens", () => {
  const { robot, store, crate } = makeRobot(["stock_1"]);
  crate.kind = "fixture";
  crate.pickUp(robot.sprite, { holderId: robot.data.id });
  robot.cargo = [{ crate, returnPosition: { x: 96, y: 6560 } }];
  store.restockCrates = [];
  store.checkoutSystem.findGoBacksSpot = () => null;
  let open = false;
  store.supply = {
    takePadSpots: () => open ? [{ x: 40, y: 40 }] : [],
    deliver: (item) => { item.lockToPad(); store.restockCrates.push(item); },
    freePlayerFromPad() {},
  };
  robot.outOfCharge = true;
  robot.requestClockOut();
  assert.equal(robot.state, "ROBOT_WAIT_RECOVERY");
  assert.equal(robot.isDestroyed, false);
  assert.equal(crate.isCarried, true);
  open = true;
  robot.update(1000);
  assert.equal(robot.isDestroyed, true);
  assert.equal(crate.lockedToPad, true);
  assert.deepEqual(store.restockCrates, [crate]);
});

test("a robot reserves the pad position for a carried fixture until it is safely put down", () => {
  const { robot, store, crate } = makeRobot(["stock_1"]);
  crate.kind = "fixture";
  crate.sprite.displayWidth = 32;
  const supply = new SupplySystem(store, { centerX: 40, centerY: 40 });
  const original = supply.padSpots()[0];
  crate.sprite.x = original.x;
  crate.sprite.y = original.y;
  store.checkoutSystem.findGoBacksSpot = () => ({ x: 96, y: 6560, inBackroom: true });
  robot.startNextTask();
  robot.arriveAtDestination();
  assert.equal(supply.freePadSpots().some(({ x, y }) => x === original.x && y === original.y), false);
  store.checkoutSystem.findGoBacksSpot = () => null;
  store.supply = {
    takePadSpots: () => { throw new Error("The fixture's reserved pad spot should be used"); },
    deliver: (item) => { item.lockToPad(); store.restockCrates.push(item); },
    freePlayerFromPad() {},
  };
  robot.outOfCharge = true;
  robot.requestClockOut();
  assert.equal(robot.isDestroyed, true);
  assert.deepEqual({ x: crate.sprite.x, y: crate.sprite.y }, original);
  assert.equal(crate.lockedToPad, true);
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
  assignedToRegister = hasRegister && jobPriorities[0] === "register",
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
      staff: {
        jobPriorities: { tavi_stock_clerk: jobPriorities },
        registerAssignments: assignedToRegister ? { register: "tavi_stock_clerk" } : {},
      },
      shop: { changed() {} },
    },
    refreshShelfStockDisplay() {},
    add: {
      sprite: (x, y, textureKey) => ({
        x,
        y,
        scene,
        texture: { key: textureKey },
        anims: { stop() {} },
        originY: 0.5,
        play() { return this; },
        setDisplaySize() { return this; },
        setTexture(key, frame) { this.texture.key = key; this.frame = frame; return this; },
        setTint() { return this; },
        setDepth() { return this; },
        setVisible(visible) { this.visible = visible; return this; },
        destroy() {},
      }),
      image: (x, y, textureKey) => ({
        x,
        y,
        texture: { key: textureKey },
        setDisplaySize() { return this; },
        setDepth() { return this; },
        setTexture(key) { this.texture.key = key; return this; },
        destroy() {},
      }),
    },
    textures: { exists: () => true },
    physics: {
      add: {
        existing(sprite) {
          sprite.body = {
            velocity: { x: 0, y: 0 },
            setVelocity(x, y) { this.velocity = { x, y }; },
            reset(x, y) { sprite.x = x; sprite.y = y; this.setVelocity(0, 0); },
            setSize() {},
            setOffset() {},
            updateFromGameObject() {},
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
    isOperated: () => scene.checkoutSystem.operatingRegister,
    goBacksReservedRectangles: () => [],
    findGoBacksSpot: (crate, reserved) => reserved.some((rect) =>
      rect.left < 96 && rect.right > 96 && rect.top < 6560 && rect.bottom > 6560)
      ? null : { x: 96, y: 6560, inBackroom: true },
    completeEmployeeCheckout(employee, customer) {
      completedSales.push({ employee, customer });
      if (registerLine[0] === customer) registerLine.shift();
      return true;
    },
  };
  const employee = new Employee({
    id: "tavi_stock_clerk",
    name: "Tavi",
  }, scene, { exitPoint: { x: 200, y: 20 } });
  employee.scene = scene;
  scene.employees = [employee];
  return { employee, shelf, crate, transfers, completedSales };
}

function finishStocking(employee) {
  employee.stockCrateOnShelf();
  employee.updateStocking(employee.stockingUnitsRemaining * STOCKING_MS_PER_ITEM);
}

function assignTestCart(employee) {
  const scene = employee.store;
  scene.areas.areaAt = (_x, y) => y < 80 ? "backroom" : "shop";
  scene.gameState.staff.hovercartFor = () => "charger-1";
  employee.sprite.body.stop = () => employee.sprite.body.setVelocity(0, 0);
  for (const crate of scene.restockCrates) crate.canPickUp = () => true;
  for (const shelf of scene.fixtures.shelves()) Object.assign(shelf, { x: 100, y: 100 });
  const cart = {
    charger: { id: "charger-1" },
    assignedEmployeeId: employee.data.id,
    cart: { x: 20, y: 20 },
    cartCrates: [],
    dock: { x: 20, y: 20 },
    launch: { x: 20, y: 45 },
    capacity: 3, batteryCapacity: 300, battery: 300,
    moving: false, active: false, dead: false,
    isOut() { return this.active || this.dead; },
    activateForStaff() { this.active = true; return true; },
    hasClearLine: () => true,
    targetFeet: (sprite) => sprite,
    syncCartCrates() {},
    reset() { this.active = false; this.dead = false; this.towedByStaff = null; },
  };
  scene.hovercarts = new StaffHovercarts({ scene, carts: [cart] });
  return cart;
}

test("employee hovercart assignments are one-to-one, replace owners, and persist", () => {
  const staff = new Staff();
  staff.add("tavi_stock_clerk");
  staff.add("sera_floor_assistant");
  assert.equal(staff.assignHovercart("not-hired", "charger-1"), false);
  staff.assignHovercart("tavi_stock_clerk", "charger-1");
  staff.assignHovercart("sera_floor_assistant", "charger-1");
  assert.equal(staff.hovercartFor("tavi_stock_clerk"), null);
  staff.assignHovercart("sera_floor_assistant", "charger-2");
  assert.deepEqual(staff.hovercartAssignments, { "charger-2": "sera_floor_assistant" });
  const restored = Staff.fromSave(staff.toSave());
  assert.equal(restored.hovercartFor("sera_floor_assistant"), "charger-2");
  restored.assignHovercart("sera_floor_assistant", null);
  assert.deepEqual(restored.hovercartAssignments, {});
});

test("assigned employees batch crates, wait for their cart, stock at the normal pace, and dock leftovers before leaving", () => {
  const { employee, shelf, crate } = makeEmployee({ crateQuantity: 2, shelfCapacity: 3 });
  const second = makeDeliveryCrate(2);
  second.canPickUp = () => true;
  employee.store.restockCrates.push(second);
  const cart = assignTestCart(employee);
  employee.startNextTask();
  assert.equal(employee.state, "HOVERCART_TO_SOURCE");
  employee.arriveAtDestination();
  employee.update(16);
  employee.arriveAtDestination();
  employee.update(16);
  assert.deepEqual(cart.cartCrates, [crate, second]);
  assert.equal(employee.store.restockCrates.length, 0);
  assert.equal(employee.state, "HOVERCART_TO_SHELF");
  employee.sprite.body.reset(100, 100);
  employee.arriveAtDestination();
  employee.update(1000);
  assert.equal(shelf.placements[0].quantity, 0, "a distant cart cannot supply stock");
  Object.assign(cart.cart, { x: 80, y: 100 });
  employee.update(16);
  assert.equal(employee.state, "STOCKING_SHELF");
  assert.equal(employee.isCarryingCrate(), false, "cargo stays on the cart");
  employee.update(999);
  assert.equal(shelf.placements[0].quantity, 0);
  employee.update(1);
  assert.equal(shelf.placements[0].quantity, 1);
  employee.update(1000);
  assert.equal(employee.state, "HOVERCART_TO_SHELF", "the next cargo crate uses the remaining space");
  employee.arriveAtDestination();
  employee.update(16);
  employee.clockOutRequested = true;
  employee.update(1000);
  assert.equal(shelf.placements[0].quantity, 3);
  assert.equal(employee.state, "HOVERCART_TO_BIN");
  employee.arriveAtDestination();
  employee.update(16);
  assert.equal(crate.destroyed, true);
  assert.deepEqual(cart.cartCrates, [second]);
  assert.equal(second.quantity, 1);
  assert.equal(employee.state, "HOVERCART_TO_CHARGER");
  employee.arriveAtDestination();
  employee.update(16);
  assert.equal(employee.state, "HOVERCART_WAIT_CHARGER", "no long-distance docking");
  Object.assign(cart.cart, { x: 30, y: 20 });
  employee.update(16);
  assert.equal(cart.isOut(), false);
  assert.equal(employee.state, "TO_EXIT");
  assert.equal(second.quantity, 1, "leftover stock is never discarded or put on the sales floor");
});

test("a dead employee cart is towed at walking speed without spending battery or losing loaded stock", () => {
  const { employee, crate } = makeEmployee();
  const cart = assignTestCart(employee);
  cart.cartCrates = [crate];
  employee.store.restockCrates = [];
  Object.assign(cart, { battery: 0, dead: true });
  employee.startNextTask();
  assert.equal(employee.state, "HOVERCART_TO_RECOVERY");
  employee.arriveAtDestination();
  assert.equal(cart.towedByStaff, employee);
  assert.equal(employee.getWalkSpeed(), 60);
  employee.arriveAtDestination();
  employee.update(16);
  assert.equal(cart.isOut(), false);
  assert.equal(cart.battery, 0, "docking does not magically refill the battery");
  assert.deepEqual(cart.cartCrates, [crate]);
});

test("register service still outranks cart stocking, and a charging cart falls back to hand stocking", () => {
  const { employee } = makeEmployee({ hasRegister: true });
  const cart = assignTestCart(employee);
  employee.startNextTask();
  assert.equal(employee.state, "TO_REGISTER");
  assert.equal(cart.active, false);
  employee.store.checkoutSystem.operatingRegister = true;
  cart.battery = 20;
  employee.startNextTask();
  assert.equal(employee.state, "TO_CRATE");
  assert.equal(cart.active, false);
});

test("a cart with empty crates and no reachable trashcan stays docked rather than repeating failed trips", () => {
  const { employee } = makeEmployee({ trashcans: [] });
  const cart = assignTestCart(employee);
  cart.cartCrates = [makeDeliveryCrate(0)];
  const messages = [];
  employee.store.showShopMessage = (message) => messages.push(message);
  employee.startNextTask();
  assert.equal(employee.state, "TO_CRATE", "useful floor stock is carried by hand");
  employee.startNextTask();
  assert.equal(cart.active, false);
  assert.equal(cart.cartCrates.length, 1);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /reachable trashcan/);
});

test("hovercart assignment changes require docked carts, but docked leftover cargo can change hands", () => {
  const { employee } = makeEmployee();
  const scene = employee.store;
  const cart = assignTestCart(employee);
  const staff = new Staff();
  staff.add(employee.data.id);
  scene.gameState.staff = staff;
  const system = { carts: [cart], chargers: () => [cart.charger], sync() {} };
  scene.gameModules = { get: () => system };
  scene.shift = { starting: false };
  let autosaves = 0;
  scene.saves = { canSaveOffShift: () => true, requestAutosave: () => { autosaves += 1; } };
  const messages = [];
  scene.messages = { show: (message) => messages.push(message) };
  const staffSystem = new StaffSystem(scene);
  cart.active = true;
  assert.equal(staffSystem.assignHovercart(employee.data.id, cart.charger.id), false);
  assert.match(messages.at(-1), /Dock these hovercarts/);
  cart.active = false;
  cart.cartCrates.push(makeDeliveryCrate(1));
  assert.equal(staffSystem.assignHovercart(employee.data.id, cart.charger.id), true);
  assert.equal(staffSystem.assignHovercart(employee.data.id, null), true);
  assert.equal(autosaves, 0);
  assert.equal(cart.cartCrates.length, 1);
});

test("employee controls show cart ownership and disable changes during a shift", () => {
  const options = {
    hiredEmployeeIds: ["tavi_stock_clerk", "sera_floor_assistant"], activeEmployeeIds: [],
    employeeJobPriorities: {}, credits: 10000, canHire: true, shopLevel: 7,
    hovercarts: [{ id: "charger-1", name: "HOVERCART 1" }],
    hovercartAssignments: { "charger-1": "tavi_stock_clerk" },
  };
  const ready = EmployeeRenderer.generateHTML(options);
  assert.match(ready, /data-employee-hovercart-id="tavi_stock_clerk"[\s\S]*?data-employee-hovercart="charger-1" aria-pressed="true"/);
  assert.match(ready, /data-employee-hovercart-id="sera_floor_assistant"[\s\S]*?replacing Tavi/);
  const duringShift = EmployeeRenderer.generateHTML({ ...options, canHire: false });
  assert.match(duringShift, /data-employee-hovercart="charger-1" aria-pressed="true"[\s\S]*?disabled/);
});

test("an employee charger's own cart blocks removal while out or loaded, independently of player carts", () => {
  const charger = { id: "charger-1", type: "hovercart_charger" };
  const otherCharger = { id: "charger-2", type: "hovercart_charger" };
  const employeeCart = { charger, cartCrates: [], isOut: () => true };
  const playerCart = { charger: otherCharger, cartCrates: [], isOut: () => false };
  const fixtures = new FixtureSystem({
    hovercart: playerCart, gameModules: { get: () => ({ carts: [employeeCart, playerCart] }) },
  });
  fixtures.canRearrange = () => true;
  assert.match(fixtures.crateBlockReason(charger), /Dock the hovercart/);
  assert.equal(fixtures.crateBlockReason(otherCharger), null);
  employeeCart.isOut = () => false;
  employeeCart.cartCrates.push({ quantity: 1 });
  assert.match(fixtures.saleBlockReason(charger), /Unload this hovercart/);
  employeeCart.cartCrates = [];
  assert.equal(fixtures.crateBlockReason(charger), null);
});

test("15 shelf items require 15 full intervals, even when clockout is requested mid-stock", () => {
  const { employee, shelf, crate, transfers } = makeEmployee({ shelfCapacity: 15, crateQuantity: 15 });
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.arriveAtDestination();
  assert.equal(employee.state, "STOCKING_SHELF");
  assert.equal(shelf.placements[0].quantity, 0);
  employee.update(999);
  assert.equal(shelf.placements[0].quantity, 0);
  employee.update(1);
  assert.equal(shelf.placements[0].quantity, 1);
  employee.requestClockOut();
  employee.update(13999);
  assert.equal(shelf.placements[0].quantity, 14);
  assert.equal(crate.quantity, 1);
  assert.equal(employee.state, "STOCKING_SHELF");
  employee.update(1);
  assert.equal(shelf.placements[0].quantity, 15);
  assert.equal(transfers.length, 15);
  assert.ok(transfers.every(({ quantity }) => quantity === 1));
  assert.equal(employee.state, "TO_TRASHCAN");
  assert.equal(employee.isReadyToClockOut(), false);
  employee.arriveAtDestination();
  assert.equal(crate.destroyed, true);
  assert.equal(employee.state, "TO_EXIT");
  assert.equal(employee.isReadyToClockOut(), false);
  employee.sprite.body.reset(200, 20);
  employee.update(16);
  assert.equal(employee.isReadyToClockOut(), true);
});

test("each stocking skill level divides the individual item pause by its stocking speed", () => {
  for (const [index, speed] of [1, 1.2, 1.4, 1.6, 1.8].entries()) {
    const { employee, shelf, crate } = makeEmployee({ shelfCapacity: 2, crateQuantity: 3 });
    employee.data.skillLevels = { stock_shelves: index + 1 };
    employee.startNextTask();
    employee.arriveAtDestination();
    employee.arriveAtDestination();
    const interval = 1000 / speed;
    employee.update(interval - 1);
    assert.equal(shelf.placements[0].quantity, 0);
    employee.update(1.001);
    assert.equal(shelf.placements[0].quantity, 1);
    employee.update(interval);
    assert.equal(shelf.placements[0].quantity, 2);
    assert.equal(crate.quantity, 1);
    assert.equal(employee.state, "TO_RETURN_CRATE");
  }
});

test("stocking returns the remainder safely if another stocker fills the reserved slot", () => {
  const { employee, shelf, crate } = makeEmployee();
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.arriveAtDestination();
  employee.update(1000);
  shelf.placements[0].quantity = 3;
  employee.update(1000);
  assert.equal(crate.quantity, 4);
  assert.equal(employee.state, "TO_RETURN_CRATE");
});

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
  finishStocking(employee);
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

  finishStocking(employee);
  assert.equal(shelf.placements[0].quantity, 3);
  assert.equal(crate.quantity, 2);
  assert.equal(employee.state, "TO_RETURN_CRATE");
  assert.equal(crate.isCarried, true);
  employee.arriveAtDestination();
  assert.equal(crate.lockedToPad, false);
  assert.equal(employee.state, "IDLE");
  assert.deepEqual(transfers, Array.from({ length: 3 }, () => ({
      itemId: "amo_01",
      quantity: 1,
      source: "loading-pad",
      destination: "shelf",
      sourceId: crate.id,
      destinationId: shelf.placements[0].id,
      sourceLocation: { kind: "carried", holderId: "tavi_stock_clerk" },
      destinationLocation: { kind: "shelf-slot", shelfId: shelf.id, slotId: shelf.placements[0].id },
    })));
});

test("a stock clerk returns a partly used crate and takes it to another open shelf spot", () => {
  const { employee, shelf, crate } = makeEmployee({
    crateQuantity: 6,
    shelfCapacity: 3,
    shelfPlacementCount: 2,
  });

  employee.startNextTask();
  employee.arriveAtDestination();
  finishStocking(employee);
  assert.equal(shelf.placements[0].quantity, 3);
  assert.equal(crate.quantity, 3);
  assert.equal(employee.state, "TO_RETURN_CRATE");
  employee.arriveAtDestination();
  assert.equal(crate.lockedToPad, false);

  employee.startNextTask();
  assert.equal(employee.currentJob.placement, shelf.placements[1]);
  employee.arriveAtDestination();
  finishStocking(employee);

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
  finishStocking(employee);
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

  finishStocking(employee); // shelf fits 3 of its 5, so 2 come back
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

test("idle, on-break, and heading-to-break employees leave visibly when no register service remains", () => {
  for (const state of ["IDLE", "ON_BREAK", "TO_BREAKROOM"]) {
    const { employee, crate } = makeEmployee({ hasRegister: true });
    employee.state = state;
    employee.sprite.setVisible(state !== "ON_BREAK");
    employee.requestClockOut();
    assert.equal(employee.state, "TO_EXIT");
    assert.equal(employee.sprite.visible, true);
    assert.equal(employee.isReadyToClockOut(), false);
    employee.startNextTask();
    employee.update(100);
    assert.ok(employee.sprite.body.velocity.x > 0);
    assert.equal(employee.currentJob, null);
    assert.equal(crate.quantity, 5);
    employee.sprite.body.reset(200, 20);
    employee.update(16);
    assert.equal(employee.isDestroyed, true);
    assert.equal(employee.isReadyToClockOut(), true);
    employee.destroy();
  }
});

test("clockout uses the normal backroom portal and public door route, holding the door on approach", () => {
  const { employee } = makeEmployee();
  employee.sprite.body.reset(20, 6560);
  let body;
  employee.scene.findPath = (...args) => {
    body = args[4];
    return [{ x: 20, y: 6560, teleportTo: { x: 180, y: 20 } }];
  };
  const held = [];
  employee.exitDoor = { door: { isNear: (sprite) => sprite.x >= 180 }, letIn: (sprite) => held.push(sprite) };
  employee.requestClockOut();
  assert.equal(body.avoidStoreDoor, false);
  employee.update(16);
  assert.deepEqual({ x: employee.sprite.x, y: employee.sprite.y }, { x: 180, y: 20 });
  employee.requestClockOut();
  employee.update(16);
  assert.deepEqual(held, [employee.sprite]);
  assert.equal(employee.state, "TO_EXIT");
  employee.sprite.body.reset(200, 20);
  employee.update(16);
  assert.equal(employee.isReadyToClockOut(), true);
});

test("an unreachable exit is retried visibly instead of counting as clocked out", () => {
  const { employee } = makeEmployee();
  employee.scene.findPath = () => null;
  employee.requestClockOut();
  assert.equal(employee.state, "WAITING_EXIT");
  assert.equal(employee.sprite.visible, true);
  assert.equal(employee.isReadyToClockOut(), false);
  employee.scene.findPath = () => [];
  employee.update(1000);
  assert.equal(employee.state, "TO_EXIT");
  assert.equal(employee.isReadyToClockOut(), false);
});

test("working staff receive the public exit and the shift waits for departure before clearing them", () => {
  const { employee: original } = makeEmployee();
  const shop = original.scene;
  const exitPoint = { x: 300, y: 20 };
  shop.exitPoint = exitPoint;
  shop.storeDoorAnimation = { door: { isNear: () => false }, letIn() {} };
  shop.employeeStore = shop;
  shop.gameState.staff.working = () => ["tavi_stock_clerk"];
  shop.gameState.staff.profile = () => ({ id: "tavi_stock_clerk", name: "Tavi" });
  shop.gameState.economy = { credits: 1000 };
  shop.gameState.reputation = { global: 0 };
  shop.customers = [];
  shop.shiftClock = { softClosed: true };
  const staff = new StaffSystem(shop);
  staff.spawnWorking();
  const employee = shop.employees[0];
  assert.equal(employee.exitPoint, exitPoint);
  assert.equal(employee.exitDoor, shop.storeDoorAnimation);
  let removals = 0;
  shop.removeEmployeeSprite = () => { removals += 1; };
  const shift = new ShiftSystem(shop);
  let ends = 0;
  shift.end = () => { ends += 1; staff.clear(); shift.ended = true; };
  shift.update();
  assert.equal(employee.state, "TO_EXIT");
  assert.equal(ends, 0);
  employee.sprite.body.reset(300, 20);
  employee.update(16);
  assert.equal(removals, 1);
  shift.update();
  assert.equal(ends, 1);
  assert.deepEqual(shop.employees, []);
  assert.equal(removals, 1, "clearing an already departed employee is harmless");
});

test("clockout drains queued register customers as the final task, then walks out immediately", () => {
  const { employee, completedSales } = makeEmployee({ hasRegister: true });
  const oneItemMs = REGISTER_SERVICE_MS_PER_CUSTOMER + REGISTER_SERVICE_MS_PER_ITEM;
  const line = employee.scene.checkoutSystem.lineFor();
  line.push({ cart: [{}] }, { cart: [{}] });
  employee.startNextTask();
  employee.requestClockOut();
  assert.equal(employee.state, "TO_REGISTER");
  employee.arriveAtDestination();
  employee.update(oneItemMs - 1);
  assert.equal(completedSales.length, 0);
  employee.update(1);
  assert.equal(completedSales.length, 1);
  assert.equal(employee.state, "SERVING_REGISTER", "the next customer is served without stepping away");
  assert.equal(employee.currentJob.customer, line[0]);
  employee.update(oneItemMs);
  assert.equal(completedSales.length, 2);
  assert.equal(line.length, 0);
  assert.equal(employee.state, "TO_EXIT");
  assert.equal(employee.currentJob, null);
  assert.equal(employee.isReadyToClockOut(), false);
});

test("closing employees stay on their own register for shoppers inside, serve them, and skip stocking", () => {
  for (const state of ["ON_BREAK", "TO_BREAKROOM"]) {
    const { employee, crate, completedSales } = makeEmployee({
      hasRegister: true, assignedToRegister: true, jobPriorities: ["stock_shelves", "clean", "register"],
    });
    const customer = { state: "BROWSING", cart: [{}] };
    employee.getClosingCustomers = () => [customer];
    employee.state = state;
    employee.sprite.setVisible(false);
    employee.requestClockOut();
    assert.equal(employee.state, "TO_REGISTER");
    employee.arriveAtDestination();
    employee.update(100);
    assert.equal(employee.state, "AT_REGISTER", "waits behind the counter while a shopper is inside");
    assert.equal(crate.quantity, 5);
    customer.state = "QUEUEING";
    employee.scene.checkoutSystem.lineFor().push(customer);
    employee.update(100);
    assert.equal(employee.state, "SERVING_REGISTER");
    customer.state = "LEAVING";
    employee.update(REGISTER_SERVICE_MS_PER_CUSTOMER + REGISTER_SERVICE_MS_PER_ITEM);
    assert.equal(completedSales.length, 1);
    assert.equal(employee.state, "TO_EXIT");
    assert.equal(crate.quantity, 5);
  }
});

test("at closing, employees never serve a register they aren't assigned to", () => {
  const { employee, completedSales } = makeEmployee({
    hasRegister: true, assignedToRegister: false, jobPriorities: ["stock_shelves", "clean", "register"],
  });
  employee.scene.restockCrates = [];
  employee.scene.checkoutSystem.lineFor().push({ state: "QUEUEING", cart: [{}] });
  employee.getClosingCustomers = () => [{ state: "QUEUEING" }];
  employee.requestClockOut();
  assert.equal(employee.state, "TO_EXIT");
  assert.equal(completedSales.length, 0);
});

test("at closing, a bumped employee waits for the player to leave their register, then serves it", () => {
  const { employee, completedSales } = makeEmployee({ hasRegister: true });
  const line = employee.scene.checkoutSystem.lineFor();
  line.push({ state: "QUEUEING", cart: [{}] });
  employee.getClosingCustomers = () => line;
  employee.scene.checkoutSystem.operatingRegister = true;
  employee.requestClockOut();
  assert.equal(employee.state, "WAITING_REGISTER");
  employee.scene.checkoutSystem.operatingRegister = false;
  employee.update(10000);
  assert.equal(employee.state, "TO_REGISTER");
  employee.arriveAtDestination();
  employee.update(REGISTER_SERVICE_MS_PER_CUSTOMER + REGISTER_SERVICE_MS_PER_ITEM);
  assert.equal(completedSales.length, 1);
});

test("clocking out carries a partly stocked delivery into the backroom, freeing the Loading Pad", () => {
  const { employee, shelf, crate } = makeEmployee();
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.requestClockOut();
  finishStocking(employee);
  assert.equal(shelf.placements[0].quantity, 3);
  assert.equal(crate.quantity, 2);
  assert.equal(employee.state, "TO_RETURN_CRATE");
  assert.equal(employee.isReadyToClockOut(), false);
  employee.arriveAtDestination();
  assert.deepEqual(crate.sprite, { x: 96, y: 6560 });
  assert.equal(crate.lockedToPad, false);
  assert.equal(employee.state, "TO_EXIT");
  assert.equal(employee.isReadyToClockOut(), false);
  employee.sprite.body.reset(200, 20);
  employee.update(16);
  assert.equal(employee.isReadyToClockOut(), true);
});

test("a stock clerk carries an empty crate to the nearest trashcan", () => {
  const far = { id: "trash-far", type: "trash_can", gx: 10, gy: 1 };
  const near = { id: "trash-near", type: "trash_can", gx: 2, gy: 1 };
  const { employee, crate } = makeEmployee({ crateQuantity: 3, trashcans: [far, near] });
  employee.startNextTask();
  employee.arriveAtDestination();
  finishStocking(employee);

  assert.equal(employee.state, "TO_TRASHCAN");
  assert.equal(employee.currentJob.trashcan, near);
  assert.equal(crate.isCarried, true);
  employee.arriveAtDestination();
  assert.equal(crate.destroyed, true);
  assert.equal(employee.state, "IDLE");
});

// A real cleaning module on a plain open sales floor, wired into the employee test store.
function addCleaning(scene) {
  const image = () => ({
    destroyed: false,
    setScale() { return this; },
    setDepth() { return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    destroy() { this.destroyed = true; },
  });
  let savedTrash = [];
  let savedDirt = [];
  const shop = {
    textures: { exists: () => true },
    add: { image },
    room: { zones: [{ id: "base", gridX: 0, gridY: 0, gridW: 100, gridH: 100, salesFloor: true }], isWalkable: () => true },
    fixtures: { all: () => [], ofKind: (kind) => scene.fixtures.ofKind(kind) },
    gameState: {
      trash: { setPieces(list) { savedTrash = list; }, setDirt(list) { savedDirt = list; } },
      reputation: { shopLevel: 1 },
    },
    player: { currentFacing: "down", sprite: { x: 0, y: 0, depth: 3 } },
  };
  const cleaning = new CleaningSystem(shop);
  // Records what each employee's mop animation was asked to do.
  const mops = new Map();
  cleaning.createMopAnimation = (actor) => {
    const mop = { presses: [], scrubFrames: 0, destroyed: false };
    mops.set(actor, mop);
    return {
      press: (time) => mop.presses.push(time),
      update: (delta, scrubbing) => { if (scrubbing) mop.scrubFrames += 1; },
      destroy: () => { mop.destroyed = true; },
    };
  };
  scene.cleaning = cleaning;
  return { cleaning, mops, savedTrash: () => savedTrash, savedDirt: () => savedDirt };
}

function addCoworker(scene, id, jobPriorities) {
  scene.gameState.staff.jobPriorities[id] = jobPriorities;
  const coworker = new Employee({ id, name: id }, scene);
  coworker.scene = scene;
  scene.employees.push(coworker);
  return coworker;
}

test("an employee who cleans first carries floor trash to a trashcan, making the store cleaner", () => {
  const { employee } = makeEmployee({ jobPriorities: ["clean", "register", "stock_shelves"] });
  const { cleaning, savedTrash } = addCleaning(employee.scene);
  const far = cleaning.trash.add("paper", 600, 20);
  const near = cleaning.trash.add("can", 100, 20);
  assert.equal(cleaning.getCleanliness().trashCount, 2);

  employee.startNextTask();
  assert.equal(employee.state, "TO_LITTER");
  assert.equal(employee.currentJob.trash, near, "the nearest piece first");
  employee.arriveAtDestination();
  assert.equal(employee.state, "PICKING_UP_LITTER");
  employee.update(TRASH_HANDLING_MS);
  assert.equal(employee.state, "TO_LITTER_BIN");
  assert.deepEqual(cleaning.trash.pieces, [far]);
  assert.equal(cleaning.getCleanliness().trashCount, 2, "carried trash still counts until it's thrown away");
  assert.deepEqual(savedTrash(), [{ kind: "paper", x: 600, y: 20 }]);
  assert.deepEqual(cleaning.serializeTrash(), [
    { kind: "paper", x: 600, y: 20 }, { kind: "can", x: 100, y: 20 },
  ], "a save mid-carry keeps the carried piece once");

  employee.arriveAtDestination();
  assert.equal(employee.state, "BINNING_LITTER");
  employee.update(TRASH_HANDLING_MS);
  assert.equal(employee.state, "IDLE");
  assert.equal(near.sprite.destroyed, true);
  assert.equal(cleaning.getCleanliness().trashCount, 1);
  assert.deepEqual(cleaning.serializeTrash(), [{ kind: "paper", x: 600, y: 20 }]);

  employee.data.skillLevels = { register: 1, stock_shelves: 1, clean: 5 };
  employee.startNextTask();
  assert.equal(employee.currentJob.trash, far);
  employee.arriveAtDestination();
  assert.ok(employee.cleaningActionRemainingMs < TRASH_HANDLING_MS, "skill speeds up picking up trash");
});

test("a failed worker pickup leaves the crate in the world", () => {
  const { employee, crate } = makeEmployee({ jobPriorities: ["stock_shelves"] });
  crate.pickUp = () => false;
  employee.startNextTask();
  employee.arriveAtDestination();
  assert.ok(employee.store.restockCrates.includes(crate));
  assert.equal(crate.lockedToPad, true);
});

test("cleaning has no work without trash or the cleaning module, so the next job starts", () => {
  const { employee } = makeEmployee({ jobPriorities: ["clean", "stock_shelves", "register"] });
  employee.startNextTask();
  assert.equal(employee.state, "TO_CRATE", "no cleaning module");

  const other = makeEmployee({ jobPriorities: ["clean", "stock_shelves", "register"] }).employee;
  addCleaning(other.scene);
  other.startNextTask();
  assert.equal(other.state, "TO_CRATE", "no trash on the floor");

  const noCan = makeEmployee({ jobPriorities: ["clean", "stock_shelves", "register"], trashcans: [] }).employee;
  addCleaning(noCan.scene).cleaning.trash.add("box", 100, 20);
  noCan.startNextTask();
  assert.notEqual(noCan.state, "TO_LITTER", "no trashcan to throw it in");
});

test("two employees and the player never collect the same piece of trash", () => {
  const { employee } = makeEmployee({ jobPriorities: ["clean", "register", "stock_shelves"] });
  const { cleaning } = addCleaning(employee.scene);
  const first = cleaning.trash.add("can", 100, 20);
  const second = cleaning.trash.add("paper", 300, 20);
  const coworker = addCoworker(employee.scene, "sera_floor_assistant", ["clean", "register", "stock_shelves"]);

  employee.startNextTask();
  coworker.startNextTask();
  assert.equal(employee.currentJob.trash, first);
  assert.equal(coworker.currentJob.trash, second, "a claimed piece is left to the employee going for it");

  // The player grabs the first piece before the employee gets there.
  assert.equal(cleaning.pickUpTrash(first), true);
  employee.update(16);
  assert.equal(employee.state, "IDLE");
  assert.equal(cleaning.pickUpTrashForStaff(employee, first), false);
  employee.startNextTask();
  assert.notEqual(employee.state, "TO_LITTER", "the only other piece is already claimed");

  coworker.arriveAtDestination();
  coworker.update(TRASH_HANDLING_MS);
  assert.equal(cleaning.isStaffHoldingTrash(coworker), true);
  assert.equal(cleaning.pickUpTrash(second), false, "the player can't take trash an employee is carrying");
  assert.equal(cleaning.getCleanliness().trashCount, 2, "one in the player's hands, one in the coworker's");
});

test("a worker carrying several pieces keeps each piece until it reaches the trashcan", () => {
  const { employee } = makeEmployee({ jobPriorities: ["clean", "register", "stock_shelves"] });
  const { cleaning } = addCleaning(employee.scene);
  const first = cleaning.trash.add("can", 100, 20);
  const second = cleaning.trash.add("paper", 120, 20);
  const third = cleaning.trash.add("box", 140, 20);
  for (const piece of [first, second]) {
    assert.equal(cleaning.claimTrashForStaff(employee, piece), true);
    assert.equal(cleaning.pickUpTrashForStaff(employee, piece, 2), true);
  }
  assert.equal(cleaning.claimTrashForStaff(employee, third), true);
  assert.equal(cleaning.pickUpTrashForStaff(employee, third, 2), false);
  assert.equal(cleaning.getCleanliness().trashCount, 3);
  assert.equal(cleaning.serializeTrash().length, 3);
  assert.equal(cleaning.throwAwayStaffTrash(employee), true);
  assert.equal(first.sprite.destroyed, true);
  assert.equal(second.sprite.destroyed, true);
  assert.equal(cleaning.getCleanliness().trashCount, 1);
  assert.equal(cleaning.serializeTrash().length, 1);
});

test("a worker with greater waste capacity collects multiple pieces before visiting the bin", () => {
  const { employee } = makeEmployee({ jobPriorities: ["clean", "register", "stock_shelves"] });
  const { cleaning } = addCleaning(employee.scene);
  const pieces = [cleaning.trash.add("can", 100, 20), cleaning.trash.add("paper", 120, 20)];
  employee.wasteCapacity = () => 2;
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.update(TRASH_HANDLING_MS);
  assert.equal(employee.state, "TO_LITTER");
  assert.equal(cleaning.serializeTrash().length, 2);
  employee.arriveAtDestination();
  employee.update(TRASH_HANDLING_MS);
  assert.equal(employee.state, "TO_LITTER_BIN");
  assert.equal(cleaning.getCleanliness().trashCount, 2);
  employee.arriveAtDestination();
  employee.update(TRASH_HANDLING_MS);
  assert.equal(cleaning.getCleanliness().trashCount, 0);
  assert.ok(pieces.every((piece) => piece.sprite.destroyed));
});

test("dropping a worker's batch returns every piece to the floor and saved trash", () => {
  const { employee } = makeEmployee({ jobPriorities: ["clean", "register", "stock_shelves"] });
  const { cleaning, savedTrash } = addCleaning(employee.scene);
  const pieces = [cleaning.trash.add("can", 100, 20), cleaning.trash.add("paper", 120, 20)];
  for (const piece of pieces) {
    assert.equal(cleaning.claimTrashForStaff(employee, piece), true);
    assert.equal(cleaning.pickUpTrashForStaff(employee, piece, 2), true);
  }
  assert.equal(cleaning.dropStaffTrash(employee), true);
  assert.equal(cleaning.isStaffHoldingTrash(employee), false);
  assert.equal(cleaning.trash.pieces.length, 2);
  assert.equal(savedTrash().length, 2);
  assert.equal(cleaning.getCleanliness().trashCount, 2);
});

test("closing never loses or duplicates trash an employee is after or carrying", () => {
  const { employee } = makeEmployee({ jobPriorities: ["clean", "register", "stock_shelves"] });
  const { cleaning, savedTrash } = addCleaning(employee.scene);
  const piece = cleaning.trash.add("can", 100, 20);

  employee.startNextTask();
  employee.requestClockOut();
  employee.update(16);
  assert.equal(employee.isReadyToClockOut(), false);
  assert.equal(employee.state, "TO_LITTER", "the current cleaning task still finishes");
  assert.deepEqual(cleaning.trash.pieces, [piece]);
  employee.arriveAtDestination();
  employee.update(TRASH_HANDLING_MS);
  employee.requestClockOut();
  assert.equal(employee.state, "TO_LITTER_BIN", "carried trash still goes in the trashcan");
  employee.arriveAtDestination();
  employee.update(TRASH_HANDLING_MS);
  assert.equal(employee.state, "TO_EXIT");
  assert.equal(cleaning.isStaffHoldingTrash(employee), false);
  assert.deepEqual(cleaning.trash.pieces, []);
  assert.equal(savedTrash().length, 0);
  assert.equal(cleaning.getCleanliness().trashCount, 0);
  assert.equal(piece.sprite.destroyed, true);
});

function mopEmployee(options = {}) {
  return makeEmployee({ jobPriorities: ["clean", "register", "stock_shelves"], ...options });
}
function mopUntilClean(employee) {
  for (let stroke = 0; stroke < 100 && employee.state === "MOPPING"; stroke += 1) {
    employee.update(MOP_STROKE_MS);
  }
}

test("an employee who cleans walks to each dirt mark and mops it with the sweeping animation, no bucket needed", () => {
  const { employee } = mopEmployee();
  const { cleaning, mops, savedDirt } = addCleaning(employee.scene);
  const far = cleaning.dirt.add("scuff", 600, 20);
  const near = cleaning.dirt.add("smudge", 100, 20);
  assert.equal(cleaning.getCleanliness().score, 16);

  employee.startNextTask();
  assert.equal(employee.state, "TO_DIRT");
  assert.equal(employee.currentJob.dirt, near, "the nearest mark first");
  assert.equal(cleaning.isStaffHoldingMop(employee), false, "the mop only comes out at the mark");
  employee.arriveAtDestination();
  assert.equal(employee.state, "MOPPING");
  assert.equal(cleaning.isStaffHoldingMop(employee), true);

  employee.update(MOP_STROKE_MS);
  assert.equal(savedDirt().find((mark) => mark.kind === "smudge").progress, 1 / 8, "partial mopping is saved");
  mopUntilClean(employee);
  const mop = mops.get(employee);
  assert.equal(mop.presses.length, 8, "one sweep per press the player would need");
  assert.ok(mop.scrubFrames >= 8, "the arms sweep the mop while mopping");
  assert.equal(near.sprite.destroyed, true);
  assert.equal(employee.state, "TO_DIRT", "walks on to the next mark");
  assert.equal(employee.currentJob.dirt, far);
  assert.equal(mop.destroyed, true, "the mop is put away while walking");

  employee.arriveAtDestination();
  mopUntilClean(employee);
  assert.equal(employee.state, "IDLE");
  assert.equal(cleaning.getCleanliness().score, 20);
  assert.deepEqual(savedDirt(), []);
  assert.equal(cleaning.isStaffHoldingMop(employee), false);
});

test("a higher cleaning level sweeps the mop faster", () => {
  const sweepGap = (level) => {
    const { employee } = mopEmployee();
    const { cleaning, mops } = addCleaning(employee.scene);
    cleaning.dirt.add("smudge", 100, 20);
    employee.data.skillLevels = { register: 1, stock_shelves: 1, clean: level };
    employee.startNextTask();
    employee.arriveAtDestination();
    for (let frame = 0; frame < 60; frame += 1) employee.update(16);
    const [first, second] = mops.get(employee).presses;
    return second - first;
  };
  assert.ok(sweepGap(5) < sweepGap(1));
});

test("trash comes before dirt", () => {
  const { employee } = mopEmployee();
  const { cleaning } = addCleaning(employee.scene);
  cleaning.dirt.add("smudge", 100, 20);
  cleaning.trash.add("can", 300, 20);
  employee.startNextTask();
  assert.equal(employee.state, "TO_LITTER");
});

test("two employees never go for the same dirt mark", () => {
  const { employee } = mopEmployee();
  const { cleaning } = addCleaning(employee.scene);
  const near = cleaning.dirt.add("smudge", 100, 20);
  const coworker = addCoworker(employee.scene, "sera_floor_assistant", ["clean", "register", "stock_shelves"]);
  employee.startNextTask();
  coworker.startNextTask();
  assert.equal(employee.currentJob.dirt, near);
  assert.notEqual(coworker.state, "TO_DIRT", "the only mark is spoken for");

  const other = cleaning.dirt.add("scuff", 300, 20);
  coworker.cleaningCheckInMs = 0;
  coworker.finishTask();
  coworker.startNextTask();
  assert.equal(coworker.state, "TO_DIRT");
  assert.equal(coworker.currentJob.dirt, other);
});

test("closing finishes the dirt mark being mopped without starting another", () => {
  const { employee } = mopEmployee();
  const { cleaning, mops } = addCleaning(employee.scene);
  const near = cleaning.dirt.add("smudge", 100, 20);
  cleaning.dirt.add("scuff", 600, 20);
  employee.startNextTask();
  employee.arriveAtDestination();
  employee.update(MOP_STROKE_MS);
  employee.requestClockOut();
  assert.equal(employee.state, "MOPPING");
  mopUntilClean(employee);
  assert.equal(near.sprite.destroyed, true);
  assert.equal(employee.state, "TO_EXIT");
  assert.equal(cleaning.dirt.count, 1);
  assert.equal(mops.get(employee).destroyed, true);

  const { employee: leaving } = mopEmployee();
  const second = addCleaning(leaving.scene);
  second.cleaning.dirt.add("smudge", 100, 20);
  leaving.startNextTask();
  leaving.arriveAtDestination();
  leaving.destroy();
  assert.equal(second.cleaning.isStaffHoldingMop(leaving), false, "the mop is put away with the employee");
  assert.equal(second.cleaning.dirt.pieces[0].claimedBy, null);
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
  finishStocking(employee);
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
  finishStocking(employee);
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
  finishStocking(employee);
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
  finishStocking(employee);
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
  finishStocking(employee);
  assert.equal(employee.state, "WAITING_CRATE_RETURN");
  assert.equal(employee.currentJob.crate, crate);
  assert.equal(crate.isCarried, true);
});

test("an assigned employee stays at their register all shift, ahead of every other job", () => {
  const { employee, completedSales, crate } = makeEmployee({
    hasRegister: true, assignedToRegister: true, jobPriorities: ["stock_shelves", "clean", "register"],
  });
  const line = employee.scene.checkoutSystem.lineFor(employee.scene.fixtures.register());
  const customer = { cart: [{ itemId: "amo_01", price: 4 }] };
  line.push(customer);

  employee.startNextTask();
  assert.equal(employee.state, "TO_REGISTER", "the register outranks stocking, whatever the job order");
  employee.beginRegisterService();
  assert.equal(employee.state, "SERVING_REGISTER");
  employee.updateRegisterService(REGISTER_SERVICE_MS_PER_CUSTOMER + REGISTER_SERVICE_MS_PER_ITEM);
  assert.deepEqual(completedSales, [{ employee, customer }]);
  assert.equal(employee.state, "AT_REGISTER", "they wait behind the counter with nobody in line");
  employee.update(5000);
  assert.equal(employee.state, "AT_REGISTER");
  assert.equal(crate.quantity, 5, "they don't leave to stock");

  const next = { cart: [{}] };
  line.push(next);
  employee.update(16);
  assert.equal(employee.state, "SERVING_REGISTER");
  assert.equal(employee.currentJob.customer, next);
});

test("an unassigned employee never works a register during the shift", () => {
  const { employee } = makeEmployee({ hasRegister: true, assignedToRegister: false });
  employee.scene.checkoutSystem.lineFor().push({ cart: [{}] });
  employee.startNextTask();
  assert.equal(employee.state, "TO_CRATE");
});

test("the player bumps an employee off their register; they do other jobs, then come back", () => {
  const { employee } = makeEmployee({ hasRegister: true, assignedToRegister: true });
  const checkout = employee.scene.checkoutSystem;
  employee.startNextTask();
  employee.beginRegisterService();
  assert.equal(employee.state, "AT_REGISTER");

  checkout.operatingRegister = true;
  employee.cancelRegisterJob(employee.scene.fixtures.register());
  employee.update(16);
  assert.equal(employee.state, "TO_CRATE", "with the register taken, they go stock instead");

  checkout.operatingRegister = false;
  employee.finishTask();
  employee.update(16);
  assert.equal(employee.state, "TO_REGISTER", "once the player leaves, their register comes first again");
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
  // Two items at level 5 register speed (2.0x): half the Level 1 time.
  assert.equal(employee.registerServiceRemainingMs,
    (REGISTER_SERVICE_MS_PER_CUSTOMER + 2 * REGISTER_SERVICE_MS_PER_ITEM) / 2);
});

test("the employee panel hides Register from the job order and offers each register instead", () => {
  const options = {
    hiredEmployeeIds: ["tavi_stock_clerk"],
    activeEmployeeIds: [],
    employeeJobPriorities: {
      tavi_stock_clerk: ["stock_shelves", "register", "clean"],
    },
    credits: 1000,
    canHire: true,
    shopLevel: 4,
    registers: [{ id: "register", name: "REGISTER 1" }, { id: "fixture-9", name: "REGISTER 2" }],
    registerAssignments: { "fixture-9": "tavi_stock_clerk" },
  };
  const stocking = EmployeeRenderer.generateHTML(options);
  assert.match(stocking, /role="listitem" draggable="true"/);
  assert.doesNotMatch(stocking, /data-employee-job="register"/);
  assert.ok(stocking.indexOf('data-employee-job="stock_shelves"') < stocking.indexOf('data-employee-job="clean"'));
  assert.match(stocking, /data-employee-priority-job="stock_shelves" data-employee-priority-move="up"\s+disabled/);
  assert.match(stocking, /data-employee-priority-job="clean" data-employee-priority-move="down"\s+disabled/);
  assert.match(stocking, /2\. Cleaning/);
  assert.match(stocking, /data-employee-register="fixture-9" aria-pressed="true"/);
  assert.match(stocking, /data-employee-register="register" aria-pressed="false"/);
  assert.match(stocking, /data-employee-register="" aria-pressed="false"/);

  const cleaning = EmployeeRenderer.generateHTML({
    ...options, employeeJobPriorities: { tavi_stock_clerk: ["clean", "register", "stock_shelves"] },
  });
  assert.ok(cleaning.indexOf('data-employee-job="clean"') < cleaning.indexOf('data-employee-job="stock_shelves"'));
  const duringShift = EmployeeRenderer.generateHTML({ ...options, canHire: false });
  assert.match(duringShift, /role="listitem" draggable="false"/);
  assert.match(duringShift, /data-employee-register="register" aria-pressed="false"\s+disabled/);

  const twoEmployees = EmployeeRenderer.generateHTML({
    ...options,
    hiredEmployeeIds: ["tavi_stock_clerk", "sera_floor_assistant"],
    shopLevel: 7,
    employeeJobPriorities: {
      tavi_stock_clerk: ["register", "stock_shelves", "clean"],
      sera_floor_assistant: ["stock_shelves", "register", "clean"],
    },
  });
  assert.match(twoEmployees, /data-employee-job-id="tavi_stock_clerk" data-employee-job="stock_shelves"/);
  assert.match(twoEmployees, /REGISTER 2 \(Tavi\)/, "Sera sees who already has a register");
});

test("the employee panel switches staff on and off shift, only between shifts", () => {
  const options = {
    hiredEmployeeIds: ["tavi_stock_clerk"],
    activeEmployeeIds: [],
    employeeJobPriorities: { tavi_stock_clerk: ["register", "stock_shelves", "clean"] },
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

test("the hiring and staff panels show compact skill levels", () => {
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
  assert.match(html, new RegExp(`employee-candidate-wage">${EMPLOYEE_BASE_WAGE}</div>`));
  assert.match(html, new RegExp(`employee-hire-cost">${EMPLOYEE_HIRE_COST}</div>`));
  assert.doesNotMatch(html, /Skills:|credits per shift/);
  assert.doesNotMatch(html.slice(html.indexOf("Your Staff")), /On Shift: works and is paid each shift/);
});

test("training preview shows the selected skill's actual level, speed, price, wage, and absence", () => {
  const skills = { register: 2, stock_shelves: 1, clean: 1 };
  const offer = getEmployeeTrainingOffer("tavi_stock_clerk", skills, "register");
  const options = {
    hiredEmployeeIds: ["tavi_stock_clerk"], activeEmployeeIds: [], employeeJobPriorities: {},
    credits: offer.cost * 2, canHire: true, shopLevel: 4,
    employeeSkills: { tavi_stock_clerk: skills },
  };
  const register = EmployeeRenderer.generateHTML(options);
  assert.match(register, /data-employee-training-job="register"\s+data-employee-training-action="select" aria-pressed="true"/);
  assert.match(register, /Register training<\/strong>[\s\S]*Level 2 → 3/);
  assert.match(register, /Register speed: 120% → 150% of Level 1 speed/);
  assert.ok(offer.nextWagePerShift > offer.wagePerShift);
  assert.ok(register.includes(`Training price: <strong>${formatMoneyAmount(offer.cost)}</strong>`));
  assert.ok(register.includes(
    `Wages after training: <strong>${formatMoneyAmount(offer.nextWagePerShift)} per shift worked or spent in training</strong>`));
  assert.match(register, new RegExp(
    `Tavi will miss the entire next shift\\s+and still be paid ${formatMoneyAmount(offer.wagePerShift)}`));
  assert.match(register, /data-employee-training-action="book"\s+aria-label="Book Register training for Tavi"/);

  const cleaning = EmployeeRenderer.generateHTML({
    ...options, employeeTrainingSelection: { tavi_stock_clerk: "clean" },
  });
  assert.match(cleaning, /data-employee-training-job="clean"\s+data-employee-training-action="select" aria-pressed="true"/);
  assert.match(cleaning, /Cleaning speed: 100% → 120% of Level 1 speed/);
  assert.match(cleaning, /aria-label="Book Cleaning training for Tavi"/);
});

test("training explains and disables booking when a course is unavailable", () => {
  const options = {
    hiredEmployeeIds: ["tavi_stock_clerk"], activeEmployeeIds: [], employeeJobPriorities: {},
    credits: 1000, canHire: true, shopLevel: 4,
  };
  const maxed = EmployeeRenderer.generateHTML({
    ...options, employeeSkills: { tavi_stock_clerk: { register: 5 } },
  });
  assert.match(maxed, /Level 5 \(maximum\)/);
  assert.match(maxed, /This skill is already at Level 5/);
  assert.match(maxed, /data-employee-training-action="book" disabled/);
  assert.doesNotMatch(maxed, /Level 6/);
  assert.doesNotMatch(maxed, /will miss the entire next shift/);

  const firstCourse = getEmployeeTrainingCost(0);
  const unaffordable = EmployeeRenderer.generateHTML({ ...options, credits: firstCourse - 1 });
  assert.match(unaffordable, new RegExp(`Training costs ${firstCourse}. You don&#39;t have enough money`));
  assert.match(unaffordable, /data-employee-training-action="book" disabled/);

  const duringShift = EmployeeRenderer.generateHTML({ ...options, canHire: false });
  assert.match(duringShift, /Book employee training between shifts/);
  assert.match(duringShift, /data-employee-training-action="book" disabled/);

  const booked = EmployeeRenderer.generateHTML({
    ...options, employeeTraining: { tavi_stock_clerk: "stock_shelves" },
    employeeTrainingSelection: { tavi_stock_clerk: "clean" },
  });
  assert.match(booked, /Tavi has Stocking\s+training booked/);
  assert.match(booked, /This employee already has training booked/);
  assert.match(booked, /data-employee-training-action="book" disabled/);
  assert.doesNotMatch(booked, /Training price:|Wages after training:/);
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

test("the employee panel explains the first staff-limit Shop Level before anyone can be hired", () => {
  const firstStaffLevel = STAFF_LIMIT_LEVELS[0];
  const options = {
    hiredEmployeeIds: [],
    activeEmployeeIds: [],
    employeeJobPriorities: {},
    credits: EMPLOYEE_HIRE_COST * 2,
    canHire: true,
  };
  const locked = EmployeeRenderer.generateHTML({ ...options, shopLevel: 1 });
  assert.match(locked, /can(?:'|&#39;)t have employees yet/);
  assert.match(locked, new RegExp(`Shop Level ${firstStaffLevel}\\b`));
  assert.match(locked, new RegExp(`${getShopLevelRequirement(firstStaffLevel)} store reputation`));
  assert.match(locked, /Hired: 0 of 0/);
  assert.match(locked, /data-hire-employee-id="kel_supply_runner"[\s\S]*?disabled/);
  assert.match(locked, />\s*FULL\s*<\/button>/);

  const unlocked = EmployeeRenderer.generateHTML({ ...options, shopLevel: firstStaffLevel });
  for (const id of ["tavi_stock_clerk", "kel_supply_runner"]) {
    assert.doesNotMatch(unlocked, new RegExp(`data-hire-employee-id="${id}"[^>]*disabled`));
  }
  const hireCosts = [...unlocked.matchAll(/class="type-description employee-hire-cost">([^<]+)<\/div>/g)]
    .map(([, cost]) => cost);
  assert.deepEqual(hireCosts, Array(6).fill(String(EMPLOYEE_HIRE_COST)));
  assert.match(unlocked, />\s*HIRE\s*<\/button>/);

  const unaffordable = EmployeeRenderer.generateHTML({
    ...options, shopLevel: firstStaffLevel, credits: EMPLOYEE_HIRE_COST - 0.25,
  });
  assert.match(unaffordable, /You need 0\.25 more/);
  assert.doesNotMatch(unaffordable, /credits/i);
  assert.match(unaffordable, /data-hire-employee-id="tavi_stock_clerk"\s+disabled/);
});

test("each staff-limit Shop Level allows one more hire", () => {
  const options = {
    activeEmployeeIds: [],
    employeeJobPriorities: {},
    credits: EMPLOYEE_HIRE_COST * 2,
    canHire: true,
  };
  const others = ["sera_floor_assistant", "dax_stock_clerk", "ivo_shop_assistant", "rhea_senior_clerk"];
  STAFF_LIMIT_LEVELS.slice(1, others.length + 2).forEach((level, index) => {
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
