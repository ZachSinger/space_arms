// Employees use their assigned cart for batches and cross-room stocking, then dock it.
const READY_RANGE = 100;
const RETURN_FRACTION = 0.2;
const DEPART_FRACTION = 0.8;
const RETRY_MS = 1000;

export class StaffHovercarts {
  constructor(system) {
    this.system = system;
  }

  cartFor(employee) {
    const id = employee.store.gameState.staff.hovercartFor(employee.data.id);
    return this.system.carts.find((cart) => cart.charger.id === id) ?? null;
  }

  employeeFor(cart) {
    return this.system.scene.employees.find((employee) =>
      !employee.isDestroyed && employee.data.id === cart.assignedEmployeeId) ?? null;
  }

  followTarget(cart) {
    const employee = this.employeeFor(cart);
    return employee?.currentJob?.hovercart === cart && employee.state !== "HOVERCART_WAIT_CHARGER"
      ? employee.sprite : cart.dock;
  }

  updateUnattendedCart(cart) {
    if (this.employeeFor(cart)?.currentJob?.hovercart === cart || !cart.active || cart.crossing) return;
    if (Math.hypot(cart.cart.x - cart.dock.x, cart.cart.y - cart.dock.y) <= 72) {
      cart.reset();
      this.changed();
    }
  }

  changed() {
    this.system.scene.gameState.shop.changed();
  }

  ready(employee, cart) {
    const { areas } = employee.store;
    return !cart.moving && !cart.crossing &&
      areas.areaAt(cart.cart.x, cart.cart.y) === areas.areaAt(employee.sprite.x, employee.sprite.y) &&
      Math.hypot(cart.cart.x - employee.sprite.x, cart.cart.y - employee.sprite.y) <= READY_RANGE &&
      cart.hasClearLine(cart.cart, cart.targetFeet(employee.sprite), 16, -2);
  }

  lowBattery(cart) {
    return cart.battery <= cart.batteryCapacity * RETURN_FRACTION;
  }

  startStocking(employee) {
    const cart = this.cartFor(employee);
    if (!cart || employee.hovercartRetryMs > 0) return false;
    if (cart.dead) {
      employee.currentJob = { jobId: "stock_shelves", hovercart: cart };
      this.recover(employee);
      return true;
    }
    if (!cart.isOut() && cart.battery < cart.batteryCapacity * DEPART_FRACTION) return false;
    if (cart.active && this.lowBattery(cart)) {
      employee.currentJob = { jobId: "stock_shelves", hovercart: cart };
      this.returnToCharger(employee);
      return true;
    }
    const cargoJob = employee.findStockingJob(cart.cartCrates);
    const floorJob = employee.findStockingJob();
    const empties = cart.cartCrates.some((crate) => crate.quantity <= 0);
    if (!cargoJob && !floorJob && !empties) return false;
    if (empties && !cargoJob && !employee.findClosestSpot(employee.trashcanSpots())) {
      this.noteBlockedDisposal(employee, cart);
      return false;
    }
    if (!cargoJob && !empties) {
      const sourceArea = employee.store.areas.areaAt(floorJob.base.sprite.x, floorJob.base.sprite.y);
      const shelfArea = employee.store.areas.areaAt(floorJob.shelf.x, floorJob.shelf.y);
      const useful = employee.store.restockCrates.filter((base) => employee.findStockingJob([base]));
      if (sourceArea === shelfArea && useful.length < 2) return false;
      if (cart.cartCrates.length >= cart.capacity) return false;
    }
    if (!cart.isOut()) cart.activateForStaff();
    employee.currentJob = { jobId: "stock_shelves", hovercart: cart };
    if (cargoJob) this.goToShelf(employee, cargoJob);
    else if (empties) this.finishBatch(employee);
    else this.goToSource(employee, floorJob);
    return true;
  }

