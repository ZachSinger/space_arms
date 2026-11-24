// ==========================================
// FILE: DeliveryDrones.js
// ==========================================
// Delivery Drone Delivery Drones: bought once in the Layout tab. They pack accepted remote orders
// by themselves, one item at a time, whenever the store holds everything an order still needs,
// then ship the finished crate. They only reach crates inside the Drone Terminal or on its pad.
import { transferItems } from "../../logic/InventoryTransfer.js";
import { formatMoneyAmount } from "../../logic/Money.js";
import { AREA } from "../../world/Areas.js";
import { findOrderItemSources } from "./OrderSources.js";

export const DELIVERY_DRONES = Object.freeze({
  name: "Delivery Drone Delivery Drones",
  price: 5000,
  requiredShopLevel: 10,
  // Time to pack one item.
  packMs: 1500,
});

/**
 * Crates before shelves so customers keep finding stock, and the backroom before the sales floor.
 * @param {{ kind: string, area: string }} source
 */
function sourceRank(source) {
  return (source.kind === "shelf" ? 2 : 0) + (source.area === AREA.BACKROOM ? 0 : 1);
}

/** @param {import("./OrderSources.js").OrderSource[]} sources */
export function sortDroneSources(sources) {
  return [...sources].sort((left, right) => sourceRank(left) - sourceRank(right));
}

/**
 * How many of each still-needed item the store is short, counting only stock the drones can take.
 * @param {{ itemId: string, remaining: number }[]} lines
 * @param {(itemId: string) => number} availableFor
 */
export function droneShortages(lines, availableFor) {
  return lines
    .filter((line) => line.remaining > 0)
    .map((line) => ({ itemId: line.itemId, short: line.remaining - availableFor(line.itemId) }))
    .filter((line) => line.short > 0);
}

const orderNumber = (order) => Number(order.id.slice("remote-order-".length));

export class DeliveryDrones {
  /** @param {import("./DroneDeliverySystem.js").DroneDeliverySystem} system */
  constructor(system) {
    this.system = system;
    this.packMs = 0;
  }

  get owned() {
    return this.system.orderState.dronesOwned === true;
  }

  /** What the Layout tab shows for the drones. */
  purchaseOption() {
    const { reputation, economy } = this.system.shop.gameState;
    return {
      ...DELIVERY_DRONES,
      owned: this.owned,
      levelMet: reputation.shopLevel >= DELIVERY_DRONES.requiredShopLevel,
      canAfford: economy.credits >= DELIVERY_DRONES.price,
    };
  }

  buy() {
    const { shop } = this.system;
    const option = this.purchaseOption();
    if (option.owned) return false;
    if (!option.levelMet) {
      shop.messages.show(`Reach Shop Level ${DELIVERY_DRONES.requiredShopLevel} to buy the ${DELIVERY_DRONES.name}.`);
      return false;
    }
    if (!option.canAfford) {
      shop.messages.show(`The ${DELIVERY_DRONES.name} cost ${formatMoneyAmount(DELIVERY_DRONES.price)}.`);
      return false;
    }
    shop.gameState.economy.spend(DELIVERY_DRONES.price, { category: "equipment", label: DELIVERY_DRONES.name });
    this.system.orderState.buyDrones();
    shop.saves?.requestAutosave?.();
    shop.messages.show(
      "Delivery Drone Delivery Drones bought. They pack and ship accepted remote orders by themselves. Follow them in the new Deliveries tab.",
      "#10b981",
    );
    return true;
  }

  /** Stock the drones may take for an item, best source first; never from a crate someone is holding. */
  sources(itemId, orderCrate) {
    const context = this.system.sourceContext(orderCrate);
    return sortDroneSources(findOrderItemSources(itemId, {
      ...context,
      floorCrates: context.floorCrates.filter((crate) =>
        crate.sprite?.body?.enable !== false && crate.isStationary() && crate.canTake()),
      carriedCrates: [],
    }));
  }

