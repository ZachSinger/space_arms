// ==========================================
// FILE: Employee.js
// ==========================================
// A hired employee who serves the register and stocks shelves from delivered crates.
import { transferItems } from "./InventoryTransfer.js";
import { addCharacterSprite } from "./CustomerSprites.js";
import { employeeTextureFor, showEmployeeFacing, EMPLOYEE_CRATE_HOLD_OFFSET } from "./EmployeeSprites.js";
import { EMPLOYEE_JOB_IDS } from "./EmployeeJobs.js";
import { getEmployeeJobSpeed } from "./EmployeeTraining.js";
import { fixtureFootprint } from "./FixtureLayout.js";
import { PLAYER_BODY_HEIGHT, PLAYER_BODY_WIDTH } from "./Player.js";
import { FLOOR_STACK_MAX } from "./CrateStack.js";
import { isBackroomRow, TILE_SIZE } from "./RoomLayout.js";

const WALK_SPEED = 120;
const JOB_RETRY_MS = 1000;
const BREAK_CHECK_MS = 100;
const WALK_BODY = { width: PLAYER_BODY_WIDTH, height: PLAYER_BODY_HEIGHT, avoidStoreDoor: true };
// Scanning plus payment per cart item. Deliberately slower than a practiced player: a
// rookie (level 1) keeps up with ~15 customers a shift and melts around 30+, so training
// and extra registers matter (see scripts/staffing-sim.mjs).
export const REGISTER_SERVICE_MS_PER_ITEM = 5000;

export class Employee {
  constructor(scene, employeeData) {
    this.scene = scene;
    this.data = employeeData;
    this.state = "IDLE";
    this.currentJob = null;
    this.jobPriorities = [...scene.gameState.staff.jobPriorities[employeeData.id]];
    this.destination = null;
    this.registerServiceRemainingMs = 0;
    this.path = [];
    this.retryInMs = 0;
    this.clockOutRequested = false;
    this.isDestroyed = false;
    this.pathRetryMs = 0;

    this.currentFacing = "down";
    const spawn = scene.backroomExitFront ?? scene.backroomDoor;
    this.sprite = addCharacterSprite(
      scene, spawn.x, spawn.y, employeeTextureFor(employeeData.id), PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT,
    )
      .setDepth(3);
    scene.employeeGroup.add(this.sprite);
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
          this.scene.anyRegisterLineWaiting() && this.retryInMs <= 0) {
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
    this.walkTo(this.scene.backroomExitFront ?? this.scene.backroomDoor, "TO_BREAKROOM");
  }

  // The first register with customers waiting that neither the player nor another
  // employee is already working, or null.
  findRegisterJob() {
    return this.scene.fixtures.registers().find((register) =>
      register.sprite &&
      !this.scene.isPlayerOperating(register) &&
      this.scene.lineFor(register).length > 0 &&
      !this.scene.employees.some((employee) =>
        employee !== this && employee.currentJob?.jobId === "register" &&
        employee.currentJob?.register === register,
      )) ?? null;
  }

  startRegisterJob() {
    const register = this.findRegisterJob();
    if (!register) return false;
    this.currentJob = { jobId: "register", register, customer: this.scene.lineFor(register)[0] };
    return this.walkTo(this.scene.getBehindRegisterPoint(register), "TO_REGISTER");
  }

