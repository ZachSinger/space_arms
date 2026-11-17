// ==========================================
// FILE: Employee.js
// ==========================================
// A hired employee who serves the register and stocks shelves from delivered crates.
import { transferItems } from "./InventoryTransfer.js";
import { addCharacterSprite, pickRandomCustomerCharacter, showCharacterFacing } from "./CustomerSprites.js";
import { EMPLOYEE_JOB_IDS } from "./EmployeeJobs.js";
import { getEmployeeJobSpeed } from "./EmployeeTraining.js";
import { PLAYER_BODY_HEIGHT, PLAYER_BODY_WIDTH } from "./Player.js";

const WALK_SPEED = 120;
const JOB_RETRY_MS = 1000;
const BREAK_CHECK_MS = 100;
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
    this.jobPriorities = [...scene.playerState.employeeJobPriorities[employeeData.id]];
    this.destination = null;
    this.registerServiceRemainingMs = 0;
    this.path = [];
    this.retryInMs = 0;
    this.clockOutRequested = false;
    this.isDestroyed = false;

    const character = pickRandomCustomerCharacter();
    this.currentFacing = "down";
    const spawn = scene.backroomExitFront ?? scene.backroomDoor;
    this.sprite = addCharacterSprite(
      scene, spawn.x, spawn.y, character.textureKey, PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT,
    )
      .setTint(0x4ade80)
      .setDepth(3);
    scene.employeeGroup.add(this.sprite);
  }

  update(delta = 0) {
    if (this.isDestroyed) return;
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
    } else if (["TO_SHELF", "TO_CRATE", "TO_REGISTER", "TO_BREAKROOM"].includes(this.state)) {
      if (this.state === "TO_SHELF" && this.currentJob.crate.isCarried) {
        this.currentJob.crate.followCarrier(this.sprite);
      }
      this.followPath();
      if (this.state === "TO_SHELF" && this.currentJob?.crate.isCarried) {
        this.currentJob.crate.followCarrier(this.sprite);
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
          this.walkTo({ x: job.crate.sprite.x, y: job.crate.sprite.y }, "TO_CRATE");
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

    for (const crate of this.scene.restockCrates) {
      if (crate.kind !== "item" || !crate.lockedToPad || crate.quantity <= 0 ||
        reservedCrates.has(crate)) continue;
      for (const shelf of this.scene.fixtures.shelves()) {
        const placement = shelf.placements.find((entry) =>
          entry.itemId === crate.itemId && !reserved.has(entry) &&
          shelf.getRemainingUnitsFor(crate.itemId, entry) > 0,
        );
        if (placement) {
          return {
            crate,
            cratePosition: { x: crate.sprite.x, y: crate.sprite.y },
            shelf,
            placement,
            itemId: crate.itemId,
          };
        }
      }
    }
    return null;
  }

  getReservedShelfPlacements() {
    return new Set(this.scene.employees
      .filter((employee) => employee !== this)
      .map((employee) => employee.currentJob?.placement)
      .filter(Boolean));
  }

  walkTo(point, nextState) {
    const path = this.scene.findPath(this.sprite.x, this.sprite.y, point.x, point.y, {
      width: PLAYER_BODY_WIDTH,
      height: PLAYER_BODY_HEIGHT,
    });
    if (path === null) {
      this.currentJob = null;
      this.state = this.state === "ON_BREAK" ? "ON_BREAK" : "IDLE";
      this.retryInMs = this.state === "ON_BREAK" ? BREAK_CHECK_MS : JOB_RETRY_MS;
      this.sprite.body.setVelocity(0, 0);
      return false;
    }
    this.destination = { x: point.x, y: point.y };
    this.path = path;
    this.state = nextState;
    this.sprite.setVisible(true);
    return true;
  }

  followPath() {
    const waypoint = this.path[0] || this.destination;
    if (!waypoint) throw new Error(`Employee ${this.data.id} has no movement target.`);

    const dx = waypoint.x - this.sprite.x;
    const dy = waypoint.y - this.sprite.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 6) {
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
    const jobId = ["TO_SHELF", "TO_CRATE"].includes(this.state) ? "stock_shelves" : null;
    const speed = WALK_SPEED * (jobId ? getEmployeeJobSpeed(this.data.skillLevels, jobId) : 1);
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
      if (!crate.lockedToPad || crate.quantity <= 0 || !crate.pickUp(this.sprite)) {
        this.finishTask();
        return;
      }
      this.scene.restockCrates = this.scene.restockCrates.filter((candidate) => candidate !== crate);
      this.currentJob.cratePosition = cratePosition;
      const job = this.currentJob;
      if (!this.walkTo(job.shelf.standPoint, "TO_SHELF")) {
        this.currentJob = job;
        this.returnCrateToPad();
      }
    } else if (this.state === "TO_SHELF") {
      this.stockCrateOnShelf();
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
      this.returnCrateToPad();
      return;
    }

    transferItems(crate, shelf, itemId, quantity, {
      destinationEntry: placement,
      eventBus: this.scene.eventBus,
      sourceName: "loading-pad",
      destinationName: "shelf",
    });
    this.scene.refreshShelfStockDisplay(shelf);
    this.scene.playerState.notifyListeners();

    if (crate.quantity <= 0) {
      this.scene.restockCrates = this.scene.restockCrates.filter((candidate) => candidate !== crate);
      crate.destroy();
      this.finishTask();
      return;
    }
    this.returnCrateToPad();
  }

  returnCrateToPad() {
    const { crate, cratePosition } = this.currentJob;
    crate.drop(cratePosition.x, cratePosition.y, 0, 0, this.scene.crateMotionPaused);
    crate.lockToPad();
    this.scene.restockCrates.push(crate);
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
    showCharacterFacing(this.sprite, this.currentFacing, moving);
  }

  standStill() {
    if (this.isDestroyed) return;
    this.sprite.body.setVelocity(0, 0);
    showCharacterFacing(this.sprite, this.currentFacing, false);
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.sprite.body.setVelocity(0, 0);
    this.scene.employeeGroup.remove(this.sprite, false);
    this.sprite.destroy();
  }
}
