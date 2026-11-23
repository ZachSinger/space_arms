// Linked hovercarts are bought in the Layout tab and each arrives with a charger fixture crate.
// A cart exists while its charger is placed somewhere in the store; the cart itself lives in
// Hovercart.js.
import { Hovercart } from "./Hovercart.js";
import { StaffHovercarts } from "./StaffHovercarts.js";
import { Crate } from "../../logic/Crate.js";
import { CONTROL_MODES } from "../../input/ControlMode.js";
import { formatMoneyAmount } from "../../logic/Money.js";
import {
  HOVERCART_BATTERY,
  HOVERCART_CHARGER_TYPE,
  HOVERCART_DEFAULT_UPGRADES,
  HOVERCART_LEVEL,
  HOVERCART_NAME,
  HOVERCART_PRICE,
  HOVERCART_UPGRADES,
  MAX_LINKED_HOVERCARTS,
  getHovercartBatteryCapacity,
  getHovercartCapacity,
  getLegacyChargerSpot,
} from "./HovercartRules.js";

export class HovercartSystem {
  constructor(scene) {
    this.id = "hovercart";
    this.scene = scene;
    this.cart = null;
    this.carts = [];
    this.cartColliders = [];
    this.linkGraphics = null;
    this.linkSignature = "";
    this.pendingCartStates = [];
    // The charge of a cart packed away in its charger's crate.
    this.storedBattery = HOVERCART_BATTERY.capacity;
    this.upgrades = { ...HOVERCART_DEFAULT_UPGRADES };
    this.staff = new StaffHovercarts(this);
  }

  /** Its charger is placed, or waiting in a crate. */
  get owned() {
    if (this.ownedCount()) return true;
    return false;
  }

  ownedCount() {
    const placed = this.chargers().length;
    const crates = this.scene.crateSystem;
    if (!crates) return placed;
    return Math.min(MAX_LINKED_HOVERCARTS, placed + this.packedChargerCount());
  }

  packedChargerCount() {
    const crates = this.scene.crateSystem;
    if (!crates) return 0;
    return [...crates.getFloorCrates(), ...crates.getCarriedCrates()]
      .filter((crate) => crate.kind === "fixture" && crate.typeId === HOVERCART_CHARGER_TYPE).length;
  }

  chargers() {
    return this.scene.fixtures?.all().filter((fixture) => fixture.type === HOVERCART_CHARGER_TYPE) ?? [];
  }

  /** What the Layout tab shows for the hovercart. */
  purchaseOption() {
    const { reputation, economy } = this.scene.gameState;
    return {
      name: HOVERCART_NAME,
      price: HOVERCART_PRICE,
      capacity: this.cart?.capacity ?? getHovercartCapacity(this.upgrades),
      cartCount: this.ownedCount(),
      maxCarts: MAX_LINKED_HOVERCARTS,
      requiredShopLevel: HOVERCART_LEVEL,
      isPurchased: this.ownedCount() > 0,
      levelMet: reputation.shopLevel >= HOVERCART_LEVEL,
      canAfford: economy.credits >= HOVERCART_PRICE,
      hasDeliverySpace: !!this.scene.supply.firstFreePadSpot(),
    };
  }

  upgradeOptions() {
    const shopLevel = this.scene.gameState.reputation.shopLevel;
    const credits = this.scene.gameState.economy.credits;
    return Object.entries(HOVERCART_UPGRADES).map(([path, steps]) => {
      const stepIndex = this.upgrades[path];
      const step = steps[stepIndex] ?? null;
      const requiresSpeed = path === "length" && stepIndex + 1 > this.upgrades.speed;
      return {
        path,
        step: Math.min(stepIndex + 1, steps.length),
        ...step,
        maxed: !step,
        requiresSpeed,
        speedRequired: stepIndex + 1,
        levelMet: !!step && shopLevel >= step.level,
        canAfford: !!step && credits >= step.cost,
        available: !!step && shopLevel >= step.level && credits >= step.cost &&
          !requiresSpeed && this.scene.fixtureSystem.canExpand(),
      };
    });
  }

