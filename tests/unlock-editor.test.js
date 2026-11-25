import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyState, buildState, problemsIn } from "../scripts/unlock-editor/server.mjs";
import { SupplierLicense } from "../js/logic/Licenses.js";

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

test("unlock editor renames a contract and rewrites its description without touching anything else", () => {
  const state = buildState(texts);
  const license = state.licenses[3];
  license.name = 'Rifles & "Ammo"';
  license.description = "Long guns and the rounds\\that feed them.";
  const next = applyState(texts, state);
  assert.deepEqual(buildState(next), state);
  const before = texts.licenses.split("\n");
  assert.equal(next.licenses.split("\n").filter((line, index) => line !== before[index]).length, 2);
  const saved = JSON.parse(next.licenses).find((entry) => entry.id === license.id);
  assert.equal(saved.name, 'Rifles & "Ammo"');
  assert.equal(saved.description, "Long guns and the rounds\\that feed them.");
});

test("unlock editor rejects blank and duplicate contract names", () => {
  const state = buildState(texts);
  state.licenses[1].name = " ";
  state.licenses[3].name = state.licenses[2].name;
  const problems = problemsIn(state).join("\n");
  assert.match(problems, /needs a name/);
  assert.match(problems, /Two contracts are both named/);
});

test("unlock editor adds a new contract the game can load", () => {
  const state = buildState(texts);
  state.licenses.push({ isNew: true, name: "Rifle Scopes", description: "Glass for long guns.", tier: 2, cost: 900, level: 9 });
  state.licenses.push({ isNew: true, name: "Rifle-Scopes!", description: "", tier: 1, cost: 0, level: 1 });
  assert.deepEqual(problemsIn(state), []);
  const next = applyState(texts, state);
  const saved = JSON.parse(next.licenses);
  assert.equal(saved.length, JSON.parse(texts.licenses).length + 2);
  const [first, second] = saved.slice(-2);
  assert.equal(first.id, "lic_rifle_scopes");
  assert.equal(second.id, "lic_rifle_scopes_2");
  const contract = new SupplierLicense(first);
  assert.equal(contract.name, "Rifle Scopes");
  assert.equal(contract.requiredShopLevel, 9);
  assert.equal(contract.baseCost, 900);
  assert.ok(next.licenses.startsWith(texts.licenses.slice(0, texts.licenses.lastIndexOf("}") + 1)));
});

test("unlock editor rejects shop levels that don't need more reputation", () => {
  const state = buildState(texts);
  state.reputation[5] = state.reputation[4];
  assert.match(problemsIn(state).join("\n"), /Shop level 6: must need more reputation than level 5/);
});
