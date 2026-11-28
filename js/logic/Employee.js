// ==========================================
// FILE: Employee.js
// ==========================================
// A hired employee who serves the register, stocks shelves from delivered crates, and (with the
// cleaning module) carries floor trash to a trashcan.
import { transferItems } from "./InventoryTransfer.js";
import { employeeTextureFor, showEmployeeFacing, EMPLOYEE_CRATE_HOLD_OFFSET } from "./EmployeeSprites.js";
import { EMPLOYEE_JOB_IDS } from "./EmployeeJobs.js";
import { getEmployeeJobSpeed, REGISTER_SERVICE_MS_PER_CUSTOMER, REGISTER_SERVICE_MS_PER_ITEM } from "./EmployeeTraining.js";
import { fixtureFacing, fixtureFootprint } from "./FixtureLayout.js";
import { PLAYER_BODY_HEIGHT, PLAYER_BODY_WIDTH } from "./Player.js";
import { FLOOR_STACK_MAX } from "./CrateStack.js";
import { TILE_SIZE } from "./RoomLayout.js";
import { AREA, areaAt } from "../world/Areas.js";
import { Mover } from "../world/Mover.js";

const WALK_SPEED = 120;
const JOB_RETRY_MS = 1000;
const BREAK_CHECK_MS = 100;
const WALK_BODY = { width: PLAYER_BODY_WIDTH, height: PLAYER_BODY_HEIGHT, avoidStoreDoor: true };
// Bending down for a piece of trash, and dropping it in the trashcan, at cleaning Level 1.
export const TRASH_HANDLING_MS = 600;
// One back-and-forth sweep of the mop at cleaning Level 1; a dirt mark takes the same number of
// sweeps as the player's presses.
export const MOP_STROKE_MS = 250;
// Provisional Level 1 pause for each individual item placed on a shelf.
export const STOCKING_MS_PER_ITEM = 1000;
const CLEANING_WALK_STATES = Object.freeze(["TO_LITTER", "TO_LITTER_BIN", "TO_DIRT"]);
const CLEANING_ACTION_STATES = Object.freeze(["PICKING_UP_LITTER", "BINNING_LITTER", "MOPPING"]);

export class Employee {
  constructor(employeeData, store, {
    exitPoint = null, exitDoor = null, getClosingCustomers = () => [],
    texture = null, jobPriorities = null,
  } = {}) {
    if (!store || typeof store.findPath !== "function") {
      throw new Error("Employee requires a store interface with findPath.");
    }
    this.store = store;
    this.exitPoint = exitPoint;
    this.exitDoor = exitDoor;
    this.getClosingCustomers = getClosingCustomers;
    this.data = employeeData;
    this.state = "IDLE";
    this.currentJob = null;
    this.jobPriorities = [...(jobPriorities ?? store.gameState.staff.jobPriorities[employeeData.id])];
    this.destination = null;
    this.registerServiceRemainingMs = 0;
    this.cleaningActionRemainingMs = 0;
    this.stockingRemainingMs = 0;
    this.stockingUnitsRemaining = 0;
    // After finding no reachable trash or trashcan, wait this long before looking again.
    this.cleaningCheckInMs = 0;
    this.path = [];
    this.retryInMs = 0;
    this.clockOutRequested = false;
    this.isDestroyed = false;
    this.pathRetryMs = 0;

    this.currentFacing = "down";
    const spawn = store.areas.arrivalIn(AREA.BACKROOM);
    this.sprite = store.createEmployeeSprite(
      spawn.x, spawn.y, texture ?? employeeTextureFor(employeeData.id), PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT,
    );
    this.mover = this.createMover();
  }

  update(delta = 0) {
    if (this.isDestroyed) return;
    this.cleaningCheckInMs -= delta;
    if (this.store.hovercarts?.updateEmployee(this, delta)) {
      this.updateFacing();
      return;
    }
    if (this.state === "WAITING_EXIT") {
      this.retryInMs -= delta;
      if (this.retryInMs <= 0) this.walkOut();
      this.updateFacing();
      return;
    }
    if (this.state === "WAITING_REGISTER") {
      this.retryInMs -= delta;
      if (this.retryInMs <= 0) this.finishClosingRegisterWork();
      this.updateFacing();
      return;
    }
    if (this.state === "WAITING_CRATE_RETURN") {
      this.retryInMs -= delta;
      if (this.retryInMs <= 0) this.returnCrate();
      this.updateFacing();
      return;
    }
    if (this.state === "IDLE" || this.state === "ON_BREAK") {
      this.retryInMs -= delta;
      if (this.clockOutRequested) {
        this.finishClosingRegisterWork();
        return;
      }
      if (this.retryInMs <= 0) this.startNextTask();
    } else if (this.state === "TO_BREAKROOM") {
      this.retryInMs -= delta;
      if (this.retryInMs <= 0) {
        this.startNextTask();
      }
    }
    if (this.state === "SERVING_REGISTER") {
      this.updateRegisterService(delta);
    } else if (this.state === "AT_REGISTER") {
      this.updateAtRegister(delta);
    } else if (this.state === "STOCKING_SHELF") {
      this.updateStocking(delta);
    } else if (CLEANING_ACTION_STATES.includes(this.state)) {
      this.updateCleaningAction(delta);
    } else if (this.state === "TO_LITTER" && !this.isStillAfterTrash()) {
      this.sprite.body.setVelocity(0, 0);
      this.finishTask();
    } else if (this.state === "TO_DIRT" && !this.isStillAfterDirt()) {
      this.sprite.body.setVelocity(0, 0);
      this.walkToNextDirt();
    } else if ([
      "TO_SHELF", "TO_CRATE", "TO_RETURN_CRATE", "TO_TRASHCAN",
      "TO_REGISTER", "TO_BREAKROOM", "TO_CLOSING_REGISTER", "TO_EXIT", ...CLEANING_WALK_STATES,
    ].includes(this.state)) {
      if (["TO_SHELF", "TO_RETURN_CRATE", "TO_TRASHCAN"].includes(this.state) &&
        this.currentJob.crate.isCarried) {
        this.currentJob.crate.followCarrier(this.sprite, 0, EMPLOYEE_CRATE_HOLD_OFFSET);
      }
      if (this.state === "TO_EXIT" && this.exitDoor?.door.isNear(this.sprite)) {
        this.exitDoor.letIn(this.sprite);
      }
      this.followPath(delta);
      if (["TO_SHELF", "TO_RETURN_CRATE", "TO_TRASHCAN"].includes(this.state) &&
        this.currentJob?.crate.isCarried) {
        this.currentJob.crate.followCarrier(this.sprite, 0, EMPLOYEE_CRATE_HOLD_OFFSET);
      }
    }
    if (this.isDestroyed) return;
    this.updateFacing();
    this.store.cleaning?.updateStaffMop(this, delta, this.state === "MOPPING");
  }

