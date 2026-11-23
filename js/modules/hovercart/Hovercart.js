import { CRATE_STACK_SPACING, INTERACT_RANGE } from "../../logic/Crate.js";
import { MAX_CARRIED_CRATES } from "../../logic/CrateStack.js";
import { CRATE_TUNING, solveCratePush } from "../../logic/CratePushing.js";
import { getBackroomInteriorBounds } from "../../logic/RoomLayout.js";
import { controlLabel } from "../../input/InputDevice.js";
import { PAD } from "../../input/GamepadInput.js";
import { CONTROL_MODES } from "../../input/ControlMode.js";
import { AREA } from "../../world/Areas.js";
import { PEOPLE_DEPTH_BASE } from "../../world/Depth.js";
import { HOVERCART_BATTERY, HOVERCART_CAPACITY, getHovercartDock } from "./HovercartRules.js";

export { HOVERCART_BATTERY };

const CART_CAPACITY = HOVERCART_CAPACITY;

const METER_COLORS = Object.freeze({ high: 0x4ade80, mid: 0xfbbf24, low: 0xef4444, back: 0x0b1220 });
const CART_MOVE_SPEED = Object.freeze({ empty: 150, perCrate: 18, minimum: 60 });
const CART_FOLLOW_START = 84;
const CART_FOLLOW_STOP = 44;
const CART_DOOR_OPEN_REACH = 72;
const CART_STUCK_MS = 500;
const CART_READY_RANGE = INTERACT_RANGE;
const CART_REPATH_MS = 300;
const CART_CLEARANCE = 4;
const CART_TRAIL_STEP = 8;
const CART_TRAIL_MAX = 80;
const CART_TRAIL_RECHECK_MS = 120;
const CART_CLOSING_MS = 600;
const CART_CLOSING_GAIN = 6;
const CART_ROUTE_MS = 1500;
const CART_BODY = Object.freeze({ width: 32, height: 16, avoidStoreDoor: true });
const HOVERCART_TEXTURES = Object.freeze({
  charger: "hovercart-charger",
  docked: "hovercart-cart-docked",
  active: "hovercart-cart-active",
});

export function getHovercartTransferCount(available, capacity) {
  return Math.max(0, Math.min(available, capacity));
}

export function getHovercartMoveSpeed(crateCount) {
  return Math.max(CART_MOVE_SPEED.minimum, CART_MOVE_SPEED.empty - CART_MOVE_SPEED.perCrate * crateCount);
}

export function getHovercartDrainPerSecond(crateCount, moving) {
  return moving ? 4 + 2 * crateCount : 1 + crateCount;
}

/** @param {number} fraction battery left, 0 to 1 */
export function getHovercartBatteryLevel(fraction) {
  if (fraction > 0.5) return "high";
  if (fraction > 0.2) return "mid";
  return "low";
}

function drawTexture(scene, key, width, height, draw) {
  if (scene.textures.exists(key)) return;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  draw(graphics);
  graphics.generateTexture(key, width, height);
  graphics.destroy();
}

function pixel(g, x, y, width, height, color) {
  g.fillStyle(color, 1).fillRect(x, y, width, height);
}

function createCartTextures(scene) {
  const colors = {
    outline: 0x0d1018,
    steel: 0x616a7c,
    light: 0x9aa7bb,
    dark: 0x3f485b,
    deep: 0x252c3b,
    green: 0x5ae678,
    cyan: 0x50c9e8,
  };
  drawTexture(scene, HOVERCART_TEXTURES.charger, 64, 88, (g) => {
    const c = colors;
    pixel(g, 20, 0, 24, 48, c.outline);
    pixel(g, 22, 2, 20, 44, c.steel);
    pixel(g, 23, 3, 3, 41, c.light);
    pixel(g, 41, 3, 1, 41, c.dark);
    pixel(g, 25, 7, 14, 17, c.deep);
    pixel(g, 27, 9, 10, 13, 0x10231a);
    pixel(g, 29, 11, 6, 2, c.green);
    pixel(g, 29, 15, 2, 2, c.green);
    pixel(g, 33, 15, 2, 2, c.green);
    pixel(g, 25, 28, 14, 5, c.dark);
    pixel(g, 27, 35, 10, 9, c.outline);
    pixel(g, 29, 36, 6, 6, c.deep);
    pixel(g, 31, 44, 2, 13, c.outline);
    pixel(g, 32, 45, 1, 11, c.steel);
    pixel(g, 5, 54, 54, 28, c.outline);
    pixel(g, 7, 56, 50, 24, c.steel);
    pixel(g, 9, 58, 46, 18, c.dark);
    pixel(g, 11, 60, 42, 14, c.deep);
    pixel(g, 17, 61, 30, 2, c.steel);
    pixel(g, 19, 62, 26, 3, c.dark);
    pixel(g, 28, 64, 8, 2, c.cyan);
  });
  drawTexture(scene, HOVERCART_TEXTURES.docked, 40, 24, (g) => {
    const c = colors;
    pixel(g, 3, 5, 34, 15, c.outline);
    pixel(g, 5, 6, 30, 12, c.steel);
    pixel(g, 6, 7, 27, 2, c.light);
    pixel(g, 6, 10, 28, 1, c.dark);
    pixel(g, 7, 12, 26, 4, c.deep);
    pixel(g, 11, 17, 18, 2, c.dark);
    pixel(g, 8, 19, 5, 3, c.outline);
    pixel(g, 27, 19, 5, 3, c.outline);
    pixel(g, 9, 20, 3, 1, c.dark);
    pixel(g, 28, 20, 3, 1, c.dark);
    pixel(g, 15, 9, 10, 2, c.outline);
    pixel(g, 16, 10, 2, 1, c.green);
    pixel(g, 19, 10, 2, 1, c.green);
    pixel(g, 22, 10, 2, 1, c.green);
  });
  drawTexture(scene, HOVERCART_TEXTURES.active, 40, 24, (g) => {
    const c = colors;
    pixel(g, 3, 4, 34, 15, c.outline);
    pixel(g, 5, 5, 30, 12, c.steel);
    pixel(g, 6, 6, 27, 2, c.light);
    pixel(g, 6, 9, 28, 1, c.dark);
    pixel(g, 7, 11, 26, 4, c.deep);
    pixel(g, 11, 16, 18, 2, c.dark);
    pixel(g, 8, 19, 5, 2, c.outline);
    pixel(g, 27, 19, 5, 2, c.outline);
    pixel(g, 9, 20, 3, 1, c.cyan);
    pixel(g, 28, 20, 3, 1, c.cyan);
    pixel(g, 15, 8, 10, 2, c.outline);
    pixel(g, 16, 9, 2, 1, c.green);
    pixel(g, 19, 9, 2, 1, c.green);
    pixel(g, 22, 9, 2, 1, c.green);
  });
}

