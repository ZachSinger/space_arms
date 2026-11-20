// ==========================================
// FILE: Employee.js
// ==========================================
// A hired employee who serves the register and stocks shelves from delivered crates.
import { transferItems } from "./InventoryTransfer.js";
import { employeeTextureFor, showEmployeeFacing, EMPLOYEE_CRATE_HOLD_OFFSET } from "./EmployeeSprites.js";
import { EMPLOYEE_JOB_IDS } from "./EmployeeJobs.js";
import { getEmployeeJobSpeed } from "./EmployeeTraining.js";
import { fixtureFootprint } from "./FixtureLayout.js";
import { PLAYER_BODY_HEIGHT, PLAYER_BODY_WIDTH } from "./Player.js";
import { FLOOR_STACK_MAX } from "./CrateStack.js";
import { TILE_SIZE } from "./RoomLayout.js";
import { AREA, areaAt } from "../world/Areas.js";
import { Mover } from "../world/Mover.js";

const WALK_SPEED = 120;
const JOB_RETRY_MS = 1000;
const BREAK_CHECK_MS = 100;
const WALK_BODY = { width: PLAYER_BODY_WIDTH, height: PLAYER_BODY_HEIGHT, avoidStoreDoor: true };
// Scanning plus payment per cart item. Deliberately slower than a practiced player: a
// rookie (level 1) keeps up with ~15 customers a shift and melts around 30+, so training
// and extra registers matter (see scripts/staffing-sim.mjs).
export const REGISTER_SERVICE_MS_PER_ITEM = 5000;

export class Employee {
  constructor(employeeData, store) {
    if (!store || typeof store.findPath !== "function") {
      throw new Error("Employee requires a store interface with findPath.");
    }
    this.store = store;
    this.data = employeeData;
    this.state = "IDLE";
    this.currentJob = null;
    this.jobPriorities = [...store.gameState.staff.jobPriorities[employeeData.id]];
    this.destination = null;
    this.registerServiceRemainingMs = 0;
    this.path = [];
    this.retryInMs = 0;
    this.clockOutRequested = false;
    this.isDestroyed = false;
    this.pathRetryMs = 0;

    this.currentFacing = "down";
    const spawn = store.areas.arrivalIn(AREA.BACKROOM);
    this.sprite = store.createEmployeeSprite(
      spawn.x, spawn.y, employeeTextureFor(employeeData.id), PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT,
    );
    this.mover = this.createMover();
  }

  update(delta = 0) {
    if (this.isDestroyed) return;
    if (this.state === "WAITING_CRATE_RETURN") {
      this.retryInMs -= delta;
      if (this.retryInMs <= 0) this.returnCrate();
      this.updateFacing();
      return;
    }
    if (this.state === "IDLE" || this.state === "ON_BREAK") {
      this.retryInMs -= delta;
      if (this.clockOutRequested) {
        if (this.jobPriorities.includes("register") &&
          this.store.checkoutSystem.anyRegisterLineWaiting() && this.retryInMs <= 0) {
          this.startRegisterJob();
        }
        this.updateFacing();
        return;
      }
      if (this.retryInMs <= 0) this.startNextTask();
    } else if (this.state === "TO_BREAKROOM") {
      this.retryInMs -= delta;
      if (this.retryInMs <= 0) {
        if (this.clockOutRequested) {
          if (this.jobPriorities.includes("register")) this.startRegisterJob();
          if (this.state === "TO_BREAKROOM") this.retryInMs = BREAK_CHECK_MS;
        } else {
          this.startNextTask();
        }
      }
    }
    if (this.state === "SERVING_REGISTER") {
      this.updateRegisterService(delta);
    } else if ([
      "TO_SHELF", "TO_CRATE", "TO_RETURN_CRATE", "TO_TRASHCAN",
      "TO_REGISTER", "TO_BREAKROOM",
    ].includes(this.state)) {
      if (["TO_SHELF", "TO_RETURN_CRATE", "TO_TRASHCAN"].includes(this.state) &&
        this.currentJob.crate.isCarried) {
        this.currentJob.crate.followCarrier(this.sprite, 0, EMPLOYEE_CRATE_HOLD_OFFSET);
      }
      this.followPath(delta);
      if (["TO_SHELF", "TO_RETURN_CRATE", "TO_TRASHCAN"].includes(this.state) &&
        this.currentJob?.crate.isCarried) {
        this.currentJob.crate.followCarrier(this.sprite, 0, EMPLOYEE_CRATE_HOLD_OFFSET);
      }
    }
    if (!this.isDestroyed) this.updateFacing();
  }

