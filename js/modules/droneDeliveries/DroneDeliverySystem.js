import { GAME_EVENTS } from "../../core/Events.js";
import { gameRandom } from "../../core/Random.js";
import { html, raw } from "../../core/html.js";
import { INTERACT_RANGE } from "../../logic/Crate.js";
import { transferItems } from "../../logic/InventoryTransfer.js";
import { fixtureBounds, fixtureFacing, fixtureInteractionDistance } from "../../logic/FixtureLayout.js";
import { formatMoneyAmount } from "../../logic/Money.js";
import { acceptRemoteOffer, createRemoteOrder, REMOTE_ORDER_TUNING, remoteOrderScaling } from "../../logic/RemoteOrders.js";
import { TILE_SIZE, BACKROOM_GRID_Y } from "../../logic/RoomLayout.js";
import { playOrderAlert, playOrderShipped } from "../../logic/Sfx.js";
import { UIWindow } from "../../logic/UIWindow.js";
import {
  DRONE_TERMINAL_FRAME_MS,
  DRONE_TERMINAL_PLATFORM_SPRITE,
  DRONE_TERMINAL_SCREEN_SPRITE,
  DRONE_TERMINAL_SENT_SCREEN_SPRITE,
} from "./DroneTerminalArt.js";
import { AREA } from "../../world/Areas.js";
import { PEOPLE_DEPTH_BASE } from "../../world/Depth.js";
import { controlLabel } from "../../input/InputDevice.js";
import { matchesBinding } from "../../input/KeyBindings.js";
import { describeOrderSources, findOrderItemSources } from "./OrderSources.js";
import { OrderTracker } from "./OrderTracker.js";
import { COOP_TUNING, friendInShop } from "../../coop/CoopTuning.js";

// The terminal art reaches 15px left, 103px right and 28px up from this point, and the pad's
// top edge is 12px below it. This puts the pad's top edge on the base of the backroom's top
// wall (the terminal stands in front of the wall) in the right corner of the starting floor.
const TERMINAL_POSITION = Object.freeze({
  x: TILE_SIZE * 5 - 103,
  y: TILE_SIZE * (BACKROOM_GRID_Y + 1) - 12,
});
const DELIVERY_PAD_POSITION = Object.freeze({
  x: TERMINAL_POSITION.x + 72.5,
  y: TERMINAL_POSITION.y + 32.5,
});
const ORDER_CRATE_POSITION = Object.freeze({
  x: TERMINAL_POSITION.x + 74,
  y: TERMINAL_POSITION.y + 19,
});
const TERMINAL_ART_CENTER = Object.freeze({
  x: TERMINAL_POSITION.x + 45,
  y: TERMINAL_POSITION.y + 12.5,
});
const TERMINAL_COLLISION_CENTER = Object.freeze({
  x: TERMINAL_POSITION.x + 3,
  y: TERMINAL_POSITION.y + 7.5,
});
const TERMINAL_SIZE = Object.freeze({ width: 36, height: 71 });
const DELIVERY_PAD_SIZE = Object.freeze({ width: 61, height: 41 });
const DELIVERY_REACH = TILE_SIZE / 2;
const SHIP_DELAY_MS = 700;
const TERMINAL_OPEN_FRAMES = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]);
const TERMINAL_CLOSE_FRAMES = Object.freeze([6, 5, 4, 3, 2, 1, 0]);
const TERMINAL_LOWER_OPEN_FRAMES = Object.freeze([6, 5, 4]);
const TERMINAL_RAISE_OPEN_FRAMES = Object.freeze([4, 5, 6, 7]);
const TERMINAL_CLOSE_HATCH_FRAMES = Object.freeze([3, 2, 1, 0]);
const TERMINAL_SWAP_PAUSE_MS = 180;
const TERMINAL_SCREEN_ANIMATION = "remote-order-terminal-screen";
// After a shipment the screen shows dots filling in, then a blinking thumbs up with a jingle.
const SHIP_FEEDBACK_DOTS_MS = 1000;
const SHIP_FEEDBACK_THUMBS_MS = 1600;
const SHIP_FEEDBACK_SPARKLE_MS = 200;
// How often the order card and the item markers re-check shelves and crates.
const GUIDANCE_REFRESH_MS = 250;
const SOURCE_MARKER_COLOR = "#2dd4bf";

