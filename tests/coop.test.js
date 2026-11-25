import test from "node:test";
import assert from "node:assert/strict";
import { ChunkAssembler, FrameReader, chunkMessage, frameMessage } from "../js/platform/coop.js";
import { MirrorReader, MirrorWriter } from "../js/coop/DisplayMirror.js";
import { CoopHost } from "../js/coop/CoopHost.js";
import { PartnerActions } from "../js/coop/PartnerActions.js";
import { InteractableRegistry } from "../js/interaction/InteractableRegistry.js";

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

test("on an uneven connection, mirrored movement still glides at a steady speed", () => {
  const scene = {
    add: { image: () => ({ x: 0, y: 0, setPosition(x, y) { this.x = x; this.y = y; return this; } }) },
    children: { add() {}, remove() {}, list: [] },
  };
  const reader = new MirrorReader(scene, () => {});
  reader.applyChange = function (entry, change) {
    Object.getPrototypeOf(this).applyChange.call(this, entry, { type: change.type, x: change.x, y: change.y });
  };
  // The host walks 5 pixels every 50 ms, but its updates arrive two at a time every 100 ms.
  const updates = Array.from({ length: 30 }, (_, step) => ({
    arrivesAt: 1000 + Math.ceil(step / 2) * 100,
    snapshot: { ht: step * 50, c: [{ id: 1, type: "Image", x: step * 5, y: 0 }] },
  }));
  const steps = [];
  let lastX = null;
  for (let now = 1000; now <= 2400; now += 16) {
    while (updates.length && updates[0].arrivesAt <= now) reader.apply(updates.shift().snapshot, now);
    reader.update(now);
    const x = reader.objectFor(1)?.x;
    if (now > 1300 && lastX !== null) steps.push(x - lastX);
    lastX = x ?? null;
  }
  assert.ok(steps.length > 50);
  for (const step of steps) assert.ok(step > 1.2 && step < 2, `moved ${step} pixels in one frame`);
});

function partnerShop() {
  const chain = new Proxy({}, { get: (target, key) => (key in target ? target[key] : () => chain) });
  const interactables = new InteractableRegistry();
  const player = { sprite: { x: 0, y: 0 } };
  const shop = {
    player,
    messages: { show() {}, setHint() {} },
    controlMode: { allows: () => true },
    add: { graphics: () => chain },
    cameras: { main: { ignore() {} } },
    interactables,
    interactionSystem: { getInteractionOrigin: () => ({ x: 0, y: 0 }) },
    checkoutSystem: { operatingRegister: true },
    crateSystem: { carriedCrates: ["host crate"], carriedCrate: "host crate", markedStackBase: null, markedFromTop: 0 },
    cleaningSystem: { heldTrash: null, heldMop: false, mopAnimation: null, mopBar: null },
  };
  const said = [];
  const host = { shop, frozen: false, partnerDoor: () => null, send: (message) => said.push(message) };
  const partner = { sprite: { x: 5, y: 5, body: { bottom: 12 } } };
  return { shop, host, partner, said, interactables };
}

test("while the friend acts, the shop's hands are the partner's, and the host's come back after", () => {
  const { shop, host, partner } = partnerShop();
  const actions = new PartnerActions(host, partner);
  const hostPlayer = shop.player;
  actions.withPartner(() => {
    assert.equal(shop.player, partner);
    assert.deepEqual(shop.crateSystem.carriedCrates, []);
    assert.equal(shop.checkoutSystem.operatingRegister, false);
    shop.crateSystem.carriedCrates = ["partner crate"];
    shop.crateSystem.carriedCrate = "partner crate";
    shop.cleaningSystem.heldTrash = { kind: "can" };
  });
  assert.equal(shop.player, hostPlayer);
  assert.deepEqual(shop.crateSystem.carriedCrates, ["host crate"]);
  assert.equal(shop.cleaningSystem.heldTrash, null);
  assert.equal(shop.checkoutSystem.operatingRegister, true);
  assert.equal(actions.carriedCrate, "partner crate");
  assert.deepEqual(actions.savedTrash(), [{ kind: "can", x: 5, y: 12 }]);
  assert.deepEqual(actions.savedCrates((crate) => ({ id: crate })),
    [{ id: "partner crate", onPad: false, x: 5, y: 5, velocityX: 0, velocityY: 0 }]);
});

test("the friend can use a shelf but is told the register is the shop owner's", () => {
  const { host, partner, said, interactables } = partnerShop();
  const used = [];
  const near = { distanceFrom: () => 0, range: 10, actions: ["interact"] };
  interactables.registerProvider("register", () => [{ ...near, id: "register", kind: "register", perform: () => used.push("register") }]);
  const actions = new PartnerActions(host, partner);
  actions.press("interact", true);
  assert.deepEqual(used, []);
  assert.deepEqual(said.map((message) => message.text), ["Only the shop owner can run the register."]);
  interactables.registerProvider("shelf", () => [{ ...near, id: "shelf", kind: "fixture", perform: () => used.push("shelf") }]);
  actions.press("interact", true);
  assert.deepEqual(used, ["shelf"]);
  assert.equal(interactables.allowedKinds, null);
});
