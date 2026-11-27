import { Employee } from "./Employee.js";
import { showCharacterFacing } from "./CustomerSprites.js";
import { CashPayment, creditCentsToScrips, splitCash } from "./CashPayment.js";
import { chooseCustomerPayment } from "./CustomerPayment.js";
import { sumMoney, toCents } from "./Money.js";
import { findCell, findFrame, robotProgram, robotSkills } from "./RobotParts.js";
import { ROBOT_PARTS, ROBOT_STANDARD_DRAIN } from "./RobotServiceCatalog.js";
import { CLEANING_TUNING } from "../modules/cleaning/Litter.js";
import { chooseAction } from "./RobotGambits.js";
import { AREA, areaAt } from "../world/Areas.js";
import { EMPLOYEE_CRATE_HOLD_OFFSET } from "./EmployeeSprites.js";

const ROBOT_TEXTURE = "customer_android_mascandroid1";
const WALK_SPEED = 120;

export class RobotWorker extends Employee {
  constructor(build, store, options = {}) {
    super(build, store, { ...options, texture: ROBOT_TEXTURE, jobPriorities: [] });
    this.build = build;
    this.id = build.id;
    this.frame = findFrame(ROBOT_PARTS, build.frame);
    this.cell = findCell(ROBOT_PARTS, build.cell);
    if (!this.frame || !this.cell) throw new Error(`Invalid robot build: ${build.id}.`);
    this.skills = Object.fromEntries(robotSkills(build, ROBOT_PARTS).map(({ id, value }) => [id, value]));
    this.program = robotProgram(build, ROBOT_PARTS);
    this.battery = build.battery ?? 1;
    this.outOfCharge = false;
    this.cargo = [];
    this.programCheckMs = 0;
  }

  update(delta = 0) {
    if (this.isDestroyed) return;
    if (this.state === "ROBOT_WAIT_RECOVERY") {
      this.retryInMs -= delta;
      if (this.retryInMs <= 0) this.recover();
      this.updateFacing();
      return;
    }
    if (this.outOfCharge) {
      this.sprite.body.setVelocity(0, 0);
      this.updateFacing();
      return;
    }
    if (this.state === "ROBOT_CHARGING") {
      this.battery = Math.min(1, this.battery + delta / 1000 * this.cell.chargeRate / this.cell.charge);
      if (this.battery >= 1) this.finishTask();
      this.updateFacing();
      return;
    }
    const share = this.state === "IDLE" || this.state === "ON_BREAK" ? 0.25 : 1;
    this.battery = Math.max(0, this.battery - delta / 1000 * share * ROBOT_STANDARD_DRAIN *
      this.cell.drainRate / this.cell.charge);
    if (this.battery <= 0) {
      this.outOfCharge = true;
      this.sprite.body.setVelocity(0, 0);
      this.store.cleaning?.dropStaffTrash(this);
      this.store.cleaning?.releaseStaffMoppingClaims(this);
      this.store.cleaning?.putAwayStaffMop(this);
      if (!this.currentJob?.crate?.isCarried) this.currentJob = null;
      this.store.showShopMessage(`${this.data.name} ran out of charge and will be recovered when the shop closes.`);
      return;
    }
    if (this.state === "ROBOT_WAIT_DROP") {
      this.retryInMs -= delta;
      if (this.retryInMs <= 0) this.returnCargo();
      this.updateFacing();
      return;
    }
    if (["ROBOT_TO_CHARGER", "ROBOT_TO_PAD", "ROBOT_TO_DROP", "ROBOT_TO_HOME"].includes(this.state)) {
      this.syncCargo();
      this.followPath(delta);
      this.syncCargo();
      this.updateFacing();
      return;
    }
    super.update(delta);
  }

  startCharging(target) {
    const station = this.store.fixtures.ofKind("robot_charger").find((entry) => entry.id === target.id);
    if (!station) return false;
    const closest = this.findClosestSpot(this.fixtureSpots([station]));
    if (!closest) return false;
    this.currentJob = { jobId: "charge", station };
    return this.startPath(closest.spot, closest.path, "ROBOT_TO_CHARGER");
  }

