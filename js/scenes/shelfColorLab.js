// ==========================================
// FILE: shelfColorLab.js
// ==========================================
// Dev room for trying shelf colors. A gray copy of the Budget Shelf (js/logic/TintableArt.js)
// stands in all four facings next to an untouched original. The panel on the right mixes a
// color from red, green, and blue sliders (the shelf's tint), then adjusts brightness,
// contrast, and saturation on top (a color filter on the shelf picture). It paints every gray
// shelf, or only the one you click. Opened from the title screen's DEV option. Nothing here
// touches the saved game.
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

const HEADER_HEIGHT = 56;
// Matches .shelf-color-panel's width in styles/windows/shelf-color-lab.css.
const PANEL_WIDTH = 320;
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
// Quick starting points for the red, green, and blue sliders. "Purple" brings the gray shelf
// back to roughly its original paint.
const PRESETS = Object.freeze([
  { name: "Purple", tint: 0xb89ff7 },
  { name: "Plain gray", tint: 0xffffff },
  { name: "Steel", tint: 0x94a3b8 },
  { name: "Black", tint: 0x4b5563 },
  { name: "Red", tint: 0xef4444 },
  { name: "Orange", tint: 0xf97316 },
  { name: "Yellow", tint: 0xfacc15 },
  { name: "Green", tint: 0x22c55e },
  { name: "Teal", tint: 0x14b8a6 },
  { name: "Blue", tint: 0x3b82f6 },
  { name: "Pink", tint: 0xec4899 },
]);
// Brightness and saturation are percentages (100 = unchanged); contrast 0 is unchanged.
// Brightness and contrast are capped so no setting turns the shelf's body black.
const SLIDERS = Object.freeze([
  { key: "red", label: "Red", min: 0, max: 255, color: "#ef4444" },
  { key: "green", label: "Green", min: 0, max: 255, color: "#22c55e" },
  { key: "blue", label: "Blue", min: 0, max: 255, color: "#3b82f6" },
  { key: "brightness", label: "Brightness", min: 75, max: 150, unit: "%", filter: true },
  { key: "contrast", label: "Contrast", min: -50, max: 25, filter: true },
  { key: "saturation", label: "Saturation", min: 0, max: 200, unit: "%", filter: true },
]);
const UNCHANGED_FILTER = Object.freeze({ brightness: 100, contrast: 0, saturation: 100 });
const PLAYER_START = Object.freeze({ x: 7 * TILE_SIZE, y: 4.6 * TILE_SIZE });

function presetLook(tint) {
  return { red: (tint >> 16) & 0xff, green: (tint >> 8) & 0xff, blue: tint & 0xff, ...UNCHANGED_FILTER };
}

function lookTint(look) {
  return (look.red << 16) | (look.green << 8) | look.blue;
}

export class ShelfColorLabScene extends Phaser.Scene {
  constructor() {
    super("scene-shelf-color-lab");
  }

