import { GAME_EVENTS } from "../../core/Events.js";
import { gameRandom } from "../../core/Random.js";
import { html, raw } from "../../core/html.js";
import { INTERACT_RANGE } from "../../logic/Crate.js";
import { transferItems } from "../../logic/InventoryTransfer.js";
import { fixtureFacing, fixtureInteractionDistance } from "../../logic/FixtureLayout.js";
import { formatMoneyAmount } from "../../logic/Money.js";
import { createRemoteOrder, REMOTE_ORDER_TUNING } from "../../logic/RemoteOrders.js";
import { TILE_SIZE, BACKROOM_GRID_Y } from "../../logic/RoomLayout.js";
import { UIWindow } from "../../logic/UIWindow.js";
import { PEOPLE_DEPTH_BASE } from "../../world/Depth.js";
import { controlLabel } from "../../input/InputDevice.js";

const TERMINAL_POSITION = Object.freeze({
  x: TILE_SIZE * 1.375,
  y: TILE_SIZE * (BACKROOM_GRID_Y + 2.5),
});
const DELIVERY_PAD_POSITION = Object.freeze({
  x: TILE_SIZE * 2.5,
  y: TILE_SIZE * (BACKROOM_GRID_Y + 2.5),
});
const ORDER_CRATE_POSITION = Object.freeze({
  x: TILE_SIZE * 2,
  y: TILE_SIZE * (BACKROOM_GRID_Y + 3.45),
});
const TERMINAL_SIZE = Object.freeze({ width: 44, height: 28 });
const DELIVERY_PAD_SIZE = Object.freeze({ width: 56, height: 48 });
const DELIVERY_REACH = TILE_SIZE / 2;
const SHIP_DELAY_MS = 700;

function facingDistance(fixture) {
  return ({ feet }) => {
    const midX = (feet.left + feet.right) / 2;
    const midY = (feet.top + feet.bottom) / 2;
    return fixtureInteractionDistance(fixture, {
      down: { x: midX, y: feet.top },
      up: { x: midX, y: feet.bottom },
      left: { x: feet.right, y: midY },
      right: { x: feet.left, y: midY },
    }[fixtureFacing(fixture)]);
  };
}

export class DroneDeliverySystem {
  constructor(shop) {
    this.id = "droneDeliveries";
    this.shop = shop;
    this.orderState = shop.gameState.droneDeliveries;
    this.itemsById = new Map(shop.gameState.items.map((item) => [item.id, item]));
    this.arrivalCursor = 0;
    this.pendingShipId = null;
    this.pendingShipMs = 0;
    this.visuals = [];
    this.drawTerminal();
    this.registerInteractions();
    this.buildWindow();
    this.unsubscribeShiftStarted = shop.eventBus.on(GAME_EVENTS.SHIFT_STARTED, () => {
      this.arrivalCursor = 0;
    });
  }

  drawTerminal() {
    const { x, y } = TERMINAL_POSITION;
    const depth = PEOPLE_DEPTH_BASE + y + TERMINAL_SIZE.height / 2 - 0.75;
    const art = this.shop.add.graphics().setDepth(depth);
    art.fillStyle(0x111827).fillRoundedRect(x - 24, y - 18, 48, 34, 3);
    art.lineStyle(2, 0x64748b).strokeRoundedRect(x - 24, y - 18, 48, 34, 3);
    art.fillStyle(0x064e3b).fillRect(x - 16, y - 12, 32, 13);
    art.lineStyle(1, 0x34d399).strokeRect(x - 16, y - 12, 32, 13);
    art.fillStyle(0x94a3b8).fillRect(x - 8, y + 16, 16, 3);
    art.fillStyle(0x475569).fillRect(x - 16, y + 19, 32, 4);
    this.visuals.push(art);
    this.visuals.push(this.shop.add.text(x, y - 5, "REMOTE", {
      fontFamily: '"Courier New", monospace',
      fontSize: "7px",
      fontStyle: "bold",
      color: "#6ee7b7",
    }).setOrigin(0.5).setDepth(depth + 0.01));
    this.visuals.push(this.shop.add.text(x, y + 34, "ORDERS", {
      fontFamily: '"Courier New", monospace',
      fontSize: "9px",
      fontStyle: "bold",
      color: "#e2e8f0",
    }).setOrigin(0.5).setDepth(depth));

    this.terminalBlocker = this.shop.add.rectangle(
      x,
      y,
      TERMINAL_SIZE.width,
      TERMINAL_SIZE.height,
      0x000000,
      0,
    ).setVisible(false);
    this.shop.physics.add.existing(this.terminalBlocker, true);
    this.shop.obstacleGroup.add(this.terminalBlocker);

    const pad = this.shop.add.graphics().setDepth(0.6);
    pad.fillStyle(0x0f172a, 0.9).fillRoundedRect(
      DELIVERY_PAD_POSITION.x - DELIVERY_PAD_SIZE.width / 2,
      DELIVERY_PAD_POSITION.y - DELIVERY_PAD_SIZE.height / 2,
      DELIVERY_PAD_SIZE.width,
      DELIVERY_PAD_SIZE.height,
      4,
    );
    pad.lineStyle(2, 0x14b8a6, 0.95).strokeRoundedRect(
      DELIVERY_PAD_POSITION.x - DELIVERY_PAD_SIZE.width / 2,
      DELIVERY_PAD_POSITION.y - DELIVERY_PAD_SIZE.height / 2,
      DELIVERY_PAD_SIZE.width,
      DELIVERY_PAD_SIZE.height,
      4,
    );
    pad.lineStyle(1, 0x5eead4, 0.55).strokeCircle(
      DELIVERY_PAD_POSITION.x,
      DELIVERY_PAD_POSITION.y,
      12,
    );
    this.visuals.push(pad);
    this.visuals.push(this.shop.add.text(
      DELIVERY_PAD_POSITION.x,
      DELIVERY_PAD_POSITION.y - DELIVERY_PAD_SIZE.height / 2 - 3,
      "DRONE PAD",
      {
        fontFamily: '"Courier New", monospace',
        fontSize: "9px",
        fontStyle: "bold",
        color: "#5eead4",
      },
    ).setOrigin(0.5, 1).setDepth(0.6));
  }