  /**
   * What the drones are doing with one accepted order.
   * @returns {{ order: object, crate: object, state: "packing" | "waiting" | "carried" | "away" | "moving" | "shipping",
   *   shortages: { itemId: string, short: number }[], packed: number, total: number } | null}
   */
  orderStatus(order) {
    const crate = this.system.findOrderCrate(order);
    if (!crate) return null;
    const lines = order.items.map((line) => ({
      itemId: line.itemId,
      needed: line.quantity,
      remaining: Math.max(0, line.quantity - crate.getAvailableUnitsFor(line.itemId)),
    }));
    const total = lines.reduce((sum, line) => sum + line.needed, 0);
    const packed = total - lines.reduce((sum, line) => sum + line.remaining, 0);
    const complete = crate.isRemoteOrderComplete();
    const shortages = complete ? [] : droneShortages(lines, (itemId) =>
      this.sources(itemId, crate).reduce((sum, source) => sum + source.quantity, 0));
    // Crates still on the Loading Pad can't be unpacked yet, by the player or the drones.
    const onLoadingPad = shortages.some(({ itemId }) => this.system.shop.crateSystem.getFloorCrates()
      .some((entry) => entry.kind === "item" && entry.itemId === itemId && entry.quantity > 0 && entry.lockedToPad));
    let state;
    if (crate.isCarried) state = "carried";
    else if (crate.remoteOrderShipping || this.system.terminalAnimation?.crate === crate) state = "moving";
    else if (!crate.inTerminal && !this.system.isCrateOnDeliveryPad(crate)) state = "away";
    else if (complete) state = "shipping";
    else state = shortages.length ? "waiting" : "packing";
    return { order, crate, state, shortages, onLoadingPad, packed, total };
  }

  /** One sentence telling the player what the drones are doing with this order. */
  statusText(status) {
    const { system } = this;
    const reach = "Your drones only reach order crates inside the Drone Terminal or on its drone pad in the backroom.";
    if (status.state === "packing") return "Your drones are packing this order.";
    if (status.state === "shipping") return "Everything is packed. Your drones are shipping it.";
    if (status.state === "moving") return "The Drone Terminal is moving this order's crate.";
    if (status.state === "carried") return `You're carrying this order's crate. ${reach}`;
    if (status.state === "away") {
      const spot = system.describeOrderCrateSpot(status.crate, false);
      if (spot === "on the drone pad") return "This order's crate is hanging off the edge of the drone pad. Set it fully on the pad so your drones can reach it.";
      return `This order's crate is ${spot}. ${reach}`;
    }
    const missing = status.shortages
      .map(({ itemId, short }) => `${system.getItem(itemId)?.name ?? itemId} (${short})`)
      .join(", ");
    const restock = status.onLoadingPad
      ? "Move the crates waiting on the Loading Pad into the store; the drones can't unpack them there."
      : "Buy more in the Supply tab.";
    return `Your drones are waiting for stock. Still missing from your shelves and crates: ${missing}. ${restock}`;
  }

  statuses() {
    return [...this.system.orderState.orders]
      .sort((left, right) => orderNumber(left) - orderNumber(right))
      .map((order) => this.orderStatus(order))
      .filter(Boolean);
  }

  /** @param {number} delta */
  update(delta) {
    if (!this.owned) {
      this.packMs = 0;
      return;
    }
    this.packMs += delta;
    if (this.packMs < DELIVERY_DRONES.packMs) return;
    this.packMs = 0;
    this.step();
  }

  /** Ships a finished crate still inside the terminal, or packs one item into the oldest ready order. */
  step() {
    for (const status of this.statuses()) {
      if (status.state === "shipping" && status.crate.inTerminal && !this.system.terminalAnimation) {
        return this.system.shipOrder(status.order, status.crate);
      }
      if (status.state === "packing" && this.packOne(status.order, status.crate)) return true;
    }
    return false;
  }

  packOne(order, crate) {
    for (const line of order.items) {
      if (crate.getAvailableUnitsFor(line.itemId) >= line.quantity) continue;
      for (const source of this.sources(line.itemId, crate)) {
        const sourceEntry = source.kind === "shelf"
          ? source.target.placements.find((placement) => placement.itemId === line.itemId && placement.quantity > 0)
          : null;
        const result = transferItems(source.target, crate, line.itemId, 1, {
          sourceEntry,
          eventBus: this.system.shop.eventBus,
          sourceName: source.kind,
          destinationName: "remote order",
          context: { orderId: order.id },
        });
        if (result.moved !== 1) continue;
        this.system.orderState.changed();
        this.system.refreshWindow();
        return true;
      }
    }
    return false;
  }
}
