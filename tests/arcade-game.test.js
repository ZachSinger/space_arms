import test from "node:test";
import assert from "node:assert/strict";
import { findArcadeGameProblems, findArcadeInstanceProblems } from "../js/arcade/ArcadeGame.js";

const methods = { start() {}, update() {}, render() {}, pause() {}, resume() {}, destroy() {} };

test("a game that follows the arcade contract has no problems", () => {
  const game = { id: "void-raiders", title: "VOID RAIDERS", scoreType: "points", create: () => ({ ...methods }) };
  assert.deepEqual(findArcadeGameProblems(game), []);
  assert.deepEqual(findArcadeInstanceProblems(game.create()), []);
});

test("arcade contract problems are named", () => {
  assert.equal(findArcadeGameProblems({ id: "Void Raiders", title: "", scoreType: "laps", create: null }).length, 4);
  assert.deepEqual(findArcadeInstanceProblems({ ...methods, destroy: undefined }), ["create() result is missing destroy()."]);
});