  buildWindow() {
    this.window = new UIWindow({
      id: "drone-deliveries-window",
      title: "REMOTE ORDERS",
      width: "420px",
      height: "auto",
      x: 150,
      y: 120,
      shouldCloseOtherWindows: true,
      contentHTML: '<div class="remote-order-content" data-remote-order-content></div>',
    }, this.shop.windowManager);
    this.windowBody = this.window.element.querySelector("[data-remote-order-content]");
    this.window.element.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-remote-order-reset]")) this.resetOrder();
      else if (event.target.closest("[data-remote-order-cancel]")) this.cancelOrder();
    });
    this.refreshWindow();
  }

  registerInteractions() {
    this.unregisterInteractions = this.shop.interactables.registerProvider("drone-deliveries", () => {
      const candidates = [{
        id: "drone-terminal",
        kind: "drone-terminal",
        target: this.terminalBlocker,
        range: DELIVERY_REACH,
        distanceFrom: (origin) => this.shop.interactionSystem.feetReachTo(
          origin,
          this.terminalBounds(),
        ),
        getActions: () => [{
          action: "interact",
          hint: `${controlLabel("interact")}: Check remote orders`,
          perform: () => this.openTerminal(),
        }],
      }];

      const orderCrate = this.carriedOrderCrate();
      if (orderCrate) {
        candidates.push(...this.shop.fixtures.shelves().map((fixture) => ({
          id: `remote-order-shelf:${fixture.id}`,
          kind: "remote-order-stock",
          target: fixture,
          range: 12,
          priority: 12,
          distanceFrom: facingDistance(fixture),
          getActions: (player) => {
            if (!this.shop.interactionSystem.isPlayerFacingFixture(fixture, player)) return [];
            const placement = this.findShelfOrderItem(fixture, orderCrate);
            if (!placement) return [];
            const item = this.getItem(placement.itemId);
            return [{
              action: "interact",
              hint: `${controlLabel("interact")}: Take 1 ${item.name} for the order`,
              perform: () => this.transferFromShelf(fixture, placement, orderCrate),
            }];
          },
        })));
        candidates.push(...this.floorCrateCandidates(orderCrate));
        candidates.push(...this.carriedCrateCandidates(orderCrate));
      }

      const top = this.shop.carriedCrate;
      if (top?.kind === "remote-order" && this.isCurrentOrderCrate(top)) {
        candidates.push({
          id: "remote-order-delivery-pad",
          kind: "crate-control",
          target: top,
          range: DELIVERY_REACH,
          priority: 100,
          distanceFrom: (origin) => this.shop.interactionSystem.feetReachTo(
            origin,
            this.deliveryPadBounds(),
          ),
          getActions: () => [{
            action: "putDown",
            kind: "crate-control",
            target: top,
            priority: 100,
            hint: `${controlLabel("putDown")}: Place the remote order crate on the drone pad`,
            perform: () => this.putOrderCrateOnPad(top),
          }],
        });
      }
      return candidates;
    });
  }

  terminalBounds() {
    const { x, y } = TERMINAL_POSITION;
    return {
      left: x - TERMINAL_SIZE.width / 2,
      right: x + TERMINAL_SIZE.width / 2,
      top: y - TERMINAL_SIZE.height / 2,
      bottom: y + TERMINAL_SIZE.height / 2,
    };
  }

  deliveryPadBounds() {
    return {
      left: DELIVERY_PAD_POSITION.x - DELIVERY_PAD_SIZE.width / 2,
      right: DELIVERY_PAD_POSITION.x + DELIVERY_PAD_SIZE.width / 2,
      top: DELIVERY_PAD_POSITION.y - DELIVERY_PAD_SIZE.height / 2,
      bottom: DELIVERY_PAD_POSITION.y + DELIVERY_PAD_SIZE.height / 2,
    };
  }

  carriedOrderCrate() {
    return this.shop.crateSystem.getCarriedCrates()
      .find((crate) => crate.kind === "remote-order" && this.isCurrentOrderCrate(crate)) ?? null;
  }

  isCurrentOrderCrate(crate) {
    const order = this.orderState.activeOrder;
    return Boolean(order && crate.orderId === order.id && crate.id === order.crateId);
  }

  getItem(itemId) {
    return this.itemsById.get(itemId) ?? null;
  }

  findOrderCrate(order = this.orderState.activeOrder) {
    if (!order) return null;
    return [
      ...this.shop.crateSystem.getFloorCrates(),
      ...this.shop.crateSystem.getCarriedCrates(),
    ].find((crate) => crate.id === order.crateId) ?? null;
  }

  findShelfOrderItem(fixture, crate) {
    return fixture.placements.find((placement) =>
      placement.quantity > 0 && crate.getRemainingUnitsFor(placement.itemId) > 0) ?? null;
  }

  neededItemFromCrate(source, orderCrate) {
    return orderCrate.requiredItems.find((line) =>
      orderCrate.getRemainingUnitsFor(line.itemId) > 0 &&
      source.getAvailableUnitsFor(line.itemId) > 0)?.itemId ?? null;
  }

  floorCrateCandidates(orderCrate) {
    return this.shop.crateSystem.getFloorCrates()
      .filter((crate) => crate.kind === "item" && crate.sprite.body?.enable &&
        crate.isStationary() && crate.canTake())
      .map((crate) => ({
        id: `remote-order-crate-source:${crate.id}`,
        kind: "remote-order-stock",
        target: crate,
        range: INTERACT_RANGE,
        priority: 14,
        distanceFrom: (origin) => this.shop.interactionSystem.feetReachTo(
          origin,
          crate.getFloorBounds(),
        ),
        getActions: () => {
          const itemId = this.neededItemFromCrate(crate, orderCrate);
          if (!itemId) return [];
          const item = this.getItem(itemId);
          return [{
            action: "interact",
            hint: `${controlLabel("interact")}: Take 1 ${item.name} from this crate`,
            perform: () => this.transferFromContainer(crate, orderCrate, itemId, "crate"),
          }];
        },
      }));
  }

  carriedCrateCandidates(orderCrate) {
    return this.shop.crateSystem.getCarriedCrates()
      .filter((crate) => crate !== orderCrate && crate.kind === "item")
      .map((crate) => ({
        id: `remote-order-carried-source:${crate.id}`,
        kind: "remote-order-stock",
        target: crate,
        range: 0,
        distanceFrom: () => 0,
        getActions: () => {
          const itemId = this.neededItemFromCrate(crate, orderCrate);
          if (!itemId) return [];
          const item = this.getItem(itemId);
          return [{
            action: "interact",
            hint: `${controlLabel("interact")}: Take 1 ${item.name} from your crate`,
            perform: () => this.transferFromContainer(crate, orderCrate, itemId, "crate"),
          }];
        },
      }));
  }

  transferFromShelf(shelf, placement, orderCrate) {
    return this.transferFromContainer(shelf, orderCrate, placement.itemId, "shelf", placement);
  }

  transferFromContainer(source, destination, itemId, sourceName, sourceEntry = null) {
    const result = transferItems(source, destination, itemId, 1, {
      ...(sourceEntry ? { sourceEntry } : {}),
      eventBus: this.shop.eventBus,
      sourceName,
      destinationName: "remote order",
      context: { orderId: destination.orderId },
    });
    if (result.moved !== 1) {
      this.shop.messages.show(`There is no ${this.getItem(itemId).name} left to move.`, "#f59e0b");
      return false;
    }
    this.orderState.changed();
    const item = this.getItem(itemId);
    const remaining = destination.getRemainingUnitsFor(itemId);
    this.shop.messages.show(remaining
      ? `Added 1 ${item.name} to the remote order. ${remaining} still needed.`
      : `Added the last ${item.name} needed for the remote order.`,
    "#10b981");
    this.refreshWindow();
    return true;
  }

  openTerminal() {
    this.refreshWindow();
    this.window.openWindow();
  }

  refreshWindow() {
    if (!this.windowBody) return;
    const order = this.orderState.activeOrder;
    if (!order) {
      this.windowBody.innerHTML = String(html`
        <p>No remote order is open. Orders may arrive during a shift.</p>
        <p>The terminal and drone pad are in the backroom beside the shipping crate area.</p>
      `);
      return;
    }
    const crate = this.findOrderCrate(order);
    if (!crate) throw new Error(`Remote order ${order.id} is missing its crate.`);
    const rows = order.items.map((line) => {
      const name = this.getItem(line.itemId)?.name ?? line.itemId;
      const packed = crate.getAvailableUnitsFor(line.itemId);
      return String(html`
        <div class="remote-order-line"><span>${name}</span><span>${packed} / ${line.quantity}</span></div>
      `);
    }).join("");
    this.windowBody.innerHTML = String(html`
      <p>Pack this crate with every product below. Take one product at a time from shelves or crates.</p>
      <div class="remote-order-lines">${raw(rows)}</div>
      <p>Payment when shipped: <strong>${formatMoneyAmount(order.payout)}</strong></p>
      <p>Ship it by the end of Day ${order.expiresOnDay}. Shipping adds ${order.reputation} store reputation.
        Cancelling or missing the deadline loses the same amount.</p>
      <div class="remote-order-actions">
        <button type="button" class="action-btn" data-remote-order-reset>RESET CRATE</button>
        <button type="button" class="action-btn warning" data-remote-order-cancel>
          CANCEL ORDER (-${order.reputation} store reputation)
        </button>
      </div>
      <p>Resetting returns packed products to the Go-Backs bin and keeps the order open.</p>
    `);
  }

  receiveOrder() {
    const { gameState } = this.shop;
    if (this.orderState.activeOrder) return false;
    const details = createRemoteOrder({
      items: this.shop.gameState.items,
      day: gameState.calendar.day,
      random: gameRandom,
      ownsLicense: (licenseId) => gameState.catalog.owns(licenseId),
      marketPrice: (itemId) => gameState.market.getPrice(itemId),
    });
    if (!details) return false;
    const id = this.orderState.allocateOrderId();
    const crate = this.shop.crateSystem.createRemoteOrderCrate({
      orderId: id,
      requiredItems: details.items,
      ...ORDER_CRATE_POSITION,
    });
    this.orderState.open({ id, ...details, crateId: crate.id });
    this.shop.messages.show("Remote order received. Check the Drone Terminal in the backroom.", "#14b8a6");
    this.refreshWindow();
    return true;
  }

  updateOrderArrivals() {
    const { shiftClock, customerFlow } = this.shop;
    if (!shiftClock.started) return;
    while (this.arrivalCursor < customerFlow.nextArrival) {
      this.arrivalCursor += 1;
      if (this.orderState.activeOrder) continue;
      if (gameRandom() < REMOTE_ORDER_TUNING.chancePerCustomer) this.receiveOrder();
    }
  }

  update(_time, delta) {
    this.updateOrderArrivals();
    this.updateDeliveryPad(delta);
  }

  updateDeliveryPad(delta) {
    const order = this.orderState.activeOrder;
    if (!order) {
      this.pendingShipId = null;
      return;
    }
    const crate = this.findOrderCrate(order);
    const bounds = crate?.getFloorBounds();
    const pad = this.deliveryPadBounds();
    const onPad = crate && !crate.isCarried && crate.isStationary() &&
      bounds.left >= pad.left && bounds.right <= pad.right &&
      bounds.top >= pad.top && bounds.bottom <= pad.bottom;
    if (!onPad || !crate.isRemoteOrderComplete()) {
      this.pendingShipId = null;
      return;
    }
    if (this.pendingShipId !== crate.id) {
      this.pendingShipId = crate.id;
      this.pendingShipMs = SHIP_DELAY_MS;
      return;
    }
    this.pendingShipMs -= delta;
    if (this.pendingShipMs <= 0) this.shipOrder(order, crate);
  }

  putOrderCrateOnPad(crate) {
    if (!this.isCurrentOrderCrate(crate) || this.shop.carriedCrate !== crate) return false;
    if (!crate.isDropPositionClear(
      DELIVERY_PAD_POSITION.x,
      DELIVERY_PAD_POSITION.y,
      this.shop.player.sprite,
    )) {
      this.shop.messages.show("Make room on the drone pad before setting down the remote order crate.", "#f59e0b");
      return false;
    }
    crate.drop(
      DELIVERY_PAD_POSITION.x,
      DELIVERY_PAD_POSITION.y,
      0,
      0,
      this.shop.crateSystem.motionPaused,
    );
    this.shop.crateSystem.restockCrates.push(crate);
    this.shop.crateSystem.removeCarriedCrate(crate);
    this.shop.crateSystem.syncFloorStacks();
    this.shop.gameState.crates.changed();
    this.pendingShipId = null;
    this.shop.messages.show(crate.isRemoteOrderComplete()
      ? "Remote order crate placed on the drone pad. It will ship shortly."
      : "Remote order crate placed on the drone pad. The order is not complete yet.",
    "#14b8a6");
    return true;
  }

  shipOrder(order, crate) {
    if (this.orderState.activeOrder !== order || !crate.isRemoteOrderComplete()) return false;
    this.shop.crateSystem.removeRemoteOrderCrate(crate);
    this.shop.gameState.economy.add(order.payout, {
      category: "drone_deliveries",
      label: "Remote order",
    });
    this.shop.gameState.reputation.gain(order.reputation);
    this.orderState.close();
    this.pendingShipId = null;
    this.shop.messages.show(
      `Remote order shipped for ${formatMoneyAmount(order.payout)}. Store reputation +${order.reputation}.`,
      "#10b981",
    );
    this.refreshWindow();
    return true;
  }

  returnContentsToGoBacks(order, crate) {
    for (const [itemId, quantity] of crate.contents) {
      const moved = this.shop.gameState.goBacks.add(itemId, quantity);
      if (moved !== quantity) throw new Error(`Could not return ${itemId} from remote order crate.`);
    }
    this.shop.crateSystem.removeRemoteOrderCrate(crate);
    this.pendingShipId = null;
    this.orderState.changed();
    return order;
  }

  resetOrder() {
    const order = this.orderState.activeOrder;
    if (!order) return false;
    const crate = this.findOrderCrate(order);
    if (!crate) throw new Error(`Remote order ${order.id} is missing its crate.`);
    const position = crate.isCarried
      ? ORDER_CRATE_POSITION
      : { x: crate.sprite.x, y: crate.sprite.y };
    this.returnContentsToGoBacks(order, crate);
    const replacement = this.shop.crateSystem.createRemoteOrderCrate({
      orderId: order.id,
      requiredItems: order.items,
      ...position,
    });
    this.orderState.updateActiveOrder({ crateId: replacement.id });
    this.shop.messages.show("Remote order crate reset. Its products are in Go-Backs; the order is still open.", "#10b981");
    this.refreshWindow();
    return true;
  }

  cancelOrder() {
    const order = this.orderState.activeOrder;
    if (!order) return false;
    const crate = this.findOrderCrate(order);
    if (!crate) throw new Error(`Remote order ${order.id} is missing its crate.`);
    this.returnContentsToGoBacks(order, crate);
    this.shop.gameState.reputation.lose(order.reputation);
    this.orderState.close();
    this.shop.messages.show(`Remote order cancelled. Store reputation -${order.reputation}.`, "#f59e0b");
    this.refreshWindow();
    return true;
  }

  endDay() {
    const order = this.orderState.activeOrder;
    if (!order || order.expiresOnDay > this.shop.gameState.calendar.day) return false;
    const crate = this.findOrderCrate(order);
    if (!crate) throw new Error(`Remote order ${order.id} is missing its crate.`);
    this.returnContentsToGoBacks(order, crate);
    this.shop.gameState.reputation.lose(order.reputation);
    this.orderState.close();
    this.shop.messages.show(`Remote order expired. Store reputation -${order.reputation}.`, "#f59e0b");
    this.refreshWindow();
    return true;
  }

  destroy() {
    this.unsubscribeShiftStarted?.();
    this.unregisterInteractions?.();
    this.window?.close();
    this.window?.element.remove();
    if (this.window) this.shop.windowManager.windows.delete(this.window.id);
    this.terminalBlocker?.destroy();
    for (const visual of this.visuals) visual.destroy();
    this.visuals = [];
  }
}
