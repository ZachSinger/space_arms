import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyState, buildState, problemsIn } from "../scripts/unlock-editor/server.mjs";

const FILES = {
  progression: "data/Progression.json",
  licenses: "data/Licenses.json",
  fixtures: "data/Fixtures.json",
  start: "data/StartingTemplate.json",
  items: "data/Items.json",
};
const texts = Object.fromEntries(await Promise.all(Object.entries(FILES).map(async ([key, file]) => [key, await readFile(new URL(`../${file}`, import.meta.url), "utf8")])));

test("unlock editor saving with no edits leaves every file unchanged", () => {
  const state = buildState(texts);
  assert.deepEqual(problemsIn(state), []);
  assert.deepEqual(applyState(texts, state), texts);
});

test("unlock editor writes only the edited numbers", () => {
  const state = buildState(texts);
  const license = state.licenses.find((entry) => entry.level !== null);
  license.cost += 7;
  state.fixtures[0].price += 3;
  state.money += 11;
  state.zones[0].level += 1;
  state.reputation[2] += 1;
  const next = applyState(texts, state);
  assert.deepEqual(buildState(next), state);
  const changedLines = (key) => {
    const before = texts[key].split("\n");
    return next[key].split("\n").filter((line, index) => line !== before[index]).length;
  };
  assert.equal(changedLines("licenses"), 1);
  assert.equal(changedLines("fixtures"), 1);
  assert.equal(changedLines("start"), 1);
  assert.equal(next.items, texts.items);
});

test("unlock editor rejects shop levels that don't need more reputation", () => {
  const state = buildState(texts);
  state.reputation[5] = state.reputation[4];
  assert.match(problemsIn(state).join("\n"), /Shop level 6: must need more reputation than level 5/);
});
