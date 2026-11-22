import { GAME_EVENTS } from "../../core/Events.js";
import { gameRandom } from "../../core/Random.js";
import { html, raw } from "../../core/html.js";
import { INTERACT_RANGE } from "../../logic/Crate.js";
import { transferItems } from "../../logic/InventoryTransfer.js";
import { fixtureBounds, fixtureFacing, fixtureInteractionDistance } from "../../logic/FixtureLayout.js";
import { formatMoneyAmount } from "../../logic/Money.js";
import { createRemoteOrder, REMOTE_ORDER_TUNING } from "../../logic/RemoteOrders.js";
import { TILE_SIZE, BACKROOM_GRID_Y } from "../../logic/RoomLayout.js";
import { playOrderAlert } from "../../logic/Sfx.js";
import { UIWindow } from "../../logic/UIWindow.js";
import {
  DRONE_TERMINAL_FRAME_MS,
  DRONE_TERMINAL_PLATFORM_SPRITE,
  DRONE_TERMINAL_SCREEN_SPRITE,
} from "./DroneTerminalArt.js";
import { AREA } from "../../world/Areas.js";
import { PEOPLE_DEPTH_BASE } from "../../world/Depth.js";
import { controlLabel } from "../../input/InputDevice.js";
import { matchesBinding } from "../../input/KeyBindings.js";
import { describeOrderSources, findOrderItemSources } from "./OrderSources.js";
import { OrderTracker } from "./OrderTracker.js";

// The terminal art reaches 15px left, 103px right and 28px up from this point, so this
// tucks it into the top-right corner of the starting backroom floor.
const TERMINAL_POSITION = Object.freeze({
  x: TILE_SIZE * 5 - 103,
  y: TILE_SIZE * (BACKROOM_GRID_Y + 1) + 28,
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
const TERMINAL_SCREEN_ANIMATION = "remote-order-terminal-screen";
// How often the order card and the item markers re-check shelves and crates.
const GUIDANCE_REFRESH_MS = 250;
const SOURCE_MARKER_COLOR = "#2dd4bf";

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
    this.sourceMarkers = [];
    this.markerSpots = [];
    this.guidanceMs = 0;
    this.terminalRaised = false;
    this.terminalAnimation = null;
    this.drawTerminal();
    this.registerInteractions();
    this.buildWindow();
    this.tracker = new OrderTracker();
    this.unsubscribeShiftStarted = shop.eventBus.on(GAME_EVENTS.SHIFT_STARTED, () => {
      this.arrivalCursor = 0;
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
    this.guidanceMs = 0;
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
    playOrderAlert();
    this.tracker?.announce();
    this.shop.messages.show(
      "New remote order! Its item list is in the top-left corner. Its crate is by the Drone Terminal in the backroom.",
      "#14b8a6",
    );
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

  update(time, delta) {
    this.updateOrderArrivals();
    this.syncTerminalState();
    this.updateTerminalAnimation(delta);
    this.updateDeliveryPad(delta);
    this.updateGuidance(time, delta);
  }

  syncTerminalState() {
    if (this.terminalAnimation) return;
    const crate = this.findOrderCrate();
    const onPad = crate && this.isCrateOnDeliveryPad(crate);
    if (onPad && !this.terminalRaised) {
      this.startTerminalAnimation(TERMINAL_OPEN_FRAMES, true, crate);
    } else if (!onPad && this.terminalRaised) {
      this.startTerminalAnimation(TERMINAL_CLOSE_FRAMES, false);
    }
  }

  isCrateOnDeliveryPad(crate) {
    if (crate.isCarried || !crate.isStationary()) return false;
    const bounds = crate.getFloorBounds();
    const pad = this.deliveryPadBounds();
    return bounds.left >= pad.left && bounds.right <= pad.right &&
      bounds.top >= pad.top && bounds.bottom <= pad.bottom;
  }

  startTerminalAnimation(frames, raised, crate = null) {
    this.terminalAnimation = { frames, index: 0, elapsedMs: 0, raised, crate };
    if (raised && crate) {
      crate.sprite.setVisible(false).setPosition(ORDER_CRATE_POSITION.x, ORDER_CRATE_POSITION.y + 18);
    }
    this.setTerminalFrame(frames[0]);
  }

  setTerminalFrame(frame) {
    this.terminal.setFrame(frame);
    this.terminalPad.setFrame(frame);
  }

  updateTerminalAnimation(delta) {
    const animation = this.terminalAnimation;
    if (!animation) return;
    animation.elapsedMs += delta;
    while (animation.elapsedMs >= DRONE_TERMINAL_FRAME_MS) {
      animation.elapsedMs -= DRONE_TERMINAL_FRAME_MS;
      animation.index += 1;
      if (animation.index >= animation.frames.length) {
        this.terminalAnimation = null;
        this.terminalRaised = animation.raised;
        if (animation.crate?.sprite?.active) {
          if (animation.raised) {
            animation.crate.sprite.setPosition(ORDER_CRATE_POSITION.x, ORDER_CRATE_POSITION.y);
          }
          animation.crate.sprite.setVisible(true);
          if (animation.raised) animation.crate.animateRemoteOrderLid();
        }
        return;
      }
      this.setTerminalFrame(animation.frames[animation.index]);
      if (animation.raised && animation.crate?.sprite?.active && animation.index >= 5) {
        animation.crate.sprite.setVisible(true);
        animation.crate.sprite.y = ORDER_CRATE_POSITION.y + (7 - animation.index) * 9;
      }
    }
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
    const pad = this.deliveryPadBounds();
    const { x, y } = crate.sprite;
    if (x >= pad.left && x <= pad.right && y >= pad.top && y <= pad.bottom) return "on the drone pad";
    return this.shop.areas.areaAt(x, y) === AREA.SHOP ? "on the sales floor" : "in the backroom";
  }

  /** Builds the order card's contents and the list of shelves and crates to mark. */
  refreshGuidance() {
    const order = this.orderState.activeOrder;
    const crate = order ? this.findOrderCrate(order) : null;
    if (!order || !crate) {
      this.markerSpots = [];
      this.tracker?.render(null);
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
      const shortage = available === 0
        ? "None in the shop. Buy more in the Supply tab."
        : available < remaining ? `Only ${available} in the shop. Buy more in the Supply tab.` : "";
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
    } else status = `The order crate is ${spot}. Pick it up to start packing.`;
    const today = this.shop.gameState.calendar.day;
    this.tracker?.render({
      dueText: order.expiresOnDay <= today ? "Ship by the end of today" : `Ship by the end of Day ${order.expiresOnDay}`,
      dueSoon: order.expiresOnDay <= today,
      payText: `Pays ${formatMoneyAmount(order.payout)}`,
      packed,
      total,
      status,
      complete,
      lines,
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
