import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let server;
let cacheDirectory;
let Customer;
let PATIENCE_MS;
let getPatienceLevel;
let PlayerState;

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-patience-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "patience-test-stubs",
      enforce: "pre",
      resolveId(source) {
        if (source === "../scenes/boot.js") return "\0patience-test-database";
        if (source === "./CustomerSprites.js") return "\0patience-test-sprites";
      },
      load(id) {
        if (id === "\0patience-test-database") {
          return `export const database = { getItem: (id) => ({ id, slots: id === "big" ? 4 : 1 }) };`;
        }
        if (id === "\0patience-test-sprites") return "export const pickRandomCustomerCharacter = () => ({});";
      },
    }],
  });
  ({ Customer, PATIENCE_MS, getPatienceLevel } = await server.ssrLoadModule("/js/logic/Customer.js"));
  ({ PlayerState } = await server.ssrLoadModule("/js/logic/PlayerState.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

function queuedCustomer({ serving = () => false } = {}) {
  const bubble = { list: [{ setFillStyle() {} }, { setText() {} }], setPosition() {}, destroyed: false };
  bubble.destroy = () => { bubble.destroyed = true; };
  const customer = Object.create(Customer.prototype);
  const angry = [];
  const floating = [];
  customer.sprite = { x: 100, y: 100 };
  customer.state = "QUEUEING";
  customer.cart = [{ itemId: "amo_01", price: 5 }, { itemId: "big", price: 50 }];
  customer.factionId = "mercenaries";
  customer.playerState = new PlayerState();
  customer.patienceBubble = bubble;
  customer.patienceLevel = -1;
  customer.scene = {
    isServingCustomer: serving,
    showFloatingText: (...args) => floating.push(args),
  };
  customer.followPath = () => {};
  customer.updateFacing = () => {};
  customer.onLeaveAngry = (who, cart) => angry.push({ who, cart });
  customer.enterLeaving = () => { customer.state = "LEAVING"; };
  customer.resetPatience();
  return { customer, angry, floating, bubble };
}

test("patience bubbles escalate from calm to urgent", () => {
  assert.equal(getPatienceLevel(1), 0);
  assert.equal(getPatienceLevel(0.5), 1);
  assert.equal(getPatienceLevel(0.1), 2);
  assert.equal(getPatienceLevel(0), 2);
});

test("queued customers drain patience, hold while served, and leave angry at zero", () => {
  let serving = true;
  const { customer, angry, floating, bubble } = queuedCustomer({ serving: () => serving });
  customer.update(PATIENCE_MS);
  assert.equal(customer.patienceRemainingMs, PATIENCE_MS);

  serving = false;
  customer.update(PATIENCE_MS - 1);
  assert.equal(customer.state, "QUEUEING");
  assert.equal(customer.patienceLevel, 2);
  customer.resetPatience(); // a sale at the register resets the next in line
  customer.update(PATIENCE_MS - 1);
  assert.equal(customer.state, "QUEUEING");
  customer.update(1);

  assert.equal(customer.state, "LEAVING");
  assert.equal(angry.length, 1);
  assert.deepEqual(angry[0].cart.map((entry) => entry.itemId), ["amo_01", "big"]);
  assert.deepEqual(customer.cart, []);
  assert.equal(customer.playerState.globalReputation, 1);
  assert.equal(customer.playerState.factionReputation.mercenaries, -1);
  assert.match(floating[0][2], /Left angry!/);
  assert.equal(bubble.destroyed, true);
});

test("the Go-Backs bin only empties into the hovercart, within its capacity", () => {
  const state = new PlayerState();
  state.addToGoBacks([{ itemId: "big" }, { itemId: "big" }, { itemId: "big" }, { itemId: "amo_01" }]);
  assert.equal(state.goBacks.findStockEntry("big").quantity, 3);

  assert.equal(state.loadGoBacksItem("big"), true);
  assert.equal(state.loadGoBacksItem("big"), true);
  assert.equal(state.loadGoBacksItem("big"), false); // 8 of 10 slots used
  assert.equal(state.goBacks.findStockEntry("big").quantity, 1);
  assert.equal(state.loadGoBacksItem("amo_01"), true);
  assert.equal(state.goBacks.findStockEntry("amo_01"), null);
  assert.equal(state.loadGoBacksItem("amo_01"), false);
  assert.equal(state.hovercart.findStockEntry("big").quantity, 2);

  const restored = new PlayerState();
  restored.applySave(JSON.parse(JSON.stringify(state.serialize())));
  assert.deepEqual(restored.goBacks.stock, [{ itemId: "big", quantity: 1 }]);
  assert.equal(restored.goBacks.capacity, Infinity);

  const legacy = state.serialize();
  delete legacy.goBacks;
  restored.applySave(legacy);
  assert.deepEqual(restored.goBacks.stock, []);
});

test("completing a faction sale adds both store and faction reputation", () => {
  const { customer } = queuedCustomer();
  const storeBefore = customer.playerState.globalReputation;
  const factionBefore = customer.playerState.factionReputation.mercenaries;
  customer.completeSale();
  assert.equal(customer.playerState.globalReputation, storeBefore + 1);
  assert.equal(customer.playerState.factionReputation.mercenaries, factionBefore + 1);
  assert.equal(customer.playerState.credits >= 55, true);
});
