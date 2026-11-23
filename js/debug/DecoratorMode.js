// ==========================================
// FILE: DecoratorMode.js
// ==========================================
// DEV "Decorator Mode": a top-level shop with every license and money that never runs out,
// for trying out store looks. Buy expansions and anything else from the tablet as usual, or
// put fixtures and shelf stock straight down with the panel. Nothing here is saved.
import { database } from "../scenes/boot.js";
import { SHOP_LEVEL_TIERS } from "../logic/ShopProgression.js";
import { createBuilderPanel } from "./DevBuilder.js";

const BOTTOMLESS_MONEY = 1000000;

/**
 * @param {Phaser.Scene} scene - the game scene, started with { sandbox: true, lab: "decorator" }
 * @returns {{ noteGaveUp: () => void, destroy: () => void }}
 */
export function setupDecoratorMode(scene) {
  const { gameState } = scene;
  gameState.reputation.setShopLevel(SHOP_LEVEL_TIERS[SHOP_LEVEL_TIERS.length - 1].level);
  for (const license of database.getAllLicenses()) gameState.catalog.sign(license.id);
  scene.catalogSystem.recalculateActiveFactions();
  const topUp = () => {
    const missing = Math.round((BOTTOMLESS_MONEY - gameState.economy.credits) * 100) / 100;
    if (missing > 0) gameState.economy.add(missing, { category: "loans", label: "Decorator money" });
  };
  const unsubscribe = gameState.subscribe(topUp);

  const builder = createBuilderPanel(scene, {
    title: "DECORATOR MODE",
    intro: "Money never runs out and every license is signed. Buy expansions from the tablet. Nothing here is saved.",
  });

  return {
    noteGaveUp() {},
    destroy() {
      unsubscribe();
      builder.destroy();
    },
  };
}
