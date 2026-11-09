import assert from "node:assert/strict";
import test from "node:test";
import { EquipmentRenderer } from "../js/logic/EquipmentRenderer.js";
import { getNextHovercartUpgrade, isValidHovercartCapacity } from "../js/logic/Hovercart.js";

const state = (capacity, credits, shopLevel = 30) => ({
  credits,
  shopLevel,
  hovercart: { capacity, usedCapacity: () => 4 },
});

test("equipment tab says which Shop Level unlocks the next hovercart upgrade", () => {
  const html = EquipmentRenderer.generateHTML(state(15, 5000, 2));
  assert.match(html, /Reach Shop Level 3 to buy this upgrade/);
  assert.match(html, /data-upgrade-hovercart\s+disabled/);
});

test("equipment tab shows current capacity, the next capacity, and its cost", () => {
  const html = EquipmentRenderer.generateHTML(state(15, 200));
  assert.match(html, /Current capacity: 15 spaces/);
  assert.match(html, /Currently carrying: 4 of 15 spaces/);
  assert.match(html, /Next upgrade: 20 spaces for 200 credits/);
  assert.match(html, /data-upgrade-hovercart/);
  assert.doesNotMatch(html, /disabled/);
});

test("equipment tab explains an unaffordable upgrade and stops at maximum capacity", () => {
  const poor = EquipmentRenderer.generateHTML(state(15, 199));
  assert.match(poor, /Not enough credits/);
  assert.match(poor, /data-upgrade-hovercart\s+disabled/);
  const maxed = EquipmentRenderer.generateHTML(state(40, 5000));
  assert.match(maxed, /maximum capacity/);
  assert.doesNotMatch(maxed, /data-upgrade-hovercart/);
  assert.equal(getNextHovercartUpgrade(40), null);
  assert.equal(isValidHovercartCapacity(45), false);
  assert.throws(() => getNextHovercartUpgrade(45), /Invalid current hovercart capacity/);
});
