import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { CashPayment } from "../js/logic/CashPayment.js";
import { CheckoutRenderer } from "../js/logic/CheckoutRenderer.js";

let server;
let cacheDirectory;
let CheckoutWindow;
let CASH_PAYMENT_CHANCE;
let customerPaysCash;

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-cash-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "cash-checkout-stubs",
      enforce: "pre",
      resolveId(source) {
        if (source === "../scenes/boot.js") return "\0cash-database";
        if (source === "./Sfx.js") return "\0cash-sfx";
      },
      load(id) {
        if (id === "\0cash-database") return "export const database = {};";
        if (id === "\0cash-sfx") return `
          export function playScanBeep() {}
          export function playKeypadClick() {}
          export function playSaleComplete() {}
          export function playErrorBuzz() {}
        `;
      },
    }],
  });
  ({ CheckoutWindow, CASH_PAYMENT_CHANCE, customerPaysCash } =
    await server.ssrLoadModule("/js/logic/CheckoutWindow.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

function harness({ cash = true, tender = 5 } = {}) {
  const element = () => {
    const classes = new Set();
    return {
      textContent: "", innerHTML: "", dataset: {}, listeners: new Map(),
      classList: {
        add: (name) => classes.add(name), remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      addEventListener(type, listener) { this.listeners.set(type, listener); },
    };
  };
  const elements = new Map();
  for (const selector of [
    "#checkout-payment-display", "#checkout-payment-feedback", "#numpad-clear",
    "#numpad-confirm", ".checkout-numpad", ".checkout-payment-prompt",
    "#checkout-payment", "#checkout-cash", "#cash-hand-over", ".checkout-belt",
    "#checkout-change-selected", "#checkout-change-pile", "#checkout-total-value",
  ]) elements.set(selector, element());
  const button = element();
  button.dataset.cashCents = "1";
  let completed = 0;
  let penalties = 0;
  const checkout = Object.create(CheckoutWindow.prototype);
  Object.assign(checkout, {
    total: 1.23, paymentStage: "total", paymentBuffer: "",
    cashPayment: cash ? new CashPayment(1.23, tender) : null,
    bodyElement: {
      querySelector: (selector) => elements.get(selector),
      querySelectorAll: (selector) => selector === "[data-cash-cents]" ? [button] : [],
    },
    uiWindow: { element: element() },
    onComplete: () => { completed += 1; },
    onWrongChange: () => { penalties += 1; },
  });
  let overlays = 0;
  checkout.renderTenderOverlay = () => { overlays += 1; };
  checkout.bindNumpad([]);
  const takeAll = () => checkout.cashPayment.tenderPieces.forEach((_, index) =>
    checkout.takeTenderPiece(index));
  return { overlays: () => overlays, takeAll, checkout, elements, button, completed: () => completed, penalties: () => penalties };
}

test("cash customers hand over money once scanning ends, with no total to key in", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  for (const digit of "1.23") h.checkout.appendDigit(digit);
  h.checkout.confirmPayment();
  assert.equal(h.checkout.paymentStage, "total");
  assert.equal(h.overlays(), 0);
  const keypadPanel = h.elements.get("#checkout-payment");
  keypadPanel.classList.add("hidden");
  h.checkout.beginPayment();
  assert.equal(keypadPanel.classList.contains("hidden"), true);
  context.mock.timers.tick(1000);
  assert.equal(h.checkout.paymentStage, "take");
  assert.equal(keypadPanel.classList.contains("hidden"), true);
  assert.equal(h.overlays(), 1);
  h.checkout.handleNumpadKeydown({ key: " ", preventDefault() {} });
  assert.equal(h.checkout.cashPayment.mistakes, 0);
  h.takeAll();
  assert.equal(h.checkout.paymentStage, "change");
  assert.equal(h.completed(), 0);
  assert.equal(h.elements.get(".checkout-numpad").classList.contains("hidden"), true);
  assert.equal(keypadPanel.classList.contains("hidden"), false);
  assert.equal(h.elements.get("#checkout-cash").classList.contains("hidden"), false);
  assert.equal(h.elements.get("#checkout-total-value").innerHTML,
    '1.23 - <span class="checkout-paid">5.00</span>');
});

test("exact payment skips counting change once every bill and coin is taken", () => {
  const h = harness({ tender: 1.23 });
  h.checkout.startTakingPayment();
  assert.deepEqual(h.checkout.cashPayment.tenderPieces.map((piece) => piece.cents), [100, 10, 10, 1, 1, 1]);
  h.checkout.takeTenderPiece(0);
  h.checkout.takeTenderPiece(0);
  assert.equal(h.checkout.paymentStage, "take");
  h.takeAll();
  assert.equal(h.checkout.paymentStage, "complete");
  assert.equal(h.completed(), 1);
});

test("drawer clicks and right-clicks adjust change, and Space rejects mistakes until exact", () => {
  const h = harness();
  h.checkout.startTakingPayment();
  h.takeAll();
  h.button.listeners.get("click")();
  let prevented = 0;
  h.button.listeners.get("contextmenu")({ preventDefault: () => { prevented += 1; } });
  assert.equal(h.checkout.cashPayment.changeCents, 0);
  const space = { key: " ", preventDefault: () => { prevented += 1; } };
  assert.equal(h.checkout.usesSpaceKey(), true);
  assert.ok(h.button.listeners.has("mousedown"));
  h.checkout.handleNumpadKeydown(space);
  assert.equal(h.penalties(), 0);
  assert.match(h.elements.get("#checkout-payment-feedback").textContent, /Another mistake/);
  h.checkout.handleNumpadKeydown(space);
  assert.equal(h.penalties(), 1);
  assert.equal(h.completed(), 0);
  h.checkout.cashPayment.adjustChange(100, 1);
  h.checkout.cashPayment.adjustChange(100, 1);
  h.checkout.cashPayment.adjustChange(100, 1);
  h.checkout.cashPayment.adjustChange(50, 1);
  h.checkout.cashPayment.adjustChange(25, 1);
  h.checkout.cashPayment.adjustChange(1, 1);
  h.checkout.cashPayment.adjustChange(1, 1);
  h.checkout.handleNumpadKeydown(space);
  assert.equal(h.completed(), 1);
  h.checkout.handOverChange();
  assert.equal(h.completed(), 1);
  assert.equal(prevented, 4);
});

test("held Space and a hidden register cannot hand over change", () => {
  const h = harness();
  h.checkout.paymentStage = "change";
  h.checkout.handleNumpadKeydown({ key: " ", repeat: true });
  assert.equal(h.checkout.cashPayment.mistakes, 0);
  h.checkout.uiWindow.element.classList.add("hidden");
  h.checkout.handleNumpadKeydown({ key: " " });
  assert.equal(h.checkout.cashPayment.mistakes, 0);
});

test("cashless checkout still completes after entering the decimal total", () => {
  const h = harness({ cash: false });
  assert.equal(h.checkout.cashPayment, null);
  h.elements.get("#checkout-payment").classList.add("hidden");
  h.checkout.beginPayment();
  assert.equal(h.elements.get("#checkout-payment").classList.contains("hidden"), false);
  for (const digit of "1.23") h.checkout.appendDigit(digit);
  h.checkout.confirmPayment();
  h.checkout.confirmPayment();
  assert.equal(h.completed(), 1);
});

test("about half of customers pay cash, with a clear card keypad prompt", () => {
  assert.equal(CASH_PAYMENT_CHANCE, 0.5);
  assert.equal(customerPaysCash(() => 0.49), true);
  assert.equal(customerPaysCash(() => 0.5), false);
  const html = CheckoutRenderer.generateHTML([], {}, null);
  assert.match(html, /CARD PAYMENT - ENTER TOTAL/);
});

test("the change drawer shows bare numbers on bills and coins, with no row headings", () => {
  const html = CheckoutRenderer.generateHTML([], {}, new CashPayment(1.23, 5));
  assert.match(html, /data-digit="\."/);
  assert.doesNotMatch(html, /BILLS - CREDITS|COINS - CENTS|CUSTOMER PAYS|CHANGE SELECTED/);
  assert.match(html, /CURRENT CHANGE/);
  const faces = [...html.matchAll(/class="cash-art"><span>([^<]*)</g)].map((match) => match[1]);
  assert.deepEqual(faces, ["1", "5", "10", "20", "1", "5", "10", "25", "50"]);
  assert.match(html, /HAND OVER CHANGE \(SPACE\)/);
  assert.match(html, /3\.77 credits/);
  assert.equal((html.match(/data-cash-cents=/g) ?? []).length, 9);
});
