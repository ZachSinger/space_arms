// =============================================================================
// FILE: Depth.js
// =============================================================================
// Draw-order layers shared by people and floor crates, and the per-frame people sort.
// =============================================================================

// People sort by feet position above this; the tallest map (about 6,800 pixels) stays below
// the 9,000+ layer used for speech bubbles, prompts, and gauges.
export const PEOPLE_DEPTH_BASE = 2000;

// Fixtures sort among themselves by the bottom of their solid base, so a lower fixture (such
// as a down-facing shelf backed against an up-facing one) covers the one behind it. They stay
// above walls and the sliding door (1.5) and under thrown crates (2). A shelf's stock and
// facing light sit just over their own shelf; bases snap 8 pixels apart, which leaves room.
const FIXTURE_DEPTH_BASE = 1.6;
const FIXTURE_DEPTH_PER_PIXEL = 1 / 20000;
export const FIXTURE_STOCK_DEPTH_OFFSET = 0.0001;
export const FIXTURE_LIGHT_DEPTH_OFFSET = 0.0002;

export function fixtureDepth(baseBottomPx) {
  return FIXTURE_DEPTH_BASE + baseBottomPx * FIXTURE_DEPTH_PER_PIXEL;
}

// People (player, customers, staff) are drawn lower-on-screen in front: a customer walking
// down past someone passes behind them. Everyone stays above shelves and floor crates.
export function sortPeopleByFeet(shop) {
  const people = [
    shop.player?.sprite,
    ...shop.customers.map((customer) => (customer.isDestroyed ? null : customer.sprite)),
    ...shop.employees.map((employee) => employee.sprite),
  ];
  for (const sprite of people) {
    if (sprite?.active) sprite.setDepth(PEOPLE_DEPTH_BASE + (sprite.body?.bottom ?? sprite.y));
  }
  // Tucked behind the counter, the register draws just over him and hides his legs.
  if (shop.checkoutSystem.registerDepthBeforeTuck != null && shop.player?.sprite) {
    shop.checkoutSystem.operatingRegisterFixture?.sprite?.setDepth(shop.player.sprite.depth + 0.5);
  }
}
