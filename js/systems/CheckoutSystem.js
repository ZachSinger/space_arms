// Player-operated registers, customer queues, and handing completed sales to the checkout window.
// This system owns queue and tuck state; the scene remains the source of world objects and services.
import { GAME_EVENTS } from "../core/Events.js";
import { loadTuning } from "../core/Tuning.js";
import checkoutTuning from "../../data/tuning/checkout.json" with { type: "json" };
import { database } from "../scenes/boot.js";
import { getCrateItemLimit } from "../logic/ShelfSlotStocking.js";
import { FLOOR_STACK_MAX } from "../logic/CrateStack.js";
import { chooseCustomerPayment } from "../logic/CustomerPayment.js";
import { formatTransactionTotal } from "../logic/Money.js";
import { CRATE_FOOTER_HEIGHT_PX } from "../logic/CrateFooter.js";
import { TILE_SIZE, BACKROOM_UPGRADE_ORDER, getBackroomBounds, getBackroomLink, getStoreDoorCells } from "../logic/RoomLayout.js";
import { fixtureAccessCells, fixtureFacing, fixtureFacingStep, fixtureFootprint, fixtureStandingSpot } from "../logic/FixtureLayout.js";
import { worldToClientRect } from "../logic/FixtureHighlight.js";
import { getGameScale } from "../logic/GameViewport.js";
import { PLAYER_CHARACTER_HEIGHT } from "../logic/Player.js";
import { controlLabel } from "../input/InputDevice.js";
import { sortPeopleByFeet } from "../world/Depth.js";

/** @typedef {import("../logic/Crate.js").Crate} Crate */
/** @typedef {import("../logic/Customer.js").Customer} Customer */

const REGISTER_ABOVE_LOWER_FRACTION = 0.3;
const REGISTER_BELOW_RAISE_FRACTION = 0.65;
const REGISTER_INTERACT_RANGE = 12;
// How far the operating player's feet sit past the register graphic's top edge (px).
const REGISTER_BEHIND_OVERLAP = 10;
export const CHECKOUT_TUNING = loadTuning("checkout", checkoutTuning);
const CUSTOMER_EXIT_SLOT_OFFSETS = Object.freeze([
  [-8, -4], [0, -4], [8, -4], [-8, 4], [0, 4], [8, 4],
].map(([dx, dy]) => Object.freeze({ dx, dy })));

export class CheckoutSystem {
  constructor(shop) {
    this.shop = shop;
    this.registerLines = new Map();
    this.operatingRegister = false;
    this.operatingRegisterFixture = null;
    this.playerPositionBeforeRegister = null;
    this.registerDepthBeforeTuck = null;
    this.goBacksPackRetryAt = 0;
    this.goBacksStuckKey = null;
    if (shop.interactables) this.registerInteractions();
  }

  // Just past the body box's rear edge, excluding transparent picture margins.
  behindRegisterPoint(register = this.operatingRegisterFixture ?? this.shop.fixtures.register()) {
    const bounds = register.sprite.body;
    const { dx, dy } = fixtureFacingStep(register, true);
    const player = this.shop.player.sprite;
    const reachX = bounds.width / 2 + player.displayWidth / 2 - REGISTER_BEHIND_OVERLAP;
    const reachY = bounds.height / 2 + player.displayHeight / 2 - REGISTER_BEHIND_OVERLAP;
    return { x: bounds.center.x + dx * reachX, y: bounds.center.y + dy * reachY };
  }

  registerInteractions() {
    const shop = this.shop;
    shop.interactables.registerProvider("register", () =>
      shop.fixtures.registers().filter((fixture) => fixture.sprite).map((fixture) => ({
        id: `register:${fixture.id}`,
        kind: "register",
        target: fixture,
        range: REGISTER_INTERACT_RANGE,
        priority: 1,
        getActions: () => [
          ...(this.operatingRegister
            ? [{
              action: "interact",
              hint: `${controlLabel("interact")}: Leave the register`,
              perform: () => this.endRegisterSession(),
            }]
            : [
              { action: "register", hint: `${controlLabel("interact")}: Activate Register` },
              ...(shop.crateSystem.getCarriedCrates().length === 0 && !shop.heldTrash && !shop.cleaningSystem?.heldMop ? [{
                action: "interact",
                hint: `${controlLabel("interact")}: Activate Register`,
                perform: () => this.tryOpenRegister(),
              }] : []),
            ]),
        ],
        distanceFrom: (origin) => shop.interactionSystem.feetReachTo(origin, fixture.sprite.getBounds()),
      })));
  }

