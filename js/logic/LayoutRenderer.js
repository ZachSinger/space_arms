import { getFixtureSpec } from "./FixtureLayout.js";

export class LayoutRenderer {
  static generateHTML(scene) {
    const enabled = scene.canRearrangeFixtures();
    return `
      <div class="fixture-stock-meta">Move existing fixtures while the store is closed.
        Stock stays on the fixture. Doors, access aisles, and the register queue must stay clear.</div>
      <p class="layout-save-status" data-save-status role="status"></p>
      <div class="retro-slot custom-scrollbar layout-fixture-list">
        ${scene.getFixtureLayout().map((entry) => `
          <div class="layout-fixture-row" data-fixture-row-id="${entry.id}">
            <span>${getFixtureSpec(entry.id).name} <small>(${entry.gx}, ${entry.gy})</small></span>
            <button type="button" class="action-btn" data-move-fixture-id="${entry.id}"
              ${enabled ? "" : "disabled"}>MOVE</button>
          </div>
        `).join("")}
      </div>
      <p class="fixture-stock-meta">${enabled
        ? "Choose MOVE, then click a green position on the shop floor. New fixture purchases come later."
        : "Rearranging is available before a shift or after all customers have left."}</p>
    `;
  }
}