  startNextTask() {
    if (this.clockOutRequested) {
      this.finishClosingRegisterWork();
      return;
    }
    // An assigned register outranks every other job, unless the player is working it.
    if (this.startRegisterJob()) return;
    for (const jobId of this.jobPriorities) {
      if (jobId === "register") {
        continue;
      } else if (jobId === "stock_shelves") {
        if (this.store.hovercarts?.startStocking(this)) return;
        const job = this.findStockingJob();
        if (job) {
          this.currentJob = { ...job, jobId };
          this.walkToCrate(job.base ?? job.crate, "TO_CRATE");
          return;
        }
      } else if (jobId === "clean") {
        if (this.startCleaningJob()) return;
      } else if (!EMPLOYEE_JOB_IDS.includes(jobId)) {
        throw new Error(`Employee ${this.data.id} has unknown job priority: ${jobId}`);
      }
    }
    if (this.state === "ON_BREAK" || this.state === "TO_BREAKROOM") {
      this.retryInMs = BREAK_CHECK_MS;
      return;
    }
    this.walkTo(this.store.areas.arrivalIn(AREA.BACKROOM), "TO_BREAKROOM");
  }

  /** The placed register this employee is assigned to, or null. */
  assignedRegister() {
    const assignments = this.store.gameState.staff.registerAssignments ?? {};
    const registerId = Object.keys(assignments).find((id) => assignments[id] === this.data.id);
    return registerId
      ? this.store.fixtures.registers().find((register) => register.id === registerId && register.sprite) ?? null
      : null;
  }

  isRegisterFree(register) {
    return Boolean(register?.sprite) && !this.store.checkoutSystem.isOperated(register) &&
      !this.store.employees.some((employee) =>
        employee !== this && employee.currentJob?.jobId === "register" &&
        employee.currentJob?.register === register);
  }

  // Only ever the assigned register. At closing, only while it still has customers to serve.
  findRegisterJob() {
    const assigned = this.assignedRegister();
    if (!assigned || !this.isRegisterFree(assigned)) return null;
    return !this.clockOutRequested || this.assignedRegisterStillNeeded(assigned) ? assigned : null;
  }

  // At closing: customers are in this register's line, or still shopping and may join it.
  assignedRegisterStillNeeded(register) {
    return this.store.checkoutSystem.lineFor(register).length > 0 || this.getClosingCustomers().some(
      (customer) => !customer.isDestroyed && customer.state !== "LEAVING");
  }

  startRegisterJob() {
    const register = this.findRegisterJob();
    if (!register) return false;
    this.currentJob = { jobId: "register", register, customer: this.store.checkoutSystem.lineFor(register)[0] ?? null };
    return this.walkTo(this.store.getBehindRegisterPoint(register), "TO_REGISTER");
  }

  findStockingJob(candidates = this.store.restockCrates, placementId = null) {
    const reserved = this.getReservedShelfPlacements();
    const reservedCrates = new Set(this.store.employees
      .filter((employee) => employee !== this)
      .map((employee) => employee.currentJob?.crate)
      .filter(Boolean));

    // Items that are sold out on every shelf come first, then the emptiest shelf spots.
    const onShelves = (itemId) => this.store.fixtures.shelves()
      .flatMap((shelf) => shelf.placements)
      .reduce((sum, entry) => sum + (entry.itemId === itemId ? entry.quantity : 0), 0);
    let best = null;
    const cartCargo = this.store.hovercarts?.cartFor(this)?.cartCrates ?? [];
    for (const base of candidates) {
      // Stacked crates are taken from the top; a lone crate is its own top. Any resting
      // crate anywhere in the shop or backroom is fair game. A stack's top crate rides the
      // one below it (flagged as carried), which doesn't make it someone's load.
      const top = this.store.floorStacks?.get(base)?.at(-1);
      const crate = top ?? base;
      const fromPad = Boolean(base.lockedToPad);
      if (crate.kind !== "item" || crate.quantity <= 0 || (!top && crate.isCarried && !cartCargo.includes(crate)) ||
        reservedCrates.has(crate)) continue;
      const soldOut = onShelves(crate.itemId) === 0;
      for (const shelf of this.store.fixtures.shelves()) {
        for (const placement of shelf.placements) {
          if (placementId !== null && placement.id !== placementId) continue;
          if (placement.itemId !== crate.itemId || reserved.has(placement)) continue;
          const room = shelf.getRemainingUnitsFor(crate.itemId, placement);
          if (room <= 0) continue;
          const fullness = placement.quantity / (placement.quantity + room);
          const score = (soldOut ? 0 : 1) + fullness;
          if (best && best.score <= score) continue;
          best = {
            score,
            job: {
              crate,
              base,
              fromPad,
              cratePosition: { x: crate.sprite.x, y: crate.sprite.y },
              shelf,
              placement,
              itemId: crate.itemId,
            },
          };
        }
      }
    }
    return best?.job ?? null;
  }

