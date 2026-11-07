// ==========================================
// FILE: Employee.js
// ==========================================
// A hired employee who serves the register, stocks shelves, and loads storage.
import { InventoryPool } from "./InventoryPool.js";
import { transferItems } from "./InventoryTransfer.js";
import { getFixtureType } from "./FixtureLayout.js";
import { pickRandomCustomerCharacter } from "./CustomerSprites.js";
import { EMPLOYEE_JOB_IDS } from "./EmployeeJobs.js";

const WALK_SPEED = 120;
const DISPLAY_WIDTH = 46;
const DISPLAY_HEIGHT = 48;
const JOB_RETRY_MS = 1000;
const REGISTER_SERVICE_MS_PER_ITEM = 1000;

export class Employee {
  constructor(scene, employeeData) {
    this.scene = scene;
    this.data = employeeData;
    this.backpack = new InventoryPool({
      capacity: employeeData.backpackCapacity,
      stock: [],
    });
    this.state = "IDLE";
    this.currentJob = null;
    this.jobPriorities = [...scene.playerState.employeeJobPriorities[employeeData.id]];
    this.sourceStorage = null;
    this.destination = null;
    this.registerServiceRemainingMs = 0;
    this.path = [];
    this.retryInMs = 0;
    this.clockOutRequested = false;
    this.isDestroyed = false;

    const character = pickRandomCustomerCharacter();
    this.facingTextures = character.facingTextures;
    this.currentFacing = "down";
    this.sprite = scene.add.image(scene.backroomDoor.x, scene.backroomDoor.y, this.facingTextures.down)
      .setDisplaySize(DISPLAY_WIDTH, DISPLAY_HEIGHT)
      .setTint(0x4ade80)
      .setDepth(3);
    scene.physics.add.existing(this.sprite);
    scene.employeeGroup.add(this.sprite);
  }

  update(delta = 0) {
    if (this.isDestroyed) return;
    if (this.state === "IDLE") {
      this.retryInMs -= delta;
      if (this.clockOutRequested) {
        const carried = this.backpack.stock.find((entry) => entry.quantity > 0);
        if (carried && this.retryInMs <= 0) this.returnStockToLocker(carried.itemId);
        else if (this.jobPriorities.includes("register") &&
          this.scene.registerLine.length > 0 && this.retryInMs <= 0) {
          this.startRegisterJob();
        }
        return;
      }
      if (this.retryInMs <= 0) this.startNextTask();
    }
    if (this.state === "SERVING_REGISTER") {
      this.updateRegisterService(delta);
    } else if (["TO_STORAGE", "TO_SHELF", "TO_RETURN", "TO_CRATE", "TO_REGISTER",
      "TO_STORAGE_CRATE"].includes(this.state)) {
      if (this.state === "TO_STORAGE_CRATE") {
        this.currentJob.crate.followCarrier(this.sprite);
      }
      this.followPath();
      if (this.state === "TO_STORAGE_CRATE") {
        this.currentJob.crate.followCarrier(this.sprite);
      }
      this.updateFacing();
    }
  }

