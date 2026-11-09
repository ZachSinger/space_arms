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
  ({ Player } = await server.ssrLoadModule("/js/logic/Player.js"));
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
  };
  const sprite = {
    body, scaleX: 1, scaleY: 1,
    setDisplaySize() { return this; },
    setTint() { return this; },
    setDepth() { return this; },
    setTexture() { return this; },
  };
  const scene = {
    movementAllowed: true,
    add: { image: () => sprite },
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
  return { player: new Player(scene, 0, 0), scene, cursors, wasd, shift, body };
}

test("only the player's lower body collides, so their head can overlap a shelf above them", () => {
  const { body } = createPlayer();
  assert.deepEqual(body.size, { width: 22, height: 20 });
  assert.deepEqual(body.offset, { x: 12, y: 24 }, "centered, ending just above the sprite bottom");
});

test("Shift increases player speed only while moving and consumes stamina", () => {
  const { player, wasd, shift, body } = createPlayer();
  assert.equal(player.stamina, 100);
  wasd.right.isDown = true;
  player.update(1000);
  assert.equal(body.velocity.x, 160);
  assert.equal(player.stamina, 100);
  shift.isDown = true;
  player.update(1000);
  assert.equal(body.velocity.x, 280);
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
    harness.shift.isDown = true;
    lock(harness);
    harness.player.update(1000);
    assert.deepEqual(harness.body.velocity, { x: 0, y: 0 });
    assert.equal(harness.player.stamina, 100);
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
