import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { FIXTURE_TYPES, getShelfDisplayGrid } from "../js/logic/FixtureLayout.js";
import { LayoutRenderer } from "../js/logic/LayoutRenderer.js";
import { SupplierLicense } from "../js/logic/Licenses.js";
import { ContractRenderer } from "../js/logic/ContractRenderer.js";

const licenses = JSON.parse(await readFile(
  new URL("../data/Licenses.json", import.meta.url),
  "utf8",
));
const licenseById = new Map(licenses.map((license) => [license.id, license]));

// Just the parts of the game state that contracts read.
function shopState({ shopLevel, globalReputation, factionReputation, credits, activeLicenses = new Set() }) {
  return {
    reputation: { shopLevel, global: globalReputation, factions: factionReputation },
    economy: { credits, canAfford(amount) { return this.credits >= amount; } },
    catalog: { owns: (id) => activeLicenses.has(id) },
  };
}

test("new shops can sign only the survival supply contract until Shop Level 2", () => {
  const state = shopState({
    shopLevel: 1,
    globalReputation: 0,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 1500,
    activeLicenses: new Set(["lic_fixture_basics"]),
  });
  const contracts = licenses.map((data) => new SupplierLicense(data));
  const available = contracts.filter((license) =>
    !state.catalog.owns(license.id) && license.isUnlocked(state) && license.canAfford(state));
  assert.deepEqual(available.map((license) => license.id), ["lic_start_rations"]);

  const html = ContractRenderer.generateHTML(contracts, state);
  assert.deepEqual([...html.matchAll(/data-license-id="([^"]+)"/g)].map((match) => match[1]),
    ["lic_start_rations"]);

  state.reputation.shopLevel = 2;
  state.reputation.global = -1;
  const unlockedAtTwo = contracts.filter((license) => license.id !== "lic_fixture_basics" &&
    license.id !== "lic_start_rations" && license.isUnlocked(state)).map((license) => license.id);
  assert.deepEqual(unlockedAtTwo, ["lic_start_survival"], "only one new contract at Shop Level 2");
  state.reputation.shopLevel = 4;
  assert.equal(contracts.find((license) => license.id === "lic_start_ammo").isUnlocked(state), true);
});

test("level rewards unlock a supply contract at 6", () => {
  const supply = new SupplierLicense(licenseById.get("lic_start_apparel"));
  const state = shopState({
    shopLevel: 5,
    globalReputation: 1000,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 1500,
    activeLicenses: new Set(),
  });
  assert.equal(supply.isUnlocked(state), false);
  let html = ContractRenderer.generateHTML([supply], state);
  assert.match(html, /Shop Level 6/);
  assert.doesNotMatch(html, /data-license-id=/);

  state.reputation.shopLevel = 6;
  state.reputation.global = -5;
  assert.equal(supply.isUnlocked(state), true);
  html = ContractRenderer.generateHTML([supply], state);
  assert.match(html, /data-license-id="lic_start_apparel"/);
});

test("contracts list signable ones first, locked next, and signed ones last", () => {
  const ids = ["lic_start_rations", "lic_corp_labor", "lic_start_apparel"];
  const list = ids.map((id) => new SupplierLicense(licenseById.get(id)));
  const state = shopState({
    shopLevel: 10,
    globalReputation: 1000,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 3000,
    activeLicenses: new Set(["lic_start_apparel"]),
  });
  assert.deepEqual(
    ContractRenderer.sortLicenses(list, state).map((license) => license.id),
    ["lic_start_rations", "lic_corp_labor", "lic_start_apparel"],
  );
  const html = ContractRenderer.generateHTML(list, state);
  assert.ok(html.indexOf(list[0].name) < html.indexOf(list[1].name));
  assert.ok(html.indexOf(list[1].name) < html.indexOf(list[2].name));
});

