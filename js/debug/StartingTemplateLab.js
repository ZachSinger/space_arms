// ==========================================
// FILE: StartingTemplateLab.js
// ==========================================
// DEV "Starting Template": the shop exactly as a new game starts it. Arrange fixtures and
// shelf stock, set the starting money, and Snapshot writes it as the new game start
// (data/StartingTemplate.json, through the dev server). Nothing else here is saved.
import { createBuilderPanel } from "./DevBuilder.js";
import { saveStartingTemplate, startingMoney } from "../logic/StartingTemplate.js";

/**
 * @param {Phaser.Scene} scene - the game scene, started with { sandbox: true, lab: "template" }
 * @returns {{ noteGaveUp: () => void, destroy: () => void }}
 */
export function setupStartingTemplateLab(scene) {
  const builder = createBuilderPanel(scene, {
    title: "STARTING TEMPLATE",
    intro: "This is the shop a new game starts with. Snapshot makes every new game start like this.",
    extraHtml: `
      <label style="display:flex;gap:6px;align-items:center">Starting money:
        <input type="number" min="0" step="1" data-start-money value="${startingMoney()}"
          style="flex:1;min-width:0;font:inherit">
      </label>
      <button type="button" class="hud-pause-btn" data-snapshot>Snapshot</button>
      <span data-snapshot-status role="status"></span>`,
  });
  const { panel } = builder;
  const moneyInput = panel.querySelector("[data-start-money]");
  const status = panel.querySelector("[data-snapshot-status]");
  // Typing a number mustn't also walk the player or open menus.
  const stopKeys = (event) => event.stopPropagation();
  moneyInput.addEventListener("keydown", stopKeys);

  const snapshot = async () => {
    const money = moneyInput.value.trim() === "" ? NaN : Number(moneyInput.value);
    status.textContent = "Saving...";
    try {
      await saveStartingTemplate({ money, fixtures: scene.gameState.shop.toSave().fixtures });
      status.textContent = "Saved. New games now start like this.";
    } catch (error) {
      status.textContent = `Not saved: ${error.message}`;
    }
  };
  const onClick = (event) => {
    if (event.target.closest("[data-snapshot]")) snapshot();
  };
  panel.addEventListener("click", onClick);

  return {
    noteGaveUp() {},
    destroy() {
      moneyInput.removeEventListener("keydown", stopKeys);
      panel.removeEventListener("click", onClick);
      builder.destroy();
    },
  };
}
