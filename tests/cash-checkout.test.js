import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { CashPayment, getCashDenominations } from "../js/logic/CashPayment.js";
import { ChitPayment } from "../js/logic/ChitPayment.js";
import { cashFaceValue, CheckoutRenderer } from "../js/logic/CheckoutRenderer.js";

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

function harness({ cash = true, tender = 5, chit = false } = {}) {
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
    "#checkout-chit", "#checkout-chit-progress", "#checkout-chit-feedback",
  ]) elements.set(selector, element());
  const button = element();
  button.dataset.cashUnits = "1";
  const chitButtons = [1, 2, 3, 4].map((digit) => {
    const chitButton = element();
    chitButton.dataset.chitDigit = String(digit);
    return chitButton;
  });
  let completed = 0;
  let penalties = 0;
  const checkout = Object.create(CheckoutWindow.prototype);
  Object.assign(checkout, {
    total: 1.23, paymentStage: "total", paymentBuffer: "",
    cashPayment: cash ? new CashPayment(1.23, tender) : null,
    chitPayment: chit ? new ChitPayment(1.23, "314") : null,
    bodyElement: {
      querySelector: (selector) => elements.get(selector),
      querySelectorAll: (selector) => selector === "[data-cash-units]"
        ? [button]
        : selector === "[data-chit-digit]" ? chitButtons : [],
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
  return {
    overlays: () => overlays, takeAll, checkout, elements, button, chitButtons,
    completed: () => completed, penalties: () => penalties,
  };
}

test("closing a belt gap pins unscanned items before continuing at normal speed", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const scanned = {
    dataset: { scanned: "true" },
    style: { transition: "left 220ms ease-in", left: "367px" },
  };
  const waiting = [156, 76].map((currentX, index) => ({
    dataset: { scanned: "false" },
    offsetLeft: currentX,
    style: { transition: "left 1s linear", left: `${236 - index * 80}px` },
  }));
  let committedPositions;
  const classes = new Set(["rolling"]);
  const belt = {
    querySelectorAll(selector) {
      assert.equal(selector, '.checkout-item-card[data-scanned="false"]');
      return [scanned, ...waiting].filter((card) => card.dataset.scanned === "false");
    },
    get offsetWidth() {
      committedPositions = waiting.map(({ style }) => ({ ...style }));
      return 500;
    },
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      remove(name) { classes.delete(name); },
    },
  };
  const checkout = Object.create(CheckoutWindow.prototype);
  checkout.bodyElement = {
    querySelector: (selector) => selector === "#checkout-belt" ? belt : { offsetLeft: 400 },
  };

  checkout.advanceBelt();

  assert.deepEqual(committedPositions, [
    { transition: "none", left: "156px" },
    { transition: "none", left: "76px" },
  ]);
  assert.deepEqual(waiting.map(({ style }) => style.left), ["316px", "236px"]);
  for (const card of waiting) {
    const seconds = Number(card.style.transition.match(/^left ([\d.]+)s linear/)[1]);
    assert.equal((parseFloat(card.style.left) - card.offsetLeft) / seconds, 260);
  }
  assert.deepEqual(scanned.style, { transition: "left 220ms ease-in", left: "367px" });
  assert.equal(classes.has("rolling"), true);
  context.mock.timers.tick(1000);
  assert.equal(classes.has("rolling"), false);
});

