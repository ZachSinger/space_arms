import { Slice } from "../Slice.js";

function copyOrder(order) {
  return order ? {
    ...order,
    items: order.items.map((item) => ({ ...item })),
  } : null;
}

export class DroneDeliveries extends Slice {
  constructor() {
    super();
    this.nextOrderId = 1;
    this.activeOrder = null;
    // Order offers waiting at the terminal to be accepted or declined.
    this.offers = [];
  }

  allocateOrderId() {
    const id = `remote-order-${this.nextOrderId}`;
    this.nextOrderId += 1;
    this.changed();
    return id;
  }

  addOffer(offer) {
    this.offers = [...this.offers, copyOrder(offer)];
    this.changed();
  }

  removeOffer(id) {
    const offer = this.offers.find((entry) => entry.id === id) ?? null;
    if (!offer) return null;
    this.offers = this.offers.filter((entry) => entry.id !== id);
    this.changed();
    return copyOrder(offer);
  }

  open(order) {
    if (this.activeOrder) throw new Error("A remote order is already open.");
    this.activeOrder = copyOrder(order);
    this.changed();
  }

  updateActiveOrder(updates) {
    if (!this.activeOrder) throw new Error("There is no remote order to update.");
    this.activeOrder = { ...this.activeOrder, ...updates };
    this.changed();
  }

  close() {
    if (!this.activeOrder) return false;
    this.activeOrder = null;
    this.changed();
    return true;
  }

  adopt(next) {
    this.nextOrderId = next.nextOrderId;
    this.activeOrder = copyOrder(next.activeOrder);
    this.offers = next.offers.map(copyOrder);
  }

  toSave() {
    return {
      droneDeliveries: {
        nextOrderId: this.nextOrderId,
        activeOrder: copyOrder(this.activeOrder),
        offers: this.offers.map(copyOrder),
      },
    };
  }

  static fromSave(data) {
    const state = new DroneDeliveries();
    if (data.droneDeliveries) {
      state.nextOrderId = data.droneDeliveries.nextOrderId;
      state.activeOrder = copyOrder(data.droneDeliveries.activeOrder);
      state.offers = (data.droneDeliveries.offers ?? []).map(copyOrder);
    }
    return state;
  }
}