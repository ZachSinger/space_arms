// The hovercart as a store purchase: unlocked at a Store Level and bought once in the Layout tab.
// It arrives as a HOVERCART CHARGER fixture crate; the cart exists while its charger is placed
// somewhere in the store, and sits in the crate with it otherwise. The cart itself lives in
// Hovercart.js.
import { Hovercart } from "./Hovercart.js";
import { Crate } from "../../logic/Crate.js";
import { formatMoneyAmount } from "../../logic/Money.js";
import {
  HOVERCART_BATTERY,
  HOVERCART_CHARGER_TYPE,
  HOVERCART_DEFAULT_UPGRADES,
  HOVERCART_LEVEL,
  HOVERCART_NAME,
  HOVERCART_PRICE,
  HOVERCART_UPGRADES,
  getHovercartBatteryCapacity,
  getHovercartCapacity,
  getLegacyChargerSpot,
} from "./HovercartRules.js";

export class HovercartSystem {
  constructor(scene) {
    this.id = "hovercart";
    this.scene = scene;
    this.cart = null;
    // The charge of a cart packed away in its charger's crate.
    this.storedBattery = HOVERCART_BATTERY.capacity;
    this.upgrades = { ...HOVERCART_DEFAULT_UPGRADES };
  }

  /** Its charger is placed, or waiting in a crate. */
  get owned() {
    if (this.chargers().length) return true;
    const crates = this.scene.crateSystem;
    if (!crates) return false;
    return [...crates.getFloorCrates(), ...crates.getCarriedCrates()]
      .some((crate) => crate.kind === "fixture" && crate.typeId === HOVERCART_CHARGER_TYPE);
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
      requiredShopLevel: HOVERCART_LEVEL,
      isPurchased: this.owned,
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
    if (option.isPurchased) {
      scene.messages.show("You already own the hovercart.");
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
    this.storedBattery = HOVERCART_BATTERY.capacity;
    this.upgrades = { ...HOVERCART_DEFAULT_UPGRADES };
    scene.supply.deliver(new Crate(scene, null, 1, spot.x, spot.y, { kind: "fixture", typeId: HOVERCART_CHARGER_TYPE }));
    scene.supply.freePlayerFromPad();
    scene.gameState.shop.changed();
    scene.saves.requestAutosave();
    scene.messages.show("Hovercart bought. It's packed with its charger in a crate on the Loading Pad. Pick the crate up and place the charger anywhere in the store.", "#10b981");
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
    const batteryFraction = this.cart
      ? this.cart.battery / previousBatteryCapacity
      : this.storedBattery / previousBatteryCapacity;
    this.upgrades = { ...this.upgrades, [path]: this.upgrades[path] + 1 };
    if (this.cart) {
      this.cart.setUpgrades(this.upgrades);
      if (path === "battery") {
        this.cart.battery = Math.min(this.cart.batteryCapacity, batteryFraction * this.cart.batteryCapacity);
        this.cart.renderBattery();
      }
    } else if (path === "battery") {
      this.storedBattery = Math.min(
        getHovercartBatteryCapacity(this.upgrades),
        batteryFraction * getHovercartBatteryCapacity(this.upgrades),
      );
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
   * Puts the cart on the first placed charger, or packs it away when there's none.
   * @returns {Hovercart | null}
   */
  sync() {
    const charger = this.chargers()[0] ?? null;
    if (!charger) {
      if (this.cart) this.storedBattery = this.cart.battery;
      this.uninstall();
      return null;
    }
    if (!this.cart) {
      this.cart = new Hovercart(this.scene, charger);
      this.cart.setUpgrades(this.upgrades);
      this.cart.battery = this.storedBattery;
      this.cart.renderBattery();
    } else if (this.cart.charger !== charger) {
      this.cart.setCharger(charger);
    }
    return this.cart;
  }

  serialize() {
    if (!this.owned) return {};
    // Whole numbers keep the save from changing with every tiny bit of charge.
    const capacity = getHovercartBatteryCapacity(this.upgrades);
    const wholeCharge = (value) => Math.max(0, Math.min(capacity, Math.floor(value)));
    if (!this.cart) {
      return { hovercart: {
        owned: true, charger: true, crates: [], battery: wholeCharge(this.storedBattery),
        out: false, upgrades: { ...this.upgrades },
      } };
    }
    const crates = this.cart.cartCrates.map((crate) => {
      if (!crate.id) crate.id = this.scene.crateSystem.createId();
      return crate.serializePayload();
    });
    return { hovercart: {
      owned: true, charger: true, crates, battery: wholeCharge(this.cart.battery),
      out: this.cart.isOut(), upgrades: { ...this.upgrades },
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
    const cart = this.sync();
    if (!cart) return;
    const { player } = this.scene;
    const crates = data.hovercart.crates.map((entry) => this.scene.crateSystem.createItemCrate(
      entry.itemId, entry.quantity, player.sprite.x, player.sprite.y, { id: entry.id }));
    cart.restoreSaved(crates, this.storedBattery, data.hovercart.out ?? false);
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

  uninstall() {
    this.cart?.destroy();
    this.cart = null;
  }

  update(time, delta) {
    this.sync();
    this.cart?.update(time, delta);
  }

  destroy() {
    this.uninstall();
  }
}
