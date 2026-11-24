import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { FIXTURE_TYPES, getFixtureResaleValue, getShelfDisplayGrid } from "../js/logic/FixtureLayout.js";
import { LayoutRenderer } from "../js/logic/LayoutRenderer.js";
import { SupplierLicense } from "../js/logic/Licenses.js";
import { ContractRenderer } from "../js/logic/ContractRenderer.js";

const licenses = JSON.parse(await readFile(
  new URL("../data/Licenses.json", import.meta.url),
  "utf8",
));
const licenseById = new Map(licenses.map((license) => [license.id, license]));
const levelOf = (license) => license.requiredShopLevel ?? 1;

// Just the parts of the game state that contracts read.
function shopState({ shopLevel, globalReputation, factionReputation, credits, activeLicenses = new Set() }) {
  return {
    reputation: { shopLevel, global: globalReputation, factions: factionReputation },
    economy: { credits, canAfford(amount) { return this.credits >= amount; } },
    catalog: { owns: (id) => activeLicenses.has(id) },
  };
}

test("new shops can sign only Shop Level 1 supply contracts until they level up", () => {
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
  const expected = licenses.filter((license) => levelOf(license) === 1 && license.id !== "lic_fixture_basics" &&
    !license.reqFactionRep && !license.reqReputation && license.baseCost <= state.economy.credits)
    .map((license) => license.id);
  assert.ok(expected.includes("lic_start_rations"));
  assert.deepEqual(available.map((license) => license.id), expected);

  const html = ContractRenderer.generateHTML(contracts, state);
  assert.deepEqual([...html.matchAll(/data-license-id="([^"]+)"/g)].map((match) => match[1]), expected);

  state.reputation.shopLevel = 2;
  state.reputation.global = -1;
  const unlockedAtTwo = contracts.filter((license) => license.requiredShopLevel > 1 && license.isUnlocked(state))
    .map((license) => license.id);
  assert.deepEqual(unlockedAtTwo, licenses.filter((license) => levelOf(license) === 2 && !license.reqFactionRep)
    .map((license) => license.id));
  const ammo = contracts.find((license) => license.id === "lic_start_ammo");
  assert.equal(ammo.isUnlocked(state), ammo.requiredShopLevel <= 2);
  state.reputation.shopLevel = ammo.requiredShopLevel;
  assert.equal(ammo.isUnlocked(state), true);
});

test("level rewards unlock a supply contract at its Shop Level", () => {
  const supply = new SupplierLicense(licenseById.get("lic_start_apparel"));
  const state = shopState({
    shopLevel: supply.requiredShopLevel - 1,
    globalReputation: 1000,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 1500,
    activeLicenses: new Set(),
  });
  assert.equal(supply.isUnlocked(state), false);
  let html = ContractRenderer.generateHTML([supply], state);
  assert.match(html, new RegExp(`Shop Level ${supply.requiredShopLevel}\\b`));
  assert.doesNotMatch(html, /data-license-id=/);

  state.reputation.shopLevel = supply.requiredShopLevel;
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
  const [ammo, rations, labor] = contracts;
  assert.ok(rations.baseCost < ammo.baseCost && ammo.requiredShopLevel < labor.requiredShopLevel);
  const html = ContractRenderer.generateHTML(contracts, shopState({
    shopLevel: ammo.requiredShopLevel,
    globalReputation: 0,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: ammo.baseCost - 1,
    activeLicenses: new Set(["lic_fixture_basics"]),
  }));
  assert.match(html, /data-license-id="lic_start_rations"/);
  assert.match(html, /INSUFFICIENT FUNDS/);
  assert.match(html, new RegExp(`Requires Shop Level ${labor.requiredShopLevel}\\b`));
  assert.match(html, />LOCKED<\/button>/);
  assert.match(html, /Purchased; stays available\./);
  assert.match(html, /Unlocks fixtures:/);
  assert.match(html, />PURCHASED<\/button>/);
  assert.doesNotMatch(html, /data-license-id="lic_start_ammo"|data-license-id="lic_corp_labor"|data-license-id="lic_fixture_basics"/);
});

test("the Contracts tab escapes license data in text and action attributes", () => {
  const license = {
    id: 'license" onclick="run()',
    name: '<img src=x onerror="run()">',
    description: '<svg onload="run()">',
    tier: 1,
    baseCost: 1,
    unlocksFixtures: [],
    requiredShopLevel: 1,
    reqReputation: null,
    reqFaction: null,
    reqFactionRep: null,
    isUnlocked: () => true,
    canAfford: () => true,
  };
  const html = ContractRenderer.generateHTML([license], shopState({
    shopLevel: 1,
    globalReputation: 0,
    factionReputation: {},
    credits: 10,
  }));

  assert.match(html, /&lt;img src=x onerror=&quot;run\(\)&quot;&gt;/);
  assert.match(html, /&lt;svg onload=&quot;run\(\)&quot;&gt;/);
  assert.match(html, /data-license-id="license&quot; onclick=&quot;run\(\)"/);
  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.doesNotMatch(html, /data-license-id="license" onclick=/);
});

test("reputation-gated supplier contracts now use Shop Levels while keeping faction gates", () => {
  const gated = licenses.filter((license) => license.reqFaction && license.reqFactionRep > 0);
  assert.ok(gated.length > 0);
  const state = shopState({
    shopLevel: 1,
    globalReputation: 0,
    factionReputation: { scavengers: 100, mercenaries: 100, explorers: 100 },
    credits: 100000,
  });
  for (const data of gated) {
    const license = new SupplierLicense(data);
    const level = license.requiredShopLevel;
    assert.ok(level > 1, data.id);
    assert.equal(license.reqReputation, null, data.id);
    state.reputation.shopLevel = level - 1;
    assert.equal(license.isUnlocked(state), false, data.id);
    state.reputation.shopLevel = level;
    assert.equal(license.isUnlocked(state), true, data.id);
    state.reputation.factions[license.reqFaction] = license.reqFactionRep - 1;
    assert.equal(license.isUnlocked(state), false, `${data.id} still needs faction reputation`);
    state.reputation.factions[license.reqFaction] = 100;
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
  state.reputation.factions.scavengers = scavengerArmor.reqFactionRep;
  assert.equal(scavengerArmor.isUnlocked(state), false, "the assigned Shop Level is still required");
  state.reputation.shopLevel = scavengerArmor.requiredShopLevel;
  assert.equal(scavengerArmor.isUnlocked(state), true);
});

test("each fixture type is unlocked by its configured license", () => {
  // Equipment, like the hovercart charger, is bought by Shop Level instead.
  for (const spec of Object.values(FIXTURE_TYPES).filter((type) => !type.equipment)) {
    assert.ok(licenseById.get(spec.licenseId)?.unlocksFixtures.includes(spec.id));
  }
});

test("the budget shelf has 2x2 slots and is a starter shelf", () => {
  const budget = FIXTURE_TYPES.shelf_budget_2x2;
  assert.equal(budget.kind, "shelf");
  assert.deepEqual(getShelfDisplayGrid(budget), { w: 2, h: 2 });
  assert.equal(budget.licenseId, "lic_fixture_basics");
});

test("the budget shelves span 2-4 sections and 2-3 levels and keep the starter contract", () => {
  const starter = licenseById.get("lic_fixture_basics");
  for (const levels of [2, 3]) {
    for (const columns of [2, 3, 4]) {
      const spec = FIXTURE_TYPES[`shelf_budget_${levels}x${columns}`];
      assert.deepEqual(getShelfDisplayGrid(spec), { w: columns, h: levels });
      assert.equal(spec.licenseId, "lic_fixture_basics");
      assert.ok(starter.unlocksFixtures.includes(spec.id));
      assert.ok(spec.price > 0);
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
    fixtures: { all: () => [] },
    fixtureSystem: {
      canRearrange: () => true,
      purchaseOptions: () => Object.values(FIXTURE_TYPES).map((spec) => ({
        spec, licensed: true, canAfford: true, uniqueAlreadyPlaced: false, hasDeliverySpace: true,
      })),
    },
  }, true);
  assert.match(html, /BUDGET SHELF 2x2/);
  assert.ok(html.includes(`fixture-sale-price">${FIXTURE_TYPES.shelf_budget_2x2.price.toLocaleString()}<`));
  assert.match(html, /data-buy-fixture-id="shelf_budget_2x2"[^>]*>BUY/);
  assert.doesNotMatch(html, /credits|floor tiles/);
});

test("the Fixtures tab escapes fixture names and action attributes", () => {
  const scene = {
    fixtures: { all: () => [] },
    fixtureSystem: {
      canRearrange: () => true,
      purchaseOptions: () => [{
        spec: {
          id: 'shelf" onclick="run()',
          name: '<img src=x onerror="run()">',
          price: 75,
        },
        license: { name: "<svg onload='run()'>" },
        licensed: false,
        canAfford: true,
        hasDeliverySpace: true,
      }],
    },
  };
  const html = LayoutRenderer.generateHTML(scene, true);

  assert.match(html, /&lt;img src=x onerror=&quot;run\(\)&quot;&gt;/);
  assert.match(html, /Needs contract: &lt;svg onload=&#39;run\(\)&#39;&gt;/);
  assert.match(html, /data-buy-fixture-id="shelf&quot; onclick=&quot;run\(\)"/);
  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.doesNotMatch(html, /data-buy-fixture-id="shelf" onclick=/);
});

test("fixtures tab offers resale with a clear value and a confirmation", () => {
  const shelf = { id: "shelf_1", type: "shelf_budget_2x4", gx: 1, gy: 1 };
  const padCrate = { kind: "fixture", typeId: "shelf_budget_2x4", lockedToPad: true };
  const scene = {
    fixtures: { all: () => [shelf], displayName: () => "BUDGET SHELF 2x4" },
    restockCrates: [padCrate],
    carriedCrate: { kind: "fixture", typeId: "shelf_budget_2x4" },
    fixtureSystem: {
      canRearrange: () => true,
      purchaseOptions: () => [],
      crateBlockReason: () => null,
      canCrate: () => true,
      moveAreaBlockReason: () => null,
      saleBlockReason: () => null,
      crateSaleBlockReason: () => null,
    },
  };
  const html = LayoutRenderer.generateHTML(scene, true, "Purchase complete.", { name: "BUDGET SHELF 2x4", value: 90 });
  assert.match(html, /Sell BUDGET SHELF 2x4 for 90\?/);
  assert.match(html, /data-confirm-fixture-sale/);
  assert.match(html, /data-cancel-fixture-sale/);
  assert.match(html, /data-sell-fixture-id="shelf_1"/);
  assert.match(html, /data-sell-fixture-crate="0"/);
  assert.match(html, /data-sell-fixture-crate="carried"/);
  assert.match(html, /On the Loading Pad/);
  assert.match(html, new RegExp(`Sells for: ${getFixtureResaleValue("shelf_budget_2x4")}<`));
  assert.ok(html.indexOf("Purchase complete.") < html.indexOf("fixtures-owned-list"));
  assert.ok(html.indexOf("layout-sale-confirmation") < html.indexOf("fixtures-owned-list"));

  scene.fixtureSystem.saleBlockReason = () => "Only empty fixtures can be sold.";
  const blocked = LayoutRenderer.generateHTML(scene, true);
  assert.match(blocked, /fixture-block-reason">Only empty fixtures can be sold\.<\/p>/);
  assert.match(blocked, /data-sell-fixture-id="shelf_1"[\s\S]*?disabled>SELL/);
});

test("layout tab offers paid store expansions gated by shop level and purchase order", () => {
  const scene = {
    fixtures: { all: () => [] },
    fixtureSystem: {
      canExpand: () => true,
      canRearrange: () => true,
      expansionOptions: () => [
        {
          zone: { id: "expansion_west", name: "Sales Floor Expansion West", cost: 4000, requiredShopLevel: 5 },
          isPurchased: false, isNext: true, levelMet: true, canAfford: true,
        },
        {
          zone: { id: "expansion_a", name: "Sales Floor Expansion A", cost: 5000, requiredShopLevel: 9 },
          isPurchased: false, isNext: false, levelMet: false, canAfford: false,
        },
      ],
      backroomOptions: () => [
        {
          zone: { id: "backroom_upgrade_a", name: "Backroom Upgrade A", cost: 4000, requiredShopLevel: 13 },
          isPurchased: false, isNext: true, levelMet: true, canAfford: true,
        },
      ],
    },
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
    fixtureSystem: { ...scene.fixtureSystem, purchaseOptions: () => [] },
    restockCrates: [],
    supply: { freePadSpots: () => [] },
  }, true);
  assert.doesNotMatch(fixturesHTML, /Expansion|data-buy-expansion-id|data-buy-backroom-id/);
});

test("contracts are small and every product's contract exists", async () => {
  const items = JSON.parse(await readFile(new URL("../data/Items.json", import.meta.url), "utf8"));
  const counts = new Map();
  for (const item of items) counts.set(item.license, (counts.get(item.license) ?? 0) + 1);
  for (const [id, count] of counts) {
    assert.ok(licenseById.has(id), id);
    const minimum = id === "lic_start_long_guns" ? 1 : 2;
    assert.ok(count >= minimum && count <= 5, `${id} has ${count} products`);
  }
});

test("mismatched guns and ammunition unlock with their matching supplies", async () => {
  const items = JSON.parse(await readFile(new URL("../data/Items.json", import.meta.url), "utf8"));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const expectedLicenses = new Map([
    ["wpn_rif_10", "lic_corp_scatter"],
    ["wpn_hvy_08", "lic_pro_artillery"],
    ["amo_03", "lic_edge_antique_ammo"],
    ["amo_04", "lic_edge_antique_ammo"],
    ["amo_07", "lic_edge_antique_ammo"],
    ["amo_08", "lic_edge_antique_ammo"],
  ]);

  for (const [itemId, licenseId] of expectedLicenses) {
    assert.equal(itemById.get(itemId)?.license, licenseId, itemId);
    assert.ok(licenseById.has(licenseId), licenseId);
  }
});