export class Hovercart {
  constructor(scene) {
    this.id = "hovercartCart";
    this.scene = scene;
    this.cartCrates = [];
    this.active = false;
    this.dead = false;
    this.carried = false;
    this.battery = HOVERCART_BATTERY.capacity;
    this.infiniteBattery = false;
    this.lastTime = null;
    this.moving = false;
    this.path = null;
    this.pathAt = -Infinity;
    this.crossing = null;
    this.trail = [];
    this.trailArea = null;
    this.trailTarget = null;
    this.trailAt = -Infinity;
    this.routeUntil = -Infinity;
    this.closing = null;
    this.destroyed = false;
    const bounds = getBackroomInteriorBounds();
    this.dock = getHovercartDock();
    this.stationBounds = {
      left: this.dock.x - 12,
      right: this.dock.x + 12,
      top: bounds.top - 20,
      bottom: bounds.top + 2,
    };

    createCartTextures(scene);
    this.charger = scene.add.image(this.dock.x, bounds.top - 8, HOVERCART_TEXTURES.charger)
      .setOrigin(0.5, 0.5)
      .setDepth(PEOPLE_DEPTH_BASE + bounds.top + 1);
    this.cart = scene.add.image(this.dock.x, this.dock.y, HOVERCART_TEXTURES.docked)
      .setOrigin(0.5, 0.5)
      .setDepth(PEOPLE_DEPTH_BASE + this.dock.y);
    scene.physics.add.existing(this.cart);
    this.cart.body.setSize(32, 16)
      .setAllowGravity(false)
      .setImmovable(false);
    this.colliders = [
      scene.physics.add.collider(this.cart, scene.room.wallGroup),
      scene.physics.add.collider(this.cart, scene.obstacleGroup),
      scene.physics.add.collider(this.cart, scene.registerGroup),
      scene.physics.add.collider(this.cart, scene.crateGroup, null, (_cart, crate) => this.slideOffCrate(crate)),
    ];

    this.postBlocker = scene.add.rectangle(
      this.dock.x,
      bounds.top - 3,
      24,
      26,
      0x000000,
      0,
    ).setVisible(false);
    scene.physics.add.existing(this.postBlocker, true);
    scene.obstacleGroup.add(this.postBlocker);

    this.chargerTop = { x: this.dock.x - 32, y: bounds.top - 8 - 44 };
    this.stationMeter = scene.add.graphics().setDepth(PEOPLE_DEPTH_BASE + bounds.top + 2);
    this.cartMeter = scene.add.graphics();

    this.unregisterStation = scene.interactables.registerProvider("hovercart-station", () => [{
      id: "hovercart-station",
      kind: "hovercart-station",
      range: 24,
      // A docked cart is solid, so facing it counts as facing its charger.
      distanceFrom: (origin) => scene.interactionSystem.feetReachTo(origin, this.isOut()
        ? this.stationBounds
        : { ...this.stationBounds, left: this.dock.x - 16, right: this.dock.x + 16, bottom: this.dock.y + 8 }),
      getActions: () => this.getStationActions(),
    }]);
    // A dead cart can't follow; the player carries it back to the charger once it's empty.
    this.unregisterCart = scene.interactables.registerProvider("hovercart-cart", () =>
      this.dead && !this.carried ? [{
        id: "hovercart-cart",
        kind: "hovercart",
        range: 24,
        distanceFrom: (origin) => scene.interactionSystem.feetReachTo(origin, this.cart.getBounds()),
        getActions: () => [{
          action: "interact",
          hint: this.cartCrates.length
            ? "Take the crates off the hovercart before you can carry it."
            : `${controlLabel("interact")}: Pick up the hovercart`,
          perform: () => this.pickUpCart(),
        }],
      }] : []);
    // Crates and the carried cart are placed after physics moves things, so they don't trail a frame behind.
    this.releaseDoors = scene.areas?.addDoorUser?.((portal) => this.isUsingDoor(portal));
    this.onPostUpdate = () => this.syncCartCrates();
    scene.events.on("postupdate", this.onPostUpdate);
    scene.hovercart = this;
    this.syncCartCrates();
    this.renderBattery();
  }

  // Off its charger, whether switched on or dead.
  isOut() {
    return this.active || this.dead;
  }

