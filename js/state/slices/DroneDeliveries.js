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
    // Keep the selected accepted order in the existing save field for backward compatibility.
    this.activeOrder = null;
    this.otherOrders = [];
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
    if (this.orders.some((entry) => entry.id === order.id)) throw new Error("This remote order is already open.");
    if (this.activeOrder) this.otherOrders = [...this.otherOrders, this.activeOrder];
    this.activeOrder = copyOrder(order);
    this.changed();
  }

  get orders() {
    return this.activeOrder ? [this.activeOrder, ...this.otherOrders] : [];
  }

  select(id) {
    if (this.activeOrder?.id === id) return;
    const order = this.otherOrders.find((entry) => entry.id === id);
    if (!order) throw new Error(`Remote order ${id} is not open.`);
    this.otherOrders = [...this.otherOrders.filter((entry) => entry.id !== id), this.activeOrder];
    this.activeOrder = order;
    this.changed();
  }

  updateActiveOrder(updates) {
    if (!this.activeOrder) throw new Error("There is no remote order to update.");
    this.activeOrder = { ...this.activeOrder, ...updates };
    this.changed();
  }

  close(id = this.activeOrder?.id) {
    if (!this.orders.some((order) => order.id === id)) return false;
    if (this.activeOrder.id === id) {
      this.activeOrder = this.otherOrders[0] ?? null;
      this.otherOrders = this.otherOrders.slice(1);
    } else this.otherOrders = this.otherOrders.filter((order) => order.id !== id);
    this.changed();
    return true;
  }

  adopt(next) {
    this.nextOrderId = next.nextOrderId;
    this.activeOrder = copyOrder(next.activeOrder);
    this.otherOrders = next.otherOrders.map(copyOrder);
    this.offers = next.offers.map(copyOrder);
  }

  toSave() {
    return {
      droneDeliveries: {
        nextOrderId: this.nextOrderId,
        activeOrder: copyOrder(this.activeOrder),
        otherOrders: this.otherOrders.map(copyOrder),
        offers: this.offers.map(copyOrder),
      },
    };
  }

  static fromSave(data) {
    const state = new DroneDeliveries();
    if (data.droneDeliveries) {
      state.nextOrderId = data.droneDeliveries.nextOrderId;
      state.activeOrder = copyOrder(data.droneDeliveries.activeOrder);
      state.otherOrders = (data.droneDeliveries.otherOrders ?? []).map(copyOrder);
      state.offers = (data.droneDeliveries.offers ?? []).map(copyOrder);
    }
    return state;
  }
}