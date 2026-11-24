import { syncPeopleVisibilityOutlines } from "./PeopleVisibility.js";

// =============================================================================
// FILE: Depth.js
// =============================================================================
// Draw-order layers shared by people and floor crates, and the per-frame people sort.
// =============================================================================

// People sort by feet position above this; the tallest map (about 6,800 pixels) stays below
// the 9,000+ layer used for speech bubbles, prompts, and gauges.
export const PEOPLE_DEPTH_BASE = 2000;

// Fixtures sort with people and floor crates by the bottom of their solid base: anyone whose
// feet are behind a shelf's feet is drawn behind it, so walking past the top of an upright
// shelf hides you behind it. A lower fixture (such as a down-facing shelf backed against an
// up-facing one) covers the one behind it, and a floor crate level with a fixture's base draws
// over it. A shelf's stock and facing light sit just over their own shelf.
const FIXTURE_DEPTH_BELOW_FEET = 0.75;
export const FIXTURE_STOCK_DEPTH_OFFSET = 0.0001;
export const FIXTURE_LIGHT_DEPTH_OFFSET = 0.0002;

export function fixtureDepth(baseBottomPx) {
  return PEOPLE_DEPTH_BASE + baseBottomPx - FIXTURE_DEPTH_BELOW_FEET;
}

// People (player, customers, staff) are drawn lower-on-screen in front: a customer walking
// down past someone passes behind them, and anyone behind a fixture's base is hidden by it.
export function sortPeopleByFeet(shop) {
  const people = [
    shop.player?.sprite,
    shop.coop?.partner?.sprite,
    ...shop.customers.map((customer) => (customer.isDestroyed ? null : customer.sprite)),
    ...shop.employees.map((employee) => employee.sprite),
  ];
  for (const sprite of people) {
    if (sprite?.active) sprite.setDepth(PEOPLE_DEPTH_BASE + (sprite.body?.bottom ?? sprite.y));
  }
  syncPeopleVisibilityOutlines(shop, [
    shop.player?.sprite,
    shop.coop?.partner?.sprite,
    ...shop.employees.map((employee) => employee.isDestroyed ? null : employee.sprite),
  ]);
  // Tucked behind the counter, the register draws just over him and hides his legs.
  if (shop.checkoutSystem.registerDepthBeforeTuck != null && shop.player?.sprite) {
    shop.checkoutSystem.operatingRegisterFixture?.sprite?.setDepth(shop.player.sprite.depth + 0.5);
  }
}