  getStationActions() {
    const scene = this.scene;
    if (scene.areas.playerArea !== AREA.BACKROOM) return [];
    let hint = `${controlLabel("interact")}: Turn on the hovercart`;
    if (this.dead) hint = `${controlLabel("interact")}: Dock the hovercart to charge it`;
    else if (this.active) hint = `${controlLabel("interact")}: Dock and turn off the hovercart`;
    return [{
      action: "interact",
      hint,
      perform: () => this.toggleAtStation(),
    }];
  }

  toggleAtStation() {
    if (!this.isOut()) {
      if (this.battery <= 0) {
        this.scene.messages.show("The hovercart's battery is empty. Let it charge first.", "#f59e0b");
        return false;
      }
      this.active = true;
      this.cart.setPosition(this.dock.x, this.dock.y);
      this.cart.body.stop();
      this.cart.body.enable = true;
      this.cart.setTexture(HOVERCART_TEXTURES.active);
      this.scene.messages.show("Hovercart on.", "#10b981");
      this.syncCartCrates();
      this.renderBattery();
      return true;
    }

    if (this.cartCrates.length) {
      this.scene.messages.show("Take the crates off the hovercart before docking it.", "#f59e0b");
      return false;
    }
    if (Phaser.Math.Distance.Between(this.cart.x, this.cart.y, this.dock.x, this.dock.y) > 72) {
      this.scene.messages.show("Bring the hovercart back to its charger first.", "#f59e0b");
      return false;
    }

    this.active = false;
    this.dead = false;
    this.carried = false;
    this.moving = false;
    this.cart.body.enable = true;
    this.cart.body.reset(this.dock.x, this.dock.y);
    this.cart.setTexture(HOVERCART_TEXTURES.docked);
    this.stepPlayerOffDock();
    this.scene.messages.show("Hovercart docked.", "#10b981");
    this.syncCartCrates();
    this.renderBattery();
    return true;
  }

  // The docked cart is solid, so a player standing on its spot steps just below it.
  stepPlayerOffDock() {
    const player = this.scene.player;
    const feet = player?.sprite?.body;
    const cart = this.cart.body;
    if (!feet || feet.right <= cart.x || feet.x >= cart.right || feet.bottom <= cart.y || feet.y >= cart.bottom) return;
    player.teleportTo(player.sprite.x, player.sprite.y + cart.bottom - feet.y + 1);
  }

  runOutOfBattery() {
    this.battery = 0;
    this.active = false;
    this.dead = true;
    this.carried = false;
    this.moving = false;
    this.path = null;
    this.cart.body.stop();
    this.cart.setTexture(HOVERCART_TEXTURES.docked);
    this.scene.messages.show("The hovercart's battery ran out. Take its crates off and carry it back to its charger.", "#ef4444");
    this.syncCartCrates();
  }

  pickUpCart() {
    const scene = this.scene;
    if (!this.dead || this.carried) return false;
    if (this.cartCrates.length) {
      scene.messages.show("Take the crates off the hovercart before you can carry it.", "#f59e0b");
      return false;
    }
    if (scene.crateSystem.getCarriedCrates().length) {
      scene.messages.show("Put your crates down before picking up the hovercart.", "#f59e0b");
      return false;
    }
    this.carried = true;
    this.cart.body.stop();
    this.cart.body.enable = false;
    scene.messages.show("Carrying the hovercart. Take it to its charger.", "#94a3b8");
    this.syncCartCrates();
    return true;
  }

  modifierDown() {
    return this.scene.controls.isActionDown("dash") || this.scene.controls.padInput?.isDown(PAD.LB);
  }

  isReadyForCrateAction() {
    return this.modifierDown() && this.isInReach();
  }

  isInReach() {
    return this.isOut() && !this.moving && this.isCloseEnough();
  }

  // Close enough to the player for its crates to count as at hand in the crate cards.
  isCloseEnough() {
    return this.isOut() &&
      Phaser.Math.Distance.Between(
        this.scene.player.sprite.x, this.scene.player.sprite.y,
        this.cart.x, this.cart.y,
      ) <= CART_READY_RANGE;
  }

  getStockableCrates() {
    return this.isInReach() ? this.cartCrates : [];
  }

  getCrateActions() {
    const scene = this.scene;
    if (this.carried) {
      const reason = "You're carrying the hovercart. Take it to its charger first.";
      const blocked = { tap: () => scene.messages.show(reason, "#f59e0b"), hintOverride: reason, blocked: true };
      return { pickUp: blocked, putDown: { ...blocked } };
    }
    if (this.isOut() && this.modifierDown() && !this.isReadyForCrateAction()) {
      const reason = this.isCloseEnough()
        ? "Wait for the hovercart to stop next to you."
        : "Stand next to the hovercart to load or unload it.";
      const blocked = { tap: () => scene.messages.show(reason, "#f59e0b"), hintOverride: reason, blocked: true };
      return { pickUp: blocked, putDown: { ...blocked } };
    }
    if (!this.isReadyForCrateAction()) return null;
    const carried = scene.crateSystem.getCarriedCrates();
    const capacity = getHovercartTransferCount(
      carried.length,
      CART_CAPACITY - this.cartCrates.length,
    );
    const takeCount = getHovercartTransferCount(
      this.cartCrates.length,
      MAX_CARRIED_CRATES - carried.length,
    );
    const modifier = "Shift / L1";
    const actions = {};

    if (takeCount > 0) {
      actions.pickUp = {
        tap: () => this.takeFromCart(1),
        hold: () => this.takeFromCart(takeCount),
        hintOverride: `Hold ${modifier} + ${controlLabel("crate")}: Take crates from the hovercart`,
      };
    } else {
      actions.pickUp = {
        tap: () => scene.messages.show(
          this.cartCrates.length ? "Your hands are full." : "The hovercart is empty.",
          "#94a3b8",
        ),
        hintOverride: this.cartCrates.length ? "Your hands are full." : "The hovercart is empty.",
      };
    }

    if (carried.length && this.dead) {
      const reason = "The hovercart's battery is empty. You can only take crates off it.";
      actions.putDown = {
        tap: () => scene.messages.show(reason, "#f59e0b"),
        hintOverride: reason,
        blocked: true,
      };
    } else if (carried.length && carried.every((crate) => crate.kind === "item") && capacity > 0) {
      actions.putDown = {
        tap: () => this.putOnCart(1),
        hold: () => this.putOnCart(capacity),
        hintOverride: `Hold ${modifier} + ${controlLabel("putDown")}: Put crates on the hovercart`,
      };
    } else if (carried.length) {
      const reason = carried.some((crate) => crate.kind !== "item")
        ? "Only item crates can go on the hovercart."
        : "The hovercart is full.";
      actions.putDown = {
        tap: () => scene.messages.show(reason, "#f59e0b"),
        hintOverride: reason,
        blocked: true,
      };
    }
    return actions;
  }

