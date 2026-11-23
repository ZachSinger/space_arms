import test from "node:test";
import assert from "node:assert/strict";
import { getHovercartMoveSpeed, getHovercartTransferCount } from "../js/debug/HovercartLab.js";

test("hovercart transfers never exceed available crates or free space", () => {
  assert.equal(getHovercartTransferCount(4, 3), 3);
  assert.equal(getHovercartTransferCount(2, 5), 2);
  assert.equal(getHovercartTransferCount(4, 0), 0);
  assert.equal(getHovercartTransferCount(-1, 3), 0);
});

test("a loaded hovercart follows more slowly, with a minimum speed", () => {
  assert.ok(getHovercartMoveSpeed(3) < getHovercartMoveSpeed(0));
  assert.equal(getHovercartMoveSpeed(5), 60);
  assert.equal(getHovercartMoveSpeed(8), 60);
});
