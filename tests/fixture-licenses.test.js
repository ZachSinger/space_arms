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

test("level rewards unlock a supply contract at 2 and a fixture contract at 14", () => {
  const supply = new SupplierLicense(licenseById.get("lic_start_apparel"));
  const fixture = new SupplierLicense(licenseById.get("lic_fixture_storage_bank"));
  const state = {
    shopLevel: 1,
    globalReputation: 1000,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 1500,
    activeLicenses: new Set(),
  };
  assert.equal(supply.isUnlocked(state), false);
  assert.equal(fixture.isUnlocked(state), false);
  let html = ContractRenderer.generateHTML([supply, fixture], state);
  assert.match(html, /Shop Level 2/);
  assert.match(html, /Shop Level 14/);
  assert.doesNotMatch(html, /data-license-id=/);

  state.shopLevel = 2;
  state.globalReputation = -5;
  assert.equal(supply.isUnlocked(state), true);
  assert.equal(fixture.isUnlocked(state), false);
  html = ContractRenderer.generateHTML([supply, fixture], state);
  assert.match(html, /data-license-id="lic_start_apparel"/);
  assert.doesNotMatch(html, /data-license-id="lic_fixture_storage_bank"/);
  state.shopLevel = 13;
  assert.equal(fixture.isUnlocked(state), false);
  state.shopLevel = 14;
  assert.equal(fixture.isUnlocked(state), true);
  html = ContractRenderer.generateHTML([supply, fixture], state);
  assert.match(html, /data-license-id="lic_fixture_storage_bank"/);

  state.shopLevel = 1;
  state.activeLicenses.add("lic_fixture_storage_bank");
  html = ContractRenderer.generateHTML([fixture], state);
  assert.match(html, /PURCHASED/);
  assert.match(html, /Purchased; stays available/);
  assert.doesNotMatch(html, />LOCKED</);
});

test("contracts list signable ones first, locked next, and signed ones last", () => {
  const ids = ["lic_start_apparel", "lic_fixture_storage_bank", "lic_corp_aulin"];
  const list = ids.map((id) => new SupplierLicense(licenseById.get(id)));
  const state = {
    shopLevel: 14,
    globalReputation: 1000,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 3000,
    activeLicenses: new Set(["lic_start_apparel"]),
  };
  assert.deepEqual(
    ContractRenderer.sortLicenses(list, state).map((license) => license.id),
    ["lic_fixture_storage_bank", "lic_corp_aulin", "lic_start_apparel"],
  );
  const html = ContractRenderer.generateHTML(list, state);
  assert.ok(html.indexOf(list[1].name) < html.indexOf(list[2].name));
  assert.ok(html.indexOf(list[2].name) < html.indexOf(list[0].name));
});

test("Stellaris Civilian Defense unlocks at Shop Level 6", () => {
  const license = new SupplierLicense(licenseById.get("lic_corp_stellaris"));
  const state = {
    shopLevel: 5,
    globalReputation: 1000,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 3000,
    activeLicenses: new Set(),
  };
  assert.equal(license.isUnlocked(state), false);
  assert.match(ContractRenderer.generateHTML([license], state), /Requires Shop Level 6/);

  state.shopLevel = 6;
  assert.equal(license.isUnlocked(state), true);
  assert.match(
    ContractRenderer.generateHTML([license], state),
    /data-license-id="lic_corp_stellaris"/,
  );
});

test("planned supplier contracts unlock at their assigned Shop Levels", () => {
  const contracts = [
    ["lic_corp_labor", 11],
    ["lic_corp_hazard", 12],
    ["lic_corp_aulin", 16],
    ["lic_corp_omni", 19],
    ["lic_corp_diagnostics", 22],
    ["lic_corp_breach", 26],
    ["lic_corp_vanguard", 29],
  ];
  const state = {
    shopLevel: 1,
    globalReputation: 10000,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 100000,
    activeLicenses: new Set(),
  };
  for (const [id, level] of contracts) {
    const license = new SupplierLicense(licenseById.get(id));
    assert.equal(license.requiredShopLevel, level, id);
    assert.equal(license.reqReputation, null, id);
    state.shopLevel = level - 1;
    assert.equal(license.isUnlocked(state), false, id);
    state.shopLevel = level;
    assert.equal(license.isUnlocked(state), true, id);
  }
});