  arriveAtDestination() {
    if (this.state === "ROBOT_TO_CHARGER") {
      this.sprite.body.setVelocity(0, 0);
      this.path = [];
      this.destination = null;
      this.state = "ROBOT_CHARGING";
      return;
    }
    if (this.state === "ROBOT_TO_HOME") {
      this.destroy();
      return;
    }
    if (this.state === "ROBOT_TO_PAD") {
      const { crate, returnPosition } = this.currentJob;
      const padPosition = { x: crate.sprite.x, y: crate.sprite.y };
      if (this.pickUpJobCrate(crate)) this.cargo.push({ crate, returnPosition, padPosition });
      if (!this.clockOutRequested && this.cargo.length < this.skills.carry && this.takeNextPadCrate()) return;
      if (this.cargo.length) this.returnCargo();
      else this.finishTask();
      return;
    }
    if (this.state === "ROBOT_TO_DROP") {
      const { crate, returnPosition } = this.cargo[0];
      if (!crate.isDropPositionClear(returnPosition.x, returnPosition.y, this.store.player.sprite)) {
        this.returnCargo();
        return;
      }
      crate.drop(returnPosition.x, returnPosition.y, 0, 0, this.store.crateMotionPaused);
      this.store.restockCrates.push(crate);
      this.cargo.shift();
      if (this.cargo.length) this.returnCargo();
      else this.finishTask();
      return;
    }
    super.arriveAtDestination();
  }

  syncCargo() {
    this.cargo.forEach(({ crate }, index) => crate.followCarrier(this.sprite, index, EMPLOYEE_CRATE_HOLD_OFFSET));
  }

  cargoReservations(except = null) {
    const others = this.store.employees.filter((worker) => worker !== this);
    return [
      ...this.store.checkoutSystem.goBacksReservedRectangles(),
      ...others.flatMap((worker) => [
        ...(worker.currentJob?.returnPosition ? [this.returnSpace(worker.currentJob.returnPosition)] : []),
        ...(worker.cargo ?? []).map(({ returnPosition }) => this.returnSpace(returnPosition)),
      ]),
      ...this.cargo.filter((load) => load !== except).map(({ returnPosition }) => this.returnSpace(returnPosition)),
    ];
  }

  takeNextPadCrate() {
    for (const crate of this.padCrates()) {
      const spot = this.store.checkoutSystem.findGoBacksSpot(crate, this.cargoReservations());
      if (!spot?.inBackroom) continue;
      this.currentJob = { jobId: "unload_pad", crate, base: crate, returnPosition: spot };
      if (this.walkToCrate(crate, "ROBOT_TO_PAD")) return true;
    }
    return false;
  }

  startUnloading() {
    return this.takeNextPadCrate();
  }

  returnCargo() {
    const load = this.cargo[0];
    if (!load) {
      this.finishTask();
      return;
    }
    const reserved = this.cargoReservations(load);
    let spot = load.returnPosition;
    while (spot) {
      if (load.crate.isDropPositionClear(spot.x, spot.y, this.store.player.sprite) &&
        this.walkToCratePosition(load.crate, spot, "ROBOT_TO_DROP")) {
        load.returnPosition = spot;
        this.currentJob = { jobId: "unload_pad", crate: load.crate, returnPosition: spot };
        return;
      }
      reserved.push(this.returnSpace(spot));
      spot = this.store.checkoutSystem.findGoBacksSpot(load.crate, reserved);
    }
    if (this.clockOutRequested) {
      this.recover();
      return;
    }
    this.currentJob = { jobId: "unload_pad", crate: load.crate };
    this.state = "ROBOT_WAIT_DROP";
    this.retryInMs = 1000;
    this.sprite.body.setVelocity(0, 0);
    this.store.showShopMessage(`${this.data.name} needs a clear place to put down its crates.`);
  }

