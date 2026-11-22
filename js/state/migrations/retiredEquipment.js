// Upgrade step: equipment that was taken out of the game is removed from older saves.
import { isMoney, roundMoney } from "../../logic/Money.js";
import { isRecord } from "../saveHelpers.js";

// Equipment that was taken out of the game, with what the player paid for it. Older saves
// get those credits back, and any stock that was on it goes to the Go-Backs bin.
const RETIRED_SHELF_PRICES = Object.freeze({
  shelf_budget_2x5: 375, shelf_budget_2x6: 450, shelf_starter_2x1: 300, shelf_universal: 2000,
  shelf_showcase: 800, shelf_bulk: 2200, shelf_armory: 3500,
});
const RETIRED_FIXTURE_PRICES = Object.freeze({
  ...RETIRED_SHELF_PRICES,
  locker_single: 180,
  locker_double: 1200,
  locker_secure: 2200,
  mop_bucket: 40,
});
const RETIRED_LICENSE_PRICES = Object.freeze({
  lic_fixture_expanded: 750, lic_fixture_premium_shelf: 600,
  lic_fixture_bulk_display: 1500, lic_fixture_armory_display: 2400,
  lic_fixture_storage_bank: 1000, lic_fixture_secure_storage: 1800,
});
// The hovercart started at 10 or 15 spaces; each 5 spaces past 15 was a paid upgrade.
const RETIRED_HOVERCART_UPGRADE_PRICES = Object.freeze({ 20: 200, 25: 300, 30: 400, 35: 500, 40: 600 });

function isRetiredFixtureCrate(crate) {
  return isRecord(crate) && crate.kind === "fixture" && Object.hasOwn(RETIRED_FIXTURE_PRICES, crate.typeId);
}

/**
 * Removes retired fixtures (placed or still in their crates), retired supplier contracts, and
 * the hovercart from an older save: refunds what they cost and sends their stock to Go-Backs.
 * @param {object} data
 * @returns {object}
 */
export function retireRemovedEquipment(data) {
  const player = data.playerState;
  if (!isRecord(player)) return data;
  let refund = 0;
  const goBacks = new Map();
  const addToGoBacks = (entry) => {
    if (!isRecord(entry) || !(entry.quantity > 0)) return;
    goBacks.set(entry.itemId, (goBacks.get(entry.itemId) ?? 0) + entry.quantity);
  };

  const fixtures = data.fixtures.filter((entry) => {
    if (!Object.hasOwn(RETIRED_FIXTURE_PRICES, entry?.type)) return true;
    refund += RETIRED_FIXTURE_PRICES[entry.type];
    (Array.isArray(entry.placements) ? entry.placements : []).forEach(addToGoBacks);
    (Array.isArray(entry.stock) ? entry.stock : []).forEach(addToGoBacks);
    return false;
  });
  let crates = data.crates;
  if (Array.isArray(crates)) {
    crates = crates.filter((crate) => {
      if (!isRetiredFixtureCrate(crate)) return true;
      refund += RETIRED_FIXTURE_PRICES[crate.typeId];
      return false;
    });
  }
  let { carriedCrate, carriedCrates } = data;
  // Fixture crates are always carried alone.
  if (isRetiredFixtureCrate(carriedCrate)) {
    refund += RETIRED_FIXTURE_PRICES[carriedCrate.typeId];
    carriedCrate = null;
    if (carriedCrates !== undefined) carriedCrates = [];
  }
  let activeLicenses = player.activeLicenses;
  if (Array.isArray(activeLicenses)) {
    activeLicenses = activeLicenses.filter((id) => {
      if (!Object.hasOwn(RETIRED_LICENSE_PRICES, id)) return true;
      refund += RETIRED_LICENSE_PRICES[id];
      return false;
    });
  }
  const { hovercart, ...rest } = player;
  if (isRecord(hovercart)) {
    (Array.isArray(hovercart.stock) ? hovercart.stock : []).forEach(addToGoBacks);
    for (const [capacity, price] of Object.entries(RETIRED_HOVERCART_UPGRADE_PRICES)) {
      if (Number(capacity) <= hovercart.capacity) refund += price;
    }
  }
  if (!refund && !goBacks.size && hovercart === undefined) return data;

  for (const entry of Array.isArray(player.goBacks) ? player.goBacks : []) addToGoBacks(entry);
  return {
    ...data,
    fixtures,
    crates,
    carriedCrate,
    ...(carriedCrates !== undefined ? { carriedCrates } : {}),
    playerState: {
      ...rest,
      activeLicenses,
      credits: isMoney(player.credits) ? roundMoney(player.credits + refund) : player.credits,
      goBacks: [...goBacks].map(([itemId, quantity]) => ({ itemId, quantity })),
    },
  };
}