export function formatRemoteDeadline(deadlineDay, currentDay, label) {
  const days = deadlineDay - currentDay + 1;
  return days <= 1 ? `${label} today` : `${label} in ${days} days`;
}

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
    this.hoursRolled = 0;
    this.pendingShipId = null;
    this.pendingShipMs = 0;
    this.visuals = [];
    this.sourceMarkers = [];
    this.markerSpots = [];
    this.guidanceMs = 0;
    this.activeTab = this.orderState.activeOrder ? "order" : this.orderState.offers.length ? "offers" : "order";
    this.cancelConfirmation = false;
    this.terminalRaised = false;
    this.terminalOpen = false;
    this.terminalAnimation = null;
    this.drawTerminal();
    this.registerInteractions();
    this.buildWindow();
    this.tracker = new OrderTracker();
    this.unsubscribeShiftStarted = shop.eventBus.on(GAME_EVENTS.SHIFT_STARTED, () => {
      this.hoursRolled = 0;
    });
  }

  drawTerminal() {
    const depth = PEOPLE_DEPTH_BASE + TERMINAL_COLLISION_CENTER.y + TERMINAL_SIZE.height / 2;
    this.shop.textures.get(DRONE_TERMINAL_PLATFORM_SPRITE.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.shop.textures.get(DRONE_TERMINAL_SCREEN_SPRITE.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.terminal = this.shop.add.sprite(
      TERMINAL_ART_CENTER.x,
      TERMINAL_ART_CENTER.y,
      DRONE_TERMINAL_PLATFORM_SPRITE.key,
      0,
    ).setCrop(0, 0, 57, DRONE_TERMINAL_PLATFORM_SPRITE.frameHeight).setDepth(depth);
    this.visuals.push(this.terminal);
    this.terminalPad = this.shop.add.sprite(
      TERMINAL_ART_CENTER.x,
      TERMINAL_ART_CENTER.y,
      DRONE_TERMINAL_PLATFORM_SPRITE.key,
      0,
    ).setCrop(57, 0, DRONE_TERMINAL_PLATFORM_SPRITE.frameWidth - 57,
      DRONE_TERMINAL_PLATFORM_SPRITE.frameHeight).setDepth(0.6);
    this.visuals.push(this.terminalPad);

    if (!this.shop.anims.exists(TERMINAL_SCREEN_ANIMATION)) {
      this.shop.anims.create({
        key: TERMINAL_SCREEN_ANIMATION,
        frames: this.shop.anims.generateFrameNumbers(DRONE_TERMINAL_SCREEN_SPRITE.key),
        frameRate: 10,
        repeat: -1,
      });
    }
    this.terminalScreen = this.shop.add.sprite(
      TERMINAL_ART_CENTER.x - DRONE_TERMINAL_PLATFORM_SPRITE.frameWidth / 2 + 10,
      TERMINAL_ART_CENTER.y - DRONE_TERMINAL_PLATFORM_SPRITE.frameHeight / 2 + 11,
      DRONE_TERMINAL_SCREEN_SPRITE.key,
    ).setOrigin(0).setDepth(depth + 0.01).play(TERMINAL_SCREEN_ANIMATION);
    this.visuals.push(this.terminalScreen);

    this.terminalBlocker = this.shop.add.rectangle(
      TERMINAL_COLLISION_CENTER.x,
      TERMINAL_COLLISION_CENTER.y,
      TERMINAL_SIZE.width,
      TERMINAL_SIZE.height,
      0x000000,
      0,
    ).setVisible(false);
    this.shop.physics.add.existing(this.terminalBlocker, true);
    this.shop.obstacleGroup.add(this.terminalBlocker);

    this.padBlocker = this.shop.add.rectangle(
      DELIVERY_PAD_POSITION.x,
      DELIVERY_PAD_POSITION.y,
      DELIVERY_PAD_SIZE.width,
      DELIVERY_PAD_SIZE.height,
      0x000000,
      0,
    ).setVisible(false).setData("allowsCrates", true);
    this.shop.physics.add.existing(this.padBlocker, true);
    this.shop.obstacleGroup.add(this.padBlocker);
  }

  buildWindow() {
    this.window = new UIWindow({
      id: "drone-deliveries-window",
      title: "DRONE TERMINAL",
      width: "440px",
      height: "auto",
      x: 150,
      y: 120,
      shouldCloseOtherWindows: true,
      contentHTML: '<div class="remote-order-content" data-remote-order-content></div>',
    }, this.shop.windowManager);
    this.windowBody = this.window.element.querySelector("[data-remote-order-content]");
    this.window.element.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const tab = event.target.closest("[data-remote-order-tab]");
      const accept = event.target.closest("[data-remote-order-accept]");
      const decline = event.target.closest("[data-remote-order-decline]");
      const selection = event.target.closest("[data-remote-order-select]");
      if (tab) {
        this.activeTab = tab.getAttribute("data-remote-order-tab");
        this.cancelConfirmation = false;
        this.refreshWindow();
      } else if (accept) this.acceptOffer(accept.getAttribute("data-remote-order-accept"));
      else if (selection) this.selectOrder(selection.getAttribute("data-remote-order-select"));
      else if (decline) this.declineOffer(decline.getAttribute("data-remote-order-decline"));
      else if (event.target.closest("[data-remote-order-reset]")) this.resetOrder();
      else if (event.target.closest("[data-remote-order-cancel]")) {
        this.cancelConfirmation = true;
        this.refreshWindow();
      } else if (event.target.closest("[data-remote-order-confirm-cancel]")) this.cancelOrder();
      else if (event.target.closest("[data-remote-order-keep]")) {
        this.cancelConfirmation = false;
        this.refreshWindow();
      }
    });
    // The interact key that opened the terminal also closes it, like the shelf window.
    this.onWindowKey = (event) => {
      if (!this.window.isOpen || this.shop.gamePaused || event.repeat) return;
      if (event.target?.matches?.("input, textarea") || !matchesBinding("interact", event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.window.close();
    };
    this.onWindowMouse = (event) => {
      if (!this.window.isOpen || this.shop.gamePaused || event.target !== this.shop.game.canvas) return;
      if (!matchesBinding("interact", event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.window.close();
    };
    window.addEventListener("keydown", this.onWindowKey, true);
    window.addEventListener("mousedown", this.onWindowMouse);
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
    const { x, y } = TERMINAL_COLLISION_CENTER;
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
    return this.orderState.orders.some((order) => crate.orderId === order.id && crate.id === order.crateId);
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
    this.guidanceMs = 0;
    if (!this.windowBody) return;
    const order = this.orderState.activeOrder;
    if (this.cancelConfirmation && order) {
      this.windowBody.innerHTML = String(html`
        <div class="remote-order-cancel-confirmation">
          <div>Cancel this order?</div>
          <div class="remote-order-cancel-cost">&minus;${order.reputation} reputation</div>
          <div class="remote-order-actions">
            <button type="button" class="action-btn warning" data-remote-order-confirm-cancel>CANCEL ORDER</button>
            <button type="button" class="action-btn" data-remote-order-keep>KEEP IT</button>
          </div>
        </div>
      `);
      return;
    }

    const tabs = this.renderTabs();
    if (this.activeTab === "offers") {
      this.windowBody.innerHTML = String(html`${raw(tabs)}${raw(this.renderOffers())}`);
      return;
    }
    if (!order) {
      this.windowBody.innerHTML = String(html`
        ${raw(tabs)}
        <div class="remote-order-empty">No orders yet</div>
      `);
      return;
    }

    const crate = this.findOrderCrate(order);
    if (!crate) throw new Error(`Remote order ${order.id} is missing its crate.`);
    const rows = order.items.map((line) => this.renderProductLine(
      line.itemId,
      line.quantity,
      crate.getAvailableUnitsFor(line.itemId),
    )).join("");
    const today = this.shop.gameState.calendar.day;
    const due = formatRemoteDeadline(order.expiresOnDay, today, "Due");
    const complete = crate.isRemoteOrderComplete();
    const onPad = this.describeOrderCrateSpot(crate, this.carriedOrderCrate() === crate) === "on the drone pad";
    const readyText = complete ? onPad ? "The drone is picking it up." : "Put the crate on the pad to ship." : "";
    this.windowBody.innerHTML = String(html`
      ${raw(tabs)}
      ${raw(this.renderOrderSelector())}
      <div class="remote-order-lines">${raw(rows)}</div>
      ${readyText ? html`<div class="remote-order-ready">${readyText}</div>` : ""}
      <div class="remote-order-stats">
        <span class="remote-order-pay">Pays ${formatMoneyAmount(order.payout)}</span>
        <span class="remote-order-reputation">+${order.reputation} reputation</span>
        <span class="remote-order-deadline${due.endsWith("today") ? " urgent" : ""}">${due}</span>
      </div>
      <div class="remote-order-actions">
        <button type="button" class="action-btn" data-remote-order-reset>RESET</button>
        <button type="button" class="action-btn warning" data-remote-order-cancel>CANCEL</button>
      </div>
    `);
  }

  renderTabs() {
    const count = this.orderState.offers.length;
    const accepted = this.orderState.orders.length;
    return String(html`
      <div class="remote-order-tabs" role="tablist" aria-label="Drone terminal">
        <button type="button" role="tab" aria-selected="${this.activeTab === "order"}"
          class="remote-order-tab${this.activeTab === "order" ? " active" : ""}"
          data-remote-order-tab="order">${accepted > 1 ? "ORDERS" : "ORDER"}${accepted > 1
            ? html`<span class="remote-order-badge">${accepted}</span>` : ""}</button>
        <button type="button" role="tab" aria-selected="${this.activeTab === "offers"}"
          class="remote-order-tab${this.activeTab === "offers" ? " active" : ""}"
          data-remote-order-tab="offers">OFFERS${count ? html`<span class="remote-order-badge">${count}</span>` : ""}</button>
      </div>
    `);
  }

  renderOrderSelector() {
    if (this.orderState.orders.length < 2) return "";
    const orders = this.orderState.orders.sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
    return String(html`
      <div class="remote-order-selector">
        ${orders.map((order) => html`
          <button type="button" class="remote-order-tab${order === this.orderState.activeOrder ? " active" : ""}"
            data-remote-order-select="${order.id}">ORDER ${order.id.slice("remote-order-".length)}</button>
        `)}
      </div>
    `);
  }

  selectOrder(id) {
    this.orderState.select(id);
    this.activeTab = "order";
    this.cancelConfirmation = false;
    this.refreshWindow();
  }

  renderProductLine(itemId, quantity, packed = null, contractNeeded = false) {
    const item = this.getItem(itemId);
    const amount = packed === null ? `&times;${quantity}` : `${packed}/${quantity}`;
    const complete = packed !== null && packed >= quantity;
    return String(html`
      <div class="remote-order-line${complete ? " complete" : ""}">
        ${item?.image ? html`<img class="remote-order-image" src="${item.image}" alt="">` : ""}
        <span class="remote-order-name">${item?.name ?? itemId}
          ${contractNeeded ? html`<small class="remote-order-contract">Contract needed</small>` : ""}
        </span>
        <span class="remote-order-quantity">${raw(amount)}</span>
      </div>
    `);
  }

  /** The waiting offers, each with its products, pay, and Accept and Decline buttons. */
  renderOffers() {
    const { offers } = this.orderState;
    if (offers.length === 0) return String(html`<div class="remote-order-empty">No offers right now</div>`);
    const today = this.shop.gameState.calendar.day;
    const cards = offers.map((offer) => {
      const rows = offer.items.map((line) => {
        const item = this.getItem(line.itemId);
        return this.renderProductLine(line.itemId, line.quantity, null, !this.ownsContractFor(item));
      }).join("");
      const expires = formatRemoteDeadline(offer.offerEndsDay, today, "Expires");
      return String(html`
        <div class="remote-order-offer">
          <div class="remote-order-lines">${raw(rows)}</div>
          <div class="remote-order-stats">
            <span class="remote-order-pay">Pays ${formatMoneyAmount(offer.payout)}</span>
            <span class="remote-order-reputation">+${offer.reputation} reputation</span>
            <span class="remote-order-deadline${expires.endsWith("today") ? " urgent" : ""}">${expires}</span>
          </div>
          <div class="remote-order-actions">
            <button type="button" class="action-btn" data-remote-order-accept="${offer.id}">ACCEPT</button>
            <button type="button" class="action-btn" data-remote-order-decline="${offer.id}">DECLINE</button>
          </div>
        </div>
      `);
    }).join("");
    return String(html`
      ${raw(cards)}
    `);
  }

  /** A buyer outside the store sends an order offer; it waits at the terminal until accepted. */
  receiveOrder() {
    const { gameState } = this.shop;
    if (this.orderState.offers.length >= this.maxOffers()) {
      return false;
    }
    const details = createRemoteOrder({
      items: gameState.items,
      day: gameState.calendar.day,
      shopLevel: gameState.reputation.shopLevel,
      random: gameRandom,
      licenseLevel: (licenseId) => this.shop.database?.getLicense(licenseId)?.requiredShopLevel,
      marketPrice: (itemId) => gameState.market.getPrice(itemId),
    });
    if (!details) return false;
    const id = this.orderState.allocateOrderId();
    this.orderState.addOffer({ id, ...details });
    playOrderAlert();
    this.tracker?.announce();
    if (!this.orderState.activeOrder) this.activeTab = "offers";
    this.shop.messages.show(
      "New remote order offer! Accept or decline it at the Drone Terminal in the backroom.",
      "#14b8a6",
    );
    this.refreshWindow();
    return true;
  }

  ownsContractFor(item) {
    return !item?.license || this.shop.gameState.catalog?.owns(item.license) !== false;
  }

  acceptOffer(id) {
    const offer = this.orderState.removeOffer(id);
    if (!offer) return false;
    const order = acceptRemoteOffer(offer, this.shop.gameState.calendar.day);
    const crate = this.shop.crateSystem.createRemoteOrderCrate({
      orderId: order.id,
      requiredItems: order.items,
      ...ORDER_CRATE_POSITION,
    });
    crate.setTerminalStored(true);
    this.orderState.open({ ...order, crateId: crate.id });
    this.shop.messages.show(
      `Remote order accepted. Its crate is by the Drone Terminal. ${formatRemoteDeadline(
        order.expiresOnDay, this.shop.gameState.calendar.day, "Due",
      )}.`,
      "#10b981",
    );
    this.activeTab = "order";
    this.cancelConfirmation = false;
    this.refreshWindow();
    return true;
  }

  declineOffer(id) {
    if (!this.orderState.removeOffer(id)) return false;
    this.shop.messages.show("Remote order offer declined. No store reputation lost.", "#94a3b8");
    this.refreshWindow();
    return true;
  }

  // One roll per shift hour passed, independent of who is in the store. A co-op friend makes
  // offers come more often, with room for more waiting (see js/coop/CoopTuning.js).
  updateOrderArrivals() {
    const { shiftClock } = this.shop;
    if (!shiftClock.started) return;
    const hoursPassed = Math.floor(shiftClock.elapsedHours);
    while (this.hoursRolled < hoursPassed) {
      this.hoursRolled += 1;
      if (this.orderState.offers.length >= this.maxOffers()) continue;
      const chanceScale = friendInShop(this.shop) ? COOP_TUNING.remoteOrderChanceScale : 1;
      if (gameRandom() < REMOTE_ORDER_TUNING.chancePerShiftHour * chanceScale) this.receiveOrder();
    }
  }

  maxOffers() {
    const { maxOffers } = remoteOrderScaling(this.shop.gameState.reputation.shopLevel);
    return maxOffers + (friendInShop(this.shop) ? COOP_TUNING.extraRemoteOffers : 0);
  }

  update(time, delta) {
    this.updateOrderArrivals();
    this.syncTerminalState();
    this.updateTerminalAnimation(delta);
    this.updateShipFeedback(delta);
    this.updateDeliveryPad(delta);
    this.updateGuidance(time, delta);
  }

  syncTerminalState() {
    if (this.terminalAnimation || this.pendingShipId) return;
    if (this.orderState.orders.length === 0) {
      if (this.terminalRaised) this.startTerminalAnimation(TERMINAL_CLOSE_FRAMES, false, null, "close");
      else if (this.terminalOpen) this.startTerminalAnimation(TERMINAL_CLOSE_HATCH_FRAMES, false, null, "close");
      return;
    }
    const selected = this.findOrderCrate();
    if (!selected) throw new Error(`Remote order ${this.orderState.activeOrder.id} is missing its crate.`);
    const resident = this.orderState.orders.map((order) => this.findOrderCrate(order))
      .find((crate) => crate && !crate.inTerminal && this.isCrateOnDeliveryPad(crate));
    if (this.terminalRaised && (selected.inTerminal || resident && resident !== selected)) {
      this.startTerminalAnimation(TERMINAL_LOWER_OPEN_FRAMES, false, resident ?? null, "swap");
    } else if (!this.terminalRaised) {
      this.startTerminalAnimation(this.terminalOpen ? TERMINAL_RAISE_OPEN_FRAMES : TERMINAL_OPEN_FRAMES,
        true, selected.inTerminal ? selected : null);
    }
  }

  restoreTerminal() {
    this.terminalAnimation = null;
    this.pendingShipId = null;
    this.pendingShipMs = 0;
    this.terminalRaised = this.orderState.orders.length > 0;
    this.terminalOpen = this.terminalRaised;
    this.setTerminalFrame(this.terminalRaised ? 7 : 0);
    this.cancelConfirmation = false;
    this.activeTab = this.orderState.activeOrder ? "order" : this.orderState.offers.length ? "offers" : "order";
    this.refreshWindow();
  }

  isCrateOnDeliveryPad(crate) {
    if (crate.isCarried || !crate.isStationary()) return false;
    const bounds = crate.getFloorBounds();
    const pad = this.deliveryPadBounds();
    return bounds.left >= pad.left && bounds.right <= pad.right &&
      bounds.top >= pad.top && bounds.bottom <= pad.bottom;
  }

  startTerminalAnimation(frames, raised, crate = null, mode = "raise", frameMs = DRONE_TERMINAL_FRAME_MS) {
    this.terminalAnimation = { frames, index: 0, elapsedMs: 0, raised, crate, mode, frameMs };
    if (crate) crate.setTerminalStored(true);
    this.showTerminalAnimationFrame();
  }

  showTerminalAnimationFrame() {
    const { frames, index, crate } = this.terminalAnimation;
    const frame = frames[index];
    this.setTerminalFrame(frame);
    if (crate?.sprite?.active) {
      crate.sprite.setVisible(frame >= 5).setPosition(ORDER_CRATE_POSITION.x,
        ORDER_CRATE_POSITION.y + Math.max(0, 7 - frame) * 9);
    }
  }

  setTerminalFrame(frame) {
    this.terminal.setFrame(frame);
    this.terminalPad.setFrame(frame);
  }

  updateTerminalAnimation(delta) {
    const animation = this.terminalAnimation;
    if (!animation) return;
    animation.elapsedMs += delta;
    while (animation.elapsedMs >= animation.frameMs) {
      animation.elapsedMs -= animation.frameMs;
      animation.index += 1;
      if (animation.index >= animation.frames.length) {
        this.terminalAnimation = null;
        this.terminalRaised = animation.raised;
        this.terminalOpen = animation.frames.at(-1) >= 4;
        if (animation.crate?.sprite?.active) {
          if (animation.raised) {
            animation.crate.sprite.setPosition(ORDER_CRATE_POSITION.x, ORDER_CRATE_POSITION.y);
            animation.crate.setTerminalStored(false);
            animation.crate.animateRemoteOrderLid();
          } else if (animation.mode === "ship") {
            const order = this.orderState.orders.find((entry) => entry.id === animation.crate.orderId);
            if (order) this.shipOrder(order, animation.crate);
          }
        }
        if (animation.mode === "swap" || animation.mode === "ship" && this.orderState.orders.length > 0) {
          this.startTerminalAnimation([4], false, null, "wait", TERMINAL_SWAP_PAUSE_MS);
        }
        this.refreshWindow();
        return;
      }
      this.showTerminalAnimationFrame();
    }
  }

  startShipFeedback() {
    if (!this.terminalScreen) return;
    this.shipFeedback = { elapsedMs: 0, cheered: false };
    this.terminalScreen.stop();
    this.terminalScreen.setTexture(DRONE_TERMINAL_SENT_SCREEN_SPRITE.key, 0);
  }

  updateShipFeedback(delta) {
    const feedback = this.shipFeedback;
    if (!feedback) return;
    feedback.elapsedMs += delta;
    const elapsed = feedback.elapsedMs;
    let frame;
    if (elapsed < SHIP_FEEDBACK_DOTS_MS) {
      frame = Math.min(2, Math.floor(elapsed / (SHIP_FEEDBACK_DOTS_MS / 3)));
    } else if (elapsed < SHIP_FEEDBACK_DOTS_MS + SHIP_FEEDBACK_THUMBS_MS) {
      if (!feedback.cheered) {
        feedback.cheered = true;
        playOrderShipped();
      }
      frame = 3 + Math.floor((elapsed - SHIP_FEEDBACK_DOTS_MS) / SHIP_FEEDBACK_SPARKLE_MS) % 2;
    } else {
      this.shipFeedback = null;
      this.terminalScreen.setTexture(DRONE_TERMINAL_SCREEN_SPRITE.key).play(TERMINAL_SCREEN_ANIMATION);
      return;
    }
    if (this.terminalScreen.frame.name !== frame) this.terminalScreen.setFrame(frame);
  }

  updateGuidance(time, delta) {
    this.guidanceMs -= delta;
    if (this.guidanceMs <= 0) {
      this.guidanceMs = GUIDANCE_REFRESH_MS;
      this.refreshGuidance();
    }
    this.positionSourceMarkers(time);
  }

  areaName(area) {
    if (area === AREA.SHOP) return "Sales floor";
    if (area === AREA.BACKROOM) return "Backroom";
    const title = this.shop.areas.titleFor(area).toLowerCase();
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  sourceContext(orderCrate) {
    return {
      shelves: this.shop.fixtures.shelves(),
      floorCrates: this.shop.crateSystem.getFloorCrates(),
      carriedCrates: this.shop.crateSystem.getCarriedCrates().filter((crate) => crate !== orderCrate),
      shelfPoint: (shelf) => {
        const bounds = fixtureBounds(shelf);
        return { x: (bounds.left + bounds.right) / 2 * TILE_SIZE, y: bounds.top * TILE_SIZE };
      },
      areaAtPoint: (x, y) => this.shop.areas.areaAt(x, y),
    };
  }

  // Where the order crate is, said the way the player would look for it.
  describeOrderCrateSpot(crate, carrying) {
    if (carrying) return "you're carrying it";
    if (crate.inTerminal) return "inside the Drone Terminal";
    const pad = this.deliveryPadBounds();
    const { x, y } = crate.sprite;
    if (x >= pad.left && x <= pad.right && y >= pad.top && y <= pad.bottom) return "on the drone pad";
    return this.shop.areas.areaAt(x, y) === AREA.SHOP ? "on the sales floor" : "in the backroom";
  }

  /** Builds the order card's contents and the list of shelves and crates to mark. */
  refreshGuidance() {
    const carried = this.carriedOrderCrate();
    const order = carried ? this.orderState.orders.find((entry) => entry.id === carried.orderId) : this.orderState.activeOrder;
    const crate = order ? this.findOrderCrate(order) : null;
    const offerCount = this.orderState.offers.length;
    const offerWord = offerCount === 1 ? "offer is" : "offers are";
    if (!order || !crate) {
      this.markerSpots = [];
      this.tracker?.render(offerCount === 0 ? null : {
        offersOnly: true,
        title: "REMOTE ORDER OFFERS",
        note: `${offerCount} remote order ${offerWord} waiting at the Drone Terminal in the backroom.`,
      });
      return;
    }
    const carrying = this.carriedOrderCrate() === crate;
    const context = this.sourceContext(crate);
    const markerSpots = [];
    const lines = order.items.map((line) => {
      const item = this.getItem(line.itemId);
      const packed = crate.getAvailableUnitsFor(line.itemId);
      const view = { name: item?.name ?? line.itemId, image: item?.image ?? null, packed, needed: line.quantity };
      const remaining = line.quantity - packed;
      if (remaining <= 0) return { ...view, where: "All packed", shortage: "" };
      const sources = findOrderItemSources(line.itemId, context);
      if (carrying) markerSpots.push(...sources.filter((source) => source.kind !== "carried"));
      const available = sources.reduce((sum, source) => sum + source.quantity, 0);
      const buyHint = this.ownsContractFor(item)
        ? "Buy more in the Supply tab."
        : "Your store doesn't own its supplier contract yet. Buy it in the Contracts tab first.";
      const shortage = available === 0
        ? `None in the shop. ${buyHint}`
        : available < remaining ? `Only ${available} in the shop. ${buyHint}` : "";
      return { ...view, where: describeOrderSources(sources, (area) => this.areaName(area)), shortage };
    });
    this.markerSpots = markerSpots;

    const total = order.items.reduce((sum, line) => sum + line.quantity, 0);
    const packed = lines.reduce((sum, line) => sum + Math.min(line.packed, line.needed), 0);
    const spot = this.describeOrderCrateSpot(crate, carrying);
    const complete = crate.isRemoteOrderComplete();
    let status;
    if (complete && spot === "on the drone pad") status = "Everything is packed. The drone is picking it up.";
    else if (complete) status = "Everything is packed. Set the order crate on the drone pad in the backroom.";
    else if (carrying) {
      status = `Face a shelf or crate with a teal diamond over it and press ${controlLabel("interact")} to pack one item.`;
    } else if (crate.inTerminal) status = "The terminal is bringing up this order's crate.";
    else status = `The order crate is ${spot}. Pick it up to start packing.`;
    const today = this.shop.gameState.calendar.day;
    this.tracker?.render({
      dueText: formatRemoteDeadline(order.expiresOnDay, today, "Due"),
      orderNumber: order.id.slice("remote-order-".length),
      dueSoon: order.expiresOnDay <= today,
      payText: `Pays ${formatMoneyAmount(order.payout)}`,
      packed,
      total,
      status,
      complete,
      lines,
      offerNote: [
        this.orderState.orders.length > 1 ? `${this.orderState.orders.length - 1} more accepted ${
          this.orderState.orders.length === 2 ? "order" : "orders"} at the Drone Terminal.` : "",
        offerCount === 0 ? "" : `${offerCount} more ${offerWord} waiting at the Drone Terminal.`,
      ].filter(Boolean).join(" "),
    });
  }

  // A teal diamond bobbing over each shelf and crate holding an item the carried order still needs.
  positionSourceMarkers(time) {
    const places = [];
    for (const spot of this.markerSpots) {
      const sprite = spot.kind === "crate" ? spot.target.sprite : null;
      if (sprite && !sprite.active) continue;
      const x = sprite ? sprite.x : spot.x;
      const top = sprite ? sprite.y - sprite.displayHeight / 2 : spot.y;
      // One diamond per crate stack and per shelf.
      if (places.some((place) => Math.abs(place.x - x) < 6 && Math.abs(place.top - top) < 64)) continue;
      places.push({ x, top });
    }
    while (this.sourceMarkers.length < places.length) {
      this.sourceMarkers.push(this.shop.add.text(0, 0, "◆", {
        fontFamily: "Arial, sans-serif",
        fontSize: "28px",
        color: SOURCE_MARKER_COLOR,
        stroke: "#0f172a",
        strokeThickness: 5,
      }).setOrigin(0.5, 1).setDepth(9000));
    }
    const bob = Math.abs(Math.sin(time / 220)) * 5;
    this.sourceMarkers.forEach((marker, index) => {
      const place = places[index];
      marker.setVisible(Boolean(place));
      if (!place) return;
      const scale = this.shop.cameraRig?.popupScale?.(place.x, place.top) ?? 1;
      marker.setScale(scale).setPosition(place.x, place.top - 2 - bob * scale);
    });
  }

  updateDeliveryPad(delta) {
    if (this.terminalAnimation) return;
    const order = this.orderState.orders.find((entry) => {
      const crate = this.findOrderCrate(entry);
      return crate && !crate.inTerminal && this.isCrateOnDeliveryPad(crate) && crate.isRemoteOrderComplete();
    });
    if (!order) {
      this.pendingShipId = null;
      return;
    }
    const crate = this.findOrderCrate(order);
    if (this.pendingShipId !== crate.id) {
      this.pendingShipId = crate.id;
      this.pendingShipMs = SHIP_DELAY_MS;
      crate.remoteOrderShipping = true;
      crate.sprite.body.stop();
      crate.sprite.body.enable = false;
      crate.animateRemoteOrderLid(false);
      return;
    }
    this.pendingShipMs -= delta;
    if (this.pendingShipMs <= 0) {
      this.startTerminalAnimation(TERMINAL_LOWER_OPEN_FRAMES, false, crate, "ship");
    }
  }

  putOrderCrateOnPad(crate) {
    if (!this.isCurrentOrderCrate(crate) || this.shop.carriedCrate !== crate) return false;
    if (this.orderState.activeOrder.id !== crate.orderId) {
      this.selectOrder(crate.orderId);
      this.syncTerminalState();
    }
    if (this.terminalAnimation || this.terminalRaised === false) {
      this.shop.messages.show("Wait for the delivery platform to finish moving.", "#f59e0b");
      return false;
    }
    if (!crate.isDropPositionClear(
      ORDER_CRATE_POSITION.x,
      ORDER_CRATE_POSITION.y,
      this.shop.player.sprite,
    )) {
      this.shop.messages.show("Make room on the drone pad before setting down the remote order crate.", "#f59e0b");
      return false;
    }
    crate.drop(
      ORDER_CRATE_POSITION.x,
      ORDER_CRATE_POSITION.y,
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
    if (!this.orderState.orders.includes(order) || !crate.isRemoteOrderComplete()) return false;
    this.shop.crateSystem.removeRemoteOrderCrate(crate);
    this.shop.gameState.economy.add(order.payout, {
      category: "drone_deliveries",
      label: "Remote order",
    });
    this.shop.gameState.reputation.gain(order.reputation);
    this.orderState.close(order.id);
    this.cancelConfirmation = false;
    this.activeTab = this.orderState.activeOrder ? "order" : this.orderState.offers.length ? "offers" : "order";
    this.pendingShipId = null;
    this.startShipFeedback();
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
    if (this.pendingShipId === crate.id) this.pendingShipId = null;
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
    if (crate.inTerminal || crate.isCarried) replacement.setTerminalStored(true);
    else replacement.animateRemoteOrderLid();
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
    this.cancelConfirmation = false;
    this.activeTab = this.orderState.activeOrder ? "order" : this.orderState.offers.length ? "offers" : "order";
    this.shop.messages.show(`Remote order cancelled. Store reputation -${order.reputation}.`, "#f59e0b");
    this.refreshWindow();
    return true;
  }

  // Offers past their last day go away for free; an accepted order past its deadline costs reputation.
  endDay() {
    const today = this.shop.gameState.calendar.day;
    let changed = false;
    for (const offer of this.orderState.offers) {
      if (offer.offerEndsDay <= today) changed = Boolean(this.orderState.removeOffer(offer.id)) || changed;
    }
    for (const order of this.orderState.orders) {
      if (order.expiresOnDay > today) continue;
      const crate = this.findOrderCrate(order);
      if (!crate) throw new Error(`Remote order ${order.id} is missing its crate.`);
      this.returnContentsToGoBacks(order, crate);
      this.shop.gameState.reputation.lose(order.reputation);
      this.orderState.close(order.id);
      this.cancelConfirmation = false;
      this.shop.messages.show(`Remote order expired. Store reputation -${order.reputation}.`, "#f59e0b");
      changed = true;
    }
    if (changed) this.refreshWindow();
    return changed;
  }

  destroy() {
    this.unsubscribeShiftStarted?.();
    this.unregisterInteractions?.();
    window.removeEventListener("keydown", this.onWindowKey, true);
    window.removeEventListener("mousedown", this.onWindowMouse);
    this.window?.close();
    this.window?.element.remove();
    if (this.window) this.shop.windowManager.windows.delete(this.window.id);
    this.terminalBlocker?.destroy();
    this.padBlocker?.destroy();
    for (const visual of this.visuals) visual.destroy();
    this.visuals = [];
    for (const marker of this.sourceMarkers ?? []) marker.destroy();
    this.sourceMarkers = [];
    this.tracker?.destroy();
  }
}