  buy() {
    const scene = this.scene;
    const option = this.purchaseOption();
    if (option.cartCount >= MAX_LINKED_HOVERCARTS) {
      scene.messages.show("You already own the maximum of three linked hovercarts.");
      return false;
    }
    if (!scene.fixtureSystem.canExpand()) {
      scene.messages.show("The hovercart can only be bought while the store is closed.");
      return false;
    }
    if (!option.levelMet) {
      scene.messages.show(`Reach Shop Level ${HOVERCART_LEVEL} to buy the hovercart.`);
      return false;
    }
    if (!option.canAfford) {
      scene.messages.show(`The hovercart costs ${formatMoneyAmount(HOVERCART_PRICE)}.`);
      return false;
    }
    const spot = scene.supply.takePadSpots(1)[0];
    if (!spot) {
      scene.messages.show("The Loading Pad is full. Clear a spot on it for the hovercart's crate.", "#f59e0b");
      return false;
    }
    scene.gameState.economy.spend(HOVERCART_PRICE, { category: "equipment", label: HOVERCART_NAME });
    if (!option.cartCount) {
      this.storedBattery = HOVERCART_BATTERY.capacity;
      this.upgrades = { ...HOVERCART_DEFAULT_UPGRADES };
    }
    scene.supply.deliver(new Crate(scene, null, 1, spot.x, spot.y, { kind: "fixture", typeId: HOVERCART_CHARGER_TYPE }));
    scene.supply.freePlayerFromPad();
    scene.gameState.shop.changed();
    scene.saves.requestAutosave();
    scene.messages.show(option.cartCount
      ? "Linked hovercart bought. Its charger is packed in a crate on the Loading Pad."
      : "Hovercart bought. It's packed with its charger in a crate on the Loading Pad. Pick the crate up and place the charger anywhere in the store.", "#10b981");
    return true;
  }

  purchaseUpgrade(path) {
    const scene = this.scene;
    if (!Object.hasOwn(HOVERCART_UPGRADES, path)) throw new Error(`Unknown hovercart upgrade: ${path}`);
    const option = this.upgradeOptions().find((entry) => entry.path === path);
    if (!this.owned) {
      scene.messages.show("Buy the hovercart before upgrading it.");
      return false;
    }
    if (!scene.fixtureSystem.canExpand()) {
      scene.messages.show("Hovercart upgrades can only be bought while the store is closed.");
      return false;
    }
    if (option.maxed) {
      scene.messages.show(`The hovercart's ${path} upgrades are maxed out.`);
      return false;
    }
    if (!option.levelMet) {
      scene.messages.show(`Reach Shop Level ${option.level} to buy this hovercart upgrade.`);
      return false;
    }
    if (option.requiresSpeed) {
      scene.messages.show(`Buy Speed Upgrade ${option.speedRequired} before adding another crate space.`);
      return false;
    }
    if (!option.canAfford) {
      scene.messages.show(`This hovercart upgrade costs ${formatMoneyAmount(option.cost)}.`);
      return false;
    }

    const previousBatteryCapacity = getHovercartBatteryCapacity(this.upgrades);
    const batteryFractions = this.carts.map((cart) => cart.battery / previousBatteryCapacity);
    const storedBatteryFraction = this.storedBattery / previousBatteryCapacity;
    this.upgrades = { ...this.upgrades, [path]: this.upgrades[path] + 1 };
    for (const [index, cart] of this.carts.entries()) {
      cart.setUpgrades(this.upgrades);
      if (path === "battery") {
        cart.battery = Math.min(cart.batteryCapacity, batteryFractions[index] * cart.batteryCapacity);
        cart.renderBattery();
      }
    }
    if (path === "battery") {
      this.storedBattery = Math.min(
        getHovercartBatteryCapacity(this.upgrades),
        storedBatteryFraction * getHovercartBatteryCapacity(this.upgrades),
      );
      for (const saved of this.pendingCartStates) {
        const fraction = saved.battery / previousBatteryCapacity;
        saved.battery = Math.min(getHovercartBatteryCapacity(this.upgrades), fraction * getHovercartBatteryCapacity(this.upgrades));
      }
    }
    scene.gameState.economy.spend(option.cost, {
      category: "equipment",
      label: `${HOVERCART_NAME} ${path} upgrade ${option.step}`,
    });
    scene.gameState.shop.changed();
    scene.saves.requestAutosave();
    scene.messages.show(`${HOVERCART_NAME} ${path} upgrade ${option.step} installed.`, "#10b981");
    return true;
  }

