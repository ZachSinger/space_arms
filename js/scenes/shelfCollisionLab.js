// ==========================================
// FILE: shelfCollisionLab.js
// ==========================================
// Dev harness for how people meet shelves: which part of a shelf you bump into, and when you
// walk behind it instead. Shelves stand in every facing, plus a back-to-back pair, using the
// shop's own solid areas (fixtureSolidBounds) and draw order (fixtureDepth). A pretend
// customer paces the room so you can watch someone else pass behind the shelves too. Opened
// from the title screen's DEV option. Nothing here touches the saved game.
import Phaser from "phaser";
import { installSceneTextSize } from "../logic/GameTextSize.js";
import { TILE_SIZE } from "../logic/RoomLayout.js";
import {
  fixtureBounds, fixtureFootprint, fixtureSolidBounds, getFixtureType,
} from "../logic/FixtureLayout.js";
import { getFixtureTexture } from "../logic/FixtureTexture.js";
import { Player } from "../logic/Player.js";
import { PEOPLE_DEPTH_BASE, fixtureDepth } from "../world/Depth.js";

const HEADER_HEIGHT = 100;
const TEXT_STYLE = { fontFamily: "monospace", fontSize: "14px", color: "#e2e8f0" };
const ROOM = Object.freeze({ columns: 14, rows: 14 });
// Rotation: 0 faces down, 1 left, 2 up, 3 right. The down/up pair at the right stands back to
// back, the down-facing one in front.
const SHELVES = Object.freeze([
  { label: "FACING DOWN", gx: 1, gy: 2, rotation: 0 },
  { label: "FACING UP", gx: 5, gy: 2, rotation: 2 },
  { label: "BACK TO BACK", gx: 10, gy: 2, rotation: 2 },
  { gx: 10, gy: 2.25, rotation: 0 },
  { label: "FACING LEFT", gx: 3, gy: 5, rotation: 1 },
  { label: "FACING RIGHT", gx: 9, gy: 5, rotation: 3 },
  { label: "TALL FACING DOWN", gx: 1, gy: 8, rotation: 0, levels: 3 },
  { label: "TALL FACING UP", gx: 5, gy: 8, rotation: 2, levels: 3 },
  { label: "TALL BACK TO BACK", gx: 10, gy: 8, rotation: 2, levels: 3 },
  { gx: 10, gy: 8.25, rotation: 0, levels: 3 },
  { label: "TALL FACING LEFT", gx: 3, gy: 11, rotation: 1, levels: 3 },
  { label: "TALL FACING RIGHT", gx: 9, gy: 11, rotation: 3, levels: 3 },
]);
const PLAYER_START = Object.freeze({ x: 7 * TILE_SIZE, y: 4.5 * TILE_SIZE });
// The pretend customer walks these points in a loop: across just behind the top row's feet,
// then along the middle into the right-facing shelf (which stops them, so they move on), just
// behind the tall row's feet, along the bottom wall, and back through the open middle.
const PATROL = Object.freeze([
  { x: 0.5 * TILE_SIZE, y: 2.45 * TILE_SIZE },
  { x: 13.5 * TILE_SIZE, y: 2.45 * TILE_SIZE },
  { x: 13.5 * TILE_SIZE, y: 6 * TILE_SIZE },
  { x: 0.5 * TILE_SIZE, y: 6 * TILE_SIZE },
  { x: 0.5 * TILE_SIZE, y: 8.45 * TILE_SIZE },
  { x: 13.5 * TILE_SIZE, y: 8.45 * TILE_SIZE },
  { x: 13.5 * TILE_SIZE, y: 13.4 * TILE_SIZE },
  { x: 0.5 * TILE_SIZE, y: 13.4 * TILE_SIZE },
  { x: 0.5 * TILE_SIZE, y: 7.4 * TILE_SIZE },
  { x: 11 * TILE_SIZE, y: 4.2 * TILE_SIZE },
  { x: 0.5 * TILE_SIZE, y: 4.2 * TILE_SIZE },
]);
const PATROL_SPEED = 90;
const PATROL_GIVE_UP_MS = 900;
const PRETEND_CUSTOMER_TINT = 0x93c5fd;

export class ShelfCollisionLabScene extends Phaser.Scene {
  constructor() {
    super("scene-shelf-collision-lab");
  }