  openRegisterWindow() {
    const shop = this.shop;
    if (!shop.controlMode.allows("interact")) return;
    if (!this.isPlayerNearRegister()) return;

    this.beginRegisterSession(); // no-ops if already in one

    const frontCustomer = this.operatingLine()[0];
    if (frontCustomer) this.startCheckout(frontCustomer); // re-renders/refocuses if already open
  }

  resumeRegisterCheckout() {
    const shop = this.shop;
    if (!this.operatingRegister || !shop.controlMode.allows("interact")) return;
    const customer = this.operatingLine()[0];
    if (!customer) return;
    this.startCheckout(customer); // resumes the sale if it's this customer's
  }

  /**
   * Go-Backs pack themselves: every few seconds, anything in the bin is poured into any crate
   * that already holds the same item and has room, then into empty crates, and only then
   * into new crates set down near the register. A message appears only when something new
   * couldn't be packed.
   * @param {number} time - scene time in ms
   */

  autoPackGoBacks(time) {
    const shop = this.shop;
    const stock = shop.gameState.goBacks.stock.filter((entry) => entry.quantity > 0);
    if (stock.length === 0) {
      this.goBacksPackRetryAt = 0;
      this.goBacksStuckKey = null;
      return;
    }
    if (time < this.goBacksPackRetryAt) return;
    this.fillExistingCratesWithGoBacks();
    const left = shop.gameState.goBacks.stock.filter((entry) => entry.quantity > 0);
    if (left.length === 0) return;
    const key = left.map((entry) => `${entry.itemId}:${entry.quantity}`).sort().join(",");
    const quiet = key === this.goBacksStuckKey;
    this.packGoBacks({ quiet });
    const stuck = shop.gameState.goBacks.stock.some((entry) => entry.quantity > 0);
    this.goBacksStuckKey = stuck ? key : null;
    // Retry later when there's no room yet: crates or customers may move out of the way.
    this.goBacksPackRetryAt = stuck ? time + CHECKOUT_TUNING.goBackRetryIntervalMs : 0;
  }

  // Pours Go-Backs into any crate with room (on the floor, in stacks, on the Loading Pad, or in
  // the player's arms): same-item crates first, then empty ones. Crates an employee is carrying
  // are mid-job and left alone.

  fillExistingCratesWithGoBacks() {
    const shop = this.shop;
    const crates = [
      ...(shop.restockCrates ?? [])
        .filter((crate) => !crate.isCarried && !crate.launch)
        .flatMap((crate) => [crate, ...(shop.floorStacks?.get(crate) ?? [])]),
      ...shop.crateSystem.getCarriedCrates(),
    ].filter((crate) => crate.kind === "item");
    let moved = 0;
    for (const entry of [...shop.gameState.goBacks.stock]) {
      const sameItem = crates.filter((crate) => crate.quantity > 0 && crate.itemId === entry.itemId);
      for (const crate of [...sameItem, ...crates.filter((crate) => crate.quantity === 0)]) {
        if (shop.gameState.goBacks.available(entry.itemId) <= 0) break;
        if (crate.getRemainingUnitsFor(entry.itemId) <= 0) continue;
        moved += shop.gameState.goBacks.packInto(entry.itemId, crate);
      }
    }
    return moved;
  }

  /**
   * Packs whatever is left in the Go-Backs bin into new crates and sets them down, stacked up
   * to FLOOR_STACK_MAX high, as close to the register as they fit without blocking the customer
   * line, the spot behind the counter, doorways, or the fronts of fixtures. Whatever doesn't fit
   * on the floor stays in the bin.
   * @param {{ quiet?: boolean }} [options] - quiet skips the "no room" message
   * @returns {number} how many crates were set down
   */

