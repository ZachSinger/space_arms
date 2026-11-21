// =============================================================================
// FILE: Depth.js
// =============================================================================
// Draw-order layers shared by people and floor crates, and the per-frame people sort.
// =============================================================================

// People sort by feet position above this; the tallest map (about 6,800 pixels) stays below
// the 9,000+ layer used for speech bubbles, prompts, and gauges.
export const PEOPLE_DEPTH_BASE = 2000;

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
