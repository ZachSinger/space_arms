// ==========================================
// FILE: FixtureSystem.js
// ==========================================
// The rules for the shop's layout: buying, crating, selling, moving, and placing fixtures, and
// buying sales-floor expansions and backroom upgrades. Layout data lives in the shop's saved
// state (state/slices/Shop.js); its pictures on the map are drawn by world/FixtureViews.js.
import { database } from "../scenes/boot.js";
import { GAME_EVENTS } from "../core/Events.js";
import { Crate } from "../logic/Crate.js";
import { ShelfFixture } from "../logic/ShelfFixture.js";
import { FIXTURE_TYPES, fixtureAccessCells, fixtureFacing, fixtureFootprint, fixtureInteractionDistance,
  fixtureStandingSpot, getFixtureResaleValue, getFixtureType, validateFixtureLayout } from "../logic/FixtureLayout.js";
import { BACKROOM_UPGRADE_ORDER, EXPANSION_ORDER, TILE_SIZE, getAuthoredGridSize, getBackroomDoorCell,
  getBackroomExitCell, getBackroomInteriorBounds, getBackroomLink, getDoorwayClearanceBounds, getLoadingPadBounds,
  getStoreDoorCell, getStoreDoorCells } from "../logic/RoomLayout.js";
import { formatMoneyAmount } from "../logic/Money.js";
import { createFixtureModel } from "../state/slices/Shop.js";
import { AREA, areaAtRow } from "../world/Areas.js";
import { controlLabel } from "../input/InputDevice.js";
import crateTuning from "../../data/tuning/crates.json" with { type: "json" };
import { loadTuning } from "../core/Tuning.js";

// The two kinds of zone the player buys, in the words the messages use.
const ZONE_KINDS = Object.freeze({
  salesFloor: { order: EXPANSION_ORDER, unknown: "sales-floor expansion", closed: "Store expansions", inOrder: "sales-floor expansions" },
  backroom: { order: BACKROOM_UPGRADE_ORDER, unknown: "backroom expansion", closed: "Backroom expansions", inOrder: "backroom expansions" },
});

const SHELF_INTERACT_RANGE = 12;
const TRASHCAN_REACH = loadTuning("crates", crateTuning).trashcanReachPx;
const PLAYER_FACING_STEPS = Object.freeze({
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
});

export class FixtureSystem {
  /** @param {object} shop - the game scene, with its room, fixture views, and game state made */
  constructor(shop) {
    this.shop = shop;
    if (shop.interactables) this.registerInteractions();
  }

  registerInteractions() {
    const shop = this.shop;
    shop.interactables.registerProvider("stock-holders", () =>
      this.fixtures.shelves().map((fixture) => ({
        id: `fixture:${fixture.id}`,
        kind: "fixture",
        target: fixture,
        range: SHELF_INTERACT_RANGE,
        priority: 3,
        getActions: (player) => shop.interactionSystem.isPlayerFacingFixture(fixture, player) ? [
          { action: "fixture" },
          {
            action: "interact",
            hint: `${controlLabel("interact")}: Open this shelf`,
            perform: () => this.tryOpenFixtureWindow(fixture),
          },
        ] : [],
        distanceFrom: ({ feet }) => {
          const midX = (feet.left + feet.right) / 2;
          const midY = (feet.top + feet.bottom) / 2;
          return fixtureInteractionDistance(fixture, {
            down: { x: midX, y: feet.top }, up: { x: midX, y: feet.bottom },
            left: { x: feet.right, y: midY }, right: { x: feet.left, y: midY },
          }[fixtureFacing(fixture)]);
        },
      })));
    shop.interactables.registerProvider("fixture-move", () => [{
      id: "fixture-move",
      kind: "fixture-move",
      isAvailable: () => shop.controlMode?.allows("interact") &&
          shop.crateSystem.getCarriedCrates().length === 0 && !shop.heldTrash &&
          !shop.checkoutSystem?.operatingRegister && this.canRearrange(),
      range: 0,
      distanceFrom: () => 0,
      getActions: () => {
        const action = this.getMoveAction();
        return action ? [action] : [];
      },
    }]);
    shop.interactables.registerProvider("fixture-placement", () => {
      const crate = shop.carriedCrate;
      if (crate?.kind !== "fixture") return [];
      return [{
        id: `fixture-placement:${crate.id}`,
        kind: "fixture-placement",
        target: crate,
        priority: 9,
        range: 0,
        distanceFrom: () => 0,
        getActions: () => [{
          action: "interact",
          hint: `${controlLabel("interact")}: Place the fixture`,
          perform: () => shop.fixturePlacement.beginFromCrate(crate),
        }],
      }];
    });
    shop.interactables.registerProvider("trashcan", () => [{
      id: "trashcan",
      kind: "trashcan",
      getActions: () => this.getTrashcanActions(),
    }]);
  }