  create() {
    installSceneTextSize(this, Phaser);
    this.carriedCrates = [];
    this.controlMode = { allows: () => true };
    this.look = presetLook(PRESETS[0].tint);
    this.paintEvery = true;
    this.selected = null;

    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.cameras.main.setBackgroundColor("#1e1b4b");
    this.roomWidth = ROOM.columns * TILE_SIZE;
    this.roomHeight = ROOM.rows * TILE_SIZE;
    this.physics.world.setBounds(0, 0, this.roomWidth, this.roomHeight);
    this.solids = this.physics.add.staticGroup();

    this.drawFloor();
    this.selectionOutline = this.addWorld(this.add.graphics().setDepth(20000));
    this.shelves = SHELVES.map((shelf) => this.placeShelf({ ...shelf, type: SHELF_TYPE }));

    this.player = new Player(this, PLAYER_START.x, PLAYER_START.y);
    this.player.sprite.body.setCollideWorldBounds(true);
    this.addWorld(this.player.sprite);
    this.physics.add.collider(this.player.sprite, this.solids);

    this.header = this.addUi(this.add.rectangle(0, 0, this.scale.width, HEADER_HEIGHT, 0x0f172a, 0.92).setOrigin(0));
    this.addUi(this.add.text(16, 8, "SHELF COLOR LAB  WASD: walk.  Esc: menu.", TEXT_STYLE));
    this.addUi(this.add.text(16, 30,
      "Use the panel on the right to color the gray shelves. Click a shelf to color only that one.",
      { ...TEXT_STYLE, color: "#facc15" }));

    this.buildPanel();
    for (const shelf of this.shelves) this.applyLook(shelf, this.look);
    this.showLook(this.look);

    this.layoutCameras();
    this.input.keyboard.on("keydown-ESC", () => this.scene.start("scene-title"));
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layoutCameras, this);
    this.events.once("shutdown", () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layoutCameras, this);
      this.panel.remove();
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
    const placed = { ...shelf, image, bounds, look: null };
    if (!shelf.original) {
      // The color filter needs the graphics-card renderer; without it only red/green/blue work.
      placed.filter = image.preFX?.addColorMatrix() ?? null;
      image.setInteractive({ useHandCursor: true, pixelPerfect: true });
      image.on("pointerdown", () => this.selectShelf(placed));
    }
    this.solids.add(this.add.zone(
      (solid.left + solid.right) / 2 * TILE_SIZE, (solid.top + solid.bottom) / 2 * TILE_SIZE,
      (solid.right - solid.left) * TILE_SIZE, (solid.bottom - solid.top) * TILE_SIZE,
    ));
    this.addWorld(this.add.text((shelf.gx + footprint.w / 2) * TILE_SIZE, shelf.gy * TILE_SIZE - 4,
      shelf.label, { ...TEXT_STYLE, fontSize: "11px", color: "#cbd5e1" }).setOrigin(0.5, 1).setDepth(1));
    return placed;
  }

  applyLook(shelf, look) {
    if (shelf.original) return;
    shelf.look = { ...look };
    shelf.image.setTint(lookTint(look));
    if (!shelf.filter) return;
    shelf.filter.reset();
    shelf.filter.saturate((look.saturation - 100) / 100, true);
    // Phaser's own contrast() divides its middle-gray offset by 255, so lowering contrast just
    // darkens; this spreads or squeezes shades around middle gray instead (offsets are 0-255).
    const spread = 1 + look.contrast / 100;
    const offset = 127.5 * (1 - spread);
    shelf.filter.multiply([
      spread, 0, 0, 0, offset,
      0, spread, 0, 0, offset,
      0, 0, spread, 0, offset,
      0, 0, 0, 1, 0,
    ], true);
    shelf.filter.brightness(look.brightness / 100, true);
  }

  // --- Choosing which shelves to paint ---

  selectShelf(shelf) {
    this.paintEvery = false;
    this.selected = shelf;
    this.look = { ...shelf.look };
    this.showLook(this.look);
    this.showMode();
  }

  paintEveryShelf() {
    this.paintEvery = true;
    this.selected = null;
    this.showMode();
  }

  showMode() {
    this.panel.querySelector("[data-mode-every]").classList.toggle("selected", this.paintEvery);
    this.panel.querySelector("[data-mode-one]").classList.toggle("selected", !this.paintEvery);
    this.panel.querySelector("[data-mode-hint]").textContent = this.paintEvery
      ? "Changes color every gray shelf."
      : `Changes color only the ${this.selected.label.toLowerCase()} shelf.`;
    const g = this.selectionOutline.clear();
    if (!this.selected) return;
    const { left, top, right, bottom } = this.selected.bounds;
    g.lineStyle(3, 0x86efac).strokeRect(left * TILE_SIZE - 4, top * TILE_SIZE - 4,
      (right - left) * TILE_SIZE + 8, (bottom - top) * TILE_SIZE + 8);
  }

  setLook(changes) {
    this.look = { ...this.look, ...changes };
    const targets = this.paintEvery ? this.shelves : [this.selected];
    for (const shelf of targets) this.applyLook(shelf, this.look);
    this.showLook(this.look);
  }

  // --- Panel ---

  buildPanel() {
    this.panel = document.createElement("div");
    this.panel.className = "shelf-color-panel";
    const filterNote = this.shelves.some((shelf) => shelf.filter) ? ""
      : "<p>Brightness, contrast, and saturation need graphics-card drawing, which is off.</p>";
    this.panel.innerHTML = `
      <h3>PAINT</h3>
      <div class="shelf-color-modes">
        <button data-mode-every>EVERY SHELF</button>
        <button data-mode-one>CLICKED SHELF</button>
      </div>
      <p data-mode-hint></p>
      <div class="shelf-color-preview" data-preview></div>
      <p data-hex></p>
      <h3>COLOR</h3>
      ${SLIDERS.filter((slider) => !slider.filter).map((slider) => this.sliderHTML(slider)).join("")}
      <h3>ADJUST</h3>
      ${filterNote}
      ${SLIDERS.filter((slider) => slider.filter).map((slider) => this.sliderHTML(slider)).join("")}
      <button class="shelf-color-reset" data-reset-adjust>RESET ADJUSTMENTS</button>
      <h3>STARTING COLORS</h3>
      <p>Sets red, green, and blue. Adjustments stay as they are.</p>
      <div class="shelf-color-swatches">
        ${PRESETS.map((preset, index) => `<button data-preset="${index}" title="${preset.name}"
          style="background:#${preset.tint.toString(16).padStart(6, "0")}"></button>`).join("")}
      </div>
      <button class="shelf-color-reset" data-menu>BACK TO MENU</button>`;
    document.getElementById("ui-layer").appendChild(this.panel);

    for (const slider of SLIDERS) {
      const input = this.panel.querySelector(`[data-slider="${slider.key}"]`);
      input.disabled = Boolean(slider.filter && filterNote);
      input.addEventListener("input", () => this.setLook({ [slider.key]: Number(input.value) }));
    }
    this.panel.querySelector("[data-reset-adjust]").addEventListener("click", () => this.setLook(UNCHANGED_FILTER));
    this.panel.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => {
      const { red, green, blue } = presetLook(PRESETS[Number(button.dataset.preset)].tint);
      this.setLook({ red, green, blue });
    }));
    this.panel.querySelector("[data-mode-every]").addEventListener("click", () => this.paintEveryShelf());
    this.panel.querySelector("[data-mode-one]").addEventListener("click", () => {
      if (!this.selected) this.selectShelf(this.shelves.find((shelf) => !shelf.original));
    });
    this.panel.querySelector("[data-menu]").addEventListener("click", () => this.scene.start("scene-title"));
    this.showMode();
  }

  sliderHTML({ key, label, min, max, color }) {
    return `<label class="shelf-color-slider" style="--slider-color:${color ?? "#38bdf8"}">
      <span>${label}</span>
      <input type="range" min="${min}" max="${max}" step="1" data-slider="${key}">
      <output data-value="${key}"></output>
    </label>`;
  }

  showLook(look) {
    for (const slider of SLIDERS) {
      this.panel.querySelector(`[data-slider="${slider.key}"]`).value = String(look[slider.key]);
      this.panel.querySelector(`[data-value="${slider.key}"]`).textContent = `${look[slider.key]}${slider.unit ?? ""}`;
    }
    const hex = `#${lookTint(look).toString(16).padStart(6, "0").toUpperCase()}`;
    this.panel.querySelector("[data-preview]").style.background = hex;
    this.panel.querySelector("[data-hex]").textContent = `Mixed color: ${hex} (before adjustments)`;
  }

  // --- Cameras ---

  addWorld(object) {
    this.uiCamera.ignore(object);
    return object;
  }

  addUi(object) {
    this.cameras.main.ignore(object);
    return object.setDepth(10);
  }

  layoutCameras() {
    const width = Math.max(1, this.scale.width - PANEL_WIDTH);
    const height = Math.max(1, this.scale.height - HEADER_HEIGHT);
    const camera = this.cameras.main.setViewport(0, HEADER_HEIGHT, width, height);
    this.uiCamera.setSize(this.scale.width, this.scale.height);
    this.header.setSize(width, HEADER_HEIGHT);
    const zoom = Math.min(width / (this.roomWidth + TILE_SIZE), height / (this.roomHeight + TILE_SIZE));
    camera.setZoom(zoom).centerOn(this.roomWidth / 2, this.roomHeight / 2);
  }
}