test("reputation-gated supplier contracts now use Shop Levels while keeping faction gates", () => {
  const contracts = [
    [3, "lic_start_armor_melee"],
    [4, "lic_start_tools"],
    [5, "lic_start_mods"],
    [7, "lic_corp_scatter"],
    [9, "lic_pro_adv_melee"],
    [11, "lic_pro_arx_heavy"],
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
  const state = {
    shopLevel: 1,
    globalReputation: 0,
    factionReputation: { scavengers: 100, mercenaries: 100, explorers: 100 },
    credits: 100000,
  };
  for (const [level, id] of contracts) {
    const license = new SupplierLicense(licenseById.get(id));
    assert.equal(license.requiredShopLevel, level, id);
    assert.equal(license.reqReputation, null, id);
    state.shopLevel = level - 1;
    assert.equal(license.isUnlocked(state), false, id);
    state.shopLevel = level;
    assert.equal(license.isUnlocked(state), true, id);
  }
});

test("planned fixture licenses unlock larger storage fixtures", () => {
  const licensesByLevel = [
    [14, "lic_fixture_storage_bank", "locker_double"],
    [25, "lic_fixture_secure_storage", "locker_secure"],
  ];
  const state = {
    shopLevel: 1,
    globalReputation: 10000,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 100000,
    activeLicenses: new Set(),
  };
  for (const [level, licenseId, fixtureId] of licensesByLevel) {
    const license = new SupplierLicense(licenseById.get(licenseId));
    assert.equal(license.requiredShopLevel, level, licenseId);
    assert.deepEqual(license.unlocksFixtures, [fixtureId]);
    assert.equal(license.isUnlocked({ ...state, shopLevel: level - 1 }), false, licenseId);
    assert.equal(license.isUnlocked({ ...state, shopLevel: level }), true, licenseId);
    assert.ok(FIXTURE_TYPES[fixtureId], fixtureId);
    assert.equal(FIXTURE_TYPES[fixtureId].licenseId, licenseId);
  }
});

test("starter contracts and existing faction reputation requirements remain available", () => {
  const state = {
    shopLevel: 1,
    globalReputation: 2,
    factionReputation: { scavengers: 0, mercenaries: 0, explorers: 0 },
    credits: 1500,
  };
  const rations = new SupplierLicense(licenseById.get("lic_start_rations"));
  const scavengerArmor = new SupplierLicense(licenseById.get("lic_start_armor_melee"));
  assert.equal(rations.isUnlocked(state), true);
  assert.equal(scavengerArmor.isUnlocked(state), false);
  state.factionReputation.scavengers = 2;
  assert.equal(scavengerArmor.isUnlocked(state), false, "the assigned Shop Level is still required");
  state.shopLevel = 3;
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

test("the starter contract covers every shelf, while bigger lockers need their own contracts", () => {
  const starter = licenseById.get("lic_fixture_basics");
  for (const spec of Object.values(FIXTURE_TYPES).filter((entry) => entry.kind === "shelf")) {
    assert.ok(starter.unlocksFixtures.includes(spec.id), spec.id);
  }
  for (const id of ["locker_double", "locker_secure"]) {
    assert.ok(!starter.unlocksFixtures.includes(id));
    assert.notEqual(FIXTURE_TYPES[id].licenseId, "lic_fixture_basics");
    assert.ok(licenseById.get(FIXTURE_TYPES[id].licenseId).baseCost > 0);
  }
});

test("a locked fixture names the contract to sign", () => {
  const spec = FIXTURE_TYPES.locker_double;
  const html = LayoutRenderer.generateHTML({
    canRearrangeFixtures: () => true,
    fixtures: { all: () => [] },
    getFixturePurchaseOptions: () => [{
      spec, license: licenseById.get(spec.licenseId), licensed: false,
      canAfford: true, uniqueAlreadyPlaced: false, hasDeliverySpace: true,
    }],
  }, true);
  assert.match(html, /NEEDS CONTRACT: Expanded Storage Supply \(Contracts tab\)/);
  assert.match(html, /disabled>LOCKED/);
});

test("fixture purchases explain shelving, storage, checkout, and floor space", () => {
  const html = LayoutRenderer.generateHTML({
    canRearrangeFixtures: () => true,
    fixtures: { all: () => [] },
    getFixturePurchaseOptions: () => Object.values(FIXTURE_TYPES).map((spec) => ({
      spec, licensed: true, canAfford: true, uniqueAlreadyPlaced: false, hasDeliverySpace: true,
    })),
  }, true);
  assert.match(html, /SHELVING - displays items for customers/);
  assert.match(html, /STORAGE - holds stock for restocking/);
  assert.match(html, /CHECKOUT - serves customers/);
  assert.match(html, /2 x 1 floor tiles/);
  assert.match(html, /1\.625 x 1 floor tiles/);
  assert.match(html, /PRICE 2200 credits/);
});

test("fixtures tab offers resale with a clear value and a confirmation", () => {
  const locker = { id: "locker_1", type: "locker_single", gx: 1, gy: 1 };
  const padCrate = { kind: "fixture", typeId: "shelf_budget_2x4", lockedToPad: true };
  const scene = {
    canRearrangeFixtures: () => true,
    fixtures: { all: () => [locker], displayName: () => "LOCKER" },
    restockCrates: [padCrate],
    carriedCrate: { kind: "fixture", typeId: "locker_single" },
    getFixturePurchaseOptions: () => [],
    getFixtureCrateBlockReason: () => null,
    canCrateFixture: () => true,
    getFixtureSaleBlockReason: () => null,
    getFixtureCrateSaleBlockReason: () => null,
  };
  const html = LayoutRenderer.generateHTML(scene, true, "Purchase complete.", { name: "LOCKER", value: 90 });
  assert.match(html, /Sell LOCKER for 90 credits\?/);
  assert.match(html, /data-confirm-fixture-sale/);
  assert.match(html, /data-cancel-fixture-sale/);
  assert.match(html, /data-sell-fixture-id="locker_1"/);
  assert.match(html, /data-sell-fixture-crate="0"/);
  assert.match(html, /data-sell-fixture-crate="carried"/);
  assert.match(html, /Loading Pad \| Resale value: 150 credits/);
  assert.ok(html.indexOf("Purchase complete.") < html.indexOf("fixture-management-scroll"));
  assert.ok(html.indexOf("layout-sale-confirmation") < html.indexOf("fixture-management-scroll"));

  scene.getFixtureSaleBlockReason = () => "Only empty fixtures can be sold.";
  const blocked = LayoutRenderer.generateHTML(scene, true);
  assert.match(blocked, /<small>Only empty fixtures can be sold\.<\/small>/);
  assert.match(blocked, /data-sell-fixture-id="locker_1"[\s\S]*?disabled>SELL/);
});

test("layout tab offers paid store expansions gated by shop level and purchase order", () => {
  const scene = {
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
  assert.match(html, /STORE EXPANSIONS/);
  assert.match(html, /SHOP LEVEL 5 \| PRICE 4,000 credits/);
  assert.match(html, /data-buy-expansion-id="expansion_west"[^>]*>BUY/);
  assert.match(html, /BUY PREVIOUS EXPANSION FIRST/);
  assert.match(html, /BACKROOM EXPANSIONS/);
  assert.match(html, /SHOP LEVEL 13 \| PRICE 4,000 credits/);
  assert.match(html, /data-buy-backroom-id="backroom_upgrade_a"[^>]*>BUY/);

  const fixturesHTML = LayoutRenderer.generateHTML({
    ...scene,
    getFixturePurchaseOptions: () => [],
    restockCrates: [],
    getLoadingPadSpawnPositions: () => [],
  }, true);
  assert.doesNotMatch(fixturesHTML, /STORE EXPANSIONS/);
});

test("early supplier license prices reflect the value of their item catalogs", () => {
  const expectedPrices = {
    lic_start_rations: 25,
    lic_start_mods: 75,
    lic_start_apparel: 100,
    lic_start_ammo: 100,
    lic_start_armor_melee: 200,
    lic_start_tools: 250,
  };

  for (const [licenseId, price] of Object.entries(expectedPrices)) {
    assert.equal(licenseById.get(licenseId)?.baseCost, price, licenseId);
  }
});
