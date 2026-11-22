// ==========================================
// FILE: deliveryCrateLab.js
// ==========================================
// Dev harness for the drone delivery terminal's floor pad: watch the doors open, the platform
// rise and lower, and the doors close. Opened from the title screen's DEV option. Nothing here
// touches the saved game.
import Phaser from "phaser";
import { installSceneTextSize } from "../logic/GameTextSize.js";
import { TILE_SIZE } from "../logic/RoomLayout.js";
import { Player } from "../logic/Player.js";
import { PEOPLE_DEPTH_BASE } from "../world/Depth.js";

export const DRONE_TERMINAL_SPRITE = Object.freeze({
  key: "fixture_drone_terminal_sheet",
  path: "img/Generated/fixture_drone_terminal_sheet.png",
  frameWidth: 120,
  frameHeight: 81,
});

// Sheet frames: 0 closed, 1-4 doors opening, 5-7 platform rising.
// pauseAfter: how long PLAY ALL holds before the next part. The platform starts rising as soon as the doors finish.
const STAGES = Object.freeze([
  { label: "DOORS OPEN", frames: [0, 1, 2, 3, 4], pauseAfter: 0 },
  { label: "PLATFORM RISES", frames: [5, 6, 7], pauseAfter: 600 },
  { label: "PLATFORM LOWERS", frames: [6, 5, 4], pauseAfter: 600 },
  { label: "DOORS CLOSE", frames: [3, 2, 1, 0], pauseAfter: 600 },
]);
const FRAME_MS = 120;
const HEADER_HEIGHT = 100;
const TEXT_STYLE = { fontFamily: "monospace", fontSize: "14px", color: "#e2e8f0" };
const ROOM = Object.freeze({ columns: 8, rows: 5 });

export class DeliveryCrateLabScene extends Phaser.Scene {
  constructor() {
    super("scene-delivery-crate-lab");
  }

  preload() {
    if (!this.textures.exists(DRONE_TERMINAL_SPRITE.key)) {
      this.load.spritesheet(DRONE_TERMINAL_SPRITE.key, DRONE_TERMINAL_SPRITE.path, {
        frameWidth: DRONE_TERMINAL_SPRITE.frameWidth,
        frameHeight: DRONE_TERMINAL_SPRITE.frameHeight,
      });
    }
  }

  create() {
    installSceneTextSize(this, Phaser);
    this.textures.get(DRONE_TERMINAL_SPRITE.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.carriedCrates = [];
    this.controlMode = { allows: () => true };
    this.playing = false;
    this.looping = false;
    this.stageIndex = -1;
    this.playToken = 0;

    this.cameras.main.setViewport(0, HEADER_HEIGHT, this.scale.width, this.scale.height - HEADER_HEIGHT)
      .setBackgroundColor("#1e1b4b");
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.roomWidth = ROOM.columns * TILE_SIZE;
    this.roomHeight = ROOM.rows * TILE_SIZE;
    this.physics.world.setBounds(0, 0, this.roomWidth, this.roomHeight);
    this.drawFloor();

    this.terminal = this.addWorld(this.add.sprite(this.roomWidth / 2, this.roomHeight / 2,
      DRONE_TERMINAL_SPRITE.key, 0));
    this.terminal.setDepth(PEOPLE_DEPTH_BASE + this.terminal.getBounds().bottom);

    this.player = new Player(this, this.terminal.getBounds().left - TILE_SIZE, this.roomHeight / 2);
    this.player.sprite.body.setCollideWorldBounds(true);
    this.addWorld(this.player.sprite);

    this.addUi(this.add.rectangle(0, 0, this.scale.width, HEADER_HEIGHT, 0x0f172a, 0.92).setOrigin(0));
    this.addUi(this.add.text(16, 6,
      "DELIVERY CRATE LAB  Space: play all.  1-4: play one part.  L: loop.  Esc: menu.", TEXT_STYLE));
    this.status = this.addUi(this.add.text(16, 26, "", { ...TEXT_STYLE, color: "#facc15" }));
    let x = 16;
    for (const [label, onClick] of [
      ["[ PLAY ALL ]", () => this.playAll()],
      ...STAGES.map((stage, index) => [`[ ${index + 1}: ${stage.label} ]`, () => this.playStage(index)]),
    ]) {
      x += this.addButton(x, 50, label, onClick).width + 12;
    }
    x = 16;
    for (const [label, onClick] of [
      ["[ LOOP ON/OFF ]", () => this.toggleLoop()],
      ["[ MENU ]", () => this.scene.start("scene-title")],
    ]) {
      x += this.addButton(x, 74, label, onClick).width + 12;
    }
    this.showStatus();

    this.fitRoom();
    this.input.keyboard.on("keydown-SPACE", () => this.playAll());
    this.input.keyboard.on("keydown-L", () => this.toggleLoop());
    STAGES.forEach((_stage, index) => {
      this.input.keyboard.on(`keydown-${["ONE", "TWO", "THREE", "FOUR"][index]}`, () => this.playStage(index));
    });
    this.input.keyboard.on("keydown-ESC", () => this.scene.start("scene-title"));
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once("shutdown", () => {
      this.playToken += 1;
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
  }

  update(_time, delta) {
    this.player.update(delta);
    this.player.sprite.setDepth(PEOPLE_DEPTH_BASE + this.player.sprite.body.bottom);
  }

  // --- Animation ---

  async playAll() {
    const token = ++this.playToken;
    do {
      for (let index = 0; index < STAGES.length; index += 1) {
        if (!await this.runStage(index, token)) return;
        const pause = STAGES[index].pauseAfter;
        if (pause > 0 && !await this.wait(pause, token)) return;
      }
    } while (this.looping && token === this.playToken);
    this.finish(token);
  }

  async playStage(index) {
    const token = ++this.playToken;
    // Each part starts from where the previous part ends.
    this.terminal.setFrame(index === 0 ? 0 : STAGES[index - 1].frames.at(-1));
    if (await this.runStage(index, token)) this.finish(token);
  }

  async runStage(index, token) {
    this.playing = true;
    this.stageIndex = index;
    for (const frame of STAGES[index].frames) {
      if (token !== this.playToken) return false;
      this.terminal.setFrame(frame);
      this.showStatus();
      if (!await this.wait(FRAME_MS, token)) return false;
    }
    return true;
  }

  wait(ms, token) {
    return new Promise((resolve) => {
      this.time.delayedCall(ms, () => resolve(token === this.playToken));
    });
  }

  finish(token) {
    if (token !== this.playToken) return;
    this.playing = false;
    this.showStatus();
  }

  toggleLoop() {
    this.looping = !this.looping;
    this.showStatus();
  }

  showStatus() {
    const stage = this.playing ? STAGES[this.stageIndex].label : "STOPPED";
    this.status.setText(`Now: ${stage}   Picture ${this.terminal.frame.name + 1} of 8   Loop: ${this.looping ? "ON" : "OFF"}`);
  }

  // --- Room, cameras, and header ---

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
