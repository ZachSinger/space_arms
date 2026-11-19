// ==========================================
// FILE: ShopSave.js
// ==========================================
// The one path from a stored shop save to one the game can apply: upgrade it to the current
// format (state/migrations), then check the whole thing (state/checkShopSave.js).
import { upgradeShopSave } from "../state/migrations/index.js";
import { checkShopSave } from "../state/checkShopSave.js";

export { SHOP_LAYOUT_VERSION } from "../state/migrations/index.js";

/**
 * Upgrade and check a shop save; throws a readable error on anything malformed.
 * @param {object} data
 * @param {object} database - item and license lookup
 * @returns {object}
 */
export function validateShopSave(data, database) {
  return checkShopSave(upgradeShopSave(data, database), database);
}