test("redesigned contracts retain available, unaffordable, locked, and purchased states", () => {
  const contracts = ["lic_start_ammo", "lic_start_rations", "lic_corp_labor", "lic_fixture_basics"]
    .map((id) => new SupplierLicense(licenseById.get(id)));
  const html = ContractRenderer.generateHTML(contracts, shopState({
    shopLevel: 4,
    globalReputation: 0,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 100,
    activeLicenses: new Set(["lic_fixture_basics"]),
  }));
  assert.match(html, /data-license-id="lic_start_rations"/);
  assert.match(html, /INSUFFICIENT FUNDS/);
  assert.match(html, /Requires Shop Level 12/);
  assert.match(html, />LOCKED<\/button>/);
  assert.match(html, /Purchased; stays available\./);
  assert.match(html, /Unlocks fixtures:/);
  assert.match(html, />PURCHASED<\/button>/);
  assert.doesNotMatch(html, /data-license-id="lic_start_ammo"|data-license-id="lic_corp_labor"|data-license-id="lic_fixture_basics"/);
});

test("Stellaris Las-Arms unlocks at Shop Level 9", () => {
  const license = new SupplierLicense(licenseById.get("lic_corp_stellaris"));
  const state = shopState({
    shopLevel: 8,
    globalReputation: 1000,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 3000,
    activeLicenses: new Set(),
  });
  assert.equal(license.isUnlocked(state), false);
  assert.match(ContractRenderer.generateHTML([license], state), /Requires Shop Level 9/);

  state.reputation.shopLevel = 9;
  assert.equal(license.isUnlocked(state), true);
  assert.match(
    ContractRenderer.generateHTML([license], state),
    /data-license-id="lic_corp_stellaris"/,
  );
});

test("planned supplier contracts unlock at their assigned Shop Levels", () => {
  const contracts = [
    ["lic_corp_labor", 12],
    ["lic_corp_hazard", 13],
    ["lic_corp_aulin", 16],
    ["lic_corp_omni", 19],
    ["lic_corp_diagnostics", 22],
    ["lic_corp_breach", 26],
    ["lic_corp_vanguard", 29],
  ];
  const state = shopState({
    shopLevel: 1,
    globalReputation: 10000,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 100000,
    activeLicenses: new Set(),
  });
  for (const [id, level] of contracts) {
    const license = new SupplierLicense(licenseById.get(id));
    assert.equal(license.requiredShopLevel, level, id);
    assert.equal(license.reqReputation, null, id);
    state.reputation.shopLevel = level - 1;
    assert.equal(license.isUnlocked(state), false, id);
    state.reputation.shopLevel = level;
    assert.equal(license.isUnlocked(state), true, id);
  }
});

test("reputation-gated supplier contracts now use Shop Levels while keeping faction gates", () => {
  const contracts = [
    [5, "lic_start_armor_melee"],
    [7, "lic_start_tools"],
    [9, "lic_start_mods"],
    [10, "lic_corp_scatter"],
    [11, "lic_pro_adv_melee"],
    [12, "lic_pro_arx_heavy"],
    [13, "lic_pro_kessler"],
    [15, "lic_pro_high_energy"],
    [17, "lic_pro_aegis_sec"],
    [18, "lic_pro_kodiak"],
    [20, "lic_pro_zastava"],
    [21, "lic_pro_artillery"],
    [22, "lic_edge_kinetic"],
    [23, "lic_edge_antique"],
    [24, "lic_edge_blackwood"],
    [25, "lic_edge_unrestricted"],
    [28, "lic_edge_tessier"],
    [30, "lic_edge_exotic"],
  ];
  const state = shopState({
    shopLevel: 1,
    globalReputation: 0,
    factionReputation: { scavengers: 100, mercenaries: 100, explorers: 100 },
    credits: 100000,
  });
  for (const [level, id] of contracts) {
    const license = new SupplierLicense(licenseById.get(id));
    assert.equal(license.requiredShopLevel, level, id);
    assert.equal(license.reqReputation, null, id);
    state.reputation.shopLevel = level - 1;
    assert.equal(license.isUnlocked(state), false, id);
    state.reputation.shopLevel = level;
    assert.equal(license.isUnlocked(state), true, id);
  }
});

test("starter contracts and existing faction reputation requirements remain available", () => {
  const state = shopState({
    shopLevel: 1,
    globalReputation: 2,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 1500,
  });
  const rations = new SupplierLicense(licenseById.get("lic_start_rations"));
  const scavengerArmor = new SupplierLicense(licenseById.get("lic_start_armor_melee"));
  assert.equal(rations.isUnlocked(state), true);
  assert.equal(scavengerArmor.isUnlocked(state), false);
  state.reputation.factions.scavengers = 2;
  assert.equal(scavengerArmor.isUnlocked(state), false, "the assigned Shop Level is still required");
  state.reputation.shopLevel = 5;
  assert.equal(scavengerArmor.isUnlocked(state), true);
});