  takeFromCart(count) {
    const scene = this.scene;
    const carried = scene.crateSystem.getCarriedCrates();
    const take = getHovercartTransferCount(
      Math.min(count, this.cartCrates.length),
      MAX_CARRIED_CRATES - carried.length,
    );
    if (!take) {
      scene.messages.show(carried.length >= MAX_CARRIED_CRATES
        ? "Your hands are full."
        : "The hovercart is empty.", "#94a3b8");
      return false;
    }
    const crates = this.cartCrates.splice(-take);
    for (const crate of crates) {
      crate.pickUp(scene.player.sprite, { holderId: "player" });
      scene.crateSystem.addCarriedCrate(crate);
      scene.crateSystem.emitCratePickedUp(crate);
    }
    scene.gameState.crates.changed();
    this.syncCartCrates();
    return true;
  }

  putOnCart(count) {
    const scene = this.scene;
    if (this.dead) {
      scene.messages.show("The hovercart's battery is empty. You can only take crates off it.", "#f59e0b");
      return false;
    }
    const carried = scene.crateSystem.getCarriedCrates();
    const take = getHovercartTransferCount(
      Math.min(count, carried.length),
      CART_CAPACITY - this.cartCrates.length,
    );
    if (!take) {
      scene.messages.show(this.cartCrates.length >= CART_CAPACITY
        ? "The hovercart is full."
        : "There are no crates to put on the hovercart.", "#94a3b8");
      return false;
    }
    const crates = carried.slice(-take);
    if (crates.some((crate) => crate.kind !== "item")) {
      scene.messages.show("Only item crates can go on the hovercart.", "#f59e0b");
      return false;
    }
    for (const crate of crates) {
      scene.crateSystem.removeCarriedCrate(crate);
      crate.setCarriedBy("hovercart");
      crate.sprite.body.stop();
      crate.sprite.body.enable = false;
      crate.sprite.body.moves = false;
      this.cartCrates.push(crate);
      scene.crateSystem.emitCrateDropped(crate, { x: this.cart.x, y: this.cart.y }, false);
    }
    scene.gameState.crates.changed();
    this.syncCartCrates();
    return true;
  }

  syncCartCrates() {
    if (!this.cart || this.destroyed) return;
    if (this.carried) {
      const player = this.scene.player.sprite;
      this.cart.setPosition(player.x, player.y - 22).setDepth(player.depth + 1);
    } else {
      // Sorts by its bottom edge like people, so it's in front of a fixture exactly when it looks it.
      this.cart.setDepth(PEOPLE_DEPTH_BASE + this.cart.y + CART_BODY.height / 2);
    }
    this.cartMeter?.setPosition(this.cart.x, this.cart.y + 15).setDepth(this.cart.depth + 0.005)
      .setVisible(this.isOut() && !this.carried);
    // Its crates stay just over the cart, never far enough up to jump past a fixture.
    this.cartCrates.forEach((crate, index) => {
      crate.followCarrier(this.cart, index, 21, CRATE_STACK_SPACING);
      crate.sprite.setDepth(this.cart.depth + 0.01 * (index + 1));
    });
  }

  updateBattery(seconds) {
    const { capacity, chargeSeconds } = HOVERCART_BATTERY;
    if (!this.isOut()) {
      this.battery = Math.min(capacity, this.battery + capacity / chargeSeconds * seconds);
      return;
    }
    if (!this.active || this.infiniteBattery) return;
    this.battery -= getHovercartDrainPerSecond(this.cartCrates.length, this.moving) * seconds;
    if (this.battery <= 0) this.runOutOfBattery();
  }

