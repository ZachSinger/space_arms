import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getItemCrateCategory, getItemCrateTint, ITEM_CRATE_TINTS } from "../js/logic/CrateCategory.js";

const items = JSON.parse(readFileSync(new URL("../data/Items.json", import.meta.url), "utf8"));

test("every item maps to one of seven visibly distinct crate colors", () => {
  const counts = new Map();
  for (const item of items) {
    const category = getItemCrateCategory(item.tags);
    assert.ok(category, `${item.name} has no crate category`);
    counts.set(category, (counts.get(category) ?? 0) + 1);
    assert.ok(getItemCrateTint(item.tags));
  }
  assert.deepEqual(Object.fromEntries(counts), {
    weapons: 40,
    ammunition: 26,
    attachments: 70,
    clothing: 50,
    armor: 25,
    tools: 19,
    survival: 15,
  });
  assert.equal(new Set(Object.values(ITEM_CRATE_TINTS)).size, 7);
});
