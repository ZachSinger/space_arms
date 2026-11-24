import assert from "node:assert/strict";
import test from "node:test";
import { problemsIn } from "../scripts/item-editor/server.mjs";

const item = {
  id: "test-item",
  name: "Test item",
  baseCost: 100,
  boxSize: 1,
  license: "test-license",
  tags: ["test"],
};
const licenses = new Set([item.license]);

test("item editor accepts supplier percentages outside the old range", () => {
  for (const supplyPercent of [-10, 0, 25.5, 75, 120]) {
    assert.deepEqual(problemsIn([{ ...item, supplyPercent }], licenses), []);
  }
});

test("item editor rejects missing and non-finite supplier percentages", () => {
  for (const supplyPercent of [undefined, null, NaN, Infinity]) {
    assert.match(problemsIn([{ ...item, supplyPercent }], licenses).join("\n"), /supplier % must be a number/);
  }
});