  packGoBacks({ quiet = false } = {}) {
    const shop = this.shop;
    const register = this.operatingRegisterFixture ?? shop.fixtures.registers()[0];
    if (!register?.sprite) return 0;
    const loads = [];
    for (const entry of shop.gameState.goBacks.stock) {
      const limit = getCrateItemLimit(database.getItem(entry.itemId)?.boxSize);
      if (entry.quantity <= 0 || limit <= 0) continue;
      for (let left = entry.quantity; left > 0; left -= limit) loads.push(entry.itemId);
    }
    if (loads.length === 0) return 0;

    const reserved = [
      ...this.goBacksReservedRectangles(),
      // Nobody gets boxed in: keep a full tile of space around every person in the shop.
      ...[...shop.customers.map((customer) => customer.sprite), ...shop.employees.map((employee) => employee.sprite)]
        .map((sprite) => {
          const feet = sprite.body?.center ?? sprite;
          return { left: feet.x - TILE_SIZE, right: feet.x + TILE_SIZE, top: feet.y - TILE_SIZE, bottom: feet.y + TILE_SIZE };
        }),
    ];
    const { centerX, centerY } = register.sprite.getBounds();
    let packed = 0;
    let floorStacksPlaced = 0;
    while (packed < loads.length) {
      const base = shop.crateSystem.createItemCrate(null, 0, centerX, centerY);
      base.sprite.body.enable = false; // so it doesn't count as an obstacle while it looks for room
      const spot = this.findGoBacksSpot(base, reserved);
      if (!spot) {
        base.destroy();
        break;
      }
      if (!spot.inBackroom) floorStacksPlaced += 1;
      const stack = [base];
      while (stack.length < FLOOR_STACK_MAX && packed + stack.length < loads.length) {
        stack.push(shop.crateSystem.createItemCrate(null, 0, spot.x, spot.y));
      }
      stack.forEach((crate, index) => shop.gameState.goBacks.packInto(loads[packed + index], crate));
      base.drop(spot.x, spot.y, 0, 0, shop.crateSystem.motionPaused);
      shop.restockCrates.push(base);
      const above = stack.slice(1);
      for (const crate of above) crate.pickUp(base.sprite, { stackedOnId: base.id });
      if (above.length) shop.floorStacks.set(base, above);
      packed += stack.length;
    }
    shop.crateSystem.syncFloorStacks();
    shop.gameState.shop.changed();
    const crates = (count) => `${count} ${count === 1 ? "crate" : "crates"}`;
    if (packed === 0) {
      if (!quiet) shop.messages.show("No clear floor space for the Go-Backs crates. Trying again shortly.", "#f59e0b");
    } else if (packed < loads.length) {
      if (!quiet) {
        shop.messages.show(`Packed ${crates(packed)} of Go-Backs. ` +
          "There wasn't floor space for the rest, so they're still in the bin.", "#f59e0b");
      }
    } else if (floorStacksPlaced === 0) {
      shop.messages.show(`Packed the Go-Backs into ${crates(packed)} in the backroom.`, "#10b981");
    } else {
      shop.messages.show(`Packed the Go-Backs into ${crates(packed)}. ` +
        "The backroom was full, so some crates sit out in the store.", "#10b981");
    }
    return packed;
  }

  // Floor the Go-Backs crates must leave clear (px): the customer line, behind the counter,
  // doorways, and where people stand to use fixtures.

  goBacksReservedRectangles() {
    const shop = this.shop;
    const tileAround = ({ x, y }) => ({
      left: x - TILE_SIZE / 2, right: x + TILE_SIZE / 2, top: y - TILE_SIZE / 2, bottom: y + TILE_SIZE / 2,
    });
    const cellCenter = ({ gx, gy }) => ({ x: shop.room.worldX(gx), y: shop.room.worldY(gy) });
    const link = getBackroomLink();
    const cells = [
      ...getStoreDoorCells().flatMap(({ gx, gy }) => [{ gx, gy }, { gx, gy: gy + 1 }]),
      link.shop, link.backroom,
      ...shop.fixtures.shelves().flatMap((fixture) => fixture.accessCells ?? fixtureAccessCells(fixture)),
    ];
    return [
      ...shop.fixtures.registers().flatMap((register) => [
        ...(register.queuePoints ?? []).map(tileAround),
        tileAround(this.behindRegisterPoint(register)),
      ]),
      ...cells.map((cell) => tileAround(cellCenter(cell))),
    ];
  }

  /**
   * Where a Go-Backs crate stack can sit: a backroom tile first, then the sales floor,
   * where spots with a whole empty tile of clearance on every side are preferred, so the
   * crates never crowd anything. Reserved rectangles (queues, doorways, people) are
   * skipped everywhere.
   * @param {Crate} crate - the probing crate, body disabled
   * @param {object[]} reserved - rectangles to keep clear
   * @returns {{ x: number, y: number, inBackroom: boolean } | null}
   */

