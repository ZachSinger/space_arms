import assert from "node:assert/strict";
import test from "node:test";
import {
  addDiscountBonusItem, createCustomerBuyList, CUSTOMER_BUY_LIST_TUNING,
  BARGAIN_PRICE_RATIO, DISCOUNT_BONUS_CHANCE,
} from "../js/logic/CustomerBuyLists.js";

const catalog = [
  { id: "rifle_a", name: "Rifle A", tags: ["Firearm", "Standard", "Rifle"], ammo: "Rifle Light Caliber" },
  { id: "rifle_b", name: "Rifle B", tags: ["Firearm", "High-Tier", "Rifle"], ammo: "Other Ammo" },
  { id: "pistol", name: "Pistol", tags: ["Firearm", "Standard", "Pistol"], ammo: "Pistol Ammo" },
  { id: "rifle_ammo", name: "Rifle Light Caliber: 30-Round Box", tags: ["Ammunition", "Standard"], ammo: "Rifle Light Caliber" },
  { id: "armor", name: "Armor", tags: ["Armor", "Standard"] },
  { id: "tool", name: "Tool", tags: ["Tool", "Standard"] },
  { id: "survival", name: "Survival", tags: ["Survival", "Standard"] },
  { id: "old_ration", name: "Old Ration", tags: ["Survival", "Surplus", "Ration"] },
  { id: "apparel", name: "Apparel", tags: ["Apparel", "Surplus"] },
  { id: "surplus_apparel", name: "Surplus Apparel", tags: ["Apparel", "Old"] },
  { id: "new_rifle", name: "New Rifle", tags: ["Firearm", "New", "Rifle"] },
];
const getItem = (itemId) => catalog.find((item) => item.id === itemId);

test("reputation thresholds stay unset and neutral customers want a shelf-assigned item", () => {
  assert.deepEqual(CUSTOMER_BUY_LIST_TUNING.reputationPrimaryThresholds, []);
  const list = createCustomerBuyList(null, ["tool", "survival"], getItem, () => 0);
  assert.deepEqual(list.primaryItemIds, ["tool"]);
  assert.deepEqual(list.bonusItemIds, []);
});

test("Scavengers prefer Surplus/Old primary stock and get a larger impulse-buy list", () => {
  const list = createCustomerBuyList(
    "scavengers",
    ["tool", "old_ration", "apparel", "surplus_apparel", "survival"],
    getItem,
    () => 0,
  );
  assert.deepEqual(list.primaryItemIds, ["old_ration"]);
  assert.equal(list.bonusItemIds.length, 2);
  assert.ok(list.bonusItemIds.every((id) => !list.primaryItemIds.includes(id)));
  assert.ok(list.bonusItemIds.every((id) =>
    ["apparel", "surplus_apparel", "survival"].includes(id),
  ));
});

test("Mercenaries want quality combat stock, avoid duplicate weapon types, and match ammo", () => {
  const list = createCustomerBuyList(
    "mercenaries",
    ["rifle_a", "rifle_b", "pistol", "rifle_ammo", "armor", "new_rifle"],
    getItem,
    () => 0,
  );
  assert.equal(list.primaryItemIds.length, 2);
  const weaponTypes = list.primaryItemIds
    .map(getItem)
    .filter((item) => item.tags.includes("Firearm"))
    .map((item) => item.tags.find((tag) => ["Pistol", "Rifle", "Heavy"].includes(tag)));
  assert.equal(new Set(weaponTypes).size, weaponTypes.length);
  assert.deepEqual(list.matchingAmmoIdsByFirearm.rifle_a, ["rifle_ammo"]);
  const highTierList = createCustomerBuyList(
    "mercenaries",
    ["rifle_a", "rifle_b", "pistol", "rifle_ammo", "armor", "new_rifle"],
    getItem,
    () => 0.99,
  );
  assert.ok(highTierList.primaryItemIds.includes("new_rifle"));
});

test("Explorers can choose either a Tool or Survival gear as a primary", () => {
  const first = createCustomerBuyList("explorers", ["survival", "tool"], getItem, () => 0);
  const last = createCustomerBuyList("explorers", ["survival", "tool"], getItem, () => 0.99);
  assert.deepEqual(
    new Set([...first.primaryItemIds, ...last.primaryItemIds]),
    new Set(["survival", "tool"]),
  );
});

test("customers sometimes add one extra bargain item when an unrequested item is 10% below market", () => {
  const buyList = { primaryItemIds: ["tool"], bonusItemIds: ["survival"] };
  const result = addDiscountBonusItem(
    buyList,
    ["tool", "survival", "apparel", "old_ration"],
    (id) => id === "apparel" || id === "old_ration",
    () => 0,
  );
  assert.equal(BARGAIN_PRICE_RATIO, 0.9);
  assert.equal(DISCOUNT_BONUS_CHANCE, 0.5);
  assert.deepEqual(result, ["survival", "apparel"]);
  assert.deepEqual(buyList.bonusItemIds, ["survival"]);
});

test("customers skip bargain extras when no unrequested item is discounted or the chance misses", () => {
  const buyList = { primaryItemIds: ["tool"], bonusItemIds: [] };
  assert.deepEqual(
    addDiscountBonusItem(buyList, ["tool", "survival"], () => false, () => 0),
    [],
  );
  assert.deepEqual(
    addDiscountBonusItem(buyList, ["tool", "survival"], () => true, () => 0.9),
    [],
  );
});