test("each fixture type is unlocked by its configured license", () => {
  for (const spec of Object.values(FIXTURE_TYPES)) {
    assert.ok(licenseById.get(spec.licenseId)?.unlocksFixtures.includes(spec.id));
  }
});

test("the budget shelf has 2x2 slots, is a starter shelf, and is the cheapest fixture besides the trashcan", () => {
  const budget = FIXTURE_TYPES.shelf_budget_2x2;
  assert.equal(budget.kind, "shelf");
  assert.deepEqual(getShelfDisplayGrid(budget), { w: 2, h: 2 });
  assert.equal(budget.licenseId, "lic_fixture_basics");
  for (const spec of Object.values(FIXTURE_TYPES)) {
    if (spec !== budget && spec.kind !== "trash") assert.ok(budget.price < spec.price, `${spec.id} costs more`);
  }
});

test("the budget shelves span 2-4 sections and 2-3 levels and keep the starter contract", () => {
  const starter = licenseById.get("lic_fixture_basics");
  for (const levels of [2, 3]) {
    for (const columns of [2, 3, 4]) {
      const spec = FIXTURE_TYPES[`shelf_budget_${levels}x${columns}`];
      assert.deepEqual(getShelfDisplayGrid(spec), { w: columns, h: levels });
      assert.equal(spec.licenseId, "lic_fixture_basics");
      assert.ok(starter.unlocksFixtures.includes(spec.id));
      assert.equal(spec.price, columns * (levels === 2 ? 75 : 100));
    }
  }
  assert.deepEqual(Object.values(FIXTURE_TYPES).filter((spec) => spec.kind === "shelf").map((spec) => spec.id).sort(),
    ["2x2", "2x3", "2x4", "3x2", "3x3", "3x4"].map((size) => `shelf_budget_${size}`));
});

test("the starter contract covers every shelf", () => {
  const starter = licenseById.get("lic_fixture_basics");
  for (const spec of Object.values(FIXTURE_TYPES).filter((entry) => entry.kind === "shelf")) {
    assert.ok(starter.unlocksFixtures.includes(spec.id), spec.id);
  }
});