  findGoBacksSpot(crate, reserved) {
    const shop = this.shop;
    const half = TILE_SIZE / 2;
    const isReserved = (x, y) => reserved.some((rect) =>
      x - half < rect.right && x + half > rect.left && y - half < rect.bottom && y + half > rect.top);
    const scan = (area, clearance, inBackroom) => {
      for (let y = area.top + half; y <= area.bottom - half; y += TILE_SIZE) {
        for (let x = area.left + half; x <= area.right - half; x += TILE_SIZE) {
          if (isReserved(x, y)) continue;
          if (crate.isDropPositionClear(x, y, shop.player.sprite, clearance)) return { x, y, inBackroom };
        }
      }
      return null;
    };
    const backroom = getBackroomBounds(shop.room.zones);
    const backroomSpot = scan({
      left: backroom.x, top: backroom.y,
      right: backroom.x + backroom.width, bottom: backroom.y + backroom.height,
    }, 0, true);
    if (backroomSpot) return backroomSpot;
    const floorAreas = shop.room.zones
      .filter((zone) => !zone.locked && !BACKROOM_UPGRADE_ORDER.includes(zone.id))
      .map((zone) => ({
        left: zone.gridX * TILE_SIZE, top: zone.gridY * TILE_SIZE,
        right: (zone.gridX + zone.gridW) * TILE_SIZE, bottom: (zone.gridY + zone.gridH) * TILE_SIZE,
      }));
    for (const clearance of [TILE_SIZE, 0]) {
      for (const area of floorAreas) {
        const spot = scan(area, clearance, false);
        if (spot) return spot;
      }
    }
    return null;
  }

  /**
   * An angry customer's cart goes to the Go-Backs bin, and their line moves up.
   * @param {Customer} customer
   * @param {Array<object>} cart
   */

  handleAngryLeave(customer, cart) {
    const shop = this.shop;
    shop.debugInfo?.record("customer-left-angry", {
      customerId: shop.debugInfo.identifyCustomer(customer), cart,
    });
    shop.gameState.goBacks.addCart(customer);
    const spot = this.findCustomerLine(customer);
    if (!spot) return;
    spot.line.splice(spot.index, 1);
    this.layoutRegisterLine(spot.register);
    if (spot.index !== 0) return;
    if (!this.isPlayerOperating(spot.register)) return;
    // Also drops a sale the player stepped away from, so it can't be resumed later.
    shop.checkoutWindow.close();
    if (spot.line[0]) this.startCheckout(spot.line[0]);
  }

  // Screen area covering the operated register and the player behind it, plus the screen
  // space between the HUD and the crate footer, for placing the register windows.

  getRegisterScreenArea() {
    const shop = this.shop;
    const register = this.operatingRegisterFixture ?? shop.fixtures.register();
    if (!register) return null;
    const { w, h } = fixtureFootprint(register);
    const rects = [worldToClientRect(shop, register.gx * TILE_SIZE, register.gy * TILE_SIZE, w * TILE_SIZE, h * TILE_SIZE)];
    for (const sprite of [register.sprite, shop.player?.sprite]) {
      if (!sprite?.getBounds) continue;
      const bounds = sprite.getBounds();
      rects.push(worldToClientRect(shop, bounds.x, bounds.y, bounds.width, bounds.height));
    }
    const hud = document.getElementById("persistent-hud")?.getBoundingClientRect().bottom ?? 0;
    const viewport = document.getElementById("game-container").getBoundingClientRect();
    const scale = getGameScale();
    return {
      target: {
        left: Math.min(...rects.map((rect) => rect.left)),
        top: Math.min(...rects.map((rect) => rect.top)),
        right: Math.max(...rects.map((rect) => rect.right)),
        bottom: Math.max(...rects.map((rect) => rect.bottom)),
      },
      viewport: {
        left: viewport.left + 8 * scale,
        top: hud + 8 * scale,
        right: viewport.right - 8 * scale,
        bottom: viewport.bottom - (CRATE_FOOTER_HEIGHT_PX + 8) * scale,
      },
    };
  }

  // Measured to the nearest edge of a register graphic, so it works from any side and
  // follows registers wherever they're placed. Always true while already behind a counter.