  create({ sections = 4 } = {}) {
    installSceneTextSize(this, Phaser);
    this.carriedCrates = [];
    this.controlMode = { allows: () => true };
    this.showSolids = true;

    this.cameras.main.setViewport(0, HEADER_HEIGHT, this.scale.width, this.scale.height - HEADER_HEIGHT)
      .setBackgroundColor("#1e1b4b");
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.roomWidth = ROOM.columns * TILE_SIZE;
    this.roomHeight = ROOM.rows * TILE_SIZE;
    this.physics.world.setBounds(0, 0, this.roomWidth, this.roomHeight);
    this.solids = this.physics.add.staticGroup();

    this.drawFloor();
    this.solidOutlines = this.addWorld(this.add.graphics().setDepth(20000));
    this.shelves = SHELVES.map((shelf) =>
      this.placeShelf({ ...shelf, type: `shelf_budget_${shelf.levels ?? 2}x${sections}` }));
    this.drawSolidOutlines();

    this.player = new Player(this, PLAYER_START.x, PLAYER_START.y);
    this.player.sprite.body.setCollideWorldBounds(true);
    this.addWorld(this.player.sprite);
    this.physics.add.collider(this.player.sprite, this.solids);
    this.customer = this.createPretendCustomer();

    this.addUi(this.add.rectangle(0, 0, this.scale.width, HEADER_HEIGHT, 0x0f172a, 0.92).setOrigin(0));
    this.addUi(this.add.text(16, 6, "SHELF COLLISION LAB  WASD: walk.  G: show or hide solid areas.  Esc: menu.", TEXT_STYLE));
    this.addUi(this.add.text(16, 26,
      "Red: the part of a shelf people bump into. Walk above the red strip of an upright shelf to pass behind it.",
      { ...TEXT_STYLE, color: "#facc15" }));
    this.addUi(this.add.text(16, 46,
      "The blue shopper is a pretend customer walking the same rules.", { ...TEXT_STYLE, color: "#86efac" }));
    let x = 16;
    for (const [label, onClick, selected] of [
      ["[ SOLID AREAS ]", () => this.toggleSolids()],
      ["[ CUSTOMER ON/OFF ]", () => this.toggleCustomer()],
      ...[2, 3, 4].map((count) => [
        `[ ${count} COLUMNS ]`, () => this.scene.restart({ sections: count }), sections === count,
      ]),
      ["[ MENU ]", () => this.scene.start("scene-title")],
    ]) {
      const button = this.addButton(x, 72, label, onClick);
      if (selected) button.setColor("#86efac");
      x += button.width + 14;
    }

    this.fitRoom();
    this.input.keyboard.on("keydown-G", () => this.toggleSolids());
    this.input.keyboard.on("keydown-ESC", () => this.scene.start("scene-title"));
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once("shutdown", () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
  }

  update(_time, delta) {
    this.player.update(delta);
    this.updatePretendCustomer(delta);
    for (const sprite of [this.player.sprite, this.customer.sprite]) {
      if (sprite.active) sprite.setDepth(PEOPLE_DEPTH_BASE + sprite.body.bottom);
    }
  }

  // --- Room ---

  drawFloor() {
    const floor = this.add.graphics().setDepth(0);
    floor.fillStyle(0x334155).fillRect(0, 0, this.roomWidth, this.roomHeight);
    floor.lineStyle(1, 0x475569, 0.6);
    for (let column = 1; column < ROOM.columns; column += 1) {
      floor.lineBetween(column * TILE_SIZE, 0, column * TILE_SIZE, this.roomHeight);
    }
    for (let row = 1; row < ROOM.rows; row += 1) {
      floor.lineBetween(0, row * TILE_SIZE, this.roomWidth, row * TILE_SIZE);
    }
    floor.lineStyle(4, 0x0f172a).strokeRect(0, 0, this.roomWidth, this.roomHeight);
    this.addWorld(floor);
  }

  // The shelf picture, drawn like the shop draws it, and a solid block where people bump it.
  placeShelf(shelf) {
    const spec = getFixtureType(shelf.type);
    const footprint = fixtureFootprint(shelf);
    const bounds = fixtureBounds(shelf);
    const solid = fixtureSolidBounds(shelf);
    const image = this.addWorld(this.add.image(
      (shelf.gx + footprint.w / 2) * TILE_SIZE, (shelf.gy + footprint.h / 2) * TILE_SIZE,
      getFixtureTexture(spec, shelf.rotation),
    ).setDisplaySize(footprint.w * TILE_SIZE, footprint.h * TILE_SIZE)
      .setDepth(fixtureDepth(bounds.bottom * TILE_SIZE)));
    const block = this.add.zone(
      (solid.left + solid.right) / 2 * TILE_SIZE, (solid.top + solid.bottom) / 2 * TILE_SIZE,
      (solid.right - solid.left) * TILE_SIZE, (solid.bottom - solid.top) * TILE_SIZE,
    );
    this.solids.add(block);
    if (shelf.label) {
      this.addWorld(this.add.text((shelf.gx + footprint.w / 2) * TILE_SIZE, shelf.gy * TILE_SIZE - 4,
        shelf.label, { ...TEXT_STYLE, fontSize: "11px", color: "#cbd5e1" }).setOrigin(0.5, 1).setDepth(1));
    }
    return { ...shelf, image, bounds, solid };
  }

  // Gray: the shelf's whole body box. Red: the part that's actually solid.
  drawSolidOutlines() {
    const g = this.solidOutlines.clear().setVisible(this.showSolids);
    for (const { bounds, solid } of this.shelves) {
      g.lineStyle(1, 0x94a3b8, 0.8).strokeRect(bounds.left * TILE_SIZE, bounds.top * TILE_SIZE,
        (bounds.right - bounds.left) * TILE_SIZE, (bounds.bottom - bounds.top) * TILE_SIZE);
      g.fillStyle(0xef4444, 0.25).lineStyle(2, 0xef4444, 0.9);
      const rect = [solid.left * TILE_SIZE, solid.top * TILE_SIZE,
        (solid.right - solid.left) * TILE_SIZE, (solid.bottom - solid.top) * TILE_SIZE];
      g.fillRect(...rect).strokeRect(...rect);
    }
  }

  toggleSolids() {
    this.showSolids = !this.showSolids;
    this.drawSolidOutlines();
  }

  // --- Pretend customer ---

  createPretendCustomer() {
    // The sprite's feet sit 16px below its position.
    const walker = new Player(this, PATROL[0].x, PATROL[0].y - 16);
    walker.inputEnabled = false;
    walker.sprite.setTint(PRETEND_CUSTOMER_TINT);
    walker.sprite.body.setCollideWorldBounds(true);
    this.addWorld(walker.sprite);
    this.physics.add.collider(walker.sprite, this.solids);
    return { sprite: walker.sprite, target: 1, stuckMs: 0, on: true };
  }

  toggleCustomer() {
    const customer = this.customer;
    customer.on = !customer.on;
    customer.sprite.setVisible(customer.on);
    customer.sprite.body.enable = customer.on;
  }

  // Walks toward the next point; if a shelf stops them for a moment, they move on.
  updatePretendCustomer(delta) {
    const customer = this.customer;
    if (!customer.on) return;
    const body = customer.sprite.body;
    const feet = { x: body.center.x, y: body.bottom - 4 };
    const target = PATROL[customer.target];
    const dx = target.x - feet.x;
    const dy = target.y - feet.y;
    const distance = Math.hypot(dx, dy);
    const moved = Math.hypot(body.deltaX(), body.deltaY());
    customer.stuckMs = moved < 0.2 ? customer.stuckMs + delta : 0;
    if (distance < 4 || customer.stuckMs > PATROL_GIVE_UP_MS) {
      customer.target = (customer.target + 1) % PATROL.length;
      customer.stuckMs = 0;
      return;
    }
    body.setVelocity(dx / distance * PATROL_SPEED, dy / distance * PATROL_SPEED);
    const facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
    customer.sprite.anims.play(`player_walk_${facing}`, true);
  }

  // --- Cameras and header ---

  addWorld(object) {
    this.uiCamera.ignore(object);
    return object;
  }

  addUi(object) {
    this.cameras.main.ignore(object);
    return object.setDepth(10);
  }

  addButton(x, y, label, onClick) {
    const button = this.add.text(x, y, label, { ...TEXT_STYLE, color: "#38bdf8" })
      .setInteractive({ useHandCursor: true });
    button.on("pointerdown", () => onClick());
    return this.addUi(button);
  }

  fitRoom() {
    const camera = this.cameras.main;
    const zoom = Math.min(camera.width / (this.roomWidth + TILE_SIZE), camera.height / (this.roomHeight + TILE_SIZE));
    camera.setZoom(zoom).centerOn(this.roomWidth / 2, this.roomHeight / 2);
  }

  handleResize(gameSize) {
    this.cameras.main.setViewport(0, HEADER_HEIGHT, gameSize.width, gameSize.height - HEADER_HEIGHT);
    this.uiCamera.setSize(gameSize.width, gameSize.height);
    this.fitRoom();
  }
}