  goToSource(employee, job) {
    const cart = employee.currentJob.hovercart;
    const loadingArea = employee.store.areas.areaAt(job.base.sprite.x, job.base.sprite.y);
    employee.currentJob = { ...job, jobId: "stock_shelves", hovercart: cart, loadingArea };
    if (!employee.walkToCrate(job.base, "HOVERCART_TO_SOURCE")) {
      employee.currentJob = { jobId: "stock_shelves", hovercart: cart };
      this.finishBatch(employee);
    }
  }

  goToShelf(employee, job) {
    const cart = employee.currentJob.hovercart;
    employee.currentJob = { ...job, jobId: "stock_shelves", hovercart: cart };
    if (!employee.walkTo(job.shelf.standPoint, "HOVERCART_TO_SHELF")) {
      employee.currentJob = { jobId: "stock_shelves", hovercart: cart };
      employee.store.showShopMessage("Staff can't reach a shelf with their hovercart's stock. They're returning it to charge.");
      employee.hovercartRetryMs = RETRY_MS;
      this.returnToCharger(employee);
    }
  }

  loadSource(employee) {
    const { crate, hovercart: cart, loadingArea } = employee.currentJob;
    if (cart.cartCrates.length < cart.capacity && crate.canPickUp() && employee.detachCrateForPickup(crate)) {
      // The crate was just checked and detached synchronously; no other worker can take it.
      if (!crate.pickUp(cart.cart, { holderId: "hovercart" })) {
        throw new Error("A detached employee hovercart crate could not be picked up.");
      }
      cart.cartCrates.push(crate);
      cart.syncCartCrates();
      employee.store.syncFloorStacks();
      this.changed();
    }
    const sources = employee.store.restockCrates.filter((base) =>
      employee.store.areas.areaAt(base.sprite.x, base.sprite.y) === loadingArea);
    const next = cart.cartCrates.length < cart.capacity ? employee.findStockingJob(sources) : null;
    if (next) this.goToSource(employee, next);
    else this.finishStocking(employee);
  }

  finishStocking(employee) {
    const cart = employee.currentJob.hovercart;
    const next = !employee.clockOutRequested && !this.lowBattery(cart)
      ? employee.findStockingJob(cart.cartCrates) : null;
    if (next) this.goToShelf(employee, next);
    else this.finishBatch(employee);
  }

  finishBatch(employee) {
    const cart = employee.currentJob.hovercart;
    employee.currentJob = { jobId: "stock_shelves", hovercart: cart };
    if (!cart.dead && !this.lowBattery(cart) && cart.cartCrates.some((crate) => crate.quantity <= 0)) {
      if (employee.walkToTrashcan("HOVERCART_TO_BIN")) {
        cart.disposalBlocked = false;
        return;
      }
      this.noteBlockedDisposal(employee, cart);
    }
    this.returnToCharger(employee);
  }

  noteBlockedDisposal(employee, cart) {
    if (!cart.disposalBlocked) {
      employee.store.showShopMessage("Staff need a reachable trashcan to empty their hovercart. Empty crates will stay on it for now.");
    }
    cart.disposalBlocked = true;
  }

  returnToCharger(employee) {
    const cart = employee.currentJob.hovercart;
    if (cart.dead && !cart.towedByStaff) {
      this.recover(employee);
      return;
    }
    const waiting = employee.state === "HOVERCART_WAIT_ROUTE";
    const job = { jobId: "stock_shelves", hovercart: cart };
    employee.currentJob = job;
    if (employee.walkTo(cart.launch, "HOVERCART_TO_CHARGER")) return;
    employee.currentJob = job;
    this.waitForRoute(employee, waiting);
  }

