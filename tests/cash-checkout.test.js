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
  ({ CheckoutWindow } = await server.ssrLoadModule("/js/logic/CheckoutWindow.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

function harness({ cash = true } = {}) {
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
    "#checkout-change-selected", "#checkout-cash-tender", "#checkout-change-pile",
  ]) elements.set(selector, element());
  const button = element();
  button.dataset.cashCents = "1";
  let completed = 0;
  let penalties = 0;
  const checkout = Object.create(CheckoutWindow.prototype);
  Object.assign(checkout, {
    total: 1.23, paymentStage: "total", paymentBuffer: "",
    cashPayment: cash ? new CashPayment(1.23, 5) : null,
    bodyElement: {
      querySelector: (selector) => elements.get(selector),
      querySelectorAll: (selector) => selector === "[data-cash-cents]" ? [button] : [],
    },
    uiWindow: { element: element() },
    onComplete: () => { completed += 1; },
    onWrongChange: () => { penalties += 1; },
  });
  checkout.bindNumpad([]);
  return { checkout, elements, button, completed: () => completed, penalties: () => penalties };
}

test("decimal keypad accepts cents, rejects extra decimals, and opens the drawer after the exact total", () => {
  const h = harness();
  for (const digit of "1.239.") h.checkout.appendDigit(digit);
  assert.equal(h.checkout.paymentBuffer, "1.23");
  h.checkout.confirmPayment();
  assert.equal(h.checkout.paymentStage, "change");
  assert.equal(h.completed(), 0);
  assert.equal(h.elements.get(".checkout-numpad").classList.contains("hidden"), true);
  assert.equal(h.elements.get("#checkout-cash").classList.contains("hidden"), false);
  assert.match(h.elements.get("#checkout-cash-tender").innerHTML, /5 credits/);
});

test("drawer clicks and right-clicks adjust change, and Enter rejects mistakes until exact", () => {
  const h = harness();
  for (const digit of "1.23") h.checkout.appendDigit(digit);
  h.checkout.confirmPayment();
  h.button.listeners.get("click")();
  let prevented = 0;
  h.button.listeners.get("contextmenu")({ preventDefault: () => { prevented += 1; } });
  assert.equal(h.checkout.cashPayment.changeCents, 0);
  const enter = { key: "Enter", preventDefault: () => { prevented += 1; } };
  h.checkout.handleNumpadKeydown(enter);
  assert.equal(h.penalties(), 0);
  assert.match(h.elements.get("#checkout-payment-feedback").textContent, /Another mistake/);
  h.checkout.handleNumpadKeydown(enter);
  assert.equal(h.penalties(), 1);
  assert.equal(h.completed(), 0);
  h.checkout.cashPayment.adjustChange(100, 1);
  h.checkout.cashPayment.adjustChange(100, 1);
  h.checkout.cashPayment.adjustChange(100, 1);
  h.checkout.cashPayment.adjustChange(50, 1);
  h.checkout.cashPayment.adjustChange(25, 1);
  h.checkout.cashPayment.adjustChange(1, 1);
  h.checkout.cashPayment.adjustChange(1, 1);
  h.checkout.handleNumpadKeydown(enter);
  h.checkout.handOverChange();
  assert.equal(h.completed(), 1);
  assert.equal(prevented, 4);
});

test("held Enter and a hidden register cannot hand over change", () => {
  const h = harness();
  h.checkout.paymentStage = "change";
  h.checkout.handleNumpadKeydown({ key: "Enter", repeat: true });
  assert.equal(h.checkout.cashPayment.mistakes, 0);
  h.checkout.uiWindow.element.classList.add("hidden");
  h.checkout.handleNumpadKeydown({ key: "Enter" });
  assert.equal(h.checkout.cashPayment.mistakes, 0);
});

test("cashless checkout still completes after entering the decimal total", () => {
  const h = harness({ cash: false });
  for (const digit of "1.23") h.checkout.appendDigit(digit);
  h.checkout.confirmPayment();
  h.checkout.confirmPayment();
  assert.equal(h.completed(), 1);
});

test("cash checkout labels separate bills in credits from coins in cents", () => {
  const html = CheckoutRenderer.generateHTML([], {}, new CashPayment(1.23, 5));
  assert.match(html, /data-digit="\."/);
  assert.match(html, /BILLS - CREDITS/);
  assert.match(html, /COINS - CENTS \(100 CENTS = 1 CREDIT\)/);
  assert.match(html, /HAND OVER CHANGE \(ENTER\)/);
  assert.match(html, /3\.77 credits/);
  assert.equal((html.match(/data-cash-cents=/g) ?? []).length, 9);
});
