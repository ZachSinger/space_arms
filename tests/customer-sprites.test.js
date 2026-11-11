import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let server;
let cacheDirectory;
let sprites;
const manifest = JSON.parse(await readFile(
  new URL("../data/CustomerCharacterManifest.json", import.meta.url), "utf8",
));

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-customer-sprites-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  globalThis.Phaser = {
    Utils: { Array: { GetRandom: (items) => items[items.length - 1] } },
    Textures: { FilterMode: { NEAREST: "nearest" } },
  };
  sprites = await server.ssrLoadModule("/js/logic/CustomerSprites.js");
});

after(async () => {
  delete globalThis.Phaser;
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

function makeSprite() {
  return {
    frame: null,
    playing: null,
    texture: { key: "customer_mercenary_test" },
    anims: {
      isPlaying: false,
      stop() { this.isPlaying = false; },
    },
    play(key) { this.playing = key; this.anims.isPlaying = true; return this; },
    setFrame(frame) { this.frame = frame; return this; },
  };
}

test("every faction picks only its own characters, and neutral picks keep no faction", () => {
  const mercenary = sprites.pickRandomCustomerCharacter("mercenaries");
  assert.equal(mercenary.factionId, "mercenaries");
  assert.match(mercenary.textureKey, /^customer_mercenary_/);
  assert.equal(sprites.pickRandomCustomerCharacter(null).factionId, null);
  // The stub picks the last roster entry, an android, which belongs to no faction.
  assert.equal(sprites.pickRandomCustomerCharacter().factionId, null);
  assert.throws(() => sprites.pickRandomCustomerCharacter("pirates"), /Unknown customer faction/);
});

test("customer sheets load as 96 px frames with a 4-facing walk cycle each", () => {
  const loaded = [];
  sprites.loadCustomerCharacters({ spritesheet: (key, path, size) => loaded.push({ key, path, size }) });
  assert.equal(loaded.length, manifest.length);
  assert.deepEqual(loaded[0].size, { frameWidth: 96, frameHeight: 96 });

  const created = new Map();
  const filters = [];
  sprites.registerCustomerAnimations(
    { get: () => ({ setFilter: (mode) => filters.push(mode) }) },
    { exists: (key) => created.has(key), create: (config) => created.set(config.key, config) },
  );
  assert.equal(created.size, manifest.length * 4);
  assert.ok(filters.every((mode) => mode === "nearest"));
  const walkLeft = created.get(`${manifest[0].key}_walk_left`);
  assert.deepEqual(walkLeft.frames.map(({ frame }) => frame), [3, 4, 5, 4]);
  assert.equal(walkLeft.repeat, -1);
});

test("characters walk while moving and hold the standing pose when stopped", () => {
  const sprite = makeSprite();
  sprites.showCharacterFacing(sprite, "up", true);
  assert.equal(sprite.playing, "customer_mercenary_test_walk_up");
  sprites.showCharacterFacing(sprite, "right", false);
  assert.equal(sprite.anims.isPlaying, false);
  assert.equal(sprite.frame, 7);
});

test("character collision box stays centered on the sprite position", () => {
  let body;
  const sprite = {
    setDisplaySize() { return this; },
    setOrigin(x, y) { this.origin = { x, y }; return this; },
  };
  const scene = {
    add: { sprite: () => sprite },
    physics: { add: { existing(target) {
      body = {
        setSize(width, height) { this.width = width; this.height = height; },
        setOffset(x, y) { this.offset = { x, y }; },
      };
      target.body = body;
    } } },
  };
  sprites.addCharacterSprite(scene, 0, 0, "customer_test", 46, 48);
  const scale = 64 / 96;
  assert.equal(body.width * scale, 46);
  assert.equal(body.height * scale, 48);
  assert.equal(body.offset.x + body.width / 2, 96 * sprite.origin.x);
  assert.equal(body.offset.y + body.height / 2, 96 * sprite.origin.y);
});