  recover(employee) {
    const cart = employee.currentJob.hovercart;
    const waiting = employee.state === "HOVERCART_WAIT_ROUTE";
    const job = { jobId: "stock_shelves", hovercart: cart };
    employee.currentJob = job;
    const { x, y } = cart.cart;
    if (employee.walkToClosestSpot([
      { x: x - 40, y }, { x: x + 40, y }, { x, y: y - 32 }, { x, y: y + 32 },
    ], "HOVERCART_TO_RECOVERY")) return;
    employee.currentJob = job;
    this.waitForRoute(employee, waiting);
  }

  waitForRoute(employee, alreadyWaiting) {
    if (!alreadyWaiting) employee.store.showShopMessage("Staff need a clear route to return their hovercart to its charger.");
    employee.sprite.body.stop();
    employee.path = [];
    employee.destination = null;
    employee.state = "HOVERCART_WAIT_ROUTE";
    employee.retryInMs = RETRY_MS;
  }

  returnBeforeClockOut(employee) {
    const cart = this.cartFor(employee);
    if (!cart?.isOut()) return false;
    employee.currentJob = { jobId: "stock_shelves", hovercart: cart };
    this.returnToCharger(employee);
    return true;
  }

  updateEmployee(employee, delta) {
    employee.hovercartRetryMs = Math.max(0, (employee.hovercartRetryMs ?? 0) - delta);
    const cart = employee.currentJob?.hovercart;
    if (!cart) return false;
    const returning = ["HOVERCART_TO_CHARGER", "HOVERCART_WAIT_CHARGER", "HOVERCART_TO_RECOVERY",
      "HOVERCART_WAIT_ROUTE"].includes(employee.state);
    if (cart.dead && !cart.towedByStaff && employee.state !== "HOVERCART_TO_RECOVERY" &&
      employee.state !== "HOVERCART_WAIT_ROUTE") {
      this.recover(employee);
    } else if (!returning && this.lowBattery(cart)) {
      this.returnToCharger(employee);
    } else if (employee.state === "STOCKING_SHELF" && !this.ready(employee, cart)) {
      employee.state = "HOVERCART_WAIT_SHELF";
    }
    if (!employee.state.startsWith("HOVERCART_")) return false;
    if (employee.state.includes("_TO_")) {
      employee.followPath(delta);
    } else if (employee.state === "HOVERCART_WAIT_ROUTE") {
      employee.retryInMs -= delta;
      if (employee.retryInMs <= 0) this.returnToCharger(employee);
    } else if (employee.state === "HOVERCART_WAIT_CHARGER") {
      if (!cart.crossing && Math.hypot(cart.cart.x - cart.dock.x, cart.cart.y - cart.dock.y) <= 72) {
        cart.reset();
        this.changed();
        employee.finishTask();
      }
    } else if (this.ready(employee, cart)) {
      if (employee.state === "HOVERCART_WAIT_SOURCE") this.loadSource(employee);
      else if (employee.state === "HOVERCART_WAIT_SHELF") employee.stockCrateOnShelf();
      else if (employee.state === "HOVERCART_WAIT_BIN") {
        if (employee.store.fixtures.ofKind("trash").includes(employee.currentJob.trashcan)) {
          const empty = cart.cartCrates.filter((crate) => crate.quantity <= 0);
          cart.cartCrates = cart.cartCrates.filter((crate) => !empty.includes(crate));
          for (const crate of empty) crate.destroy();
          cart.syncCartCrates();
          this.changed();
        }
        this.returnToCharger(employee);
      }
    }
    return true;
  }

  arrive(employee) {
    if (!employee.state.startsWith("HOVERCART_")) return false;
    employee.sprite.body.stop();
    employee.path = [];
    employee.destination = null;
    if (employee.state === "HOVERCART_TO_RECOVERY") {
      const cart = employee.currentJob.hovercart;
      cart.towedByStaff = employee;
      this.returnToCharger(employee);
    } else {
      employee.state = employee.state.replace("_TO_", "_WAIT_");
    }
    return true;
  }

  releaseEmployee(employee) {
    const cart = this.cartFor(employee);
    if (cart) cart.towedByStaff = null;
  }
}
