// ==========================================
// FILE: deliveryCrateLab.js
// ==========================================
// Dev harness for the delivery terminal: watch the loaded platform rise, the crate lid open
// and close, and everything lower again. Opened from the title screen's DEV option.
// Nothing here touches the saved game.
import Phaser from "phaser";
import { installSceneTextSize } from "../logic/GameTextSize.js";
import { TILE_SIZE } from "../logic/RoomLayout.js";
import { Player } from "../logic/Player.js";
import { PEOPLE_DEPTH_BASE } from "../world/Depth.js";

export const DRONE_TERMINAL_SPRITE = Object.freeze({
  key: "fixture_drone_terminal_crate_sheet",
  path: "img/Generated/fixture_drone_terminal_crate_sheet.png",
  frameWidth: 120,
  frameHeight: 81,
});

// Frames 5-7 reveal only the crate; 8-12 reveal its platform. Frames 13-15 open the crate lid.
// The platform starts rising as soon as the doors finish; other holds stay unchanged.
const STAGES = Object.freeze([
  { label: "FLOOR DOORS OPENING", frames: [0, 1, 2, 3, 4], pauseAfter: 0 },
  { label: "PLATFORM RAISING", frames: [5, 6, 7, 8, 9, 10, 11, 12], pauseAfter: 600 },
  { label: "CRATE LID OPENING", frames: [13, 14, 15], pauseAfter: 600 },
  { label: "CRATE LID CLOSING", frames: [14, 13, 12], pauseAfter: 600 },
  { label: "PLATFORM LOWERING", frames: [11, 10, 9, 8, 7, 6, 5, 4], pauseAfter: 600 },
  { label: "FLOOR DOORS CLOSING", frames: [3, 2, 1, 0], pauseAfter: 600 },
]);
const SPEEDS = Object.freeze([
  { label: "SLOW", frameMs: 240 },
  { label: "NORMAL", frameMs: 120 },
  { label: "FAST", frameMs: 60 },
]);
const HEADER_HEIGHT = 244;
const TEXT_STYLE = { fontFamily: "monospace", fontSize: "14px", color: "#e2e8f0" };
const ROOM = Object.freeze({ columns: 8, rows: 5 });

export class DeliveryCrateLabScene extends Phaser.Scene {
  constructor() {
    super("scene-delivery-crate-lab");
    this.speedSettings = STAGES.map(() => 1);
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
      "DELIVERY CRATE LAB  Always looping. Click a speed to change that stage. Esc: menu.", TEXT_STYLE));
    this.status = this.addUi(this.add.text(16, 26, "", { ...TEXT_STYLE, color: "#facc15" }));
    this.addUi(this.add.text(16, 46,
      "Slow: half speed. Normal: original speed. Fast: double speed. Green marks your choice.", TEXT_STYLE));
    this.speedButtons = STAGES.map((stage, stageIndex) => {
      const y = 72 + stageIndex * 24;
      this.addUi(this.add.text(16, y, `${stageIndex + 1}: ${stage.label}`, TEXT_STYLE));
      let x = 260;
      return SPEEDS.map((speed, speedIndex) => {
        const button = this.addButton(x, y, `[ ${speed.label} ]`,
          () => this.setStageSpeed(stageIndex, speedIndex));
        button.setColor(speedIndex === this.speedSettings[stageIndex] ? "#86efac" : "#38bdf8");
        x += button.width + 16;
        return button;
      });
    });
    this.addButton(16, 220, "[ MENU ]", () => this.scene.start("scene-title"));
    this.showStatus();

    this.fitRoom();
    this.input.keyboard.on("keydown-ESC", () => this.scene.start("scene-title"));
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once("shutdown", () => {
      this.playToken += 1;
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
    this.playAll();
  }

  update(_time, delta) {
    this.player.update(delta);
    this.player.sprite.setDepth(PEOPLE_DEPTH_BASE + this.player.sprite.body.bottom);
  }

  // --- Animation ---

  async playAll() {
    const token = ++this.playToken;
    while (token === this.playToken) {
      for (let index = 0; index < STAGES.length; index += 1) {
        if (!await this.runStage(index, token)) return;
        const pause = STAGES[index].pauseAfter;
        if (pause > 0 && !await this.wait(pause, token)) return;
      }
    }
  }

  async runStage(index, token) {
    this.playing = true;
    this.stageIndex = index;
    for (const frame of STAGES[index].frames) {
      if (token !== this.playToken) return false;
      this.terminal.setFrame(frame);
      this.showStatus();
      if (!await this.wait(SPEEDS[this.speedSettings[index]].frameMs, token)) return false;
    }
    return true;
  }

  wait(ms, token) {
    return new Promise((resolve) => {
      this.time.delayedCall(ms, () => resolve(token === this.playToken));
    });
  }

  setStageSpeed(stageIndex, speedIndex) {
    this.speedSettings[stageIndex] = speedIndex;
    this.speedButtons[stageIndex].forEach((button, index) => {
      button.setColor(index === speedIndex ? "#86efac" : "#38bdf8");
    });
    this.showStatus();
  }

  showStatus() {
    const stage = this.playing ? STAGES[this.stageIndex].label : "STARTING";
    const speed = this.playing ? SPEEDS[this.speedSettings[this.stageIndex]].label : "NORMAL";
    this.status.setText(`Now: ${stage}   Speed: ${speed}   Picture ${this.terminal.frame.name + 1} of 16   Loop: ON`);
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