  // Shows the charge on the cart, on the charger's screen, and in the top bar while it's out.
  renderBattery() {
    if (this.destroyed) return;
    const fraction = Math.max(0, Math.min(1, this.battery / HOVERCART_BATTERY.capacity));
    const level = getHovercartBatteryLevel(fraction);
    const color = METER_COLORS[level];
    const charging = !this.isOut() && fraction < 1;
    const blinkOff = charging && Math.floor(this.scene.time.now / 500) % 2 === 1;
    const screenFill = Math.round(13 * fraction);
    const cartFill = Math.round(24 * fraction);
    const key = `${this.isOut()}/${level}/${screenFill}/${cartFill}/${blinkOff}`;
    if (key !== this.meterKey) {
      this.meterKey = key;
      const { x, y } = this.chargerTop;
      this.stationMeter.clear()
        .fillStyle(METER_COLORS.back, 1).fillRect(x + 27, y + 9, 10, 13)
        .fillStyle(color, 1).fillRect(x + 27, y + 22 - screenFill, 10, screenFill);
      // While charging, the top of the bar blinks.
      if (blinkOff && screenFill > 0) {
        this.stationMeter.fillStyle(METER_COLORS.back, 1).fillRect(x + 27, y + 22 - screenFill, 10, 1);
      }
      this.cartMeter.clear()
        .fillStyle(0x0d1018, 1).fillRect(-13, -2, 26, 5)
        .fillStyle(METER_COLORS.back, 1).fillRect(-12, -1, 24, 3)
        .fillStyle(color, 1).fillRect(-12, -1, cartFill, 3);
    }
    this.scene.hud?.renderHovercartBattery?.(this.isOut()
      ? { percent: Math.ceil(fraction * 100), level, dead: this.dead }
      : null);
  }

  update(time, delta) {
    const seconds = this.lastTime === null ? 0 : Math.min(time - this.lastTime, 100) / 1000;
    this.lastTime = time;
    const scene = this.scene;
    const frozen = (scene.shiftClock?.isPaused && scene.shiftClock.started) ||
      scene.controlMode?.getMode() === CONTROL_MODES.LOADING;
    if (!frozen && this.cart?.body) this.updateBattery(seconds);
    this.updateMovement(time, frozen, seconds);
    if (!frozen) this.updatePlayerPush(delta);
    this.renderBattery();
  }

  // Whether the cart's body would hit a wall, fixture, register, or floor crate at rect.
  isCartSpaceBlocked(rect) {
    const scene = this.scene;
    const touches = (b) => rect.left < b.x + b.width && rect.left + rect.width > b.x &&
      rect.top < b.y + b.height && rect.top + rect.height > b.y;
    if (!Phaser.Geom.Rectangle.ContainsRect(scene.crateBounds,
      new Phaser.Geom.Rectangle(rect.left, rect.top, rect.width, rect.height))) return true;
    const solidGroups = [scene.room.wallGroup, scene.obstacleGroup, scene.registerGroup];
    return scene.physics.overlapRect(rect.left, rect.top, rect.width, rect.height, false, true)
      .some((solid) => solid.enable && solidGroups.some((group) => group?.contains(solid.gameObject)) && touches(solid)) ||
      scene.restockCrates.some((crate) => crate.sprite.body?.enable && touches(crate.sprite.body));
  }

  // Moves the cart to (x, y), or the nearest free spot around it that isn't where the player stands.
  placeCartClearOfPlayer(x, y) {
    const body = this.cart.body;
    const feet = this.scene.player.sprite.body;
    const { width, height } = body;
    const offsets = [[0, 0], [0, 28], [40, 0], [-40, 0], [0, -28], [40, 28], [-40, 28], [0, 52], [40, -28], [-40, -28]];
    for (const [dx, dy] of offsets) {
      const rect = { left: x + dx - width / 2, top: y + dy - height / 2, width, height };
      const onPlayer = rect.left < feet.right && rect.left + width > feet.x &&
        rect.top < feet.bottom && rect.top + height > feet.y;
      if (!onPlayer && !this.isCartSpaceBlocked(rect)) {
        body.reset(x + dx, y + dy);
        return;
      }
    }
    body.reset(x, y);
  }

  // The cart is solid like a floor crate. Walking into it pushes it at the one-crate push
  // speed, whatever the player carries; docked, it holds still and blocks.
  updatePlayerPush(delta) {
    const scene = this.scene;
    const body = this.cart?.body;
    const playerBody = scene.player?.sprite?.body;
    if (!body?.enable || this.carried || !playerBody || !scene.crateBounds) return;
    const rectOf = (b) => ({ left: b.x, top: b.y, width: b.width, height: b.height });
    const touches = (a, b) => a.left < b.x + b.width && a.left + a.width > b.x &&
      a.top < b.y + b.height && a.top + a.height > b.y;
    const cartRect = rectOf(body);
    const { playerVelocity, crateVelocities } = solveCratePush({
      player: rectOf(playerBody),
      velocity: playerBody.velocity,
      dt: Math.min(delta ?? 16, CRATE_TUNING.physicsFrameDeltaCapMs) / 1000,
      crates: [{ key: this, rect: cartRect, weight: 1, locked: !this.isOut() }],
      isBlocked: (rect) => this.isCartSpaceBlocked(rect),
      maxMoved: 1,
    });
    playerBody.setVelocity(playerVelocity.x, playerVelocity.y);
    const pushed = crateVelocities.get(this);
    if (pushed && (pushed.x || pushed.y)) {
      body.setVelocity(pushed.x, pushed.y);
      this.path = null;
      return;
    }
    // A following cart stops short instead of driving into the player.
    const seconds = Math.min(delta ?? 16, CRATE_TUNING.physicsFrameDeltaCapMs) / 1000;
    const playerNext = rectOf(playerBody);
    playerNext.left += playerVelocity.x * seconds;
    playerNext.top += playerVelocity.y * seconds;
    for (const axis of ["x", "y"]) {
      if (!body.velocity[axis]) continue;
      const next = { ...cartRect };
      if (axis === "x") next.left += body.velocity.x * seconds;
      else next.top += body.velocity.y * seconds;
      const asBody = { x: playerNext.left, y: playerNext.top, width: playerNext.width, height: playerNext.height };
      if (touches(next, asBody)) body.velocity[axis] = 0;
    }
  }