  startNextTask() {
    const carried = this.backpack.stock.find((entry) => entry.quantity > 0);
    if (carried) {
      const target = this.findOpenPlacement(carried.itemId);
      if (target) {
        this.currentJob = { ...target, itemId: carried.itemId };
        this.walkTo(target.shelf.standPoint, "TO_SHELF");
      } else {
        this.returnStockToLocker(carried.itemId);
      }
      return;
    }

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
          this.walkTo(job.storage.standPoint, "TO_STORAGE");
          return;
        }
      } else if (jobId === "load_storage") {
        const job = this.findStorageLoadingJob();
        if (job) {
          this.currentJob = { ...job, jobId };
          this.walkTo({ x: job.crate.sprite.x, y: job.crate.sprite.y }, "TO_CRATE");
          return;
        }
      } else if (!EMPLOYEE_JOB_IDS.includes(jobId)) {
        throw new Error(`Employee ${this.data.id} has unknown job priority: ${jobId}`);
      }
    }
    this.retryInMs = JOB_RETRY_MS;
  }

  findRegisterJob() {
    if (this.scene.operatingRegister || this.scene.registerLine.length === 0 ||
      !this.scene.fixtures.register()) return false;
    return !this.scene.employees.some((employee) =>
      employee !== this && employee.currentJob?.jobId === "register",
    );
  }

  startRegisterJob() {
    if (!this.findRegisterJob()) return false;
    this.currentJob = { jobId: "register", customer: this.scene.registerLine[0] };
    return this.walkTo(this.scene.getBehindRegisterPoint(), "TO_REGISTER");
  }

  findStockingJob() {
    const reserved = new Set(this.scene.employees
      .filter((employee) => employee !== this)
      .map((employee) => employee.currentJob?.placement)
      .filter(Boolean));
    const storages = this.scene.fixtures.stockHolders()
      .filter((fixture) => getFixtureType(fixture.type)?.kind === "storage");

    for (const shelf of this.scene.fixtures.shelves()) {
      for (const placement of shelf.placements) {
        if (reserved.has(placement) ||
          shelf.getRemainingUnitsFor(placement.itemId, placement) <= 0) continue;
        const storage = storages.find((fixture) =>
          fixture.getAvailableUnitsFor(placement.itemId) > 0,
        );
        if (storage) return { shelf, placement, storage, itemId: placement.itemId };
      }
    }
    return null;
  }

  findStorageLoadingJob() {
    const storages = this.scene.fixtures.stockHolders()
      .filter((fixture) => getFixtureType(fixture.type)?.kind === "storage");
    const reserved = new Set(this.scene.employees
      .filter((employee) => employee !== this)
      .map((employee) => employee.currentJob?.crate)
      .filter(Boolean));
    for (const crate of this.scene.restockCrates) {
      if (crate.kind !== "item" || !crate.lockedToPad || crate.quantity <= 0 ||
        reserved.has(crate)) continue;
      const storage = storages.find((fixture) =>
        fixture.getRemainingUnitsFor(crate.itemId) > 0,
      );
      if (storage) {
        return {
          crate,
          cratePosition: { x: crate.sprite.x, y: crate.sprite.y },
          storage,
          itemId: crate.itemId,
        };
      }
    }
    return null;
  }

  findOpenPlacement(itemId) {
    const reserved = new Set(this.scene.employees
      .filter((employee) => employee !== this)
      .map((employee) => employee.currentJob?.placement)
      .filter(Boolean));
    for (const shelf of this.scene.fixtures.shelves()) {
      const placement = shelf.placements.find((entry) =>
        entry.itemId === itemId &&
        !reserved.has(entry) &&
        shelf.getRemainingUnitsFor(itemId, entry) > 0,
      );
      if (placement) return { shelf, placement };
    }
    return null;
  }

  walkTo(point, nextState) {
    const path = this.scene.findPath(this.sprite.x, this.sprite.y, point.x, point.y);
    if (path === null) {
      this.currentJob = null;
      this.state = "IDLE";
      this.retryInMs = JOB_RETRY_MS;
      this.sprite.body.setVelocity(0, 0);
      return false;
    }
    this.destination = { x: point.x, y: point.y };
    this.path = path;
    this.state = nextState;
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
        return;
      }
      this.arriveAtDestination();
      return;
    }
    this.sprite.body.setVelocity((dx / distance) * WALK_SPEED, (dy / distance) * WALK_SPEED);
  }

  arriveAtDestination() {
    if (this.state === "TO_STORAGE") this.takeStockFromLocker();
    else if (this.state === "TO_SHELF") this.stockShelf();
    else if (this.state === "TO_RETURN") this.finishReturningStock();
    else if (this.state === "TO_CRATE") {
      const { crate, cratePosition } = this.currentJob;
      if (!crate.lockedToPad || crate.quantity <= 0 || !crate.pickUp(this.sprite)) {
        this.finishTask();
        return;
      }
      this.scene.restockCrates = this.scene.restockCrates.filter((candidate) => candidate !== crate);
      this.currentJob.cratePosition = cratePosition;
      const job = this.currentJob;
      if (!this.walkTo(job.storage.standPoint, "TO_STORAGE_CRATE")) {
        this.currentJob = job;
        this.returnCrateToPad();
      }
    } else if (this.state === "TO_STORAGE_CRATE") {
      this.loadCrateIntoStorage();
    } else if (this.state === "TO_REGISTER") {
      this.beginRegisterService();
    }
  }

  takeStockFromLocker() {
    const { shelf, placement, storage, itemId } = this.currentJob;
    const quantity = Math.min(
      shelf.getRemainingUnitsFor(itemId, placement),
      storage.getAvailableUnitsFor(itemId),
      this.backpack.getRemainingUnitsFor(itemId),
    );
    if (quantity <= 0) {
      this.finishTask();
      return;
    }

    const result = transferItems(storage, this.backpack, itemId, quantity, {
      eventBus: this.scene.eventBus,
      sourceName: "locker",
      destinationName: "employee-backpack",
    });
    this.scene.refreshLockerCapacityDisplay(storage);
    this.scene.playerState.notifyListeners();
    if (result.moved === 0) {
      this.finishTask();
      return;
    }
    this.sourceStorage = storage;
    this.walkTo(shelf.standPoint, "TO_SHELF");
  }

  stockShelf() {
    const { shelf, placement, itemId } = this.currentJob;
    const quantity = Math.min(
      shelf.getRemainingUnitsFor(itemId, placement),
      this.backpack.getAvailableUnitsFor(itemId),
    );
    if (quantity <= 0) {
      this.returnStockToLocker(itemId);
      return;
    }

    const result = transferItems(this.backpack, shelf, itemId, quantity, {
      destinationEntry: placement,
      eventBus: this.scene.eventBus,
      sourceName: "employee-backpack",
      destinationName: "shelf",
    });
    this.scene.refreshShelfStockDisplay(shelf);
    this.scene.playerState.notifyListeners();

    if (this.backpack.getAvailableUnitsFor(itemId) > 0) {
      this.currentJob = null;
      this.state = "IDLE";
      this.retryInMs = 0;
    } else if (result.moved > 0) {
      this.finishTask();
    } else {
      this.returnStockToLocker(itemId);
    }
  }

  loadCrateIntoStorage() {
    const { crate, storage, itemId } = this.currentJob;
    if (!crate.isCarried || crate.quantity <= 0 ||
      storage.getRemainingUnitsFor(itemId) <= 0) {
      this.returnCrateToPad();
      return;
    }

    const quantity = Math.min(
      crate.getAvailableUnitsFor(itemId),
      storage.getRemainingUnitsFor(itemId),
    );
    if (quantity <= 0) {
      this.returnCrateToPad();
      return;
    }
    const result = transferItems(crate, storage, itemId, quantity, {
      eventBus: this.scene.eventBus,
      sourceName: "crate",
      destinationName: "locker",
    });
    this.scene.refreshLockerCapacityDisplay(storage);
    this.scene.fixtureWindow?.refresh(storage);
    this.scene.playerState.notifyListeners();
    if (result.moved === 0) {
      this.returnCrateToPad();
      return;
    }
    if (crate.quantity <= 0) {
      this.scene.restockCrates = this.scene.restockCrates.filter((candidate) => candidate !== crate);
      crate.destroy();
    } else {
      this.returnCrateToPad();
      return;
    }
    this.finishTask();
  }

  returnCrateToPad() {
    const { crate, cratePosition } = this.currentJob;
    crate.drop(cratePosition.x, cratePosition.y, 0, 0, this.scene.crateMotionPaused);
    crate.lockToPad();
    this.scene.restockCrates.push(crate);
    this.finishTask();
  }

  beginRegisterService() {
    const customer = this.scene.registerLine[0];
    if (this.scene.operatingRegister || !customer) {
      this.finishTask();
      return;
    }
    this.currentJob.customer = customer;
    this.registerServiceRemainingMs = Math.max(
      REGISTER_SERVICE_MS_PER_ITEM,
      customer.cart.length * REGISTER_SERVICE_MS_PER_ITEM,
    );
    this.state = "SERVING_REGISTER";
  }

  updateRegisterService(delta) {
    const customer = this.currentJob?.customer;
    if (this.scene.operatingRegister || this.scene.registerLine[0] !== customer) {
      this.finishTask();
      return;
    }
    this.registerServiceRemainingMs -= delta;
    if (this.registerServiceRemainingMs > 0) return;
    this.scene.completeEmployeeCheckout(this, customer);
    this.finishTask();
  }

  cancelRegisterJob() {
    if (this.currentJob?.jobId !== "register") return;
    this.sprite.body.setVelocity(0, 0);
    this.finishTask();
  }

  returnStockToLocker(itemId) {
    const storages = this.scene.fixtures.stockHolders()
      .filter((fixture) => getFixtureType(fixture.type)?.kind === "storage");
    const storage = [this.sourceStorage, ...storages].find((fixture) =>
      fixture?.getRemainingUnitsFor(itemId) > 0,
    );
    if (!storage) {
      this.currentJob = null;
      this.state = "IDLE";
      this.retryInMs = JOB_RETRY_MS;
      return;
    }
    this.returnStorage = storage;
    this.currentJob = null;
    this.walkTo(storage.standPoint, "TO_RETURN");
  }

  finishReturningStock() {
    const entry = this.backpack.findStockEntry(this.backpack.stock.find((stock) =>
      stock.quantity > 0,
    )?.itemId);
    if (!entry) {
      this.finishTask();
      return;
    }
    const result = transferItems(this.backpack, this.returnStorage, entry.itemId, entry.quantity, {
      eventBus: this.scene.eventBus,
      sourceName: "employee-backpack",
      destinationName: "locker",
    });
    this.scene.refreshLockerCapacityDisplay(this.returnStorage);
    this.scene.playerState.notifyListeners();
    if (result.moved < entry.quantity) {
      this.returnStockToLocker(entry.itemId);
      return;
    }
    this.sourceStorage = null;
    this.returnStorage = null;
    this.finishTask();
  }

  finishTask() {
    this.currentJob = null;
    this.sourceStorage = null;
    this.returnStorage = null;
    this.registerServiceRemainingMs = 0;
    this.state = "IDLE";
    this.retryInMs = 0;
  }

  requestClockOut() {
    this.clockOutRequested = true;
  }

  isReadyToClockOut() {
    return this.state === "IDLE" && this.backpack.usedCapacity() === 0;
  }

  updateFacing() {
    const { x, y } = this.sprite.body.velocity;
    if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
    const facing = Math.abs(x) > Math.abs(y)
      ? (x < 0 ? "left" : "right")
      : (y < 0 ? "up" : "down");
    if (facing === this.currentFacing) return;
    this.currentFacing = facing;
    this.sprite.setTexture(this.facingTextures[facing]).setDisplaySize(DISPLAY_WIDTH, DISPLAY_HEIGHT);
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.sprite.body.setVelocity(0, 0);
    this.scene.employeeGroup.remove(this.sprite, false);
    this.sprite.destroy();
  }
}
