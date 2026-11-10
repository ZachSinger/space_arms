import assert from "node:assert/strict";
import test from "node:test";
import { CHIT_DIRECTION_DIGITS, ChitPayment, generateChitCode } from "../js/logic/ChitPayment.js";
import { chooseCustomerPayment, FACTION_CURRENCY_PAYMENT_CHANCE } from "../js/logic/CustomerPayment.js";

test("Explorer Chit codes contain two to four digits from one through four", () => {
  for (const random of [() => 0, () => 0.49, () => 0.99]) {
    const code = generateChitCode(random);
    assert.match(code, /^[1-4]{2,4}$/);
  }
  assert.deepEqual(CHIT_DIRECTION_DIGITS, { up: 1, down: 2, left: 3, right: 4 });
});

test("a wrong Chit key resets progress and the sale completes on the last correct key", () => {
  const payment = new ChitPayment(12.34, "314");
  assert.deepEqual(payment.enterDigit(3), { accepted: true, completed: false, restarted: false });
  assert.equal(payment.progress, 1);
  assert.deepEqual(payment.enterDigit(2), { accepted: false, completed: false, restarted: true });
  assert.equal(payment.progress, 0);
  assert.equal(payment.mistakes, 1);
  payment.enterDigit(3);
  payment.enterDigit(1);
  assert.deepEqual(payment.enterDigit(4), { accepted: true, completed: true, restarted: false });
  assert.equal(payment.completed, true);
  assert.deepEqual(payment.enterDigit(4), { accepted: false, completed: false, restarted: false });
});

test("Chit values and codes reject invalid input", () => {
  assert.throws(() => new ChitPayment(-1, "12"), /Invalid Chit value/);
  for (const code of ["1", "12345", "150", "abcd"]) {
    assert.throws(() => new ChitPayment(1, code), /Invalid Chit code/);
  }
  const payment = new ChitPayment(1, "12");
  for (const digit of [0, 5, 1.5]) assert.throws(() => payment.enterDigit(digit), /Invalid Chit key/);
});

test("only Scavengers roll M-Scrip and only Explorers roll Chits", () => {
  assert.equal(FACTION_CURRENCY_PAYMENT_CHANCE, 0.75);
  assert.deepEqual(chooseCustomerPayment("scavengers", () => 0.1), { type: "m-scrips", exact: true });
  const scavengerFallback = [0.9, 0.1, 0.9];
  assert.deepEqual(chooseCustomerPayment("scavengers", () => scavengerFallback.shift()),
    { type: "cash", exact: false });
  const explorerRandom = [0.1, 0, 0, 0.999];
  assert.deepEqual(chooseCustomerPayment("explorers", () => explorerRandom.shift()),
    { type: "chit", code: "14" });
  const mercenaryRandom = [0.1, 0.9];
  assert.deepEqual(chooseCustomerPayment("mercenaries", () => mercenaryRandom.shift()),
    { type: "cash", exact: false });
});
