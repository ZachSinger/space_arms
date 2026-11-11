import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { HUDController } from "../js/logic/HUDController.js";

let server;
let cacheDirectory;
let Player;
let PLAYER_SPRITE;
let registerPlayerAnimations;

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-movement-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  ({ Player, PLAYER_SPRITE, registerPlayerAnimations } = await server.ssrLoadModule("/js/logic/Player.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

function createPlayer() {
  const directions = () => Object.fromEntries(
    ["left", "right", "up", "down"].map((direction) => [direction, { isDown: false }]),
  );
  const cursors = directions();
  const wasd = directions();
  const shift = { isDown: false };
  const body = {
    velocity: { x: 0, y: 0 },
    setSize(width, height) { this.size = { width, height }; },
    setOffset(x, y) { this.offset = { x, y }; },
    setVelocity(x, y) { this.velocity = { x, y }; },
    reset(x, y) { sprite.x = x; sprite.y = y; this.setVelocity(0, 0); },
  };
  const sprite = {
    body, scaleX: 1, scaleY: 1,
    anims: {
      isPlaying: false, timeScale: 1, starts: 0,
      stop() { this.isPlaying = false; },
    },
    setDisplaySize(width, height) {
      this.displayWidth = width;
      this.displayHeight = height;
      this.scaleX = width / PLAYER_SPRITE.frameWidth;
      this.scaleY = height / PLAYER_SPRITE.frameHeight;
      return this;
    },
    setOrigin(x, y) { this.originX = x; this.originY = y; return this; },
    setDepth() { return this; },
    setFrame(frame) { this.frame = frame; return this; },
    play(key, ignoreIfPlaying) {
      if (ignoreIfPlaying && this.anims.isPlaying && this.anims.key === key) return this;
      this.anims.key = key;
      this.anims.isPlaying = true;
      this.anims.starts += 1;
      return this;
    },
  };
  const scene = {
    movementAllowed: true,
    add: {
      sprite(x, y, texture, frame) {
        Object.assign(sprite, { x, y, texture, frame });
        return sprite;
      },
    },
    physics: { add: { existing() {} } },
    input: {
      keyboard: {
        enabled: true,
        createCursorKeys: () => cursors,
        addKeys: () => wasd,
        addKey(key) {
          assert.equal(key, "SHIFT");
          return shift;
        },
      },
    },
    controlMode: { allows: () => scene.movementAllowed },
  };
  return { player: new Player(scene, 0, 0), scene, cursors, wasd, shift, body, sprite };
}

test("only the player's lower body collides, so their head can overlap a shelf above them", () => {
  const { body, sprite } = createPlayer();
  assert.equal(body.size.width * sprite.scaleX, 22);
  assert.equal(body.size.height * sprite.scaleY, 20);
  assert.equal(body.offset.x * sprite.scaleX - sprite.displayWidth * sprite.originX, -11);
  assert.equal(body.offset.y * sprite.scaleY - sprite.displayHeight * sprite.originY, 0);
});

test("the mechanic sheet has a looping walk cycle for each direction without duplicate registration", () => {
  const animations = new Map();
  const manager = {
    exists: (key) => animations.has(key),
    create(config) {
      assert.equal(animations.has(config.key), false);
      animations.set(config.key, config);
    },
  };
  registerPlayerAnimations(manager);
  registerPlayerAnimations(manager);
  assert.equal(animations.size, 4);
  for (const [facing, row] of [["down", 0], ["left", 1], ["right", 2], ["up", 3]]) {
    const config = animations.get(`player_walk_${facing}`);
    assert.deepEqual(config.frames, [0, 1, 2, 1].map((column) =>
      ({ key: PLAYER_SPRITE.key, frame: row * 3 + column })));
    assert.equal(config.frameRate, 8);
    assert.equal(config.repeat, -1);
  }
});

test("walking animates all four directions and stops on the matching standing frame", () => {
  const { player, wasd, sprite } = createPlayer();
  assert.equal(sprite.texture, PLAYER_SPRITE.key);
  assert.equal(sprite.frame, 1);
  for (const [facing, idleFrame] of [["down", 1], ["left", 4], ["right", 7], ["up", 10]]) {
    wasd[facing].isDown = true;
    player.update(16);
    assert.equal(sprite.anims.key, `player_walk_${facing}`);
    assert.equal(sprite.anims.isPlaying, true);
    const starts = sprite.anims.starts;
    player.update(16);
    assert.equal(sprite.anims.starts, starts, "holding a direction does not restart the cycle");
    wasd[facing].isDown = false;
    player.update(16);
    assert.equal(sprite.anims.isPlaying, false);
    assert.equal(sprite.frame, idleFrame);
  }
});

test("forcing a facing or teleporting stops the walk cycle immediately", () => {
  const { player, wasd, sprite, body } = createPlayer();
  wasd.left.isDown = true;
  player.update(16);
  player.forceFacing("left");
  assert.equal(sprite.anims.isPlaying, false);
  assert.equal(sprite.frame, 4, "even an unchanged facing returns to standing");
  player.update(16);
  player.teleportTo(100, 200);
  assert.deepEqual(body.velocity, { x: 0, y: 0 });
  assert.equal(sprite.x, 100);
  assert.equal(sprite.y, 200);
  assert.equal(sprite.anims.isPlaying, false);
  assert.equal(sprite.frame, 4);
});

test("Shift increases player speed only while moving and consumes stamina", () => {
  const { player, wasd, shift, body, sprite } = createPlayer();
  assert.equal(player.stamina, 100);
  wasd.right.isDown = true;
  player.update(1000);
  assert.equal(body.velocity.x, 160);
  assert.equal(sprite.anims.timeScale, 1);
  assert.equal(player.stamina, 100);
  shift.isDown = true;
  player.update(1000);
  assert.equal(body.velocity.x, 280);
  assert.equal(sprite.anims.timeScale, 1.75);
  assert.equal(player.stamina, 75);
  wasd.right.isDown = false;
  player.update(1000);
  assert.deepEqual(body.velocity, { x: 0, y: 0 });
  assert.equal(player.stamina, 81.25);
});

test("arrow-key diagonal dashing has the same speed and stamina cost as straight dashing", () => {
  const { player, cursors, shift, body } = createPlayer();
  cursors.up.isDown = true;
  cursors.right.isDown = true;
  shift.isDown = true;
  player.update(1000);
  assert.ok(Math.abs(Math.hypot(body.velocity.x, body.velocity.y) - 280) < 0.000001);
  assert.equal(player.stamina, 75);
});

test("four seconds of dashing empties stamina, then walking recovers without speed jitter", () => {
  const { player, wasd, shift, body } = createPlayer();
  wasd.right.isDown = true;
  shift.isDown = true;
  for (let frame = 0; frame < 40; frame++) player.update(100);
  assert.equal(player.stamina, 0);
  assert.equal(player.exhausted, true);
  player.update(750);
  assert.equal(player.stamina, 0);
  assert.equal(body.velocity.x, 160);
  player.update(500);
  assert.equal(player.stamina, 12.5);
  assert.equal(player.exhausted, true);
  player.update(500);
  assert.equal(player.stamina, 25);
  assert.equal(player.exhausted, false);
  player.update(100);
  assert.equal(body.velocity.x, 280);
  assert.equal(player.stamina, 22.5);
});

test("stamina drain and recovery use elapsed time rather than frame counts", () => {
  const large = createPlayer();
  const small = createPlayer();
  for (const harness of [large, small]) {
    harness.wasd.right.isDown = true;
    harness.shift.isDown = true;
  }
  large.player.update(1000);
  for (let frame = 0; frame < 10; frame++) small.player.update(100);
  assert.equal(large.player.stamina, small.player.stamina);
  large.shift.isDown = false;
  small.shift.isDown = false;
  large.player.update(1000);
  for (let frame = 0; frame < 10; frame++) small.player.update(100);
  assert.equal(large.player.stamina, small.player.stamina);
  large.player.update(10000);
  assert.equal(large.player.stamina, 100);
});

test("register, window, and keyboard input locks prevent both movement and stamina drain", () => {
  for (const lock of [
    ({ player }) => { player.inputEnabled = false; },
    ({ scene }) => { scene.movementAllowed = false; },
    ({ scene }) => { scene.input.keyboard.enabled = false; },
  ]) {
    const harness = createPlayer();
    harness.wasd.right.isDown = true;
    harness.player.update(16);
    assert.equal(harness.sprite.anims.isPlaying, true);
    harness.shift.isDown = true;
    lock(harness);
    harness.player.update(1000);
    assert.deepEqual(harness.body.velocity, { x: 0, y: 0 });
    assert.equal(harness.player.stamina, 100);
    assert.equal(harness.sprite.anims.isPlaying, false);
  }
});

test("the stamina bar displays the current percentage and accessible exhaustion status", () => {
  const hud = Object.create(HUDController.prototype);
  const attributes = new Map();
  const classes = new Set();
  hud.staminaEl = {
    setAttribute: (name, value) => attributes.set(name, value),
    classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) },
  };
  hud.staminaFillEl = { style: {} };
  hud.staminaValueEl = {};
  hud.renderStamina({ stamina: 0, maxStamina: 100, exhausted: true });
  assert.equal(hud.staminaFillEl.style.width, "0%");
  assert.equal(hud.staminaValueEl.textContent, "0%");
  assert.equal(attributes.get("aria-valuenow"), "0");
  assert.match(attributes.get("aria-valuetext"), /Recovering/);
  assert.equal(classes.has("exhausted"), true);
  hud.renderStamina({ stamina: 100, maxStamina: 100, exhausted: false });
  assert.equal(hud.staminaFillEl.style.width, "100%");
  assert.equal(classes.has("exhausted"), false);
});