  getNearbyTrashcan() {
    const shop = this.shop;
    if (shop.areas.playerArea === AREA.BACKROOM) return null;
    const step = PLAYER_FACING_STEPS[shop.player.currentFacing];
    if (!step) return null;
    const { x, y } = shop.player.sprite;
    const probe = {
      x: x + step.x * TRASHCAN_REACH,
      y: y + step.y * TRASHCAN_REACH,
    };
    return shop.fixtures.ofKind("trash").find((fixture) => {
      const { w, h } = fixtureFootprint(fixture);
      const left = fixture.gx * TILE_SIZE;
      const top = fixture.gy * TILE_SIZE;
      return probe.x >= left - 6 && probe.x <= left + w * TILE_SIZE + 6 &&
        probe.y >= top - 6 && probe.y <= top + h * TILE_SIZE + 6;
    }) ?? null;
  }

  getTrashcanActions() {
    const shop = this.shop;
    if (shop.heldTrash) return [];
    const trashcan = this.getNearbyTrashcan();
    if (!trashcan) return [];
    const carriedCrates = shop.crateSystem.getCarriedCrates();
    const emptyCrates = shop.crateSystem.heldEmptyCrates();
    let hint;
    let perform;
    if (carriedCrates.length === 0) {
      hint = `${controlLabel("interact")}: Create`;
      perform = () => shop.crateSystem.takeEmptyCrateFromTrashcan();
    } else if (emptyCrates.length > 0) {
      const description = emptyCrates.length === 1
        ? "your empty crate"
        : `all ${emptyCrates.length} empty crates`;
      hint = `${controlLabel("interact")}: Put ${description} in the trashcan`;
      perform = () => shop.crateSystem.returnEmptyCratesToTrashcan();
    } else return [];
    return [{
      action: "interact", id: `trashcan:${trashcan.id}`, kind: "trashcan", target: trashcan,
      priority: 5, range: 0, distanceFrom: () => 0, hint, perform,
    }];
  }

  getHoldToMoveFixture() {
    const shop = this.shop;
    if (!shop.controlMode.allows("interact") || shop.crateSystem.getCarriedCrates().length > 0 || shop.heldTrash) return null;
    if (shop.checkoutSystem.operatingRegister || shop.areas.nearbyPortal()) return null;
    const origin = shop.interactionSystem.getInteractionOrigin();
    const target = shop.interactables.findTarget(
      "interact",
      origin,
      null,
      shop.player,
      shop.input,
      "fixture",
      { excludeProvider: "fixture-move" },
    ) ?? shop.interactables.findTarget(
      "interact",
      origin,
      null,
      shop.player,
      shop.input,
      "register",
      { excludeProvider: "fixture-move" },
    );
    let fixture = null;
    if (target?.kind === "fixture" && shop.interactionSystem.isPlayerFacingFixture(target.target)) fixture = target.target;
    else if (target?.kind === "register") fixture = target.target;
    if (!fixture) {
      const trashcan = this.getNearbyTrashcan();
      if (trashcan && shop.interactionSystem.isPlayerFacingFixture(trashcan)) fixture = trashcan;
    }
    if (!fixture || !this.canRearrange()) return null;
    return this.moveAreaBlockReason(fixture) ? null : fixture;
  }