  /**
   * Puts one linked cart on each placed charger.
   * @returns {Hovercart | null}
   */
  sync() {
    const chargers = this.chargers().slice(0, MAX_LINKED_HOVERCARTS);
    if (!chargers.length) {
      if (this.cart) this.storedBattery = this.cart.battery;
      const packedCount = this.packedChargerCount();
      for (const cart of this.carts) {
        if (this.pendingCartStates.length >= packedCount) break;
        if (!this.pendingCartStates.some((state) => state.chargerId === cart.charger.id)) {
          this.pendingCartStates.push(this.serializeCart(cart));
        }
      }
      this.destroyCarts();
      return null;
    }

    const existing = new Map(this.carts.map((cart) => [cart.charger.id, cart]));
    const packedCount = this.packedChargerCount();
    const next = chargers.map((charger, index) => {
      let cart = existing.get(charger.id);
      if (cart) {
        existing.delete(charger.id);
        if (cart.charger !== charger) cart.setCharger(charger);
      } else {
        cart = new Hovercart(this.scene, charger, { secondary: index > 0 });
        cart.assignedEmployeeId = this.scene.gameState.staff.hovercartAssignments?.[charger.id] ?? null;
        cart.setUpgrades(this.upgrades);
        if (index === 0) cart.battery = this.storedBattery;
        cart.renderBattery();
        const savedIndex = this.pendingCartStates.findIndex((entry) => entry.chargerId === charger.id);
        const saved = this.pendingCartStates.splice(savedIndex >= 0 ? savedIndex : 0, 1)[0];
        if (saved) this.restoreCart(cart, saved);
      }
      cart.secondary = index > 0;
      cart.assignedEmployeeId = this.scene.gameState.staff.hovercartAssignments?.[charger.id] ?? null;
      cart.linkedCarts = null;
      return cart;
    });
    for (const removed of existing.values()) {
      if (packedCount > this.pendingCartStates.length) this.pendingCartStates.push(this.serializeCart(removed));
      removed.destroy();
    }
    this.carts = next;
    this.cart = next[0] ?? null;
    const playerCarts = next.filter((cart) => !cart.assignedEmployeeId);
    for (const cart of next) cart.linkedCarts = cart.assignedEmployeeId ? [cart] : playerCarts;

    const signature = next.map((cart) => cart.charger.id).join("|");
    if (signature !== this.linkSignature) {
      for (const collider of this.cartColliders) collider.destroy();
      this.cartColliders = [];
      for (let first = 0; first < next.length; first += 1) {
        for (let second = first + 1; second < next.length; second += 1) {
          this.cartColliders.push(this.scene.physics.add.collider(next[first].cart, next[second].cart));
        }
      }
      this.linkSignature = signature;
    }

    return this.cart;
  }

  getCargoCrates() {
    return this.carts.flatMap((cart) => cart.cartCrates);
  }

  serializeCart(cart) {
    const crates = cart.cartCrates.map((crate) => {
      if (!crate.id) crate.id = this.scene.crateSystem.createId();
      return crate.serializePayload();
    });
    return {
      chargerId: cart.charger.id,
      crates,
      battery: Math.max(0, Math.min(getHovercartBatteryCapacity(this.upgrades), Math.floor(cart.battery))),
      out: cart.isOut(),
    };
  }

  serialize() {
    if (!this.owned) return {};
    const states = this.cart
      ? [this.serializeCart(this.cart), ...this.carts.slice(1).map((cart) => this.serializeCart(cart)), ...this.pendingCartStates]
      : [...this.pendingCartStates];
    if (!states.length) {
      const capacity = getHovercartBatteryCapacity(this.upgrades);
      const wholeCharge = (value) => Math.max(0, Math.min(capacity, Math.floor(value)));
      return { hovercart: {
        owned: true, charger: true, crates: [], battery: wholeCharge(this.storedBattery),
        out: false, upgrades: { ...this.upgrades },
      } };
    }
    const [primary, ...linked] = states.slice(0, MAX_LINKED_HOVERCARTS);
    return { hovercart: {
      owned: true, charger: true, crates: primary.crates, battery: primary.battery,
      out: primary.out, upgrades: { ...this.upgrades }, chargerId: primary.chargerId,
      ...(linked.length ? { carts: linked } : {}),
    } };
  }

  /**
   * Runs after the save's fixtures and crates are back, so a placed or crated charger is already there.
   * @param {{ hovercart?: { owned: true, charger?: true, crates: object[], battery?: number, out?: boolean } }} data
   *   - a checked save
   */
  load(data) {
    this.uninstall();
    this.storedBattery = data.hovercart?.battery ?? HOVERCART_BATTERY.capacity;
    this.upgrades = { ...HOVERCART_DEFAULT_UPGRADES, ...(data.hovercart?.upgrades ?? {}) };
    if (!data.hovercart?.owned) return;
    if (!data.hovercart.charger) this.placeLegacyCharger();
    this.pendingCartStates = [
      {
        ...(typeof data.hovercart.chargerId === "string" ? { chargerId: data.hovercart.chargerId } : {}),
        crates: data.hovercart.crates,
        battery: data.hovercart.battery ?? getHovercartBatteryCapacity(this.upgrades),
        out: data.hovercart.out ?? false,
      },
      ...(data.hovercart.carts ?? []),
    ];
    this.sync();
  }

  restoreCart(target, saved) {
    const { player } = this.scene;
    const crates = saved.crates.map((entry) => this.scene.crateSystem.createItemCrate(
      entry.itemId, entry.quantity, player.sprite.x, player.sprite.y, { id: entry.id }));
    target.restoreSaved(crates, saved.battery ?? getHovercartBatteryCapacity(this.upgrades), saved.out ?? false);
    if (target.assignedEmployeeId && !saved.out) target.reset();
  }