  // Lifts the job's crate out of the world lists so it can be carried: a lone crate leaves
  // restockCrates; a stack's top crate leaves its stack. Anything buried or changed is refused.
  detachCrateForPickup(crate) {
    if (crate.quantity <= 0) return false;
    const store = this.store;
    if (store.restockCrates.includes(crate)) {
      if (crate.isCarried) return false;
      if (store.floorStacks?.get(crate)?.length) return false; // something is stacked on it now
      store.restockCrates = store.restockCrates.filter((candidate) => candidate !== crate);
      return true;
    }
    for (const [base, above] of store.floorStacks ?? []) {
      if (above.at(-1) === crate) {
        above.pop();
        if (above.length === 0) store.floorStacks.delete(base);
        return true;
      }
      if (above.includes(crate)) return false; // buried mid-stack
    }
    return false;
  }

  pickUpJobCrate(crate) {
    const wasOnFloor = this.store.restockCrates.includes(crate);
    const stackBase = wasOnFloor ? null : [...(this.store.floorStacks ?? [])]
      .find(([_base, stack]) => stack.at(-1) === crate)?.[0];
    if (!this.detachCrateForPickup(crate)) return false;
    if (crate.pickUp(this.sprite, { holderId: this.data.id, hidden: this.hidesCarriedCrates })) return true;
    if (wasOnFloor) this.store.restockCrates.push(crate);
    else if (stackBase) {
      const stack = this.store.floorStacks.get(stackBase) ?? [];
      stack.push(crate);
      this.store.floorStacks.set(stackBase, stack);
      this.store.syncFloorStacks();
    }
    return false;
  }

  getReservedShelfPlacements() {
    return new Set(this.store.employees
      .filter((employee) => employee !== this)
      .map((employee) => employee.currentJob?.placement)
      .filter(Boolean));
  }

  walkTo(point, nextState) {
    const from = this.sprite.body.center ?? this.sprite;
    const path = this.store.findPath(from.x, from.y, point.x, point.y, this.walkBody());
    return this.startPath(point, path, nextState);
  }

  /**
   * Walks to whichever side of the crate (below, above, left, right) is quickest to reach.
   * Its middle is never a goal: a crate pushed against a wall leaves no room to stand there.
   * @param {Crate} base - the crate on the floor (a stack's bottom crate)
   */
  walkToCrate(base, nextState) {
    const bounds = base.getFloorBounds?.();
    if (!bounds) return this.walkTo({ x: base.sprite.x, y: base.sprite.y }, nextState);
    const reachX = PLAYER_BODY_WIDTH / 2 + 2;
    const reachY = PLAYER_BODY_HEIGHT / 2 + 2;
    const midX = (bounds.left + bounds.right) / 2;
    const midY = (bounds.top + bounds.bottom) / 2;
    return this.walkToClosestSpot([
      { x: midX, y: bounds.bottom + reachY }, { x: midX, y: bounds.top - reachY },
      { x: bounds.left - reachX, y: midY }, { x: bounds.right + reachX, y: midY },
    ], nextState);
  }

  walkToClosestSpot(spots, nextState) {
    const best = this.findClosestSpot(spots);
    if (!best) return false;
    return this.startPath(best.spot, best.path, nextState);
  }

  walkToCratePosition(crate, position, nextState) {
    const bounds = crate.getFloorBounds?.();
    if (!bounds) return this.walkTo(position, nextState);
    const reachX = PLAYER_BODY_WIDTH / 2 + 2;
    const reachY = PLAYER_BODY_HEIGHT / 2 + 2;
    const left = position.x + bounds.left - crate.sprite.x;
    const right = position.x + bounds.right - crate.sprite.x;
    const top = position.y + bounds.top - crate.sprite.y;
    const bottom = position.y + bounds.bottom - crate.sprite.y;
    const midX = (left + right) / 2;
    const midY = (top + bottom) / 2;
    return this.walkToClosestSpot([
      { x: midX, y: bottom + reachY }, { x: midX, y: top - reachY },
      { x: left - reachX, y: midY }, { x: right + reachX, y: midY },
    ], nextState);
  }

  trashcanSpots() {
    return this.fixtureSpots(this.store.fixtures.ofKind("trash"));
  }

  // Standing spots one step outside each side of each fixture.
  fixtureSpots(fixtures) {
    const reachX = PLAYER_BODY_WIDTH / 2 + 2;
    const reachY = PLAYER_BODY_HEIGHT / 2 + 2;
    return fixtures.flatMap((fixture) => {
      const { w, h } = fixtureFootprint(fixture);
      const left = fixture.gx * TILE_SIZE;
      const top = fixture.gy * TILE_SIZE;
      const right = left + w * TILE_SIZE;
      const bottom = top + h * TILE_SIZE;
      const midX = (left + right) / 2;
      const midY = (top + bottom) / 2;
      return [
        { x: midX, y: bottom + reachY }, { x: midX, y: top - reachY },
        { x: left - reachX, y: midY }, { x: right + reachX, y: midY },
      ].map((spot) => ({ ...spot, fixture }));
    });
  }

