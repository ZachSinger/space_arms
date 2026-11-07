import test from "node:test";
import assert from "node:assert/strict";
import {
  addTraitBonusItems,
  BASE_PATIENCE_MS,
  CUSTOMER_TRAITS,
  getPatienceMs,
  planShelfRoute,
  rollCustomerTraits,
} from "../js/logic/CustomerTraits.js";

const stop = (id) => ({ fixture: { id }, standPoint: { x: 0, y: 0 } });

test("every customer carries their group as a trait, plus rolled personality traits", () => {
  assert.deepEqual(rollCustomerTraits("mercenaries", () => 0.99), ["mercenaries"]);
  assert.deepEqual(rollCustomerTraits("explorers", () => 0), ["explorers", "wanderer", "impatient"]);
  assert.deepEqual(rollCustomerTraits(null, () => 0.99), []);
});

test("browsers only show up once the store has enough shelves or enough variety", () => {
  const always = () => 0;
  assert.ok(!rollCustomerTraits("scavengers", always, { shelfCount: 3, itemVariety: 7 }).includes("browser"));
  assert.ok(rollCustomerTraits("scavengers", always, { shelfCount: 4, itemVariety: 0 }).includes("browser"));
  assert.ok(rollCustomerTraits("scavengers", always, { shelfCount: 1, itemVariety: 8 }).includes("browser"));
});

test("browsers pick extra items from anything on the shelves", () => {
  const buyList = { primaryItemIds: ["a"], bonusItemIds: ["b"] };
  const shelfItemIds = ["a", "b", "c", "c", "d", "e"];
  assert.deepEqual(addTraitBonusItems(buyList, shelfItemIds, ["scavengers"]), ["b"]);
  const withBrowser = addTraitBonusItems(buyList, shelfItemIds, ["scavengers", "browser"], () => 0.5);
  assert.equal(withBrowser.length, 3);
  assert.equal(withBrowser[0], "b");
  assert.equal(new Set(withBrowser).size, 3);
  assert.ok(withBrowser.slice(1).every((id) => ["c", "d", "e"].includes(id)));
});

test("impatient customers give up sooner in line", () => {
  assert.equal(getPatienceMs(["scavengers"]), BASE_PATIENCE_MS);
  assert.equal(
    getPatienceMs(["scavengers", "impatient"]),
    BASE_PATIENCE_MS * CUSTOMER_TRAITS.impatient.patienceMultiplier,
  );
});

test("wanderers also browse other shelves, more of them in bigger stores", () => {
  const wanted = [stop("a")];
  const small = [stop("a"), stop("b"), stop("c")].map((s, i) => (i === 0 ? wanted[0] : s));
  const big = [wanted[0], ...Array.from({ length: 8 }, (_, i) => stop(`x${i}`))];
  const random = () => 0.5;

  assert.deepEqual(planShelfRoute(wanted, big, ["mercenaries"], random), wanted);

  const smallRoute = planShelfRoute(wanted, small, ["mercenaries", "wanderer"], random);
  const bigRoute = planShelfRoute(wanted, big, ["mercenaries", "wanderer"], random);
  assert.ok(smallRoute.includes(wanted[0]));
  assert.ok(bigRoute.includes(wanted[0]));
  assert.equal(smallRoute.length, 2);
  assert.equal(bigRoute.length, 5);
  assert.equal(new Set(bigRoute).size, bigRoute.length);
});