  getMoveAction() {
    const fixture = this.getHoldToMoveFixture();
    if (!fixture) return null;
    const moveKey = controlLabel("moveFixture");
    const hint = getFixtureType(fixture.type).kind === "trash"
      ? `Hold ${moveKey}: Move`
      : `Hold ${moveKey}: Move this ${this.fixtures.displayName(fixture)}`;
    return {
      action: "moveFixture",
      id: `move-fixture:${fixture.id}`,
      kind: "fixture-move",
      target: fixture,
      hint,
      perform: () => this.shop.fixturePlacement.begin(fixture.id),
    };
  }

  // The scene's list is the shop slice's own registry, so either name reaches the same fixtures.
  get fixtures() {
    return this.shop.fixtures;
  }

  /**
   * Adds a new fixture to the shop and draws it. Its access spots come from the next layout check.
   * @param {{ id: string, type: string, gx: number, gy: number, rotation?: number }} entry
   * @returns {object} the fixture
   */
  spawn(entry) {
    return this.shop.fixtureViews.show(this.fixtures.add(createFixtureModel(entry)));
  }

  /**
   * Opens a zone for good: built on the map, the camera refitted, then saved in the shop's state.
   * @param {string} zoneId
   */
  openZone(zoneId) {
    this.shop.room.unlockZone(zoneId);
    this.shop.cameraRig.refresh();
    this.shop.gameState.shop.unlockZone(zoneId);
  }

  /**
   * Options for validateFixtureLayout: walkability, the entrance, door thresholds, and
   * approach spaces used when checking shelf fronts and the checkout line.
   * @param {Array<{ left: number, right: number, top: number, bottom: number }>} occupiedRectangles - bodies a fixture must not land on (px)
   */
  layoutOptions(occupiedRectangles = []) {
    const { room } = this.shop;
    const entrance = getStoreDoorCell();
    const link = getBackroomLink();
    const backroomDoor = getBackroomDoorCell();
    const backroomExit = getBackroomExitCell();
    const doorwayCells = new Set([
      ...getStoreDoorCells().map(({ gx, gy }) => `${gx},${gy}`),
      `${backroomDoor.gx},${backroomDoor.gy}`,
      `${backroomExit.gx},${backroomExit.gy}`,
    ]);
    const reservedCells = new Set([
      ...doorwayCells,
      ...getStoreDoorCells().map(({ gx, gy }) => `${gx},${gy + 1}`),
      `${link.shop.gx},${link.shop.gy}`,
      `${link.backroom.gx},${link.backroom.gy}`,
    ]);
    return {
      isWalkable: (gx, gy) => room.isWalkable(gx, gy),
      // Door art counts as a doorway, not wall a fixture can tuck into.
      isWall: (gx, gy) => {
        const wall = room.wallCells.get(`${gx},${gy}`);
        return Boolean(wall && !wall.door);
      },
      entrance, reservedCells, doorwayCells, fixtureReservedCells: doorwayCells, occupiedRectangles,
      links: [[link.shop, link.backroom]],
      backroomBounds: getBackroomInteriorBounds(room.zones),
      reservedRectangles: [getLoadingPadBounds()],
      doorwayClearanceRectangles: getDoorwayClearanceBounds(),
    };
  }

