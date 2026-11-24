import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTuning } from "../js/core/Tuning.js";
import customerTuning from "../data/tuning/customers.json" with { type: "json" };
import checkoutTuning from "../data/tuning/checkout.json" with { type: "json" };
import crateTuning from "../data/tuning/crates.json" with { type: "json" };
import cleaningTuning from "../data/tuning/cleaning.json" with { type: "json" };
import navigationTuning from "../data/tuning/navigation.json" with { type: "json" };

const entry = (value, extra = {}) => ({ value, min: 0, max: 10, description: "A number.", ...extra });

test("tuning loads plain values and lists, frozen", () => {
  const tuning = loadTuning("shop", { doors: entry(2, { integer: true }), walkMs: entry([1, 4]) });

  assert.deepEqual(tuning, { doors: 2, walkMs: [1, 4] });
  assert.ok(Object.isFrozen(tuning) && Object.isFrozen(tuning.walkMs));
});

test("tuning rejects out-of-range, fractional, missing, and undescribed numbers by name", () => {
  assert.throws(() => loadTuning("shop", { doors: entry(11) }), /shop\.doors is 11, outside its allowed range 0 to 10/);
  assert.throws(() => loadTuning("shop", { walkMs: entry([1, -1]) }), /shop\.walkMs is -1/);
  assert.throws(() => loadTuning("shop", { doors: entry(1.5, { integer: true }) }), /whole number/);
  assert.throws(() => loadTuning("shop", { doors: entry("2") }), /must be a number/);
  assert.throws(() => loadTuning("shop", { doors: entry(2, { description: " " }) }), /needs a description/);
  assert.throws(() => loadTuning("shop", { doors: entry(2, { min: 5, max: 1 }) }), /min and max/);
});

// Numbers moved out of the code during the rebuild keep exactly the values they had.
test("moved tuning numbers keep their old values", () => {
  assert.deepEqual({ ...loadTuning("customers", customerTuning) }, {
    maxCustomersInStore: 6,
    poolRefreshIntervalMs: 1000,
  });
  assert.deepEqual({ ...loadTuning("checkout", checkoutTuning) }, {
    goBackRetryIntervalMs: 5000,
  });
  assert.deepEqual({ ...loadTuning("crates", crateTuning) }, {
    maxMovedCrates: 4,
    trashcanReachPx: 40,
    pushSpeedByCrateCount: [1, 0.6, 0.4, 0.25],
    customerPushClaimMs: 150,
    customerPushReach: 160,
    customerCrateStuckMs: 1000,
    customerCrateSqueezeMs: 1500,
    physicsFrameDeltaCapMs: 50,
  });
  assert.deepEqual({ ...loadTuning("cleaning", cleaningTuning) }, {
    cleanlinessBase: 20,
    cleanlinessPerSalesExpansion: 20,
    cleanlinessPerLevelAboveFloor: 2,
    cleanlinessLevelFloor: 5,
    trashPenalty: 1,
    dirtPenalty: 2,
    cleanlinessJudgeMs: 3000,
    trashDropChance: 0.2,
    trashDropWalkMs: [1000, 6000],
    dirtDropChance: 0.15,
    mopPressesPerSpot: 8,
    upsetReputationLoss: 1,
    walkOutReputationLoss: 2,
    trashPickupAheadPx: 22,
    trashPickupReachPx: 26,
    blockedSpotSearchStepPx: 16,
    blockedSpotSearchMaxRings: 24,
    trashDepth: 0.9,
    trashScale: 1.5,
    trashHighlightDepth: 8990,
    scavengersUpsetPercent: [40, 60],
    scavengersWalkOutPercent: [10, 25],
    civilianUpsetPercent: [55, 75],
    civilianWalkOutPercent: [25, 40],
    mercenariesUpsetPercent: [65, 80],
    mercenariesWalkOutPercent: [35, 50],
    explorersUpsetPercent: [70, 80],
    explorersWalkOutPercent: [45, 60],
  });
  assert.deepEqual({ ...loadTuning("navigation", navigationTuning) }, {
    walkStepPx: 8,
    connectorRadiusCells: 16,
    maxPathNodes: 50000,
    maxReachableGridCells: 4000,
    maxGridPathSteps: 4000,
  });
});
