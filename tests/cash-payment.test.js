import assert from "node:assert/strict";
import test from "node:test";
import { CashPayment, CASH_DENOMINATIONS, splitCash } from "../js/logic/CashPayment.js";
import { formatMoney, fromCents, isMoney, roundMoney, sumMoney, toCents } from "../js/logic/Money.js";

test("money arithmetic and formatting preserve cents without floating-point drift", () => {
  assert.equal(sumMoney([0.1, 0.2]), 0.3);
  assert.equal(sumMoney(Array(10000).fill(0.01)), 100);
  assert.equal(sumMoney([1500, 1.23, -250, -25]), 1226.23);
  assert.equal(roundMoney(108.90000000000001), 108.9);
  assert.equal(formatMoney(1234.5), "1,234.50 credits");
  assert.equal(formatMoney(1500), "1,500 credits");
  for (const invalid of [NaN, Infinity, 1.001, "1.25", Number.MAX_SAFE_INTEGER]) {
    assert.equal(isMoney(invalid), false);
    assert.throws(() => toCents(invalid), /Money must/);
  }
  assert.equal(fromCents(toCents(12.99)), 12.99);
});

test("the drawer has the requested bills and coins", () => {
  assert.deepEqual(CASH_DENOMINATIONS.filter(({ kind }) => kind === "bill").map(({ cents }) => cents),
    [100, 500, 1000, 2000]);
  assert.deepEqual(CASH_DENOMINATIONS.filter(({ kind }) => kind === "coin").map(({ cents }) => cents),
    [1, 5, 10, 25, 50]);
});

test("every cent amount can be made from drawer denominations", () => {
  for (let cents = 0; cents <= 5000; cents += 1) {
    const pieces = splitCash(cents);
    assert.equal(pieces.reduce((sum, piece) => sum + piece.cents * piece.count, 0), cents);
  }
});

test("customer cash uses bills and covers cent-priced and large purchases", () => {
  for (const total of [0, 1, 1.01, 4.99, 10, 19.99, 20, 20.01, 89.73, 10000.99]) {
    const cash = new CashPayment(total);
    assert.ok(cash.tender >= total);
    assert.ok(cash.changeDueCents < 2000);
    assert.ok(splitCash(cash.tenderCents).every(({ kind }) => kind === "bill"));
  }
  assert.throws(() => new CashPayment(-1), /negative/);
  assert.throws(() => new CashPayment(10, 5), /cover/);
});

test("click adds, right-click removes, and the drawer never runs out", () => {
  const cash = new CashPayment(12.34, 20);
  cash.adjustChange(100, -1);
  assert.equal(cash.changeCents, 0);
  for (let i = 0; i < 100; i += 1) cash.adjustChange(100, 1);
  cash.adjustChange(100, -1);
  assert.equal(cash.change.get(100), 99);
  assert.equal(cash.changeCents, 9900);
  assert.throws(() => cash.adjustChange(2, 1), /Invalid drawer/);
});

test("wrong change is refused, first mistake warns, later mistakes penalize", () => {
  const cash = new CashPayment(12.34, 20);
  assert.deepEqual(cash.handOver(), { accepted: false, penalty: false });
  assert.deepEqual(cash.handOver(), { accepted: false, penalty: true });
  assert.deepEqual(cash.handOver(), { accepted: false, penalty: true });
  for (const { cents, count } of splitCash(cash.changeDueCents)) {
    for (let i = 0; i < count; i += 1) cash.adjustChange(cents, 1);
  }
  assert.equal(cash.changeCents, 766);
  assert.deepEqual(cash.handOver(), { accepted: true, penalty: false });
  assert.deepEqual(cash.handOver(), { accepted: false, penalty: false });
  cash.adjustChange(1, 1);
  assert.equal(cash.changeCents, 766);
  assert.equal(new CashPayment(20, 20).handOver().accepted, true);
});
