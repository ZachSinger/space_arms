import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { ChunkAssembler, FrameReader, chunkMessage, frameMessage } from "../js/platform/coop.js";
import { MirrorWriter } from "../js/coop/DisplayMirror.js";
import { CoopHost } from "../js/coop/CoopHost.js";
import { PartnerActions } from "../js/coop/PartnerActions.js";
import { InteractableRegistry } from "../js/interaction/InteractableRegistry.js";

let server;
let cacheDirectory;
let CheckoutSystem;

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-coop-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "coop-test-stubs",
      enforce: "pre",
      resolveId(source) {
        if (source === "../scenes/boot.js") return "\0coop-test-database";
      },
      load(id) {
        if (id === "\0coop-test-database") return "export const database = { getItem: (id) => ({ id }) };";
      },
    }],
  });
  ({ CheckoutSystem } = await server.ssrLoadModule("/js/systems/CheckoutSystem.js"));
});

after(async () => {
  await server?.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

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

test("the friend can use a shelf but is told the drone terminal is the shop owner's", () => {
  const { host, partner, said, interactables } = partnerShop();
  const used = [];
  const near = { distanceFrom: () => 0, range: 10, actions: ["interact"] };
  interactables.registerProvider("drone", () => [{ ...near, id: "drone", kind: "drone-terminal", perform: () => used.push("drone") }]);
  const actions = new PartnerActions(host, partner);
  actions.press("interact", true);
  assert.deepEqual(used, []);
  assert.deepEqual(said.map((message) => message.text), ["Only the shop owner can check remote orders."]);
  interactables.registerProvider("shelf", () => [{ ...near, id: "shelf", kind: "fixture", perform: () => used.push("shelf") }]);
  actions.press("interact", true);
  assert.deepEqual(used, ["shelf"]);
  assert.equal(interactables.allowedKinds, null);
});

test("the friend rings up their own register's line, and the host settles each sale", () => {
  const { shop, host, partner, said } = partnerShop();
  const registry = shop.interactables;
  shop.interactables = null;
  const register = { id: "register-2", queuePoints: [{ x: 0, y: 0 }, { x: 0, y: 10 }] };
  Object.assign(shop, {
    fixtures: { registers: () => [register], get: () => register, register: () => register },
    eventBus: { emit() {} },
    employees: [],
    checkoutWindow: { name: "host register screen" },
  });
  shop.checkoutSystem = new CheckoutSystem(shop);
  shop.interactables = registry;
  const sold = [];
  const customer = (itemId) => ({
    cart: [{ itemId, price: 5 }],
    checkoutPayment: { type: "card" },
    setQueuePosition() {},
    setQueueTarget() {},
    completeSale() { sold.push(itemId); return 5; },
  });
  const actions = new PartnerActions(host, partner);
  actions.registerSeat = { ...actions.registerSeat, operatingRegister: true, operatingRegisterFixture: register };

  shop.checkoutSystem.handleJoinQueue(customer("blaster"));
  shop.checkoutSystem.handleJoinQueue(customer("shield"));
  const opened = () => said.filter((message) => message.open).map((message) => message.open.cart[0].itemId);
  assert.deepEqual(opened(), ["blaster"], "only the front customer's cart goes to the friend's register");
  assert.equal(shop.checkoutSystem.isOperated(register), true, "employees and shoppers count it as staffed");
  assert.equal(shop.checkoutSystem.isPlayerOperating(register), false);
  assert.deepEqual(shop.checkoutSystem.registerActions(register).map((action) => action.hint),
    ["Your friend is working this register"], "the host can't take the friend's register");

  actions.handleRegisterMessage({ t: "regDone", sale: 1 });
  actions.handleRegisterMessage({ t: "regDone", sale: 1 });
  assert.deepEqual(sold, ["blaster"], "a repeated report can't sell twice");
  assert.deepEqual(opened(), ["blaster", "shield"], "the next customer steps up");
  assert.deepEqual(shop.checkoutWindow, { name: "host register screen" });
});