  walkToTrashcan(nextState = "TO_TRASHCAN") {
    const closest = this.findClosestSpot(this.trashcanSpots());
    if (!closest) return false;
    this.currentJob.trashcan = closest.spot.fixture;
    return this.startPath(closest.spot, closest.path, nextState);
  }

  // Cleaning: trash first (the nearest piece nobody else is after, then the nearest trashcan),
  // then dirt (walk to the nearest mark and mop it, then the next). No cleaning module,
  // no mess, or nowhere reachable to take it means there's no cleaning work.
  startCleaningJob() {
    const cleaning = this.store.cleaning;
    if (!cleaning || this.cleaningCheckInMs > 0) return false;
    return this.startTrashJob(cleaning) || this.startMoppingJob(cleaning);
  }

  startTrashJob(cleaning) {
    const pieces = cleaning.staffTrashTargets(this);
    if (pieces.length === 0 || this.store.fixtures.ofKind("trash").length === 0) return false;
    const nearest = this.findClosestSpot(pieces.flatMap((piece) =>
      cleaning.trashStandSpots(piece).map((spot) => ({ ...spot, piece }))));
    if (!nearest || !this.findClosestSpot(this.trashcanSpots()) ||
      !cleaning.claimTrashForStaff(this, nearest.spot.piece)) {
      this.cleaningCheckInMs = JOB_RETRY_MS;
      return false;
    }
    this.currentJob = { jobId: "clean", trash: nearest.spot.piece };
    if (this.startPath(nearest.spot, nearest.path, "TO_LITTER")) return true;
    cleaning.releaseStaffClaims(this);
    return false;
  }

  // Beside the mark, never on it, so the mop head lands on the dirt like the player's does.
  dirtSpots(marks) {
    const cleaning = this.store.cleaning;
    return marks.flatMap((mark) => cleaning.trashStandSpots(mark).slice(1).map((spot) => ({ ...spot, mark })));
  }

  startMoppingJob(cleaning) {
    const marks = cleaning.staffDirtTargets(this);
    if (marks.length === 0) return false;
    const toDirt = this.findClosestSpot(this.dirtSpots(marks));
    if (!toDirt || !cleaning.claimDirtForStaff(this, toDirt.spot.mark)) {
      this.cleaningCheckInMs = JOB_RETRY_MS;
      return false;
    }
    this.currentJob = { jobId: "clean", dirt: toDirt.spot.mark };
    if (this.startPath(toDirt.spot, toDirt.path, "TO_DIRT")) return true;
    cleaning.releaseStaffMoppingClaims(this);
    return false;
  }

  isStillAfterDirt() {
    const dirt = this.currentJob?.dirt;
    return Boolean(dirt && this.store.cleaning?.isDirtClaimedBy(dirt, this));
  }

  // The claimed mark if it's still dirty, otherwise the nearest unclaimed one. At closing time
  // the claimed mark still gets finished, but no new one is started.
  walkToNextDirt() {
    const cleaning = this.store.cleaning;
    const job = this.currentJob;
    cleaning.putAwayStaffMop(this);
    const marks = this.isStillAfterDirt() ? [job.dirt]
      : this.clockOutRequested ? [] : cleaning.staffDirtTargets(this);
    const nearest = marks.length > 0 ? this.findClosestSpot(this.dirtSpots(marks)) : null;
    if (nearest && cleaning.claimDirtForStaff(this, nearest.spot.mark)) {
      job.dirt = nearest.spot.mark;
      if (this.startPath(nearest.spot, nearest.path, "TO_DIRT")) return true;
      this.currentJob = job;
    }
    this.finishTask();
    return false;
  }

  arriveAtDirt() {
    if (!this.isStillAfterDirt()) {
      this.walkToNextDirt();
      return;
    }
    this.faceToward(this.currentJob.dirt);
    this.store.cleaning.takeMopForStaff(this);
    this.beginCleaningAction("MOPPING");
    // The first sweep starts right away.
    this.cleaningActionRemainingMs = 0;
  }