  requestClockOut() {
    if (this.isDestroyed || this.state === "ROBOT_WAIT_RECOVERY") return;
    if (!this.outOfCharge) {
      if (this.state === "ROBOT_WAIT_DROP" || this.state === "WAITING_CRATE_RETURN") {
        this.clockOutRequested = true;
        this.recover();
        return;
      }
      if (this.state === "ROBOT_TO_CHARGER" || this.state === "ROBOT_CHARGING") {
        this.clockOutRequested = true;
        this.currentJob = null;
        this.finishClosingRegisterWork();
        return;
      }
      if (this.state === "ROBOT_TO_PAD" && this.cargo.length) {
        this.clockOutRequested = true;
        this.returnCargo();
        return;
      }
      super.requestClockOut();
      return;
    }
    this.clockOutRequested = true;
    this.recover();
  }

  recover() {
    if (this.isDestroyed) return;
    this.store.cleaning?.dropStaffTrash(this);
    this.store.cleaning?.releaseStaffMoppingClaims(this);
    const carried = new Set(this.cargo.map(({ crate }) => crate));
    if (this.currentJob?.crate?.isCarried) carried.add(this.currentJob.crate);
    for (const crate of carried) {
      const reserved = this.cargoReservations(this.cargo.find((load) => load.crate === crate));
      const spot = this.store.checkoutSystem.findGoBacksSpot(crate, reserved);
      if (spot) {
        crate.drop(spot.x, spot.y, 0, 0, this.store.crateMotionPaused);
        this.store.restockCrates.push(crate);
      } else if (crate.kind === "item") {
        const quantity = crate.quantity;
        if (quantity > 0 && this.store.gameState.goBacks.takeFrom(crate, crate.itemId, quantity,
          { sourceName: "crate" }) !== quantity) throw new Error("Could not recover robot cargo to Go-Backs.");
        crate.destroy();
        this.store.showShopMessage("No floor space for robot cargo. Its items were sent to Go-Backs.");
      } else {
        const pad = this.cargo.find((load) => load.crate === crate)?.padPosition ??
          this.store.supply.takePadSpots(1)[0];
        if (!pad) {
          if (this.state !== "ROBOT_WAIT_RECOVERY") {
            this.store.showShopMessage("Clear the loading pad or floor space to recover a robot's fixture crate.");
          }
          this.state = "ROBOT_WAIT_RECOVERY";
          this.retryInMs = 1000;
          this.sprite.body.setVelocity(0, 0);
          return;
        }
        crate.drop(pad.x, pad.y, 0, 0, this.store.crateMotionPaused);
        this.store.supply.deliver(crate);
        this.store.supply.freePlayerFromPad();
      }
      this.cargo = this.cargo.filter((load) => load.crate !== crate);
      if (this.currentJob?.crate === crate) this.currentJob = null;
    }
    this.cargo = [];
    this.currentJob = null;
    this.destroy();
  }

  destroy() {
    if (this.isDestroyed) return;
    this.store.gameState.robotService?.setBattery(this.data.id, this.battery);
    super.destroy();
  }

  finishClosingRegisterWork() {
    if (this.cargo.length) {
      this.returnCargo();
      return;
    }
    const hasCustomers = this.getClosingCustomers().some((customer) =>
      !customer.isDestroyed && customer.state !== "LEAVING");
    const canWorkRegister = this.program.some((rule) =>
      rule.action === "work_register" || ["register_1", "register_2"].includes(rule.ability));
    if (hasCustomers && canWorkRegister) {
      const world = this.world();
      world.unavailableActions = ["restock", "unload_pad", "clean", "charge"];
      for (;;) {
        const decision = chooseAction(this.program, world, this, ROBOT_PARTS.conditions, ROBOT_PARTS.measures);
        if (decision.action !== "work_register") break;
        if (this.startRobotAction(decision.action, decision.target)) return;
        this.currentJob = null;
        this.rejectDecision(world, decision);
      }
      this.state = "WAITING_REGISTER";
      this.retryInMs = 1000;
      this.sprite.body.setVelocity(0, 0);
      return;
    }
    const home = this.store.areas.arrivalIn(AREA.BACKROOM);
    if (!this.walkTo(home, "ROBOT_TO_HOME")) this.destroy();
  }