  // Layout options with the player and loose crates as bodies a fixture must not land on.
  #layoutOptionsAroundBodies() {
    const { player, restockCrates } = this.shop;
    const bodies = [player.sprite.body, ...restockCrates.map((crate) => crate.sprite.body)];
    return this.layoutOptions(
      bodies.filter((body) => body.enable).map((body) => ({
        left: body.left, right: body.right, top: body.top, bottom: body.bottom,
      })),
    );
  }

  canRearrange() {
    const scene = this.shop;
    if (scene.saves.loadFailed || scene.shift.starting ||
      (scene.shiftClock.started && scene.shiftClock.isPaused)) return false;
    return scene.saves.canSaveOffShift() ||
      (scene.shiftClock.started && (scene.customerFlow.temporarilyClosed || scene.shiftClock.softClosed));
  }

  canExpand() {
    return this.shop.saves.canSaveOffShift() && !this.shop.shift.starting;
  }

  // Fixtures can only be moved from the same room the player is standing in.
  moveAreaBlockReason(fixture) {
    if (!fixture) return null;
    const area = areaAtRow(Math.floor(fixture.gy));
    if (area === this.shop.areas.playerArea) return null;
    const name = this.fixtures.displayName(fixture);
    return area === AREA.BACKROOM
      ? `Go into the backroom to move the ${name}.`
      : `Go out to the sales floor to move the ${name}.`;
  }

  // --- Expansions ---

  #zone(id) {
    return this.shop.room.zones.find((candidate) => candidate.id === id);
  }

  #zoneOptions({ order, unknown }) {
    const nextId = order.find((id) => this.#zone(id)?.locked);
    const { reputation, economy } = this.shop.gameState;
    return order.map((id) => {
      const zone = this.#zone(id);
      if (!zone) throw new Error(`Unknown ${unknown}: ${id}`);
      return {
        zone,
        isPurchased: !zone.locked,
        isNext: id === nextId,
        levelMet: reputation.shopLevel >= zone.requiredShopLevel,
        canAfford: economy.credits >= zone.cost,
      };
    });
  }

  expansionOptions() {
    return this.#zoneOptions(ZONE_KINDS.salesFloor);
  }

  backroomOptions() {
    return this.#zoneOptions(ZONE_KINDS.backroom);
  }

  #buyZone(zoneId, { order, unknown, closed, inOrder }) {
    const scene = this.shop;
    if (!order.includes(zoneId)) throw new Error(`Unknown ${unknown}: ${zoneId}`);
    if (!this.canExpand()) {
      scene.messages.show(`${closed} can only be bought while the store is closed.`);
      return false;
    }
    const zone = this.#zone(zoneId);
    if (!zone) throw new Error(`Unknown ${unknown}: ${zoneId}`);
    if (!zone.locked) {
      scene.messages.show(`${zone.name} is already open.`);
      return false;
    }
    if (zoneId !== order.find((id) => this.#zone(id)?.locked)) {
      scene.messages.show(`Buy ${inOrder} in order.`);
      return false;
    }
    const { reputation, economy } = scene.gameState;
    if (reputation.shopLevel < zone.requiredShopLevel) {
      scene.messages.show(`Reach Shop Level ${zone.requiredShopLevel} to buy ${zone.name}.`);
      return false;
    }
    if (economy.credits < zone.cost) {
      scene.messages.show(`${zone.name} costs ${formatMoneyAmount(zone.cost)}.`);
      return false;
    }

    economy.spend(zone.cost, { category: "expansions", label: zone.name });
    this.openZone(zoneId);
    scene.saves.requestAutosave();
    scene.messages.show(`${zone.name} is open.`);
    return true;
  }

  buyExpansion(zoneId) {
    return this.#buyZone(zoneId, ZONE_KINDS.salesFloor);
  }

  buyBackroomUpgrade(zoneId) {
    return this.#buyZone(zoneId, ZONE_KINDS.backroom);
  }

  // --- Moving fixtures ---

  /**
   * The current layout with one fixture moved and turned; nothing is applied.
   * @param {string} id
   * @param {number} gx
   * @param {number} gy
   * @param {number} [rotation] - quarter turns clockwise; defaults to its current rotation
   */
  layoutWithMove(id, gx, gy, rotation) {
    return this.fixtures.layout().map((entry) =>
      entry.id === id ? { ...entry, gx, gy, rotation: rotation ?? entry.rotation } : entry);
  }

  /**
   * Validates a move without applying it. The player and loose crates count as obstacles.
   * @param {string} id
   * @param {number} gx
   * @param {number} gy
   * @param {number} [rotation]
   * @returns {{ valid: boolean, reason?: string }} validateFixtureLayout's result
   */
  checkMove(id, gx, gy, rotation) {
    const { playerArea } = this.shop.areas;
    const areaBlock = this.moveAreaBlockReason(this.fixtures.get(id));
    if (areaBlock) return { valid: false, reason: areaBlock };
    if (areaAtRow(Math.floor(gy)) !== playerArea) {
      return { valid: false, reason: playerArea === AREA.BACKROOM ? "Keep it in the backroom." : "Keep it on the sales floor." };
    }
    return validateFixtureLayout(this.layoutWithMove(id, gx, gy, rotation), this.#layoutOptionsAroundBodies());
  }

  /**
   * Moves a fixture if the store is closed and the new spot is valid; otherwise shows why not.
   * @param {string} id
   * @param {number} gx
   * @param {number} gy
   * @param {number} [rotation]
   * @returns {boolean} whether it moved
   */
  move(id, gx, gy, rotation) {
    const scene = this.shop;
    if (!this.canRearrange()) {
      scene.messages.show("Fixtures can only move while the store is closed.");
      return false;
    }
    if (!this.fixtures.get(id)) throw new Error(`Unknown fixture: ${id}`);
    const result = this.checkMove(id, gx, gy, rotation);
    if (!result.valid) {
      scene.messages.show(result.reason);
      return false;
    }
    this.applyLayout(this.layoutWithMove(id, gx, gy, rotation), result);
    scene.gameState.shop.changed();
    return true;
  }

  /**
   * Moves and turns every fixture to its layout cell and adopts the validated access
   * points and register queue positions.
   * @param {Array<{ id: string, gx: number, gy: number, rotation?: number }>} layout
   * @param {object} result - a valid result from validateFixtureLayout for this layout
   */
  applyLayout(layout, result) {
    const scene = this.shop;
    const views = scene.fixtureViews;
    for (const entry of layout) {
      const fixture = this.fixtures.get(entry.id);
      fixture.gx = entry.gx;
      fixture.gy = entry.gy;
      fixture.rotation = entry.rotation ?? 0;
      const footprint = fixtureFootprint(fixture);
      fixture.x = (entry.gx + footprint.w / 2) * TILE_SIZE;
      fixture.y = (entry.gy + footprint.h / 2) * TILE_SIZE;
      views.orient(fixture);
      fixture.accessCells = result.accessCells?.get(entry.id) ?? fixtureAccessCells(fixture);
      fixture.standPoint = fixtureStandingSpot(fixture, result.access.get(entry.id));
    }
    for (const fixture of this.fixtures.all()) views.placeDisplays(fixture);
    // Each register carries its own validated customer-line positions.
    for (const register of this.fixtures.registers()) {
      register.queuePoints = result.queuePointsById?.get(register.id) ?? result.queuePoints;
    }
    scene.goBacksBadge?.refresh();
    scene.cleaningSystem?.moveOffBlockedSpots();
  }

  /**
   * Checks the whole current layout and applies it; throws if it isn't valid.
   * @param {object} [options] - extra validateFixtureLayout options
   */
  applyCurrentLayout(options = {}) {
    const layout = this.fixtures.layout();
    const result = validateFixtureLayout(layout, { ...this.layoutOptions(), ...options });
    if (!result.valid) throw new Error(result.reason);
    this.applyLayout(layout, result);
  }

  // --- Buying, crating, selling, and placing ---

  // Fixture shop rows, with every reason a purchase might be blocked.
  purchaseOptions() {
    const { catalog, economy } = this.shop.gameState;
    return Object.values(FIXTURE_TYPES).map((spec) => ({
      spec,
      license: database.getLicense(spec.licenseId),
      licensed: catalog.owns(spec.licenseId),
      canAfford: economy.credits >= spec.price,
      hasDeliverySpace: !!this.shop.supply.firstFreePadSpot(),
    }));
  }

  /**
   * Buys a fixture, delivered as a crate on the Loading Pad.
   * @param {string} typeId
   * @returns {boolean} whether the purchase went through
   */
  buy(typeId) {
    const scene = this.shop;
    const { catalog, economy } = scene.gameState;
    const spec = getFixtureType(typeId);
    if (!spec) throw new Error(`Unknown fixture type: ${typeId}`);
    if (!catalog.owns(spec.licenseId)) return false;
    if (economy.credits < spec.price) return false;
    const spawn = scene.supply.takePadSpots(1)[0];
    if (!spawn) return false;

    economy.spend(spec.price, { category: "fixtures", label: spec.name });
    scene.supply.deliver(new Crate(scene, null, 1, spawn.x, spawn.y, { kind: "fixture", typeId }));
    scene.supply.freePlayerFromPad();
    scene.gameState.shop.changed();
    return true;
  }

  canCrate(fixture) {
    return this.crateBlockReason(fixture) === null;
  }

  /**
   * @param {object} fixture
   * @returns {string | null} why it can't be packed into a crate, or null if it can
   */
  crateBlockReason(fixture) {
    return this.#removalBlockReason(fixture, "crated");
  }

  saleBlockReason(fixture) {
    return this.#removalBlockReason(fixture, "sold");
  }

  #removalBlockReason(fixture, action) {
    if (!fixture) return "Fixture not found.";
    if (!this.canRearrange()) return `Fixtures can only be ${action} while the store is closed.`;
    if (getFixtureType(fixture.type).kind === "register" &&
      this.fixtures.ofKind("register").length <= 1) return `The last register cannot be ${action}.`;
    if (fixture instanceof ShelfFixture && fixture.placements.some((stack) => stack.quantity > 0)) {
      return `Only empty fixtures can be ${action}.`;
    }
    return null;
  }

  #removePlaced(fixture) {
    const scene = this.shop;
    const layout = this.fixtures.layout().filter((entry) => entry.id !== fixture.id);
    const result = validateFixtureLayout(layout, { ...this.layoutOptions(), requireSalesFloor: false });
    if (!result.valid) {
      scene.messages.show(result.reason);
      return false;
    }
    if (scene.shelfStockingWindow?.fixture === fixture) scene.shelfStockingWindow.uiWindow.close();
    scene.fixtureViews.hide(fixture);
    this.fixtures.remove(fixture.id);
    this.applyLayout(layout, result);
    return true;
  }

  /**
   * Packs an empty fixture into a crate where it stood, so it can be carried and re-placed.
   * @param {string} id
   * @returns {boolean} whether it was crated
   */
  crate(id) {
    const scene = this.shop;
    const fixture = this.fixtures.get(id);
    if (!fixture) throw new Error(`Unknown fixture: ${id}`);
    const reason = this.crateBlockReason(fixture);
    if (reason) {
      scene.messages.show(reason);
      return false;
    }
    if (!this.#removePlaced(fixture)) return false;
    const crate = new Crate(scene, null, 1, fixture.x, fixture.y, {
      kind: "fixture",
      typeId: fixture.type,
    });
    crate.setPaused(scene.crateSystem.motionPaused);
    scene.restockCrates.push(crate);
    scene.gameState.shop.changed();
    return true;
  }

  sell(id) {
    const scene = this.shop;
    const fixture = this.fixtures.get(id);
    const reason = this.saleBlockReason(fixture);
    if (reason) {
      scene.messages.show(reason);
      return false;
    }
    const spec = getFixtureType(fixture.type);
    const value = getFixtureResaleValue(fixture.type);
    if (!this.#removePlaced(fixture)) return false;
    scene.gameState.economy.add(value, { category: "fixture_sales", label: spec.name });
    return true;
  }

  crateSaleBlockReason(crate) {
    const scene = this.shop;
    if (!crate || crate.kind !== "fixture" ||
      (crate !== scene.carriedCrate && !scene.restockCrates.includes(crate))) {
      return "Fixture crate not found.";
    }
    if (!this.canRearrange()) return "Fixtures can only be sold while the store is closed.";
    return null;
  }

  sellCrate(crate) {
    const scene = this.shop;
    const reason = this.crateSaleBlockReason(crate);
    if (reason) {
      scene.messages.show(reason);
      return false;
    }
    const spec = getFixtureType(crate.typeId);
    const value = getFixtureResaleValue(crate.typeId);
    if (scene.crateSystem.getCarriedCrates().includes(crate)) scene.crateSystem.removeCarriedCrate(crate);
    else scene.restockCrates = scene.restockCrates.filter((candidate) => candidate !== crate);
    crate.destroy();
    scene.gameState.economy.add(value, { category: "fixture_sales", label: spec.name });
    return true;
  }

  /**
   * Validates adding a new fixture of this type without placing it. The player and loose
   * crates count as obstacles.
   * @param {string} typeId
   * @param {number} gx
   * @param {number} gy
   * @param {number} [rotation] - quarter turns clockwise
   */
  checkPlacement(typeId, gx, gy, rotation = 0) {
    const id = this.fixtures.nextId(typeId);
    const layout = [...this.fixtures.layout(), { id, type: typeId, gx, gy, rotation }];
    return validateFixtureLayout(layout, this.#layoutOptionsAroundBodies());
  }

  /**
   * Unpacks the carried fixture crate into a real fixture at this cell.
   * @param {Crate} crate - must be the carried fixture crate
   * @param {number} gx
   * @param {number} gy
   * @param {number} [rotation] - quarter turns clockwise
   * @returns {boolean} whether it was placed
   */
  placeFromCrate(crate, gx, gy, rotation = 0) {
    const scene = this.shop;
    if (!this.canRearrange() || scene.carriedCrate !== crate || crate.kind !== "fixture") return false;
    const id = this.fixtures.nextId(crate.typeId);
    const result = this.checkPlacement(crate.typeId, gx, gy, rotation);
    if (!result.valid) {
      scene.messages.show(result.reason);
      return false;
    }

    this.spawn({ id, type: crate.typeId, gx, gy, rotation });
    this.applyLayout(this.fixtures.layout(), result);
    crate.destroy();
    scene.crateSystem.removeCarriedCrate(crate);
    scene.gameState.shop.changed();
    return true;
  }

  /**
   * The closest cell to `origin` where a new fixture of this type would be valid.
   * @param {string} typeId
   * @param {{ gx: number, gy: number }} origin
   * @returns {{ gx: number, gy: number } | null}
   */
  findNearestCell(typeId, origin) {
    const { gridW, gridH } = getAuthoredGridSize();
    const cells = [];
    for (let gy = 0; gy < gridH; gy += 1) {
      for (let gx = 0; gx < gridW; gx += 1) cells.push({ gx, gy });
    }
    cells.sort((a, b) => Math.hypot(a.gx - origin.gx, a.gy - origin.gy) -
      Math.hypot(b.gx - origin.gx, b.gy - origin.gy));
    return cells.find(({ gx, gy }) => this.checkPlacement(typeId, gx, gy).valid) ?? null;
  }

  /**
   * Opens a shelf's window if the player is in range; silently does nothing if not.
   * @param {object} [fixture] - the clicked fixture; the E key passes none and uses the nearest
   * @returns {boolean} whether a window opened
   */
  tryOpenFixtureWindow(fixture) {
    const shop = this.shop;
    if (!shop.controlMode.allows("interact")) return false;
    const target = shop.interactables.findTarget(
      "fixture",
      shop.interactionSystem.getInteractionOrigin(),
      fixture,
    )?.target;
    if (!target) return false;
    const fixtureWindow = shop.shelfStockingWindow;
    const alreadyOpen = fixtureWindow.uiWindow.isOpen && fixtureWindow.fixture === target;
    fixtureWindow.openForFixture(target, shop.fixtures.displayName(target));
    if (!alreadyOpen) {
      shop.eventBus.emit(GAME_EVENTS.FIXTURE_OPENED, { fixtureId: target.id, type: target.type });
    }
    return true;
  }
}
