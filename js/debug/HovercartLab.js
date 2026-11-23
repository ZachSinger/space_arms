import { CRATE_STACK_SPACING, INTERACT_RANGE } from "../logic/Crate.js";
import { MAX_CARRIED_CRATES } from "../logic/CrateStack.js";
import { getBackroomInteriorBounds } from "../logic/RoomLayout.js";
import { controlLabel } from "../input/InputDevice.js";
import { PAD } from "../input/GamepadInput.js";
import { AREA } from "../world/Areas.js";
import { PEOPLE_DEPTH_BASE } from "../world/Depth.js";

const CART_CAPACITY = 5;
const CART_MOVE_SPEED = Object.freeze({ empty: 150, perCrate: 18, minimum: 60 });
const CART_FOLLOW_START = 84;
const CART_FOLLOW_STOP = 44;
const CART_READY_RANGE = INTERACT_RANGE;
const HOVERCART_TEXTURES = Object.freeze({
  charger: "hovercart-lab-charger",
  docked: "hovercart-lab-cart-docked",
  active: "hovercart-lab-cart-active",
});

export function getHovercartTransferCount(available, capacity) {
  return Math.max(0, Math.min(available, capacity));
}

export function getHovercartMoveSpeed(crateCount) {
  return Math.max(CART_MOVE_SPEED.minimum, CART_MOVE_SPEED.empty - CART_MOVE_SPEED.perCrate * crateCount);
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

export class HovercartLab {
  constructor(scene) {
    this.id = "hovercartLab";
    this.scene = scene;
    this.cartCrates = [];
    this.active = false;
    this.moving = false;
    this.destroyed = false;
    const bounds = getBackroomInteriorBounds();
    this.dock = { x: bounds.left + 40, y: bounds.top + 22 };
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
      .setImmovable(false)
      .setBoundsRectangle(new Phaser.Geom.Rectangle(
        bounds.left + 20,
        bounds.top + 20,
        bounds.right - bounds.left - 40,
        bounds.bottom - bounds.top - 40,
      ));
    this.colliders = [
      scene.physics.add.collider(this.cart, scene.room.wallGroup),
      scene.physics.add.collider(this.cart, scene.obstacleGroup),
      scene.physics.add.collider(this.cart, scene.registerGroup),
      scene.physics.add.collider(this.cart, scene.crateGroup),
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

    this.unregisterStation = scene.interactables.registerProvider("hovercart-lab-station", () => [{
      id: "hovercart-lab-station",
      kind: "hovercart-station",
      range: 24,
      distanceFrom: (origin) => scene.interactionSystem.feetReachTo(origin, this.stationBounds),
      getActions: () => this.getStationActions(),
    }]);
    scene.hovercartLab = this;
    this.syncCartCrates();
  }

  getStationActions() {
    const scene = this.scene;
    if (scene.areas.playerArea !== AREA.BACKROOM) return [];
    const hint = this.active
      ? `${controlLabel("interact")}: Dock and turn off the hovercart`
      : `${controlLabel("interact")}: Turn on the hovercart`;
    return [{
      action: "interact",
      hint,
      perform: () => this.toggleAtStation(),
    }];
  }

  toggleAtStation() {
    if (!this.active) {
      this.active = true;
      this.cart.setPosition(this.dock.x, this.dock.y);
      this.cart.body.stop();
      this.cart.body.enable = true;
      this.cart.setTexture(HOVERCART_TEXTURES.active);
      this.scene.messages.show("Hovercart on.", "#10b981");
      this.syncCartCrates();
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
    this.moving = false;
    this.cart.body.stop();
    this.cart.setPosition(this.dock.x, this.dock.y);
    this.cart.setTexture(HOVERCART_TEXTURES.docked);
    this.scene.messages.show("Hovercart docked.", "#10b981");
    return true;
  }

  modifierDown() {
    return this.scene.controls.isActionDown("dash") || this.scene.controls.padInput?.isDown(PAD.LB);
  }

  isReadyForCrateAction() {
    return this.active && !this.moving && this.modifierDown() &&
      Phaser.Math.Distance.Between(
        this.scene.player.sprite.x, this.scene.player.sprite.y,
        this.cart.x, this.cart.y,
      ) <= CART_READY_RANGE;
  }

  getStockableCrates() {
    return this.active && !this.moving &&
      Phaser.Math.Distance.Between(
        this.scene.player.sprite.x, this.scene.player.sprite.y,
        this.cart.x, this.cart.y,
      ) <= CART_READY_RANGE
      ? this.cartCrates
      : [];
  }

  getCrateActions() {
    if (!this.isReadyForCrateAction()) return null;
    const scene = this.scene;
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

    if (carried.length && carried.every((crate) => crate.kind === "item") && capacity > 0) {
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
    this.cart.setDepth(PEOPLE_DEPTH_BASE + this.cart.y);
    this.cartCrates.forEach((crate, index) =>
      crate.followCarrier(this.cart, index, 21, CRATE_STACK_SPACING));
  }

  update() {
    if (!this.cart?.body || !this.active || this.scene.areas.playerArea !== AREA.BACKROOM) {
      this.moving = false;
      this.cart?.body?.stop();
      return;
    }

    const player = this.scene.player;
    const direction = {
      up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
      left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
    }[player.currentFacing];
    const targetX = player.sprite.x - direction.x * 42;
    const targetY = player.sprite.y - direction.y * 42;
    const distance = Phaser.Math.Distance.Between(this.cart.x, this.cart.y, targetX, targetY);
    const shouldMove = this.moving ? distance > CART_FOLLOW_STOP : distance > CART_FOLLOW_START;
    if (!shouldMove) {
      this.moving = false;
      this.cart.body.stop();
    } else {
      this.moving = true;
      const speed = getHovercartMoveSpeed(this.cartCrates.length);
      const angle = Phaser.Math.Angle.Between(this.cart.x, this.cart.y, targetX, targetY);
      this.cart.body.setVelocity(
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
      );
    }
    this.syncCartCrates();
  }

  clearCrates() {
    for (const crate of this.cartCrates) crate.destroy();
    this.cartCrates = [];
    this.reset();
  }

  reset() {
    this.active = false;
    this.moving = false;
    this.cart?.body?.stop();
    this.cart?.setTexture(HOVERCART_TEXTURES.docked);
    this.cart?.setPosition(this.dock.x, this.dock.y);
    this.syncCartCrates();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unregisterStation?.();
    for (const collider of this.colliders) collider.destroy();
    this.scene.obstacleGroup.remove(this.postBlocker, true, true);
    for (const crate of this.cartCrates) crate.destroy();
    this.cartCrates = [];
    this.charger.destroy();
    this.cart.destroy();
    for (const key of Object.values(HOVERCART_TEXTURES)) {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    }
    if (this.scene.hovercartLab === this) this.scene.hovercartLab = null;
  }
}