  findStockingJob() {
    const reserved = this.getReservedShelfPlacements();
    const reservedCrates = new Set(this.scene.employees
      .filter((employee) => employee !== this)
      .map((employee) => employee.currentJob?.crate)
      .filter(Boolean));

    // Items that are sold out on every shelf come first, then the emptiest shelf spots.
    const onShelves = (itemId) => this.scene.fixtures.shelves()
      .flatMap((shelf) => shelf.placements)
      .reduce((sum, entry) => sum + (entry.itemId === itemId ? entry.quantity : 0), 0);
    let best = null;
    for (const base of this.scene.restockCrates) {
      // Stacked crates are taken from the top; a lone crate is its own top. Any resting
      // crate anywhere in the shop or backroom is fair game. A stack's top crate rides the
      // one below it (flagged as carried), which doesn't make it someone's load.
      const top = this.scene.floorStacks?.get(base)?.at(-1);
      const crate = top ?? base;
      const fromPad = Boolean(base.lockedToPad);
      if (crate.kind !== "item" || crate.quantity <= 0 || (!top && crate.isCarried) ||
        reservedCrates.has(crate)) continue;
      const soldOut = onShelves(crate.itemId) === 0;
      for (const shelf of this.scene.fixtures.shelves()) {
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
    const scene = this.scene;
    if (scene.restockCrates.includes(crate)) {
      if (crate.isCarried) return false;
      if (scene.floorStacks?.get(crate)?.length) return false; // something is stacked on it now
      scene.restockCrates = scene.restockCrates.filter((candidate) => candidate !== crate);
      return true;
    }
    for (const [base, above] of scene.floorStacks ?? []) {
      if (above.at(-1) === crate) {
        above.pop();
        if (above.length === 0) scene.floorStacks.delete(base);
        return true;
      }
      if (above.includes(crate)) return false; // buried mid-stack
    }
    return false;
  }

  getReservedShelfPlacements() {
    return new Set(this.scene.employees
      .filter((employee) => employee !== this)
      .map((employee) => employee.currentJob?.placement)
      .filter(Boolean));
  }

  walkTo(point, nextState) {
    const from = this.sprite.body.center ?? this.sprite;
    const path = this.scene.findPath(from.x, from.y, point.x, point.y, WALK_BODY);
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
    const spots = this.scene.fixtures.ofKind("trash").flatMap((fixture) => {
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
    let best = null;
    for (const spot of spots) {
      const path = this.scene.findPath(position.x, position.y, spot.x, spot.y, WALK_BODY);
      if (!path) continue;
      let length = 0;
      let from = position;
      for (const waypoint of [...path, spot]) {
        length += Math.hypot(waypoint.x - from.x, waypoint.y - from.y);
        from = waypoint.teleportTo ?? waypoint;
      }
      if (!best || length < best.length) best = { spot, path, length };
    }
    return best;
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
    this.state = nextState;
    this.sprite.setVisible(true);
    return true;
  }

  followPath(delta = 1000 / 60) {
    this.pathRetryMs = Math.max(0, this.pathRetryMs - delta);
    let waypoint = this.path[0] || this.destination;
    if (!waypoint) throw new Error(`Employee ${this.data.id} has no movement target.`);

    const position = this.sprite.body.center ?? this.sprite;
    const { blocked, touching } = this.sprite.body;
    const hitting = (direction) => blocked?.[direction] || touching?.[direction];
    if (this.pathRetryMs === 0 &&
      ((waypoint.x > position.x && hitting("right")) || (waypoint.x < position.x && hitting("left")) ||
       (waypoint.y > position.y && hitting("down")) || (waypoint.y < position.y && hitting("up")))) {
      this.pathRetryMs = 200;
      const path = this.scene.findPath(position.x, position.y, this.destination.x, this.destination.y, WALK_BODY);
      if (path === null) {
        this.sprite.body.setVelocity(0, 0);
        if (["TO_TRASHCAN", "TO_RETURN_CRATE"].includes(this.state)) this.returnCrate();
        return;
      }
      this.path = path;
      waypoint = this.path[0] || this.destination;
    }
    const dx = waypoint.x - position.x;
    const dy = waypoint.y - position.y;
    const distance = Math.hypot(dx, dy);
    // Reach corners exactly, rather than turning early into the fixture beside the path.
    if (distance < (this.path.length > 0 ? 0.0001 : 6)) {
      this.sprite.body.setVelocity(0, 0);
      if (this.path.length > 0) {
        this.path.shift();
        // Reaching a door: step through to the floor just inside the other one.
        if (waypoint.teleportTo) this.sprite.body.reset(waypoint.teleportTo.x, waypoint.teleportTo.y);
        return;
      }
      this.arriveAtDestination();
      return;
    }
    const jobId = ["TO_SHELF", "TO_CRATE", "TO_RETURN_CRATE", "TO_TRASHCAN"].includes(this.state)
      ? "stock_shelves"
      : null;
    const maxSpeed = WALK_SPEED * (jobId ? getEmployeeJobSpeed(this.data.skillLevels, jobId) : 1);
    const speed = delta > 0 ? Math.min(maxSpeed, distance / (Math.max(delta, 1000 / 60) / 1000)) : 0;
    this.sprite.body.setVelocity((dx / distance) * speed, (dy / distance) * speed);
  }

  arriveAtDestination() {
    if (this.state === "TO_BREAKROOM") {
      this.sprite.setVisible(false);
      this.state = "ON_BREAK";
      this.destination = null;
      this.retryInMs = BREAK_CHECK_MS;
    } else if (this.state === "TO_CRATE") {
      const { crate, cratePosition } = this.currentJob;
      if (!this.detachCrateForPickup(crate) || !crate.pickUp(this.sprite)) {
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
      eventBus: this.scene.eventBus,
      sourceName: "loading-pad",
      destinationName: "shelf",
    });
    this.scene.refreshShelfStockDisplay(shelf);
    this.scene.gameState.shop.changed();

    if (crate.quantity <= 0) {
      if (!this.walkToTrashcan()) this.returnCrate();
      return;
    }
    this.returnCrate();
  }

  // Fill an existing stack before taking floor space. Deliveries leave the Loading Pad free.
  returnCrate() {
    const { crate, base: originalBase, fromPad, cratePosition } = this.currentJob;
    const scene = this.scene;
    const others = scene.employees.filter((employee) => employee !== this);
    const availableStacks = scene.restockCrates.filter((base) =>
      base.kind === "item" && !base.lockedToPad && !base.isCarried && base.isStationary() &&
      (scene.floorStacks.get(base)?.length ?? 0) + 1 < FLOOR_STACK_MAX &&
      !others.some((employee) =>
        employee.currentJob?.base === base || employee.currentJob?.returnBase === base),
    ).sort((a, b) => {
      const priority = (candidate) => fromPad
        ? (isBackroomRow(Math.floor(candidate.sprite.y / TILE_SIZE)) ? 0 : 1)
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
      ...scene.goBacksReservedRectangles(),
      ...others.flatMap((employee) => employee.currentJob?.returnPosition
        ? [this.returnSpace(employee.currentJob.returnPosition)] : []),
    ];
    const overlapsReserved = (position) => reserved.some((rect) => {
      const bounds = crate.getFloorBounds(position.x, position.y);
      return bounds.left < rect.right && bounds.right > rect.left &&
        bounds.top < rect.bottom && bounds.bottom > rect.top;
    });
    if (!fromPad && !overlapsReserved(cratePosition) &&
      crate.isDropPositionClear(cratePosition.x, cratePosition.y, scene.player.sprite) &&
      this.walkToCratePosition(crate, cratePosition, "TO_RETURN_CRATE")) {
      this.currentJob.returnPosition = { ...cratePosition };
      return;
    }
    let spot = scene.findGoBacksSpot(crate, reserved);
    while (spot) {
      if (this.walkToCratePosition(crate, spot, "TO_RETURN_CRATE")) {
        this.currentJob.returnPosition = { x: spot.x, y: spot.y };
        return;
      }
      reserved.push(this.returnSpace(spot));
      spot = scene.findGoBacksSpot(crate, reserved);
    }
    this.currentJob.returnPosition = null;
    this.sprite.body.setVelocity(0, 0);
    if (this.state !== "WAITING_CRATE_RETURN") {
      scene.showShopMessage("Staff need clear floor space to put down a crate.");
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
    const scene = this.scene;
    if (base) {
      if (!scene.restockCrates.includes(base) || base.lockedToPad || !base.isStationary() ||
        (scene.floorStacks.get(base)?.length ?? 0) + 1 >= FLOOR_STACK_MAX ||
        base.sprite.x !== returnPosition.x || base.sprite.y !== returnPosition.y) {
        this.returnCrate();
        return;
      }
      const stack = scene.floorStacks.get(base) ?? [];
      crate.pickUp(base.sprite);
      stack.push(crate);
      scene.floorStacks.set(base, stack);
      scene.syncFloorStacks();
      this.finishTask();
      return;
    }
    if (!crate.isDropPositionClear(returnPosition.x, returnPosition.y, scene.player.sprite)) {
      this.returnCrate();
      return;
    }
    crate.drop(returnPosition.x, returnPosition.y, 0, 0, scene.crateMotionPaused);
    scene.restockCrates.push(crate);
    this.finishTask();
  }

  discardEmptyCrate() {
    const { crate, trashcan } = this.currentJob;
    if (!this.scene.fixtures.ofKind("trash").includes(trashcan)) {
      this.returnCrate();
      return;
    }
    crate.destroy();
    this.finishTask();
  }

  beginRegisterService() {
    const register = this.currentJob?.register;
    const customer = register ? this.scene.lineFor(register)[0] : null;
    if (!register || this.scene.isPlayerOperating(register) || !customer) {
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
    if (!register || this.scene.isPlayerOperating(register) ||
      this.scene.lineFor(register)[0] !== customer) {
      this.finishTask();
      return;
    }
    this.registerServiceRemainingMs -= delta;
    if (this.registerServiceRemainingMs > 0) return;
    this.scene.completeEmployeeCheckout(this, customer);
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
    this.scene.employeeGroup.remove(this.sprite, false);
    this.sprite.destroy();
  }
}