test("fixture purchases list each fixture with its price and a buy button", () => {
  const html = LayoutRenderer.generateHTML({
    canRearrangeFixtures: () => true,
    fixtures: { all: () => [] },
    getFixturePurchaseOptions: () => Object.values(FIXTURE_TYPES).map((spec) => ({
      spec, licensed: true, canAfford: true, uniqueAlreadyPlaced: false, hasDeliverySpace: true,
    })),
  }, true);
  assert.match(html, /BUDGET SHELF 2x2/);
  assert.match(html, /fixture-sale-price">400</);
  assert.match(html, /data-buy-fixture-id="shelf_budget_2x2"[^>]*>BUY/);
  assert.doesNotMatch(html, /credits|floor tiles/);
});

test("fixtures tab offers resale with a clear value and a confirmation", () => {
  const shelf = { id: "shelf_1", type: "shelf_budget_2x4", gx: 1, gy: 1 };
  const padCrate = { kind: "fixture", typeId: "shelf_budget_2x4", lockedToPad: true };
  const scene = {
    canRearrangeFixtures: () => true,
    fixtures: { all: () => [shelf], displayName: () => "BUDGET SHELF 2x4" },
    restockCrates: [padCrate],
    carriedCrate: { kind: "fixture", typeId: "shelf_budget_2x4" },
    getFixturePurchaseOptions: () => [],
    getFixtureCrateBlockReason: () => null,
    canCrateFixture: () => true,
    getFixtureSaleBlockReason: () => null,
    getFixtureCrateSaleBlockReason: () => null,
  };
  const html = LayoutRenderer.generateHTML(scene, true, "Purchase complete.", { name: "BUDGET SHELF 2x4", value: 90 });
  assert.match(html, /Sell BUDGET SHELF 2x4 for 90\?/);
  assert.match(html, /data-confirm-fixture-sale/);
  assert.match(html, /data-cancel-fixture-sale/);
  assert.match(html, /data-sell-fixture-id="shelf_1"/);
  assert.match(html, /data-sell-fixture-crate="0"/);
  assert.match(html, /data-sell-fixture-crate="carried"/);
  assert.match(html, /On the Loading Pad/);
  assert.match(html, /Sells for: 150/);
  assert.ok(html.indexOf("Purchase complete.") < html.indexOf("fixtures-owned-list"));
  assert.ok(html.indexOf("layout-sale-confirmation") < html.indexOf("fixtures-owned-list"));

  scene.getFixtureSaleBlockReason = () => "Only empty fixtures can be sold.";
  const blocked = LayoutRenderer.generateHTML(scene, true);
  assert.match(blocked, /fixture-block-reason">Only empty fixtures can be sold\.<\/p>/);
  assert.match(blocked, /data-sell-fixture-id="shelf_1"[\s\S]*?disabled>SELL/);
});

test("layout tab offers paid store expansions gated by shop level and purchase order", () => {
  const scene = {
    canExpandStore: () => true,
    canRearrangeFixtures: () => true,
    fixtures: { all: () => [] },
    getExpansionPurchaseOptions: () => [
      {
        zone: { id: "expansion_west", name: "Sales Floor Expansion West", cost: 4000, requiredShopLevel: 5 },
        isPurchased: false, isNext: true, levelMet: true, canAfford: true,
      },
      {
        zone: { id: "expansion_a", name: "Sales Floor Expansion A", cost: 5000, requiredShopLevel: 9 },
        isPurchased: false, isNext: false, levelMet: false, canAfford: false,
      },
    ],
    getBackroomPurchaseOptions: () => [
      {
        zone: { id: "backroom_upgrade_a", name: "Backroom Upgrade A", cost: 4000, requiredShopLevel: 13 },
        isPurchased: false, isNext: true, levelMet: true, canAfford: true,
      },
    ],
  };
  const html = LayoutRenderer.generateHTML(scene);
  assert.match(html, /Sales Floor</);
  assert.match(html, /Backroom</);
  assert.match(html, /Shop Level 5</);
  assert.match(html, /fixture-sale-price">4,000</);
  assert.match(html, /data-buy-expansion-id="expansion_west"[^>]*>BUY/);
  assert.match(html, /class="retro-tab-btn" data-buy-expansion-id="expansion_a"\s+disabled>LOCKED/);
  assert.match(html, /Shop Level 13</);
  assert.match(html, /data-buy-backroom-id="backroom_upgrade_a"[^>]*>BUY/);
  assert.doesNotMatch(html, /credits/);

  const fixturesHTML = LayoutRenderer.generateHTML({
    ...scene,
    getFixturePurchaseOptions: () => [],
    restockCrates: [],
    getLoadingPadSpawnPositions: () => [],
  }, true);
  assert.doesNotMatch(fixturesHTML, /Expansion|data-buy-expansion-id|data-buy-backroom-id/);
});

test("early supplier license prices reflect the value of their item catalogs", () => {
  const expectedPrices = {
    lic_start_rations: 25,
    lic_start_survival: 25,
    lic_start_surplus: 50,
    lic_start_ammo: 200,
    lic_start_armor_melee: 325,
  };

  for (const [licenseId, price] of Object.entries(expectedPrices)) {
    assert.equal(licenseById.get(licenseId)?.baseCost, price, licenseId);
  }
});

test("contracts are small and products unlock slowly through the early levels", async () => {
  const items = JSON.parse(await readFile(new URL("../data/Items.json", import.meta.url), "utf8"));
  const counts = new Map();
  for (const item of items) counts.set(item.license, (counts.get(item.license) ?? 0) + 1);
  for (const [id, count] of counts) {
    assert.ok(licenseById.has(id), id);
    assert.ok(count >= 2 && count <= 5, `${id} has ${count} products`);
  }
  const earlyProducts = licenses
    .filter((license) => (license.requiredShopLevel ?? 1) <= 5)
    .reduce((total, license) => total + (counts.get(license.id) ?? 0), 0);
  assert.ok(earlyProducts <= 15, `${earlyProducts} products by Shop Level 5`);
});