  faceToward(point) {
    const position = this.sprite.body.center ?? this.sprite;
    const dx = point.x - position.x;
    const dy = point.y - position.y;
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
      this.currentFacing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
    }
  }

  // False once the player (or anyone) has taken the claimed piece.
  isStillAfterTrash() {
    const trash = this.currentJob?.trash;
    return Boolean(trash && this.store.cleaning?.isClaimedBy(trash, this));
  }

  beginCleaningAction(nextState) {
    this.sprite.body.setVelocity(0, 0);
    this.destination = null;
    this.path = [];
    this.state = nextState;
    this.cleaningActionRemainingMs = TRASH_HANDLING_MS / getEmployeeJobSpeed(this.data.skillLevels, "clean");
  }

  wasteCapacity() {
    return 1;
  }

  moppingInterval() {
    return MOP_STROKE_MS / getEmployeeJobSpeed(this.data.skillLevels, "clean");
  }

  stockingInterval() {
    return STOCKING_MS_PER_ITEM / getEmployeeJobSpeed(this.data.skillLevels, "stock_shelves");
  }

  registerServiceDuration(customer) {
    return (REGISTER_SERVICE_MS_PER_CUSTOMER + customer.cart.length * REGISTER_SERVICE_MS_PER_ITEM) /
      getEmployeeJobSpeed(this.data.skillLevels, "register");
  }

  collectMoreTrash() {
    const cleaning = this.store.cleaning;
    if (this.clockOutRequested || (cleaning.staffHeldTrash.get(this)?.length ?? 0) >= this.wasteCapacity()) return false;
    const nearest = this.findClosestSpot(cleaning.staffTrashTargets(this).flatMap((piece) =>
      cleaning.trashStandSpots(piece).map((spot) => ({ ...spot, piece }))));
    if (!nearest || !cleaning.claimTrashForStaff(this, nearest.spot.piece)) return false;
    const job = this.currentJob;
    job.trash = nearest.spot.piece;
    if (this.startPath(nearest.spot, nearest.path, "TO_LITTER")) return true;
    this.currentJob = job;
    cleaning.releaseStaffClaims(this);
    return false;
  }

  updateCleaningAction(delta) {
    const cleaning = this.store.cleaning;
    if (this.state === "MOPPING") {
      this.updateMopping(delta);
      return;
    }
    if (this.state === "PICKING_UP_LITTER" && !this.isStillAfterTrash()) {
      this.finishTask();
      return;
    }
    this.cleaningActionRemainingMs -= delta;
    if (this.cleaningActionRemainingMs > 0) return;
    if (this.state === "PICKING_UP_LITTER") {
      if (!cleaning.pickUpTrashForStaff(this, this.currentJob.trash, this.wasteCapacity())) {
        this.finishTask();
        return;
      }
      if (this.collectMoreTrash()) return;
      const job = this.currentJob;
      if (!this.walkToTrashcan("TO_LITTER_BIN")) {
        this.currentJob = job;
        this.finishTask();
      }
      return;
    }
    cleaning.throwAwayStaffTrash(this);
    this.finishTask();
  }

  // Each sweep is one stroke of progress; higher skill speeds up the mop window.
  updateMopping(delta) {
    const job = this.currentJob;
    if (job.finishingSweep) {
      // The mark is clean; let the last sweep play out before walking off.
      this.cleaningActionRemainingMs -= delta;
      if (this.cleaningActionRemainingMs > 0) return;
      job.finishingSweep = false;
      this.walkToNextDirt();
      return;
    }
    if (!this.isStillAfterDirt()) {
      this.walkToNextDirt();
      return;
    }
    this.cleaningActionRemainingMs -= delta;
    if (this.cleaningActionRemainingMs > 0) return;
    this.cleaningActionRemainingMs += this.moppingInterval();
    if (this.store.cleaning.mopDirtForStaff(this, job.dirt)) job.finishingSweep = true;
  }

  arriveAtTrash() {
    const trash = this.currentJob?.trash;
    if (!this.isStillAfterTrash()) {
      this.finishTask();
      return;
    }
    this.faceToward(trash);
    this.beginCleaningAction("PICKING_UP_LITTER");
  }

  arriveAtTrashBin() {
    const { trashcan } = this.currentJob;
    if (!this.store.cleaning?.isStaffHoldingTrash(this)) {
      this.finishTask();
      return;
    }
    if (!this.store.fixtures.ofKind("trash").includes(trashcan)) {
      if (!this.walkToTrashcan("TO_LITTER_BIN")) this.finishTask();
      return;
    }
    this.beginCleaningAction("BINNING_LITTER");
  }

  findClosestSpot(spots) {
    const position = this.sprite.body.center ?? this.sprite;
    const areas = this.store.areas;
    const startArea = areas?.areaAt?.(position.x, position.y);
    // A walk within one room is never shorter than a straight line, so farther spots can be
    // skipped. Door crossings jump between rooms, so those spots are always checked.
    const candidates = spots.map((spot, index) => ({
      spot,
      index,
      minimumLength: startArea !== undefined && areas.areaAt(spot.x, spot.y) === startArea
        ? Math.hypot(spot.x - position.x, spot.y - position.y)
        : 0,
    })).sort((a, b) => a.minimumLength - b.minimumLength || a.index - b.index);
    let best = null;
    for (const { spot, index, minimumLength } of candidates) {
      if (best && minimumLength > best.length + 1e-6) break;
      const path = this.store.findPath(position.x, position.y, spot.x, spot.y, WALK_BODY);
      if (!path) continue;
      let length = 0;
      let from = position;
      for (const waypoint of [...path, spot]) {
        length += Math.hypot(waypoint.x - from.x, waypoint.y - from.y);
        from = waypoint.teleportTo ?? waypoint;
      }
      if (!best || length < best.length || (length === best.length && index < best.index)) {
        best = { spot, path, length, index };
      }
    }
    return best && { spot: best.spot, path: best.path, length: best.length };
  }

  startPath(point, path, nextState) {
    if (path === null) {
      if (!this.currentJob?.crate?.isCarried) this.currentJob = null;
      this.state = this.state === "ON_BREAK" ? "ON_BREAK" : "IDLE";
      this.retryInMs = this.state === "ON_BREAK" ? BREAK_CHECK_MS : JOB_RETRY_MS;
      this.sprite.body.setVelocity(0, 0);
      return false;
    }
    this.destination = { x: point.x, y: point.y };
    this.path = path;
    this.pathRetryMs = 0;
    this.onArriveAtDestination = () => this.arriveAtDestination();
    this.state = nextState;
    this.sprite.setVisible(true);
    return true;
  }

  createMover() {
    if (!this.store?.findPath) throw new Error("Employee requires a store route interface.");
    return new Mover(this, {
      findPath: (fromX, fromY, toX, toY) =>
        this.store.findPath(fromX, fromY, toX, toY, this.walkBody()),
      canFindPath: () => Boolean(this.store.findPath),
      getSpeed: () => this.getWalkSpeed(),
      replanIntervalMs: 200,
      collisionTolerance: 0,
      waypointArrivalDistance: 0.0001,
      destinationArrivalDistance: 6,
      onReroute() {},
      onRerouteUnavailable: (previousPath) => {
        this.path = previousPath;
        if (this.handleBlockedRoute?.()) return;
        if (this.currentJob?.hovercart) {
          this.store.hovercarts.returnToCharger(this);
        } else if (["TO_TRASHCAN", "TO_RETURN_CRATE"].includes(this.state)) this.returnCrate();
        else if (CLEANING_WALK_STATES.includes(this.state)) {
          this.sprite.body.setVelocity(0, 0);
          this.finishTask();
        }
      },
      onPortal: ({ x, y }) => this.sprite.body.reset(x, y),
      onPathUnavailable() {},
    });
  }

  getMover() {
    if (!this.mover) this.mover = this.createMover();
    return this.mover;
  }

  walkBody() {
    return this.state === "TO_EXIT" ? { ...WALK_BODY, avoidStoreDoor: false } : WALK_BODY;
  }

  getWalkSpeed() {
    if (this.currentJob?.hovercart?.towedByStaff) return 60;
    const jobId = this.state.startsWith("HOVERCART_") ||
      ["TO_SHELF", "TO_CRATE", "TO_RETURN_CRATE", "TO_TRASHCAN"].includes(this.state)
      ? "stock_shelves"
      : CLEANING_WALK_STATES.includes(this.state) ? "clean" : null;
    return WALK_SPEED * (jobId ? getEmployeeJobSpeed(this.data.skillLevels, jobId) : 1);
  }

  followPath(delta = 1000 / 60) {
    if (!this.path[0] && !this.destination) {
      throw new Error(`Employee ${this.data.id} has no movement target.`);
    }
    this.getMover().followPath(delta);
  }

  arriveAtDestination() {
    if (this.store.hovercarts?.arrive(this)) return;
    if (this.state === "TO_EXIT") {
      this.destroy();
    } else if (this.state === "TO_CLOSING_REGISTER") {
      this.state = "WAITING_REGISTER";
      this.destination = null;
      this.retryInMs = 0;
    } else if (this.state === "TO_BREAKROOM") {
      this.sprite.setVisible(false);
      this.state = "ON_BREAK";
      this.destination = null;
      this.retryInMs = BREAK_CHECK_MS;
    } else if (this.state === "TO_CRATE") {
      const { crate, cratePosition } = this.currentJob;
      if (!this.pickUpJobCrate(crate)) {
        this.finishTask();
        return;
      }
      this.currentJob.cratePosition = cratePosition;
      crate.followCarrier(this.sprite, 0, EMPLOYEE_CRATE_HOLD_OFFSET);
      const job = this.currentJob;
      if (!this.walkTo(job.shelf.standPoint, "TO_SHELF")) {
        this.currentJob = job;
        this.returnCrate();
      }
    } else if (this.state === "TO_SHELF") {
      this.stockCrateOnShelf();
    } else if (this.state === "TO_RETURN_CRATE") {
      this.finishReturningCrate();
    } else if (this.state === "TO_TRASHCAN") {
      this.discardEmptyCrate();
    } else if (this.state === "TO_REGISTER") {
      this.beginRegisterService();
    } else if (this.state === "TO_LITTER") {
      this.arriveAtTrash();
    } else if (this.state === "TO_LITTER_BIN") {
      this.arriveAtTrashBin();
    } else if (this.state === "TO_DIRT") {
      this.arriveAtDirt();
    }
  }

  stockCrateOnShelf() {
    const { crate, shelf, placement, itemId } = this.currentJob;
    const quantity = Math.min(
      shelf.getRemainingUnitsFor(itemId, placement),
      crate.getAvailableUnitsFor(itemId),
    );
    if (quantity <= 0) {
      this.returnCrate();
      return;
    }

    this.sprite.body.setVelocity(0, 0);
    this.path = [];
    this.destination = null;
    this.state = "STOCKING_SHELF";
    this.stockingUnitsRemaining = quantity;
    this.stockingRemainingMs = this.stockingInterval();
  }

  updateStocking(delta) {
    const { crate, shelf, placement, itemId } = this.currentJob;
    this.stockingRemainingMs -= delta;
    while (this.stockingRemainingMs <= 0 && this.stockingUnitsRemaining > 0) {
      const { moved } = transferItems(crate, shelf, itemId, 1, {
        destinationEntry: placement,
        eventBus: this.store.eventBus,
        sourceName: this.currentJob.hovercart ? "hovercart" : "loading-pad",
        destinationName: "shelf",
      });
      if (moved === 0) break;
      this.stockingUnitsRemaining -= moved;
      this.store.refreshShelfStockDisplay(shelf);
      this.store.gameState.shop.changed();
      this.stockingRemainingMs += this.stockingInterval();
    }
    if (this.stockingUnitsRemaining > 0 && this.stockingRemainingMs > 0) return;
    if (this.currentJob.hovercart) {
      this.store.hovercarts.finishStocking(this);
      return;
    }
    if (crate.quantity <= 0) {
      if (!this.walkToTrashcan()) this.returnCrate();
      return;
    }
    this.returnCrate();
  }

  // Fill an existing stack before taking floor space. Deliveries leave the Loading Pad free.
  returnCrate() {
    if (this.currentJob.hovercart) {
      this.store.hovercarts.finishStocking(this);
      return;
    }
    const { crate, base: originalBase, fromPad, cratePosition } = this.currentJob;
    const store = this.store;
    const others = store.employees.filter((employee) => employee !== this);
    const availableStacks = store.restockCrates.filter((base) =>
      base.kind === "item" && !base.lockedToPad && !base.isCarried && base.isStationary() &&
      (store.floorStacks.get(base)?.length ?? 0) + 1 < FLOOR_STACK_MAX &&
      !others.some((employee) =>
        employee.currentJob?.base === base || employee.currentJob?.returnBase === base),
    ).sort((a, b) => {
      const priority = (candidate) => fromPad
        ? (areaAt(candidate.sprite.y) === AREA.BACKROOM ? 0 : 1)
        : (candidate === originalBase ? 0 : 1);
      return priority(a) - priority(b) ||
        Math.hypot(a.sprite.x - this.sprite.x, a.sprite.y - this.sprite.y) -
        Math.hypot(b.sprite.x - this.sprite.x, b.sprite.y - this.sprite.y);
    });
    for (const base of availableStacks) {
      if (!this.walkToCratePosition(crate, base.sprite, "TO_RETURN_CRATE")) continue;
      this.currentJob.returnBase = base;
      this.currentJob.returnPosition = { x: base.sprite.x, y: base.sprite.y };
      return;
    }
    this.currentJob.returnBase = null;
    const reserved = [
      ...store.checkoutSystem.goBacksReservedRectangles(),
      ...others.flatMap((employee) => [
        ...(employee.currentJob?.returnPosition ? [this.returnSpace(employee.currentJob.returnPosition)] : []),
        ...(employee.cargo ?? []).map(({ returnPosition }) => this.returnSpace(returnPosition)),
      ]),
    ];
    const overlapsReserved = (position) => reserved.some((rect) => {
      const bounds = crate.getFloorBounds(position.x, position.y);
      return bounds.left < rect.right && bounds.right > rect.left &&
        bounds.top < rect.bottom && bounds.bottom > rect.top;
    });
    if (!fromPad && !overlapsReserved(cratePosition) &&
      crate.isDropPositionClear(cratePosition.x, cratePosition.y, store.player.sprite) &&
      this.walkToCratePosition(crate, cratePosition, "TO_RETURN_CRATE")) {
      this.currentJob.returnPosition = { ...cratePosition };
      return;
    }
    let spot = store.checkoutSystem.findGoBacksSpot(crate, reserved);
    while (spot) {
      if (this.walkToCratePosition(crate, spot, "TO_RETURN_CRATE")) {
        this.currentJob.returnPosition = { x: spot.x, y: spot.y };
        return;
      }
      reserved.push(this.returnSpace(spot));
      spot = store.checkoutSystem.findGoBacksSpot(crate, reserved);
    }
    this.currentJob.returnPosition = null;
    this.sprite.body.setVelocity(0, 0);
    if (this.state !== "WAITING_CRATE_RETURN") {
      store.showShopMessage("Staff need clear floor space to put down a crate.");
    }
    this.state = "WAITING_CRATE_RETURN";
    this.retryInMs = JOB_RETRY_MS;
  }

  returnSpace({ x, y }) {
    return {
      left: x - TILE_SIZE / 2, right: x + TILE_SIZE / 2,
      top: y - TILE_SIZE / 2, bottom: y + TILE_SIZE / 2,
    };
  }

  finishReturningCrate() {
    const { crate, returnBase: base, returnPosition } = this.currentJob;
    const store = this.store;
    if (base) {
      if (!store.restockCrates.includes(base) || base.lockedToPad || !base.isStationary() ||
        (store.floorStacks.get(base)?.length ?? 0) + 1 >= FLOOR_STACK_MAX ||
        base.sprite.x !== returnPosition.x || base.sprite.y !== returnPosition.y) {
        this.returnCrate();
        return;
      }
      const stack = store.floorStacks.get(base) ?? [];
      crate.pickUp(base.sprite, { stackedOnId: base.id });
      stack.push(crate);
      store.floorStacks.set(base, stack);
      store.syncFloorStacks();
      this.finishTask();
      return;
    }
    if (!crate.isDropPositionClear(returnPosition.x, returnPosition.y, store.player.sprite)) {
      this.returnCrate();
      return;
    }
    crate.drop(returnPosition.x, returnPosition.y, 0, 0, store.crateMotionPaused);
    store.restockCrates.push(crate);
    this.finishTask();
  }

  discardEmptyCrate() {
    const { crate, trashcan } = this.currentJob;
    if (!this.store.fixtures.ofKind("trash").includes(trashcan)) {
      this.returnCrate();
      return;
    }
    crate.destroy();
    this.finishTask();
  }

  beginRegisterService() {
    const register = this.currentJob?.register;
    if (!register || !register.sprite || this.store.checkoutSystem.isOperated(register)) {
      this.finishTask();
      return;
    }
    this.sprite.body.setVelocity(0, 0);
    if (register.type) this.currentFacing = fixtureFacing(register);
    const customer = this.store.checkoutSystem.lineFor(register)[0];
    if (!customer) {
      // Nobody waiting: stay behind the counter, unless closing time leaves no one to serve.
      if (this.clockOutRequested && !this.assignedRegisterStillNeeded(register)) {
        this.finishTask();
        return;
      }
      this.currentJob.customer = null;
      this.state = "AT_REGISTER";
      return;
    }
    this.currentJob.customer = customer;
    this.registerServiceRemainingMs = this.registerServiceDuration(customer);
    this.state = "SERVING_REGISTER";
  }

  updateAtRegister() {
    const register = this.currentJob?.register;
    if (!register || !register.sprite || this.store.checkoutSystem.isOperated(register)) {
      this.finishTask();
      return;
    }
    this.sprite.body.setVelocity(0, 0);
    if (this.store.checkoutSystem.lineFor(register).length > 0 ||
      (this.clockOutRequested && !this.assignedRegisterStillNeeded(register))) {
      this.beginRegisterService();
    }
  }

  updateRegisterService(delta) {
    const register = this.currentJob?.register;
    const customer = this.currentJob?.customer;
    if (!register || this.store.checkoutSystem.isOperated(register)) {
      this.finishTask();
      return;
    }
    if (this.store.checkoutSystem.lineFor(register)[0] !== customer) {
      this.beginRegisterService();
      return;
    }
    this.registerServiceRemainingMs -= delta;
    if (this.registerServiceRemainingMs > 0) return;
    this.store.checkoutSystem.completeEmployeeCheckout(this, customer);
    this.beginRegisterService();
  }

  /**
   * Stops this employee's register job, optionally only when it targets one register
   * (the one the player just stepped behind).
   * @param {object} [register] - register fixture; omitted cancels any register job
   */
  cancelRegisterJob(register = null) {
    if (this.currentJob?.jobId !== "register") return;
    if (register && this.currentJob.register !== register) return;
    this.sprite.body.setVelocity(0, 0);
    this.finishTask();
  }

  finishTask() {
    // Trash still in hand goes back on the floor, so it's never lost or counted twice, and a
    // mop in hand is put away.
    if (this.currentJob?.jobId === "clean") this.dropCleaningThings();
    this.currentJob = null;
    this.registerServiceRemainingMs = 0;
    this.cleaningActionRemainingMs = 0;
    this.stockingRemainingMs = 0;
    this.stockingUnitsRemaining = 0;
    this.state = "IDLE";
    this.retryInMs = 0;
    if (this.clockOutRequested) this.finishClosingRegisterWork();
  }

  dropCleaningThings() {
    this.store.cleaning?.dropStaffTrash(this);
    this.store.cleaning?.releaseStaffMoppingClaims(this);
    this.store.cleaning?.putAwayStaffMop(this);
  }

  requestClockOut() {
    if (this.isDestroyed || this.clockOutRequested) return;
    this.clockOutRequested = true;
    if (!this.currentJob) this.finishClosingRegisterWork();
  }

  finishClosingRegisterWork() {
    if (this.startRegisterJob()) return;
    // Only the employee assigned to a register waits for it (for example, while the player
    // is working it); everyone else goes home.
    const assigned = this.assignedRegister();
    if (!assigned || !this.assignedRegisterStillNeeded(assigned)) {
      if (this.store.hovercarts?.returnBeforeClockOut(this)) return;
      this.walkOut();
      return;
    }
    this.sprite.setVisible(true);
    this.sprite.body.setVelocity(0, 0);
    const position = this.sprite.body.center ?? this.sprite;
    const area = this.store.areas.areaAt?.(position.x, position.y) ?? areaAt(position.y);
    // Wait on the sales floor for shoppers still inside, not hidden on a backroom break.
    if (area !== AREA.SHOP &&
      this.walkTo(this.store.areas.arrivalIn(AREA.SHOP), "TO_CLOSING_REGISTER")) return;
    this.state = "WAITING_REGISTER";
    this.destination = null;
    this.path = [];
    this.retryInMs = BREAK_CHECK_MS;
  }

  walkOut() {
    if (!this.exitPoint) throw new Error("Employee requires a public exit point to clock out.");
    this.state = "TO_EXIT";
    if (!this.walkTo(this.exitPoint, "TO_EXIT")) {
      this.state = "WAITING_EXIT";
      this.retryInMs = JOB_RETRY_MS;
      this.sprite.setVisible(true);
    }
  }

  isReadyToClockOut() {
    return this.isDestroyed;
  }

  // Walks in the direction of travel, or holds the standing pose in the last facing.
  updateFacing() {
    const { x, y } = this.sprite.body.velocity;
    const moving = Math.abs(x) >= 1 || Math.abs(y) >= 1;
    if (moving) {
      this.currentFacing = Math.abs(x) > Math.abs(y)
        ? (x < 0 ? "left" : "right")
        : (y < 0 ? "up" : "down");
      this.sprite.anims.timeScale = Math.hypot(x, y) / WALK_SPEED;
    }
    showEmployeeFacing(
      this.sprite, this.data.id, this.currentFacing, moving, this.isCarryingCrate(),
    );
  }

  isCarryingCrate() {
    return !this.currentJob?.hovercart &&
      ["TO_SHELF", "STOCKING_SHELF", "TO_RETURN_CRATE", "TO_TRASHCAN", "WAITING_CRATE_RETURN"].includes(this.state) &&
      Boolean(this.currentJob?.crate.isCarried);
  }

  standStill() {
    if (this.isDestroyed) return;
    this.sprite.body.setVelocity(0, 0);
    showEmployeeFacing(
      this.sprite, this.data.id, this.currentFacing, false, this.isCarryingCrate(),
    );
  }

  destroy() {
    if (this.isDestroyed) return;
    if (this.currentJob?.jobId === "clean") this.dropCleaningThings();
    this.store.hovercarts?.releaseEmployee(this);
    this.isDestroyed = true;
    this.sprite.body.setVelocity(0, 0);
    this.store.removeEmployeeSprite(this.sprite);
    this.sprite.destroy();
  }
}