  startNextTask() {
    for (const jobId of this.jobPriorities) {
      if (jobId === "register") {
        if (this.findRegisterJob()) {
          this.startRegisterJob();
          return;
        }
      } else if (jobId === "stock_shelves") {
        const job = this.findStockingJob();
        if (job) {
          this.currentJob = { ...job, jobId };
          this.walkToCrate(job.base ?? job.crate, "TO_CRATE");
          return;
        }
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

  // The first register with customers waiting that neither the player nor another
  // employee is already working, or null.
  findRegisterJob() {
    return this.store.fixtures.registers().find((register) =>
      register.sprite &&
      !this.store.checkoutSystem.isPlayerOperating(register) &&
      this.store.checkoutSystem.lineFor(register).length > 0 &&
      !this.store.employees.some((employee) =>
        employee !== this && employee.currentJob?.jobId === "register" &&
        employee.currentJob?.register === register,
      )) ?? null;
  }

  startRegisterJob() {
    const register = this.findRegisterJob();
    if (!register) return false;
    this.currentJob = { jobId: "register", register, customer: this.store.checkoutSystem.lineFor(register)[0] };
    return this.walkTo(this.store.getBehindRegisterPoint(register), "TO_REGISTER");
  }

  findStockingJob() {
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
    for (const base of this.store.restockCrates) {
      // Stacked crates are taken from the top; a lone crate is its own top. Any resting
      // crate anywhere in the shop or backroom is fair game. A stack's top crate rides the
      // one below it (flagged as carried), which doesn't make it someone's load.
      const top = this.store.floorStacks?.get(base)?.at(-1);
      const crate = top ?? base;
      const fromPad = Boolean(base.lockedToPad);
      if (crate.kind !== "item" || crate.quantity <= 0 || (!top && crate.isCarried) ||
        reservedCrates.has(crate)) continue;
      const soldOut = onShelves(crate.itemId) === 0;
      for (const shelf of this.store.fixtures.shelves()) {
        for (const placement of shelf.placements) {
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

  getReservedShelfPlacements() {
    return new Set(this.store.employees
      .filter((employee) => employee !== this)
      .map((employee) => employee.currentJob?.placement)
      .filter(Boolean));
  }

  walkTo(point, nextState) {
    const from = this.sprite.body.center ?? this.sprite;
    const path = this.store.findPath(from.x, from.y, point.x, point.y, WALK_BODY);
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

  walkToTrashcan() {
    const reachX = PLAYER_BODY_WIDTH / 2 + 2;
    const reachY = PLAYER_BODY_HEIGHT / 2 + 2;
    const spots = this.store.fixtures.ofKind("trash").flatMap((fixture) => {
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
    const closest = this.findClosestSpot(spots);
    if (!closest) return false;
    this.currentJob.trashcan = closest.spot.fixture;
    return this.startPath(closest.spot, closest.path, "TO_TRASHCAN");
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
      this.currentJob = null;
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
        this.store.findPath(fromX, fromY, toX, toY, WALK_BODY),
      canFindPath: () => Boolean(this.store.findPath),
      getSpeed: () => this.getWalkSpeed(),
      replanIntervalMs: 200,
      collisionTolerance: 0,
      waypointArrivalDistance: 0.0001,
      destinationArrivalDistance: 6,
      onReroute() {},
      onRerouteUnavailable: (previousPath) => {
        this.path = previousPath;
        if (["TO_TRASHCAN", "TO_RETURN_CRATE"].includes(this.state)) this.returnCrate();
      },
      onPortal: ({ x, y }) => this.sprite.body.reset(x, y),
      onPathUnavailable() {},
    });
  }

  getMover() {
    if (!this.mover) this.mover = this.createMover();
    return this.mover;
  }

  getWalkSpeed() {
    const jobId = ["TO_SHELF", "TO_CRATE", "TO_RETURN_CRATE", "TO_TRASHCAN"].includes(this.state)
      ? "stock_shelves"
      : null;
    return WALK_SPEED * (jobId ? getEmployeeJobSpeed(this.data.skillLevels, jobId) : 1);
  }

  followPath(delta = 1000 / 60) {
    if (!this.path[0] && !this.destination) {
      throw new Error(`Employee ${this.data.id} has no movement target.`);
    }
    this.getMover().followPath(delta);
  }

  arriveAtDestination() {
    if (this.state === "TO_BREAKROOM") {
      this.sprite.setVisible(false);
      this.state = "ON_BREAK";
      this.destination = null;
      this.retryInMs = BREAK_CHECK_MS;
    } else if (this.state === "TO_CRATE") {
      const { crate, cratePosition } = this.currentJob;
      if (!this.detachCrateForPickup(crate) || !crate.pickUp(this.sprite, { holderId: this.data.id })) {
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

    transferItems(crate, shelf, itemId, quantity, {
      destinationEntry: placement,
      eventBus: this.store.eventBus,
      sourceName: "loading-pad",
      destinationName: "shelf",
    });
    this.store.refreshShelfStockDisplay(shelf);
    this.store.gameState.shop.changed();

    if (crate.quantity <= 0) {
      if (!this.walkToTrashcan()) this.returnCrate();
      return;
    }
    this.returnCrate();
  }

  // Fill an existing stack before taking floor space. Deliveries leave the Loading Pad free.
  returnCrate() {
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
      ...others.flatMap((employee) => employee.currentJob?.returnPosition
        ? [this.returnSpace(employee.currentJob.returnPosition)] : []),
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
    const customer = register ? this.store.checkoutSystem.lineFor(register)[0] : null;
    if (!register || this.store.checkoutSystem.isPlayerOperating(register) || !customer) {
      this.finishTask();
      return;
    }
    this.currentJob.customer = customer;
    this.registerServiceRemainingMs = Math.max(
      REGISTER_SERVICE_MS_PER_ITEM,
      customer.cart.length * REGISTER_SERVICE_MS_PER_ITEM,
    ) / getEmployeeJobSpeed(this.data.skillLevels, "register");
    this.state = "SERVING_REGISTER";
  }

  updateRegisterService(delta) {
    const register = this.currentJob?.register;
    const customer = this.currentJob?.customer;
    if (!register || this.store.checkoutSystem.isPlayerOperating(register) ||
      this.store.checkoutSystem.lineFor(register)[0] !== customer) {
      this.finishTask();
      return;
    }
    this.registerServiceRemainingMs -= delta;
    if (this.registerServiceRemainingMs > 0) return;
    this.store.checkoutSystem.completeEmployeeCheckout(this, customer);
    this.finishTask();
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
    this.currentJob = null;
    this.registerServiceRemainingMs = 0;
    this.state = "IDLE";
    this.retryInMs = 0;
  }

  requestClockOut() {
    this.clockOutRequested = true;
  }

  isReadyToClockOut() {
    return this.state === "IDLE" || this.state === "ON_BREAK";
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
    return ["TO_SHELF", "TO_RETURN_CRATE", "TO_TRASHCAN", "WAITING_CRATE_RETURN"].includes(this.state) &&
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
    this.isDestroyed = true;
    this.sprite.body.setVelocity(0, 0);
    this.store.removeEmployeeSprite(this.sprite);
    this.sprite.destroy();
  }
}
