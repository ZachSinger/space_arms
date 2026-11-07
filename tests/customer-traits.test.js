import test from "node:test";
import assert from "node:assert/strict";
import {
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
