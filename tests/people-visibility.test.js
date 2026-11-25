import test from "node:test";
import assert from "node:assert/strict";
import { isOccludedByShelf } from "../js/world/PeopleVisibility.js";

const sprite = (depth, bounds) => ({
  active: true,
  depth,
  getBounds: () => bounds,
});
const shelf = (depth, bounds) => ({ type: "shelf_budget_2x4", rotation: 0, sprite: sprite(depth, bounds) });

test("people are outlined only when a shelf overlaps them and draws in front", () => {
  const person = sprite(100, { left: 20, right: 40, top: 20, bottom: 60 });
  assert.equal(isOccludedByShelf(person, [shelf(101, { left: 30, right: 50, top: 40, bottom: 80 })]), true);
  assert.equal(isOccludedByShelf(person, [shelf(99, { left: 30, right: 50, top: 40, bottom: 80 })]), false);
  assert.equal(isOccludedByShelf(person, [shelf(101, { left: 41, right: 60, top: 40, bottom: 80 })]), false);
});

test("standing beside a shelf, with only the empty edge of the picture over it, is not outlined", () => {
  const person = {
    ...sprite(100, { left: 0, right: 96, top: 0, bottom: 96 }),
    body: { left: 37, right: 59, bottom: 90 },
  };
  assert.equal(isOccludedByShelf(person, [shelf(101, { left: 60, right: 120, top: 40, bottom: 100 })]), false);
  assert.equal(isOccludedByShelf(person, [shelf(101, { left: 50, right: 120, top: 40, bottom: 100 })]), true);
});

test("the larger transparent margins of a sideways shelf do not outline someone beside it", () => {
  for (const rotation of [1, 3]) {
    const sideways = { ...shelf(101, { left: 0, right: 64, top: 0, bottom: 128 }), rotation };
    const person = {
      ...sprite(100, { left: 0, right: 96, top: 10, bottom: 90 }),
      body: { left: 0, right: 21, bottom: 90 },
    };
    assert.equal(isOccludedByShelf(person, [sideways]), false);
    person.body.left = 22;
    person.body.right = 44;
    assert.equal(isOccludedByShelf(person, [sideways]), true);
  }
});

test("inactive people and shelves do not trigger visibility outlines", () => {
  const person = sprite(100, { left: 20, right: 40, top: 20, bottom: 60 });
  assert.equal(isOccludedByShelf({ ...person, active: false }, [shelf(101, person.getBounds())]), false);
  const inactiveShelf = shelf(101, person.getBounds());
  inactiveShelf.sprite.active = false;
  assert.equal(isOccludedByShelf(person, [inactiveShelf]), false);
});