  // Floor crates stop the cart without being shoved by it; the cart backs out the short way.
  slideOffCrate(crateSprite) {
    const cart = this.cart.body;
    const crate = crateSprite.body;
    if (!cart.enable || !crate?.enable) return false;
    const pushLeft = cart.right - crate.x;
    const pushRight = crate.right - cart.x;
    const pushUp = cart.bottom - crate.y;
    const pushDown = crate.bottom - cart.y;
    const smallest = Math.min(pushLeft, pushRight, pushUp, pushDown);
    if (smallest <= 0) return false;
    let { x, y } = cart.center;
    if (smallest === pushLeft) x -= pushLeft;
    else if (smallest === pushRight) x += pushRight;
    else if (smallest === pushUp) y -= pushUp;
    else y += pushDown;
    const velocity = { x: cart.velocity.x, y: cart.velocity.y };
    if (smallest === pushLeft || smallest === pushRight) velocity.x = 0;
    else velocity.y = 0;
    cart.reset(x, y);
    cart.setVelocity(velocity.x, velocity.y);
    return false;
  }

  // The portal whose front is the path's next stop, while the cart is heading for a door.
  approachingPortal() {
    const next = this.path?.[0];
    if (!next?.teleportTo || !this.moving) return null;
    return this.scene.areas.portals.find((portal) =>
      Math.abs(portal.front.x - next.x) < 1 && Math.abs(portal.front.y - next.y) < 1) ?? null;
  }

  // Doors open as the cart nears them and stay open while it passes through.
  isUsingDoor(portal) {
    if (this.crossing) return portal === this.crossing.from || portal === this.crossing.to;
    const approaching = this.approachingPortal();
    return portal === approaching &&
      Phaser.Math.Distance.Between(this.cart.x, this.cart.y, portal.front.x, portal.front.y) < CART_DOOR_OPEN_REACH;
  }

  // True once a moving cart has gone nowhere for a moment.
  isStuck(time) {
    const last = this.progress;
    if (!last || Phaser.Math.Distance.Between(this.cart.x, this.cart.y, last.x, last.y) > 4) {
      this.progress = { x: this.cart.x, y: this.cart.y, time };
      return false;
    }
    return time - last.time > CART_STUCK_MS;
  }

  startCrossing(portal) {
    this.progress = null;
    const to = portal.partner ?? this.scene.areas.portalBetween(portal.to, portal.area);
    if (!to) return false;
    this.crossing = { from: portal, to, phase: "in" };
    this.cart.body.stop();
    this.cart.body.enable = false;
    return true;
  }

  // Glides into the doorway, comes out of the other door, and waits there if the player
  // is standing just outside it.
  updateCrossing(seconds) {
    const crossing = this.crossing;
    const speed = getHovercartMoveSpeed(this.cartCrates.length);
    const goal = crossing.phase === "in" ? crossing.from.door : crossing.to.front;
    const distance = Phaser.Math.Distance.Between(this.cart.x, this.cart.y, goal.x, goal.y);
    const step = Math.min(distance, speed * seconds);
    const x = distance ? this.cart.x + (goal.x - this.cart.x) / distance * step : goal.x;
    const y = distance ? this.cart.y + (goal.y - this.cart.y) / distance * step : goal.y;
    if (crossing.phase === "out" && this.overlapsPlayerAt(x, y)) {
      this.moving = false;
      this.syncCartCrates();
      return;
    }
    this.moving = true;
    this.cart.setPosition(x, y);
    if (step >= distance) {
      if (crossing.phase === "in") {
        crossing.phase = "out";
        this.cart.setPosition(crossing.to.door.x, crossing.to.door.y);
      } else {
        this.crossing = null;
        this.cart.body.enable = true;
        this.cart.body.reset(goal.x, goal.y);
        this.path = null;
        this.pathAt = -Infinity;
      }
    }
    this.syncCartCrates();
  }

  overlapsPlayerAt(x, y) {
    const feet = this.scene.player.sprite.body;
    const { width, height } = CART_BODY;
    return x - width / 2 < feet.right && x + width / 2 > feet.x &&
      y - height / 2 < feet.bottom && y + height / 2 > feet.y;
  }

  // In the player's room it heads for the player. Anywhere else it only heads for the door
  // leading toward him, and goes straight at it if no clear route is found.
  findFollowPath(player, sameArea) {
    const navStore = this.scene.navigation.store;
    const extraSolids = this.scene.restockCrates
      .filter((crate) => crate.sprite.body?.enable)
      .map(({ sprite: { body: b } }) => ({ x: b.x, y: b.y, width: b.width, height: b.height }));
    const tight = { ...CART_BODY, extraSolids };
    // Routes keep a little room off fixture corners so the cart can't snag on them; the
    // tight fit is only used for gaps too narrow otherwise.
    const roomy = {
      width: CART_BODY.width + CART_CLEARANCE * 2,
      height: CART_BODY.height + CART_CLEARANCE * 2,
      extraSolids,
    };
    const store = {
      findPath: (fromX, fromY, toX, toY) =>
        navStore.findPath(fromX, fromY, toX, toY, roomy) ?? navStore.findPath(fromX, fromY, toX, toY, tight),
    };
    if (sameArea) return store.findPath(this.cart.x, this.cart.y, player.x, player.y);
    const legs = this.scene.areas.crossings(this.cart.x, this.cart.y, player.x, player.y);
    if (!legs?.length) return null;
    const { near, far } = legs[0];
    const door = { x: near.x, y: near.y, teleportTo: { x: far.x, y: far.y } };
    let route = null;
    for (const [dx, dy] of [[0, 0], [0, 16], [-24, 8], [24, 8], [0, 32], [-32, 24], [32, 24], [0, 48]]) {
      const path = store.findPath(this.cart.x, this.cart.y, near.x + dx, near.y + dy);
      if (!path) continue;
      route = dx || dy ? [...path, { x: near.x + dx, y: near.y + dy }] : path;
      break;
    }
    return [...(route ?? []).filter((point) => point.x !== near.x || point.y !== near.y), door];
  }

