import test from "node:test";
import assert from "node:assert/strict";
import { ChunkAssembler, FrameReader, chunkMessage, frameMessage } from "../js/platform/coop.js";
import { MirrorWriter } from "../js/coop/DisplayMirror.js";

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
