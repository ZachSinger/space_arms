// ==========================================
// FILE: shelfColorLab.js
// ==========================================
// Dev room for trying shelf colors. A gray copy of the Budget Shelf (js/logic/TintableArt.js)
// stands in all four facings next to an untouched original. Pick a color from the header to
// paint every gray shelf, or click one shelf to paint just that one. Opened from the title
// screen's DEV option. Nothing here touches the saved game.
import Phaser from "phaser";
import { installSceneTextSize } from "../logic/GameTextSize.js";
import { TILE_SIZE } from "../logic/RoomLayout.js";
import {
  fixtureBounds, fixtureFootprint, fixtureSolidBounds, getFixtureType,
} from "../logic/FixtureLayout.js";
import { getFixtureTexture } from "../logic/FixtureTexture.js";
import { ensureGrayTexture } from "../logic/TintableArt.js";
import { Player } from "../logic/Player.js";
import { PEOPLE_DEPTH_BASE, fixtureDepth } from "../world/Depth.js";

const HEADER_HEIGHT = 120;
const TEXT_STYLE = { fontFamily: "monospace", fontSize: "14px", color: "#e2e8f0" };
const ROOM = Object.freeze({ columns: 14, rows: 9 });
const SHELF_TYPE = "shelf_budget_2x4";
// Rotation: 0 faces down, 1 left, 2 up, 3 right.
const SHELVES = Object.freeze([
  { label: "FACING DOWN", gx: 1, gy: 2, rotation: 0 },
  { label: "FACING UP", gx: 5, gy: 2, rotation: 2 },
  { label: "ORIGINAL COLORS", gx: 10, gy: 2, rotation: 0, original: true },
  { label: "FACING LEFT", gx: 3, gy: 5, rotation: 1 },
  { label: "FACING RIGHT", gx: 9, gy: 5, rotation: 3 },
]);
// "Purple" is the tint that brings the gray shelf back to roughly its original paint.
const COLORS = Object.freeze([
  { name: "PURPLE", tint: 0xb89ff7 },
  { name: "GRAY", tint: 0xffffff },
  { name: "STEEL", tint: 0x94a3b8 },
  { name: "BLACK", tint: 0x4b5563 },
  { name: "RED", tint: 0xef4444 },
  { name: "ORANGE", tint: 0xf97316 },
  { name: "YELLOW", tint: 0xfacc15 },
  { name: "GREEN", tint: 0x22c55e },
  { name: "TEAL", tint: 0x14b8a6 },
  { name: "BLUE", tint: 0x3b82f6 },
  { name: "PINK", tint: 0xec4899 },
]);
const PLAYER_START = Object.freeze({ x: 7 * TILE_SIZE, y: 4.6 * TILE_SIZE });
const SWATCH = 26;

export class ShelfColorLabScene extends Phaser.Scene {
  constructor() {
    super("scene-shelf-color-lab");
  }

  create() {
    installSceneTextSize(this, Phaser);
    this.carriedCrates = [];
    this.controlMode = { allows: () => true };
    this.color = COLORS[0];

    this.cameras.main.setViewport(0, HEADER_HEIGHT, this.scale.width, this.scale.height - HEADER_HEIGHT)
      .setBackgroundColor("#1e1b4b");
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.roomWidth = ROOM.columns * TILE_SIZE;
    this.roomHeight = ROOM.rows * TILE_SIZE;
    this.physics.world.setBounds(0, 0, this.roomWidth, this.roomHeight);
    this.solids = this.physics.add.staticGroup();

    this.drawFloor();
    this.shelves = SHELVES.map((shelf) => this.placeShelf({ ...shelf, type: SHELF_TYPE }));

    this.player = new Player(this, PLAYER_START.x, PLAYER_START.y);
    this.player.sprite.body.setCollideWorldBounds(true);
    this.addWorld(this.player.sprite);
    this.physics.add.collider(this.player.sprite, this.solids);

    this.addUi(this.add.rectangle(0, 0, this.scale.width, HEADER_HEIGHT, 0x0f172a, 0.92).setOrigin(0));
    this.addUi(this.add.text(16, 6, "SHELF COLOR LAB  WASD: walk.  Esc: menu.", TEXT_STYLE));
    this.addUi(this.add.text(16, 26,
      "Click a color to paint every gray shelf. Click one shelf to paint only that shelf.",
      { ...TEXT_STYLE, color: "#facc15" }));
    this.drawSwatches(16, 50);
    this.colorLabel = this.addUi(this.add.text(16, 86, "", TEXT_STYLE));
    this.addButton(this.scale.width - 90, 86, "[ MENU ]", () => this.scene.start("scene-title"));
    this.paintAll(this.color);

    this.fitRoom();
    this.input.keyboard.on("keydown-ESC", () => this.scene.start("scene-title"));
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once("shutdown", () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
  }

  update(_time, delta) {
    this.player.update(delta);
    this.player.sprite.setDepth(PEOPLE_DEPTH_BASE + this.player.sprite.body.bottom);
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

  // Drawn and made solid the way the shop does it; gray shelves use the tint-ready copy.
  placeShelf(shelf) {
    const spec = getFixtureType(shelf.type);
    const footprint = fixtureFootprint(shelf);
    const bounds = fixtureBounds(shelf);
    const solid = fixtureSolidBounds(shelf);
    const texture = getFixtureTexture(spec, shelf.rotation);
    const image = this.addWorld(this.add.image(
      (shelf.gx + footprint.w / 2) * TILE_SIZE, (shelf.gy + footprint.h / 2) * TILE_SIZE,
      shelf.original ? texture : ensureGrayTexture(this, texture),
    ).setDisplaySize(footprint.w * TILE_SIZE, footprint.h * TILE_SIZE)
      .setDepth(fixtureDepth(bounds.bottom * TILE_SIZE)));
    if (!shelf.original) {
      image.setInteractive({ useHandCursor: true, pixelPerfect: true });
      image.on("pointerdown", () => image.setTint(this.color.tint));
    }
    this.solids.add(this.add.zone(
      (solid.left + solid.right) / 2 * TILE_SIZE, (solid.top + solid.bottom) / 2 * TILE_SIZE,
      (solid.right - solid.left) * TILE_SIZE, (solid.bottom - solid.top) * TILE_SIZE,
    ));
    this.addWorld(this.add.text((shelf.gx + footprint.w / 2) * TILE_SIZE, shelf.gy * TILE_SIZE - 4,
      shelf.label, { ...TEXT_STYLE, fontSize: "11px", color: "#cbd5e1" }).setOrigin(0.5, 1).setDepth(1));
    return { ...shelf, image };
  }

  // --- Colors ---

  drawSwatches(x, y) {
    this.swatchMarker = this.addUi(this.add.rectangle(0, 0, SWATCH + 6, SWATCH + 6)
      .setOrigin(0).setStrokeStyle(2, 0xffffff));
    this.swatches = COLORS.map((color, index) => {
      const swatch = this.addUi(this.add.rectangle(x + index * (SWATCH + 10), y, SWATCH, SWATCH, color.tint)
        .setOrigin(0).setStrokeStyle(1, 0x0f172a).setInteractive({ useHandCursor: true }));
      swatch.on("pointerdown", () => this.paintAll(color));
      return swatch;
    });
  }

  paintAll(color) {
    this.color = color;
    for (const shelf of this.shelves) {
      if (!shelf.original) shelf.image.setTint(color.tint);
    }
    const swatch = this.swatches[COLORS.indexOf(color)];
    this.swatchMarker.setPosition(swatch.x - 3, swatch.y - 3);
    this.colorLabel.setText(`Color: ${color.name}`);
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
