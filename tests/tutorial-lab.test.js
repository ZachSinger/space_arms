import assert from "node:assert/strict";
import { test } from "node:test";
import { tutorialHint } from "../js/debug/TutorialLab.js";
import { setInputDevice } from "../js/input/InputDevice.js";

function scene() {
  const carried = [];
  const floor = [];
  const shelf = { placements: [] };
  const catalog = { licenses: new Set(), owns(id) { return this.licenses.has(id); } };
  return {
    gameState: {
      calendar: { day: 1, awaitingEndDay: false },
      items: [{ license: "rations" }],
      catalog,
    },
    shiftClock: { started: false, softClosed: false },
    shift: { customersServed: 0 },
    customers: [],
    fixtures: { shelves: () => [shelf] },
    shelf,
    crateSystem: { getCarriedCrates: () => carried, getFloorCrates: () => floor },
    carried,
    floor,
    fixturePlacement: { active: false },
    shelfStockingWindow: { uiWindow: { isOpen: false } },
    checkoutSystem: { operatingRegister: false },
    checkoutWindow: {
      uiWindow: { isOpen: false },
      paymentStage: "total",
      bodyElement: { querySelector: () => ({ classList: { contains: () => true } }) },
    },
  };
}

test("first day guidance follows real stocking actions and recovers when a crate is put down", () => {
  const shop = scene();
  const stage = () => tutorialHint(shop, 1).stage;
  assert.equal(stage(), "contract");
  shop.gameState.catalog.licenses.add("rations");
  assert.equal(stage(), "order");
  const crate = { kind: "item", quantity: 5 };
  shop.floor.push(crate);
  assert.equal(stage(), "pickup-stock");
  shop.floor.pop();
  shop.carried.push(crate);
  assert.equal(stage(), "open-shelf");
  shop.shelfStockingWindow.uiWindow.isOpen = true;
  assert.equal(stage(), "stock");
  shop.carried.pop();
  shop.floor.push(crate);
  assert.equal(stage(), "pickup-stock");
  shop.shelf.placements.push({ quantity: 1 });
  assert.equal(stage(), "start-shift");
  shop.floor.pop();
  shop.carried.push(crate);
  assert.equal(stage(), "stock");
  shop.shelfStockingWindow.uiWindow.isOpen = false;
  assert.equal(stage(), "start-shift");
});

test("first day guidance follows checkout, closing and ending the day even without a sale", () => {
  const shop = scene();
  const stage = () => tutorialHint(shop, 1).stage;
  shop.shiftClock.started = true;
  assert.equal(stage(), "contract");
  shop.checkoutSystem.operatingRegister = true;
  assert.equal(stage(), "leave-register");
  shop.checkoutSystem.operatingRegister = false;
  shop.shelf.placements.push({ quantity: 1 });
  assert.equal(stage(), "register");
  shop.checkoutSystem.operatingRegister = true;
  assert.equal(stage(), "customers");
  shop.shelf.placements[0].quantity = 0;
  shop.customers.push({ cart: [{ itemId: "ration" }] });
  assert.equal(stage(), "customers");
  shop.checkoutWindow.uiWindow.isOpen = true;
  assert.equal(stage(), "scan");
  shop.checkoutWindow.bodyElement.querySelector = () => ({ classList: { contains: () => false } });
  assert.equal(stage(), "total");
  for (const [paymentStage, expected] of [["take", "take-payment"], ["change", "change"], ["chit", "chit"]]) {
    shop.checkoutWindow.paymentStage = paymentStage;
    assert.equal(stage(), expected);
  }
  shop.checkoutWindow.uiWindow.isOpen = false;
  shop.shiftClock.softClosed = true;
  assert.equal(stage(), "closing");
  shop.shiftClock.started = false;
  shop.gameState.calendar.awaitingEndDay = true;
  assert.equal(stage(), "end-day");
  shop.gameState.calendar.day = 2;
  assert.equal(stage(), "complete");
});

test("tutorial handles a starting shop without a shelf and uses current controller hints", () => {
  const shop = scene();
  shop.fixtures.shelves = () => [];
  assert.equal(tutorialHint(shop, 1).stage, "buy-shelf");
  shop.floor.push({ kind: "fixture", typeId: "shelf_budget_2x2" });
  assert.equal(tutorialHint(shop, 1).stage, "pickup-shelf");
  shop.carried.push(shop.floor.pop());
  assert.equal(tutorialHint(shop, 1).stage, "unpack-shelf");
  shop.fixturePlacement.active = true;
  setInputDevice("gamepad");
  try {
    assert.match(tutorialHint(shop, 1).text, /right stick/);
  } finally {
    setInputDevice("keyboard");
  }
});