test("scanning requires a click or actual mouse movement while holding the button", () => {
  const h = harness({ cash: false });
  const cards = [0, 1, 2].map((index) => ({
    dataset: { index: String(index), scanned: "false" },
    listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener); },
  }));
  const originalQuery = h.checkout.bodyElement.querySelector;
  h.checkout.bodyElement.querySelector = (selector) => selector === "#checkout-belt"
    ? { querySelectorAll: () => cards }
    : originalQuery(selector);
  const scanned = [];
  let payments = 0;
  h.checkout.slideOverScanner = (card) => scanned.push(card);
  h.checkout.advanceBelt = () => {};
  h.checkout.beginPayment = () => { payments += 1; };
  h.checkout.bindEvents([1, 2, 3].map((price) => ({ itemId: "item", price })));

  cards[0].listeners.get("mousedown")();
  assert.deepEqual(cards.map(({ dataset }) => dataset.scanned), ["true", "false", "false"]);
  assert.equal(payments, 0);
  assert.equal(cards[1].listeners.has("mouseenter"), false);
  const at = (x) => ({ clientX: x, clientY: 10, isTrusted: true });
  cards[1].listeners.get("mousemove")(at(5));
  assert.equal(cards[1].dataset.scanned, "false");
  // Holding still while the next item rolls under the cursor must not scan it.
  h.checkout.isScanning = true;
  h.checkout.lastPointer = { x: 20, y: 10 };
  cards[1].listeners.get("mousemove")(at(20));
  assert.equal(cards[1].dataset.scanned, "false");
  // The controller cursor's fake hover on the next card must not scan it either.
  cards[1].listeners.get("mousemove")({ clientX: 99, clientY: 10, isTrusted: false });
  assert.equal(cards[1].dataset.scanned, "false");
  cards[1].listeners.get("mousemove")(at(24));
  assert.equal(cards[1].dataset.scanned, "true");
  cards[1].listeners.get("mousemove")(at(28));
  h.checkout.isScanning = false;
  cards[2].listeners.get("mousemove")(at(40));
  assert.equal(cards[2].dataset.scanned, "false");
  cards[2].listeners.get("mousedown")();
  assert.deepEqual(scanned, cards);
  assert.equal(payments, 1);
  assert.equal(h.elements.get("#checkout-total-value").textContent, "6 credits");
});

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
    '1.23 credits - <span class="checkout-paid">5 credits</span>');
});

test("the held scan gesture is released before customer cash can be swept up", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  h.checkout.isScanning = true;
  h.checkout.beginPayment();
  assert.equal(h.checkout.paymentStage, "total");
  context.mock.timers.tick(1000);
  assert.equal(h.checkout.paymentStage, "take");
  assert.equal(h.checkout.isScanning, false);
  assert.ok(h.checkout.cashPayment.tenderPieces.every(({ taken }) => !taken));
});