  // Saves from before the charger was a fixture had it fixed in the backroom's top-left corner.
  placeLegacyCharger() {
    const scene = this.scene;
    const fixtures = scene.fixtureSystem;
    const legacy = getLegacyChargerSpot();
    const spot = fixtures.checkPlacement(HOVERCART_CHARGER_TYPE, legacy.gx, legacy.gy).valid
      ? legacy
      : fixtures.findNearestCell(HOVERCART_CHARGER_TYPE, legacy);
    if (spot) {
      fixtures.spawn({ id: scene.fixtures.nextId(HOVERCART_CHARGER_TYPE), type: HOVERCART_CHARGER_TYPE, ...spot, rotation: 0 });
      fixtures.applyCurrentLayout();
      return;
    }
    const pad = scene.supply.takePadSpots(1)[0] ?? { x: scene.player.sprite.x, y: scene.player.sprite.y };
    scene.supply.deliver(new Crate(scene, null, 1, pad.x, pad.y, { kind: "fixture", typeId: HOVERCART_CHARGER_TYPE }));
  }

  destroyCarts() {
    for (const collider of this.cartColliders) collider.destroy();
    this.cartColliders = [];
    this.linkSignature = "";
    for (const cart of this.carts) cart.destroy();
    this.linkGraphics?.destroy();
    this.linkGraphics = null;
    if (this.carts.includes(this.scene.hovercart)) this.scene.hovercart = null;
    this.carts = [];
    this.cart = null;
  }

  uninstall() {
    this.destroyCarts();
    this.pendingCartStates = [];
  }

  update(time, delta) {
    this.sync();
    if (!this.carts.length) return;

    const frozen = (this.scene.shiftClock?.isPaused && this.scene.shiftClock.started) ||
      this.scene.controlMode.getMode() === CONTROL_MODES.LOADING;
    const playerCarts = this.carts.filter((cart) => !cart.assignedEmployeeId);
    const active = playerCarts.filter((cart) => cart.active);
    for (const cart of this.carts) {
      const position = active.indexOf(cart);
      const target = cart.assignedEmployeeId ? this.staff.followTarget(cart)
        : position > 0 ? active[position - 1].cart : null;
      if (cart.followTarget !== target) {
        cart.followTarget = target;
        cart.trail = [];
        cart.trailArea = null;
        cart.trailTarget = null;
        cart.path = null;
      }
      cart.update(time, delta);
      if (!frozen && cart.assignedEmployeeId) this.staff.updateUnattendedCart(cart);
    }
    if (!frozen) this.cart.updatePlayerPush(delta, this.carts);

    const available = playerCarts.filter((cart) => cart.isOut());
    this.scene.hovercart = available.sort((a, b) =>
      Phaser.Math.Distance.Between(this.scene.player.sprite.x, this.scene.player.sprite.y, a.cart.x, a.cart.y) -
      Phaser.Math.Distance.Between(this.scene.player.sprite.x, this.scene.player.sprite.y, b.cart.x, b.cart.y))[0] ??
      playerCarts[0] ?? null;
    for (const cart of this.carts) cart.showBatteryHud = cart === this.scene.hovercart;
    this.scene.hovercart?.renderBattery();
    if (!this.scene.hovercart) this.scene.hud?.renderHovercartBattery?.(null);

    const towing = this.carts.filter((cart) => cart.towedByStaff);
    if (this.carts.length > 1 || towing.length) {
      this.linkGraphics ??= this.scene.add.graphics();
      this.linkGraphics.clear().lineStyle(2, 0x7dd3fc, 0.8);
      for (let index = 1; index < active.length; index += 1) {
        const first = active[index - 1].cart;
        const second = active[index].cart;
        if (this.scene.areas.areaAt(first.x, first.y) !== this.scene.areas.areaAt(second.x, second.y)) continue;
        this.linkGraphics.lineBetween(first.x, first.y, second.x, second.y);
      }
      this.linkGraphics.lineStyle(2, 0xffc267, 0.8);
      for (const cart of towing) {
        const worker = cart.towedByStaff.sprite;
        if (this.scene.areas.areaAt(worker.x, worker.y) === this.scene.areas.areaAt(cart.cart.x, cart.cart.y)) {
          this.linkGraphics.lineBetween(worker.x, worker.y, cart.cart.x, cart.cart.y);
        }
      }
      const drawing = [...active, ...towing];
      this.linkGraphics.setDepth(drawing.length ? Math.min(...drawing.map((cart) => cart.cart.depth)) - 0.02 : 0);
    } else {
      this.linkGraphics?.clear();
    }
  }

  destroy() {
    this.uninstall();
  }
}
