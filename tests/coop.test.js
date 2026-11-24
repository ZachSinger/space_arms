import test from "node:test";
import assert from "node:assert/strict";
import { ChunkAssembler, FrameReader, chunkMessage, frameMessage } from "../js/platform/coop.js";
import { MirrorReader, MirrorWriter } from "../js/coop/DisplayMirror.js";
import { CoopHost } from "../js/coop/CoopHost.js";

test("a long Steam message split into pieces comes back whole, including multi-byte text", () => {
  const text = `{"t":"texture","url":"${"é".repeat(40)}${"x".repeat(25)}"}`;
  const packets = chunkMessage(text, 16);
  assert.ok(packets.length > 3);
  const assembler = new ChunkAssembler();
  const results = packets.map((packet) => assembler.push(packet));
  assert.deepEqual(results.slice(0, -1), Array(packets.length - 1).fill(null));
  assert.equal(results.at(-1), text);
  assert.equal(assembler.push(chunkMessage("next")[0]), "next");
});

test("direct-connection messages survive arriving split and glued together", () => {
  const bytes = Buffer.concat([frameMessage("first"), frameMessage(""), frameMessage("third ✓")]);
  const reader = new FrameReader();
  const messages = [];
  for (let i = 0; i < bytes.length; i += 3) messages.push(...reader.push(bytes.subarray(i, i + 3)));
  assert.deepEqual(messages, ["first", "", "third ✓"]);
});

const image = (x, extra = {}) => ({
  type: "Image", x, y: 0, depth: 0, alpha: 1, visible: true, scaleX: 1, scaleY: 1, rotation: 0,
  scrollFactorX: 1, scrollFactorY: 1, blendMode: 0, texture: { key: "crate" }, frame: { name: 0 },
  flipX: false, flipY: false, originX: 0.5, originY: 0.5, tintTopLeft: 0xffffff, tintFill: false,
  isCropped: false, ...extra,
});

test("the mirror sends only what changed, removals, and new draw order", () => {
  const writer = new MirrorWriter();
  const a = image(10);
  const b = image(20);
  const hidden = image(30, { mirrorSkip: true });
  const first = writer.snapshot([a, b, hidden]);
  assert.equal(first.c.length, 2);
  assert.deepEqual(first.o, { 0: [writer.idOf(a), writer.idOf(b)] });

  assert.equal(writer.snapshot([a, b]), null);

  a.x = 15;
  const moved = writer.snapshot([b, a]);
  assert.deepEqual(moved.c, [{ id: writer.idOf(a), x: 15 }]);
  assert.deepEqual(moved.o, { 0: [writer.idOf(b), writer.idOf(a)] });

  const removed = writer.snapshot([a]);
  assert.deepEqual(removed.r, [writer.idOf(b)]);

  writer.reset();
  assert.equal(writer.snapshot([a]).c[0].tex, "crate");
});

test("a partner at a backroom door goes through when the friend presses use", () => {
  const door = { area: "shop", to: "backroom", door: { x: 100, y: 100 }, front: { x: 100, y: 132 } };
  const exit = { area: "backroom", to: "shop", door: { x: 300, y: 600 }, front: { x: 300, y: 632 } };
  door.partner = exit;
  exit.partner = door;
  const shop = { areas: { portals: [door, exit], areaAt: (_x, y) => (y > 500 ? "backroom" : "shop") } };
  const host = new CoopHost(shop);
  const moves = [];
  const partner = {
    sprite: { x: 400, y: 132 },
    teleportTo(x, y) { moves.push([x, y]); this.sprite.x = x; this.sprite.y = y; },
    forceFacing() {},
  };
  host.partner = partner;
  host.handleMessage(JSON.stringify({ t: "use" }));
  assert.deepEqual(moves, [], "too far from the door");
  partner.sprite.x = 104;
  host.handleMessage(JSON.stringify({ t: "use" }));
  assert.deepEqual(moves, [[300, 632]]);
  host.handleMessage(JSON.stringify({ t: "use" }));
  assert.deepEqual(moves, [[300, 632], [100, 132]], "and back out through the exit");
});

test("on a slow connection, mirrored movement keeps gliding between late updates", () => {
  const scene = {
    time: { now: 0 },
    add: { image: () => ({ x: 0, y: 0, setPosition(x, y) { this.x = x; this.y = y; return this; } }) },
    children: { add() {}, remove() {}, list: [] },
  };
  const reader = new MirrorReader(scene, () => {});
  reader.applyChange = function (entry, change, now) {
    Object.getPrototypeOf(this).applyChange.call(this, entry, { type: change.type, x: change.x, y: change.y }, now);
  };
  for (let step = 0; step <= 10; step += 1) {
    scene.time.now = step * 100;
    reader.apply({ c: [{ id: 1, type: "Image", x: step * 10, y: 0 }] });
    reader.update(scene.time.now);
  }
  const object = reader.objectFor(1);
  const before = object.x;
  reader.update(scene.time.now + 80);
  assert.ok(object.x > before && object.x < 100, `still gliding toward the latest spot, at ${object.x}`);
});