  isPlayerNearRegister() {
    if (this.operatingRegister) return true;
    return Boolean(this.getNearbyRegisterTarget());
  }

  // The register fixture within the player's reach, or null.

  getNearbyRegisterTarget() {
    const shop = this.shop;
    return shop.interactables.findTarget("register", shop.interactionSystem.getInteractionOrigin())?.target ?? null;
  }

  // Hold the player at the validated rear access point until they leave the counter.

  beginRegisterSession(register = this.getNearbyRegisterTarget()) {
    const shop = this.shop;
    if (this.operatingRegister) return;
    if (!register) return;
    // Working the counter needs empty hands; crates would lock the player in place.
    if (shop.crateSystem.getCarriedCrates().length > 0) {
      shop.messages.show("Put down what you're carrying before working the register.");
      return;
    }
    shop.cleaningSystem?.putAwayMop();

    shop.employees.forEach((employee) => employee.cancelRegisterJob(register));
    this.operatingRegister = true;
    this.operatingRegisterFixture = register;
    this.playerPositionBeforeRegister = { x: shop.player.sprite.x, y: shop.player.sprite.y };
    const behind = this.behindRegisterPoint(register);
    // From above, the player stands tucked behind the counter, partly hidden by it.
    if (fixtureFacingStep(register, true).dy < 0) {
      behind.y += PLAYER_CHARACTER_HEIGHT * REGISTER_ABOVE_LOWER_FRACTION;
      // The counter is lifted just over him (see sortPeopleByFeet) rather than sinking him
      // under it, so he stays above every floor crate beside or behind him.
      this.registerDepthBeforeTuck = register.sprite.depth;
    } else if (fixtureFacingStep(register, true).dy > 0) {
      // From below, the player stands slightly over the front of the counter.
      behind.y -= PLAYER_CHARACTER_HEIGHT * REGISTER_BELOW_RAISE_FRACTION;
    }
    shop.player.teleportTo(behind.x, behind.y);
    shop.player.forceFacing(fixtureFacing(register));
    shop.player.inputEnabled = false;
    shop.player.sprite.body.enable = false;
    shop.eventBus.emit(GAME_EVENTS.REGISTER_SESSION_STARTED, {
      registerId: register.id,
    });
    sortPeopleByFeet(shop);
    shop.crateSystem.syncFloorStacks();
  }

  // Steps the player out behind the counter. Only called when
  // the player leaves on purpose (E again), not when the checkout window closes because
  // the line ran out.

  endRegisterSession() {
    const shop = this.shop;
    if (!this.operatingRegister) return;

    const register = this.operatingRegisterFixture;
    this.operatingRegister = false;
    this.operatingRegisterFixture = null;
    // The scan UI can't be operated from wherever the player is teleported back to. The
    // sale is set aside, not thrown away, so coming back can't re-roll it.
    if (shop.checkoutWindow.mode === "checkout") shop.checkoutWindow.suspend();
    shop.player.sprite.body.enable = true;
    shop.player.inputEnabled = true;
    if (this.registerDepthBeforeTuck != null) {
      register?.sprite?.setDepth(this.registerDepthBeforeTuck);
      this.registerDepthBeforeTuck = null;
    }
    // Always step out through the back, on the validated floor behind the counter.
    const exit = register?.backExitPoint;
    const sprite = shop.player.sprite;
    if (exit) {
      const center = sprite.body.center;
      shop.player.teleportTo(exit.x - (center.x - sprite.x), exit.y - (center.y - sprite.y));
    } else {
      shop.player.teleportTo(this.playerPositionBeforeRegister.x, this.playerPositionBeforeRegister.y);
    }
    this.playerPositionBeforeRegister = null;
    shop.eventBus.emit(GAME_EVENTS.REGISTER_SESSION_ENDED, {
      registerId: register?.id ?? null,
    });
    sortPeopleByFeet(shop);
    shop.crateSystem.syncFloorStacks();
  }

  lineFor(register) {
    if (!this.registerLines.has(register.id)) this.registerLines.set(register.id, []);
    return this.registerLines.get(register.id);
  }

  /** The line of the register the player is working, or an empty array. */

  operatingLine() {
    return this.operatingRegisterFixture ? this.lineFor(this.operatingRegisterFixture) : [];
  }

  /** Whether the player is working this specific register. */

  isPlayerOperating(register) {
    return this.operatingRegister && this.operatingRegisterFixture === register;
  }

