import assert from "node:assert/strict";
import { test } from "node:test";
import { findFreeWalkPath } from "../js/logic/Pathfinder.js";

function segmentIntersectsRectangle(from, to, rectangle) {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2);
  for (let index = 0; index <= steps; index += 1) {
    const ratio = steps ? index / steps : 0;
    const x = from.x + (to.x - from.x) * ratio;
    const y = from.y + (to.y - from.y) * ratio;
    if (x > rectangle.left && x < rectangle.right &&
        y > rectangle.top && y < rectangle.bottom) return true;
  }
  return false;
}

function makeRoute(start, goal, obstacles, bounds = { left: 0, right: 256, top: 0, bottom: 256 }) {
  const isWalkable = (x, y) =>
    x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom &&
    !obstacles.some((rectangle) =>
      x > rectangle.left && x < rectangle.right && y > rectangle.top && y < rectangle.bottom);
  const isSegmentClear = (from, to) => {
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4);
    for (let index = 0; index <= steps; index += 1) {
      const ratio = steps ? index / steps : 0;
      const x = from.x + (to.x - from.x) * ratio;
      const y = from.y + (to.y - from.y) * ratio;
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return false;
    }
    return obstacles.every((rectangle) => !segmentIntersectsRectangle(from, to, rectangle));
  };
  return findFreeWalkPath(start, goal, { isWalkable, isSegmentClear });
}

test("free-walk paths fit through character-sized gaps smaller than a floor tile", () => {
  const start = { x: 32, y: 96 };
  const goal = { x: 224, y: 96 };
  const obstacles = [
    { left: 80, right: 160, top: 0, bottom: 72 },
    { left: 80, right: 160, top: 120, bottom: 256 },
  ];
  const path = makeRoute(start, goal, obstacles);

  assert.ok(path);
  let previous = start;
  for (const point of [...path, goal]) {
    assert.ok(obstacles.every((rectangle) => !segmentIntersectsRectangle(previous, point, rectangle)));
    previous = point;
  }
  assert.ok(path.every(({ x, y }) => x % 8 === 0 && y % 8 === 0));
});

test("free-walk paths route around fixture edges instead of crossing them", () => {
  const start = { x: 32, y: 96 };
  const goal = { x: 224, y: 96 };
  const obstacle = { left: 80, right: 160, top: 32, bottom: 128 };
  const path = makeRoute(start, goal, [obstacle]);

  assert.ok(path);
  assert.ok(path.some(({ y }) => y <= obstacle.top || y >= obstacle.bottom));
  let previous = start;
  for (const point of [...path, goal]) {
    assert.equal(segmentIntersectsRectangle(previous, point, obstacle), false);
    previous = point;
  }
});
