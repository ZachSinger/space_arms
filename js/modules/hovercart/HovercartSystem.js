// The hovercart as a store purchase: unlocked at a Store Level, bought once in the Layout tab,
// then parked on its charger in the backroom. The cart itself lives in Hovercart.js.
import { Hovercart } from "./Hovercart.js";
import { formatMoneyAmount } from "../../logic/Money.js";
import { validateFixtureLayout } from "../../logic/FixtureLayout.js";
import {
  HOVERCART_BATTERY,
  HOVERCART_LEVEL,
  HOVERCART_NAME,
  HOVERCART_PRICE,
  getHovercartReservedRectangle,
} from "./HovercartRules.js";

export class HovercartSystem {
  constructor(scene) {
    this.id = "hovercart";
    this.scene = scene;
    this.cart = null;
  }

  get owned() {
    return Boolean(this.cart);
  }

  /** What the Layout tab shows for the hovercart. */
  purchaseOption() {
    const { reputation, economy } = this.scene.gameState;
    return {
      name: HOVERCART_NAME,
      price: HOVERCART_PRICE,
      requiredShopLevel: HOVERCART_LEVEL,
      isPurchased: this.owned,
      levelMet: reputation.shopLevel >= HOVERCART_LEVEL,
      canAfford: economy.credits >= HOVERCART_PRICE,
    };
  }

  /** Fixtures must keep clear of the charger once the cart is bought. */
  reservedRectangles() {
    return this.owned ? [getHovercartReservedRectangle()] : [];
  }

  // What's sitting where the charger goes, or null when the spot is clear.
  chargerSpotBlocker() {
    const scene = this.scene;
    const spot = getHovercartReservedRectangle();
    const overlaps = (body) => body && body.enable !== false &&
      body.x < spot.right && body.right > spot.left && body.y < spot.bottom && body.bottom > spot.top;
    const options = scene.fixtureSystem.layoutOptions();
    const check = validateFixtureLayout(scene.fixtures.layout(), {
      ...options,
      reservedRectangles: [...options.reservedRectangles, spot],
    });
    if (!check.valid && check.reason === spot.reason) {
      return "Move the fixture out of that corner first.";
    }
    if (scene.restockCrates.some((crate) => overlaps(crate.sprite?.body))) {
      return "Move the crates out of that corner first.";
    }
    if (overlaps(scene.player?.sprite?.body)) return "Step out of that corner first.";
    return null;
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
    const blocker = this.chargerSpotBlocker();
    if (blocker) {
      scene.messages.show(`The hovercart's charger goes in the top-left corner of the backroom. ${blocker}`, "#f59e0b");
      return false;
    }
    scene.gameState.economy.spend(HOVERCART_PRICE, { category: "equipment", label: HOVERCART_NAME });
    this.install();
    scene.gameState.shop.changed();
    scene.saves.requestAutosave();
    scene.messages.show("Hovercart bought. Its charger is in the top-left corner of the backroom.", "#10b981");
    return true;
  }

  install() {
    if (!this.cart) this.cart = new Hovercart(this.scene);
    return this.cart;
  }

  serialize() {
    if (!this.cart) return {};
    const crates = this.cart.cartCrates.map((crate) => {
      if (!crate.id) crate.id = this.scene.crateSystem.createId();
      return crate.serializePayload();
    });
    // Whole numbers keep the save from changing with every tiny bit of charge.
    const battery = Math.max(0, Math.min(HOVERCART_BATTERY.capacity, Math.floor(this.cart.battery)));
    return { hovercart: { owned: true, crates, battery, out: this.cart.isOut() } };
  }

  /**
   * @param {{ hovercart?: { owned: true, crates: object[], battery?: number, out?: boolean } }} data
   *   - a checked save
   */
  load(data) {
    this.uninstall();
    if (!data.hovercart?.owned) return;
    const cart = this.install();
    const { player } = this.scene;
    const crates = data.hovercart.crates.map((entry) => this.scene.crateSystem.createItemCrate(
      entry.itemId, entry.quantity, player.sprite.x, player.sprite.y, { id: entry.id }));
    cart.restoreSaved(crates, data.hovercart.battery ?? HOVERCART_BATTERY.capacity, data.hovercart.out ?? false);
  }

  uninstall() {
    this.cart?.destroy();
    this.cart = null;
  }

  update(time, delta) {
    this.cart?.update(time, delta);
  }

  destroy() {
    this.uninstall();
  }
}