  /** Whether the player or the employee assigned to it is working this register this shift. */
  isStaffed(register) {
    return this.isPlayerOperating(register) ||
      (this.shop.employees ?? []).some((employee) => employee.assignedRegister?.() === register);
  }

  /** Whether any register has a customer waiting. */

  anyRegisterLineWaiting() {
    const shop = this.shop;
    return shop.fixtures.registers().some((register) => this.lineFor(register).length > 0);
  }

  /**
   * The register fixture and line a queued customer belongs to, or null.
   * @param {Customer} customer
   */

  findCustomerLine(customer) {
    const shop = this.shop;
    for (const register of shop.fixtures.registers()) {
      const line = this.lineFor(register);
      const index = line.indexOf(customer);
      if (index !== -1) return { register, line, index };
    }
    return null;
  }

  /**
   * Only the front customer's cart shows in the checkout window; the rest wait single-file
   * with patience bubbles (see Customer.updatePatience).
   * @param {Customer} customer
   */

  handleJoinQueue(customer) {
    const shop = this.shop;
    shop.debugInfo?.recordCustomer("customer-joined-queue", customer);
    const register = shop.fixtures.get(customer.targetRegisterId) ?? shop.fixtures.register();
    const line = this.lineFor(register);
    line.push(customer);
    this.layoutRegisterLine(register);

    if (line.length === 1) {
      this.startCheckout(customer);
    }
  }

  // A distinct queue waypoint for a customer heading to a register, so two walkers never
  // aim at the same pixel; layoutRegisterLine fixes final spots on arrival. The customer
  // picks the shortest line, counting shoppers already walking to it. Derived fresh
  // from live customer states rather than a counter, so a customer who gives up can't
  // leak a reservation. The caller is still SEEK_SHELF, so it isn't counted.

  reserveQueueSlot(customer) {
    const shop = this.shop;
    // Customers line up where someone is working; with no one at any register, anywhere.
    const allRegisters = shop.fixtures.registers();
    const staffed = allRegisters.filter((register) => this.isStaffed(register));
    const registers = staffed.length > 0 ? staffed : allRegisters;
    const headedTo = (register) => shop.customers.filter((candidate) =>
      candidate !== customer && candidate.state === "SEEK_REGISTER" &&
      candidate.targetRegisterId === register.id).length;
    const register = registers.reduce((best, candidate) =>
      this.lineFor(candidate).length + headedTo(candidate) <
        this.lineFor(best).length + headedTo(best) ? candidate : best);
    customer.targetRegisterId = register.id;
    customer.registerPoint = register.queuePoints[0];
    const index = this.lineFor(register).length + headedTo(register);
    return register.queuePoints[Math.min(index, register.queuePoints.length - 1)];
  }

  /**
   * Spreads shoppers heading to the same shelf across its clear front cells.
   * @param {ShelfFixture} shelf
   * @param {Customer | null} arrivingCustomer - excluded from the count
   * @returns {{ x: number, y: number }} world-space waypoint
   */

  reserveShelfSlot(shelf, arrivingCustomer = null) {
    const shop = this.shop;
    const inFlight = shop.customers.filter((c) =>
      c !== arrivingCustomer && (c.state === "SEEK_SHELF" || c.state === "BROWSING") &&
      c.fixture === shelf,
    ).length;
    const cells = shelf.accessCells ?? fixtureAccessCells(shelf);
    return fixtureStandingSpot(shelf, cells[inFlight % cells.length]);
  }

  reserveExitSlot() {
    const shop = this.shop;
    const occupied = new Set(shop.customers
      .filter((customer) => customer.state === "LEAVING" && customer.destination)
      .map((customer) => `${customer.destination.x},${customer.destination.y}`));
    const offset = CUSTOMER_EXIT_SLOT_OFFSETS.find(({ dx, dy }) =>
      !occupied.has(`${shop.exitPoint.x + dx},${shop.exitPoint.y + dy}`),
    );
    if (!offset) throw new Error("No unoccupied customer exit slot is available.");
    return { x: shop.exitPoint.x + offset.dx, y: shop.exitPoint.y + offset.dy };
  }

  // Queue cells remain reachable even when a register is moved near other fixtures.

  layoutRegisterLine(register) {
    this.lineFor(register).forEach((customer, index) => {
      const point = register.queuePoints[index];
      customer.setQueuePosition(index);
      customer.setQueueTarget(point.x, point.y);
    });
  }