  handleBlockedRoute() {
    if (this.clockOutRequested) {
      this.recover();
      return true;
    }
    if (this.state === "ROBOT_TO_HOME") {
      this.destroy();
      return true;
    }
    if (this.state === "ROBOT_TO_DROP" || (this.state === "ROBOT_TO_PAD" && this.cargo.length)) {
      this.returnCargo();
      return true;
    }
    if (["ROBOT_TO_PAD", "ROBOT_TO_CHARGER", "TO_CRATE", "TO_REGISTER"].includes(this.state)) {
      this.finishTask();
      this.retryInMs = 1000;
      return true;
    }
    if (this.state === "TO_SHELF" && this.currentJob?.crate?.isCarried) {
      this.returnCrate();
      return true;
    }
    return false;
  }

  isCarryingCrate() {
    return this.cargo.length > 0 || super.isCarryingCrate();
  }

  backroomCrates() {
    return this.store.restockCrates.filter((crate) =>
      !crate.lockedToPad && areaAt(crate.sprite.y) === AREA.BACKROOM);
  }

  padCrates() {
    const reserved = new Set(this.store.employees.filter((worker) => worker !== this)
      .map((worker) => worker.currentJob?.crate).filter(Boolean));
    return this.store.restockCrates.filter((crate) =>
      crate.lockedToPad && ["item", "fixture"].includes(crate.kind) && crate.quantity > 0 && !reserved.has(crate));
  }

  world() {
    const workers = this.store.employees.filter((worker) => worker !== this);
    const registers = this.store.fixtures.registers().map((register) => ({
      id: register.id,
      line: this.store.checkoutSystem.lineFor(register).length,
      staffedBy: this.store.checkoutSystem.isOperated(register) ||
        workers.some((worker) => (worker.currentJob?.jobId === "register" &&
          worker.currentJob.register === register) || worker.assignedRegister?.() === register) ? "other" : null,
    }));
    const shelves = this.store.fixtures.shelves().flatMap((shelf) =>
      shelf.placements.map((placement) => {
        const room = shelf.getRemainingUnitsFor(placement.itemId, placement);
        const capacity = placement.quantity + room;
        return { id: placement.id, fill: capacity > 0 ? placement.quantity / capacity : 1 };
      }));
    const cleaning = this.store.cleaning;
    const messes = cleaning
      ? cleaning.staffTrashTargets(this).length + cleaning.staffDirtTargets(this).length : 0;
    const stations = this.store.fixtures.ofKind("robot_charger").map((station) => ({
      id: station.id,
      usedBy: workers.find((worker) => worker.currentJob?.jobId === "charge" &&
        worker.currentJob.station === station)?.data.id ?? null,
    }));
    const padCrates = this.padCrates();
    const backroomCrates = this.backroomCrates();
    return {
      registers, shelves, stations, messes,
      padCrates: padCrates.length, backroomCrates: backroomCrates.length,
      backroomCapacity: backroomCrates.length + (padCrates.length ? 1 : 0),
      unavailableActions: [],
      unavailableTargets: [],
    };
  }

  rejectDecision(world, decision) {
    if (["work_register", "restock", "charge"].includes(decision.action)) {
      world.unavailableTargets.push({ action: decision.action, id: decision.target.id });
    } else world.unavailableActions.push(decision.action);
  }

  startNextTask() {
    if (this.clockOutRequested) {
      this.finishClosingRegisterWork();
      return;
    }
    const world = this.world();
    for (;;) {
      const decision = chooseAction(this.program, world, this, ROBOT_PARTS.conditions, ROBOT_PARTS.measures);
      if (decision.action === "wait") {
        this.state = "IDLE";
        this.retryInMs = 1000;
        return;
      }
      if (this.startRobotAction(decision.action, decision.target)) return;
      this.currentJob = null;
      this.rejectDecision(world, decision);
    }
  }

