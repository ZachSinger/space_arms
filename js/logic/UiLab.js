// ==========================================
// FILE: UiLab.js
// ==========================================
// DEV "UI Lab": a throwaway shop for working on the game's real menus. It starts unlocked,
// with a couple of stocked shelves so menus have something to show, and nothing is saved.
// The panel opens the real windows directly, so any change made here is the in-game UI.
import { unlockEverything } from "./SandboxRoom.js";
import { getTabDefs } from "./ManagerTablet.js";

/**
 * @param {Phaser.Scene} scene - the game scene, started with { sandbox: true, lab: "ui" }
 * @returns {{ noteGaveUp: () => void, destroy: () => void }}
 */
export function setupUiLab(scene) {
  unlockEverything(scene);
  scene.debugQuickstart({ shelfCount: 2, itemCount: 8 });
  scene.gameState.shop.changed();

  const panel = document.createElement("div");
  panel.className = "sandbox-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "UI Lab controls");
  panel.style.cssText = [
    "position:fixed", "right:12px", "top:84px", "z-index:50", "width:260px",
    "padding:10px", "background:rgba(15,23,42,0.92)", "border:1px solid #38bdf8",
    "color:#e2e8f0", "font:13px monospace", "display:flex", "flex-direction:column", "gap:6px",
    "pointer-events:auto",
  ].join(";");
  const tabButtons = getTabDefs(scene).map(({ id, label }) =>
    `<button type="button" class="hud-pause-btn" data-tablet-tab="${id}">${label}</button>`).join("");
  panel.innerHTML = `
    <strong style="color:#38bdf8">UI LAB</strong>
    <span>Nothing here is saved.</span>
    <span>Manager's Tablet:</span>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${tabButtons}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button type="button" class="hud-pause-btn" data-send-customer>Send 1 customer</button>
    </div>
  `;
  document.getElementById("ui-layer").appendChild(panel);

  const onClick = (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.tabletTab) {
      scene.managerTablet.openWindow();
      scene.managerTablet.switchTab(button.dataset.tabletTab);
    } else if (button.hasAttribute("data-send-customer")) {
      if (!scene.hasRoomForCustomer()) scene.showShopMessage("The shop is full right now.");
      else scene.spawnCustomer(null);
    }
  };
  panel.addEventListener("click", onClick);

  return {
    noteGaveUp() {},
    destroy() {
      panel.removeEventListener("click", onClick);
      panel.remove();
    },
  };
}