test("exact payment skips counting change once every bill and coin is taken", () => {
  const h = harness({ tender: 1.23 });
  h.checkout.startTakingPayment();
  assert.deepEqual(h.checkout.cashPayment.tenderPieces.map((piece) => piece.units), [100, 10, 10, 1, 1, 1]);
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
  assert.equal(h.checkout.cashPayment.changeUnits, 0);
  const space = { key: " ", preventDefault: () => { prevented += 1; } };
  assert.equal(h.checkout.usesSpaceKey(), true);
  assert.ok(h.button.listeners.has("mousedown"));
  h.checkout.handleNumpadKeydown(space);
  assert.equal(h.penalties(), 0);
  assert.match(h.elements.get("#checkout-payment-feedback").textContent, /Another mistake/);
  assert.match(h.elements.get("#checkout-payment-feedback").textContent, /end of the shift/);
  h.checkout.handleNumpadKeydown(space);
  assert.equal(h.penalties(), 1);
  assert.match(h.elements.get("#checkout-payment-feedback").textContent, /Lose 1 store reputation at the end of the shift/);
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

test("Explorer Chit keyboard input resets mistakes and completes on the last right key", () => {
  const h = harness({ cash: false, chit: true });
  h.checkout.startChitPayment();
  let prevented = 0;
  const press = (key) => h.checkout.handleNumpadKeydown({
    key, preventDefault: () => { prevented += 1; },
  });
  press("ArrowDown");
  assert.equal(h.checkout.chitPayment.progress, 0);
  assert.match(h.elements.get("#checkout-chit-feedback").textContent, /WRONG KEY. START OVER/);
  press("ArrowLeft");
  press("ArrowUp");
  assert.equal(h.checkout.chitPayment.progress, 2);
  press("ArrowRight");
  assert.equal(h.checkout.paymentStage, "complete");
  assert.equal(h.completed(), 1);
  assert.equal(prevented, 4);
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
  assert.match(html, /HAND OVER CHANGE<span class="kbd-only"> \(SPACE\)<\/span>/);
  assert.match(html, /3\.77 credits/);
  assert.equal((html.match(/data-cash-units=/g) ?? []).length, 9);
});

test("every cash bill and coin face shows only its numeric amount", () => {
  for (const currency of ["credits", "m-scrips"]) {
    for (const denomination of getCashDenominations(currency)) {
      assert.match(
        cashFaceValue(denomination, currency),
        /^\d+(,\d{3})*(\.\d+)?$/,
        `${currency} ${denomination.kind} face should contain only its amount`,
      );
    }
  }
});

test("Scavenger cash shows only M-Scrip bills and prices the sale in M-Scrips", () => {
  const payment = new CashPayment(12.34, 1500, "m-scrips");
  const html = CheckoutRenderer.generateHTML([], {}, payment);
  assert.match(html, /id="checkout-total-value">0 M-Scrips/);
  assert.match(html, /CHANGE OWED<\/span><strong>19 M-Scrips/);
  assert.match(html, /id="checkout-change-selected">0 M-Scrips/);
  assert.doesNotMatch(html, /cash-coins|cash-coin|cent/);
  const faces = [...html.matchAll(/class="cash-art"><span>([^<]*)</g)].map((match) => match[1]);
  assert.deepEqual(faces, ["1", "5", "10", "25", "50", "100", "500", "1,000"]);
  assert.equal((html.match(/data-cash-units=/g) ?? []).length, 8);
});

test("Explorer Chit display shows its art, value, visible code, and four direction keys", async () => {
  const html = CheckoutRenderer.generateHTML([], {}, null, new ChitPayment(100, "314"));
  const css = await readFile(new URL("../styles/space_dealer_window.css", import.meta.url), "utf8");
  assert.match(css, /\.chit-card\s*\{[^}]*background-image:\s*url\("\.\.\/img\/Generated\/explorer_travel_chit\.png"\)/s);
  assert.match(css, /\.chit-card\s*\{[^}]*min-height:\s*calc\(240px \* var\(--text-scale\)\)/s);
  assert.match(html, /class="chit-screen"/);
  assert.match(html, /EXPLORER TRAVEL CHIT/);
  assert.match(html, /VALUE: <strong>100 credits/);
  assert.match(html, /ACCESS CODE: <strong class="chit-code">3 1 4/);
  assert.match(html, /data-chit-digit="1" aria-label="Up, key 1"/);
  assert.match(html, /data-chit-digit="4" aria-label="Right, key 4"/);
  assert.doesNotMatch(html, /data-cash-units|cash-checkout/);
});

test("change counted appears first on the left, and the bills use a narrow upright layout", async () => {
  const html = CheckoutRenderer.generateHTML([], {}, new CashPayment(1.23, 5));
  assert.ok(html.indexOf("CURRENT CHANGE") < html.indexOf("CHANGE OWED"));
  const css = await readFile(new URL("../styles/space_dealer_window.css", import.meta.url), "utf8");
  assert.match(css, /\.cash-summary\s*\{[^}]*justify-content:\s*flex-start/s);
  assert.match(css, /\.cash-bills\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*60px\)/s);
  assert.match(css, /\.cash-bill \.cash-art\s*\{[^}]*width:\s*46px;[^}]*height:\s*84px/s);
  assert.match(css, /\.cash-loose\.cash-bill\s*\{[^}]*width:\s*52px;[^}]*height:\s*96px/s);
  assert.match(css, /background-image:\s*url\("\.\.\/img\/Generated\/currency_bill\.png"\)/);
  assert.match(css, /background-image:\s*url\("\.\.\/img\/Generated\/currency_coin\.png"\)/);
});