  startRobotAction(action, target) {
    if (action === "work_register") {
      const register = this.store.fixtures.registers().find((entry) => entry.id === target.id);
      if (!this.isRegisterFree(register)) return false;
      this.currentJob = { jobId: "register", register, customer: this.store.checkoutSystem.lineFor(register)[0] ?? null };
      return this.walkTo(this.store.getBehindRegisterPoint(register), "TO_REGISTER");
    }
    if (action === "restock") {
      const job = this.findStockingJob(this.backroomCrates(), target.id);
      if (!job) return false;
      this.currentJob = { ...job, jobId: "stock_shelves" };
      return this.walkToCrate(job.base ?? job.crate, "TO_CRATE");
    }
    if (action === "clean") return this.startCleaningJob();
    if (action === "charge") return this.startCharging(target);
    if (action === "unload_pad") return this.startUnloading();
    throw new Error(`Unknown robot action: ${action}`);
  }

  assignedRegister() {
    return this.currentJob?.jobId === "register" ? this.currentJob.register : null;
  }

  reconsiderRegister() {
    const previousJob = this.currentJob;
    const world = this.world();
    for (;;) {
      const choice = chooseAction(this.program, world, this, ROBOT_PARTS.conditions, ROBOT_PARTS.measures);
      if (choice.action === "work_register" && choice.target.id === previousJob?.register?.id) return true;
      if (choice.action === "wait") {
        this.finishTask();
        return false;
      }
      if (this.startRobotAction(choice.action, choice.target)) return false;
      this.currentJob = previousJob;
      this.rejectDecision(world, choice);
    }
  }

  beginRegisterService() {
    if (!this.clockOutRequested && !this.reconsiderRegister()) return;
    super.beginRegisterService();
  }

  updateAtRegister(delta = 0) {
    this.programCheckMs -= delta;
    if (!this.clockOutRequested && this.programCheckMs <= 0) {
      this.programCheckMs = 1000;
      if (!this.reconsiderRegister()) return;
    }
    super.updateAtRegister();
  }

  walkToNextDirt() {
    if (this.isStillAfterDirt()) return super.walkToNextDirt();
    this.finishTask();
    return false;
  }

  getWalkSpeed() {
    return WALK_SPEED * this.frame.speed;
  }

  wasteCapacity() {
    return this.skills.handleWaste;
  }

  stockingInterval() {
    return 1000 / this.skills.stocking;
  }

  moppingInterval() {
    return 1000 / (this.skills.mopping * CLEANING_TUNING.mopPressesPerSpot);
  }

  registerServiceDuration(customer) {
    customer.checkoutPayment ??= chooseCustomerPayment(customer.factionId);
    const payment = customer.checkoutPayment;
    let changePieces = 0;
    if (payment.type === "cash" || payment.type === "m-scrips") {
      const total = sumMoney(customer.cart.map(({ price }) => price));
      const currency = payment.type === "m-scrips" ? "m-scrips" : "credits";
      const exactTender = currency === "m-scrips" ? creditCentsToScrips(toCents(total)) : total;
      const cash = new CashPayment(total, payment.exact ? exactTender : undefined, currency);
      changePieces = splitCash(cash.changeDueUnits, currency).reduce((sum, { count }) => sum + count, 0);
    }
    return 1000 * (customer.cart.length / this.skills.scanning + changePieces / this.skills.counting);
  }

  updateFacing() {
    if (this.isDestroyed) return;
    const { x, y } = this.sprite.body.velocity;
    const moving = Math.abs(x) >= 1 || Math.abs(y) >= 1;
    if (moving) {
      this.currentFacing = Math.abs(x) > Math.abs(y)
        ? (x < 0 ? "left" : "right")
        : (y < 0 ? "up" : "down");
      this.sprite.anims.timeScale = Math.hypot(x, y) / WALK_SPEED;
    }
    showCharacterFacing(this.sprite, this.currentFacing, moving);
  }

  standStill() {
    if (this.isDestroyed) return;
    this.sprite.body.setVelocity(0, 0);
    showCharacterFacing(this.sprite, this.currentFacing, false);
  }
}