  updateMovement(time, frozen, seconds = 0) {
    this.recordTrail();
    if (this.crossing && this.cart?.body) {
      if (!frozen) this.updateCrossing(seconds);
      return;
    }
    if (!this.cart?.body || !this.active || frozen) {
      this.moving = false;
      this.path = null;
      this.cart?.body?.stop();
      return;
    }

    // Parks within reach of the player, whichever way he faces, and follows him through doors.
    const areas = this.scene.areas;
    const player = this.scene.player.sprite;
    const sameArea = areas.areaAt(this.cart.x, this.cart.y) === areas.playerArea;
    const distance = Phaser.Math.Distance.Between(this.cart.x, this.cart.y, player.x, player.y);
    // Close only counts if nothing like the register stands between them.
    const nearby = sameArea && distance <= CART_FOLLOW_START;
    const shouldMove = !sameArea ||
      (this.moving ? distance > CART_FOLLOW_STOP : distance > CART_FOLLOW_START) ||
      (nearby && !this.hasClearLine(this.cart, player.body.center, CART_BODY.width / 2, -2));
    if (!this.moving) {
      this.progress = null;
      this.closing = null;
    }
    if (!shouldMove) {
      this.moving = false;
      this.path = null;
      this.trailTarget = null;
      this.cart.body.stop();
      this.syncCartCrates();
      return;
    }

    this.moving = true;
    if (sameArea) {
      this.steerInRoom(time, player);
      this.syncCartCrates();
      return;
    }
    if (!this.path || time - this.pathAt > CART_REPATH_MS) {
      this.path = this.findFollowPath(player, sameArea);
      this.pathAt = time;
    }
    if (!sameArea && !this.path?.length) {
      this.moving = false;
      this.cart.body.stop();
      this.syncCartCrates();
      return;
    }
    while (this.path?.length) {
      const next = this.path[0];
      if (Phaser.Math.Distance.Between(this.cart.x, this.cart.y, next.x, next.y) > 6) break;
      const portal = next.teleportTo ? this.approachingPortal() : null;
      this.path.shift();
      if (portal && this.startCrossing(portal)) {
        this.updateCrossing(seconds);
        return;
      }
      if (next.teleportTo) {
        this.placeCartClearOfPlayer(next.teleportTo.x, next.teleportTo.y);
        this.pathAt = -Infinity;
      }
    }
    const doorAhead = !sameArea ? this.approachingPortal() : null;
    if (doorAhead && this.isStuck(time) && Phaser.Math.Distance.Between(
      this.cart.x, this.cart.y, doorAhead.front.x, doorAhead.front.y) < CART_DOOR_OPEN_REACH) {
      // Something's in front of the door; it squeezes past rather than waiting forever.
      this.path.shift();
      if (this.startCrossing(doorAhead)) {
        this.updateCrossing(seconds);
        return;
      }
    }
    const target = this.path?.[0] ?? player;
    const speed = getHovercartMoveSpeed(this.cartCrates.length);
    const angle = Phaser.Math.Angle.Between(this.cart.x, this.cart.y, target.x, target.y);
    this.cart.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    this.syncCartCrates();
  }

  // Remembers where the player has walked in his current room, to follow in his footsteps.
  recordTrail() {
    const areas = this.scene.areas;
    const feet = this.scene.player?.sprite?.body?.center;
    if (!feet || !areas) return;
    if (this.trailArea !== areas.playerArea) {
      this.trail = [];
      this.trailArea = areas.playerArea;
      this.trailTarget = null;
    }
    const last = this.trail[this.trail.length - 1];
    if (last && Phaser.Math.Distance.Between(last.x, last.y, feet.x, feet.y) < CART_TRAIL_STEP) return;
    this.trail.push({ x: feet.x, y: feet.y });
    if (this.trail.length > CART_TRAIL_MAX) this.trail.shift();
  }

  // Whether the cart, grown by `margin` pixels, could glide straight from `from` to `to`
  // without touching anything, stopping `short` pixels before `to`.
  hasClearLine(from, to, short = 0, margin = CART_CLEARANCE) {
    const length = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
    const end = Math.max(0, length - short);
    const width = CART_BODY.width + margin;
    const height = CART_BODY.height + margin;
    for (let along = 0; ; along = Math.min(end, along + 6)) {
      const x = length ? from.x + (to.x - from.x) / length * along : from.x;
      const y = length ? from.y + (to.y - from.y) / length * along : from.y;
      if (this.isCartSpaceBlocked({ left: x - width / 2, top: y - height / 2, width, height })) return false;
      if (along >= end) return true;
    }
  }