  /**
   * Opens checkout for this customer if the player is at their register, stepping them
   * behind the counter if needed; otherwise does nothing until openRegisterWindow retries.
   * Each finished sale moves the line up and serves the next customer.
   * @param {Customer} customer
   */

  startCheckout(customer) {
    const shop = this.shop;
    if (!shop.controlMode.allows("interact")) return;
    const spot = this.findCustomerLine(customer);
    if (!spot) return;
    // Only a player already behind this customer's register serves them. Standing near
    // the counter never pulls the player onto it; E (openRegisterWindow) is the only way on.
    if (!this.isPlayerOperating(spot.register)) return;

    // Stepping away mid-sale and coming back picks up exactly where it was left.
    if (shop.checkoutWindow.isCheckingOut(customer.cart)) {
      shop.checkoutWindow.resume();
      return;
    }
    // Decided once per customer, so restarting the sale can't change how they pay.
    customer.checkoutPayment ??= chooseCustomerPayment(customer.factionId);

    shop.checkoutWindow.openForCustomer(customer.cart, () => {
      const total = customer.completeSale();
      shop.eventBus.emit(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, { customer, total });
      const line = this.lineFor(spot.register);
      if (line[0] === customer) line.shift();
      this.layoutRegisterLine(spot.register); // shuffle everyone else forward one spot

      const nextCustomer = line[0];
      if (nextCustomer) {
        this.startCheckout(nextCustomer);
      } else {
        // Nothing left to scan: the belt closes, but the player stays at the counter.
        shop.checkoutWindow.close();
      }
    }, {
      cash: ["cash", "m-scrips"].includes(customer.checkoutPayment.type),
      exact: customer.checkoutPayment.exact,
      currency: customer.checkoutPayment.type === "m-scrips" ? "m-scrips" : "credits",
      paymentType: customer.checkoutPayment.type,
      chitCode: customer.checkoutPayment.code,
      onWrongChange: () => {
        customer.checkoutMistakes = (customer.checkoutMistakes ?? 0) + 1;
        shop.gameState.reputation.lose(1);
      },
      onCashAttempt: (attempt) => shop.debugInfo?.record("cash-handover", {
        customerId: shop.debugInfo.identifyCustomer(customer), ...attempt,
      }),
      // The third wrong change loses the sale; the reputation was already lost on the second.
      onChangeFailed: () => customer.leaveAngry({ reputationPenalty: false }),
      // Three Chit mistakes (wrong keys or running out of time) in one order: the customer gives up and storms out.
      onChitFailed: () => customer.leaveAngry(),
    });
  }

  completeEmployeeCheckout(employee, customer) {
    const shop = this.shop;
    const register = employee.currentJob?.register;
    if (!register || this.isPlayerOperating(register) ||
      employee.currentJob?.customer !== customer) return false;
    const line = this.lineFor(register);
    if (line[0] !== customer) return false;
    if (shop.checkoutWindow.isCheckingOut(customer.cart)) shop.checkoutWindow.close();
    const total = customer.completeSale();
    shop.eventBus.emit(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, { customer, total });
    shop.messages.floatText(
      employee.sprite.x,
      employee.sprite.y - 50,
      `Sale completed: ${formatTransactionTotal(total)}`,
      "#10b981",
    );
    line.shift();
    this.layoutRegisterLine(register);
    return true;
  }

  // Shelf Test Room's automatic cashier: serves the front customer like an employee would.

  completeSandboxCheckout(customer) {
    const shop = this.shop;
    if (!shop.sandbox) return false;
    const spot = this.findCustomerLine(customer);
    if (!spot || spot.index !== 0) return false;
    if (shop.checkoutWindow.isCheckingOut(customer.cart)) shop.checkoutWindow.close();
    const total = customer.completeSale();
    shop.eventBus.emit(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, { customer, total });
    spot.line.shift();
    this.layoutRegisterLine(spot.register);
    return true;
  }

  // Called by customers who couldn't reach where they were going; only the test room counts them.


  // Keyboard equivalent of clicking the register: steps behind the counter if close enough,
  // even with no customer waiting. Returns false so handleInteract can show its fallback.
  tryOpenRegister() {
    if (!this.isPlayerNearRegister()) return false;
    this.openRegisterWindow();
    return true;
  }
}