  // The furthest point along the player's footsteps the cart can reach in a straight line,
  // or the player himself if nothing is in the way.
  nextTrailPoint(time) {
    const cart = this.cart;
    if (this.trailTarget &&
      Phaser.Math.Distance.Between(cart.x, cart.y, this.trailTarget.x, this.trailTarget.y) <= 6) {
      this.trailTarget = null;
    }
    if (this.trailTarget && time - this.trailAt < CART_TRAIL_RECHECK_MS) return this.trailTarget;
    this.trailAt = time;
    const feet = this.scene.player.sprite.body.center;
    if (this.hasClearLine(cart, feet, CART_BODY.width / 2)) {
      this.trailTarget = { x: feet.x, y: feet.y };
      return this.trailTarget;
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const point = this.trail[i];
      // The trail point it's already on doesn't count: there the player squeezed somewhere
      // the wider cart can't, so it plans its own way around right away.
      if (Phaser.Math.Distance.Between(cart.x, cart.y, point.x, point.y) <= 6) break;
      if (!this.hasClearLine(cart, point)) continue;
      this.trail.splice(0, i);
      this.trailTarget = this.trail[0];
      return this.trailTarget;
    }
    this.trailTarget = null;
    return null;
  }

  // In the player's room the cart retraces his footsteps. If it stops getting anywhere
  // (stuck on something, or not closing in on the player, whether he's standing or
  // walking), it plans its own route for a moment instead.
  steerInRoom(time, player) {
    const feet = player.body.center;
    // Progress is judged against where the player is now, so his own walking neither
    // hides a stuck cart nor counts against one that's keeping up.
    const closing = this.closing;
    const gained = closing
      ? Phaser.Math.Distance.Between(closing.x, closing.y, feet.x, feet.y) -
        Phaser.Math.Distance.Between(this.cart.x, this.cart.y, feet.x, feet.y)
      : 0;
    if (!closing || gained >= CART_CLOSING_GAIN) {
      this.closing = { x: this.cart.x, y: this.cart.y, time };
    }
    const stuck = this.isStuck(time);
    const notClosing = time - this.closing.time > CART_CLOSING_MS;
    if (time >= this.routeUntil && (stuck || notClosing)) this.startRouting(time);

    let target;
    if (time < this.routeUntil) {
      if (!this.path || time - this.pathAt > CART_REPATH_MS) {
        this.path = this.findFollowPath(player, true);
        this.pathAt = time;
      }
      while (this.path?.length &&
        Phaser.Math.Distance.Between(this.cart.x, this.cart.y, this.path[0].x, this.path[0].y) <= 6) {
        this.path.shift();
      }
      target = this.path?.[0] ?? player;
    } else {
      target = this.nextTrailPoint(time);
      if (!target) {
        this.startRouting(time);
        this.steerInRoom(time, player);
        return;
      }
    }
    const speed = getHovercartMoveSpeed(this.cartCrates.length);
    const angle = Phaser.Math.Angle.Between(this.cart.x, this.cart.y, target.x, target.y);
    this.cart.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  startRouting(time) {
    this.routeUntil = time + CART_ROUTE_MS;
    this.path = null;
    this.pathAt = -Infinity;
    this.trailTarget = null;
    this.closing = null;
    this.progress = null;
  }

  clearCrates() {
    for (const crate of this.cartCrates) crate.destroy();
    this.cartCrates = [];
    this.battery = HOVERCART_BATTERY.capacity;
    this.reset();
  }

  // A loaded save keeps the cart's charge. A cart that was out (or has crates) comes back next
  // to the player, switched on, or dead if its battery was empty; otherwise it's on its charger.
  restoreSaved(crates, battery, out) {
    this.battery = battery;
    if (!crates.length && !out) {
      this.renderBattery();
      return;
    }
    const player = this.scene.player.sprite;
    const dead = battery <= 0;
    this.active = !dead;
    this.dead = dead;
    this.cart.setTexture(dead ? HOVERCART_TEXTURES.docked : HOVERCART_TEXTURES.active);
    this.placeCartClearOfPlayer(player.x + 40, player.y);
    if (dead) this.cart.body.stop();
    for (const crate of crates) {
      crate.setCarriedBy("hovercart");
      crate.sprite.body.stop();
      crate.sprite.body.enable = false;
      crate.sprite.body.moves = false;
      this.cartCrates.push(crate);
    }
    this.syncCartCrates();
    this.renderBattery();
  }

  reset() {
    this.crossing = null;
    this.trailTarget = null;
    this.routeUntil = -Infinity;
    this.closing = null;
    this.active = false;
    this.dead = false;
    this.carried = false;
    this.moving = false;
    if (this.cart?.body) this.cart.body.enable = true;
    this.cart?.body?.stop();
    this.cart?.setTexture(HOVERCART_TEXTURES.docked);
    this.cart?.body?.reset(this.dock.x, this.dock.y);
    this.syncCartCrates();
    this.renderBattery();
  }

  destroy() {
    if (this.destroyed) return;
    this.scene.hud?.renderHovercartBattery?.(null);
    this.destroyed = true;
    this.scene.events.off("postupdate", this.onPostUpdate);
    this.unregisterStation?.();
    this.unregisterCart?.();
    this.releaseDoors?.();
    for (const collider of this.colliders) collider.destroy();
    // Destroying it also takes it out of obstacleGroup, which may already be gone at shutdown.
    this.postBlocker.destroy();
    for (const crate of this.cartCrates) crate.destroy();
    this.cartCrates = [];
    this.charger.destroy();
    this.stationMeter.destroy();
    this.cartMeter.destroy();
    this.cart.destroy();
    for (const key of Object.values(HOVERCART_TEXTURES)) {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    }
    if (this.scene.hovercart === this) this.scene.hovercart = null;
  }
}
