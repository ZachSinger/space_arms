// ==========================================
// FILE: DevBuilder.js
// ==========================================
// Shared tools for the DEV "Starting Template" and "Decorator Mode" areas: a side panel that
// adds, moves, and removes fixtures for free, and a shelf brush that fills any shelf space
// with any item straight from the shelf window.
import { database } from "../scenes/boot.js";
import { FIXTURE_TYPES } from "../logic/FixtureLayout.js";
import { sinkItems, sourceItems } from "../logic/InventoryTransfer.js";

const PANEL_STYLE = [
  "position:fixed", "right:12px", "top:84px", "z-index:50", "width:280px", "max-height:calc(100vh - 110px)",
  "overflow-y:auto", "padding:10px", "background:rgba(15,23,42,0.92)", "border:1px solid #38bdf8",
  "color:#e2e8f0", "font:13px monospace", "display:flex", "flex-direction:column", "gap:6px",
  "pointer-events:auto",
].join(";");

/** Fills shelf spaces with any item, for free, from the shelf window. */
export class ShelfBrush {
  /** @param {Phaser.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.picker = document.createElement("label");
    this.picker.className = "type-description";
    this.picker.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:6px";
    this.select = document.createElement("select");
    this.select.style.cssText = "flex:1;font:inherit;min-width:0";
    const groups = new Map();
    for (const item of [...database.getAllItems()].sort((a, b) => a.name.localeCompare(b.name))) {
      const group = item.tags?.[0] ?? "Other";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    }
    for (const [group, items] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group;
      for (const item of items) optgroup.append(new Option(item.name, item.id));
      this.select.append(optgroup);
    }
    this.picker.append("Fill with:", this.select);
  }

  /**
   * Left click fills the space to the top with the chosen item, replacing whatever was there.
   * Right click empties it.
   * @param {object} shelf
   * @param {number} gx
   * @param {number} gy
   * @param {boolean} empty
   * @returns {string} what happened, for the shelf window's status line
   */
  paint(shelf, gx, gy, empty) {
    const { gameState, eventBus } = this.scene;
    const existing = shelf.placements.find((entry) => entry.gx === gx && entry.gy === gy);
    if (existing) {
      if (existing.quantity > 0) {
        sinkItems(shelf, existing.itemId, existing.quantity, {
          sinkId: `dev-brush-${existing.id}`,
          sinkLocation: { kind: "dev-brush", slotId: existing.id },
          sourceEntry: existing,
          eventBus,
          sourceName: "shelf",
          sinkName: "dev brush",
        });
      }
      shelf.removeEmptyPlacement(existing);
    }
    let notice = "Emptied this space.";
    if (!empty) {
      const itemId = this.select.value;
      const placement = shelf.placeItem(itemId, gx, gy, false, 0);
      if (!placement) {
        notice = "That item doesn't fit in this space.";
      } else {
        sourceItems(shelf, itemId, shelf.getPlacementCapacity(placement), {
          sourceId: `dev-brush-${placement.id}`,
          sourceLocation: { kind: "dev-brush", slotId: placement.id },
          destinationEntry: placement,
          eventBus,
          sourceName: "dev brush",
          destinationName: "shelf",
        });
        gameState.catalog.priceIfUnset(itemId, gameState.market.getPrice(itemId));
        notice = `Filled with ${database.getItem(itemId).name}.`;
      }
    }
    this.scene.fixtureViews.refreshStockDisplay(shelf);
    gameState.shop.changed();
    return notice;
  }
}

/**
 * The fixture side panel. `extraHtml` goes above the fixture tools; the returned panel element
 * lets the caller wire its own buttons.
 * @param {Phaser.Scene} scene
 * @param {{ title: string, intro: string, extraHtml?: string }} options
 * @returns {{ panel: HTMLElement, destroy: () => void }}
 */
export function createBuilderPanel(scene, { title, intro, extraHtml = "" }) {
  scene.shelfBrush = new ShelfBrush(scene);
  const panel = document.createElement("div");
  panel.className = "sandbox-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", `${title} controls`);
  panel.style.cssText = PANEL_STYLE;
  const addButtons = Object.entries(FIXTURE_TYPES).map(([id, type]) =>
    `<button type="button" class="hud-pause-btn" data-add-fixture="${id}">${type.name}</button>`).join("");
  panel.innerHTML = `
    <strong style="color:#38bdf8">${title}</strong>
    <span>${intro}</span>
    ${extraHtml}
    <span>Add a fixture, then click the floor to put it down (R turns it):</span>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${addButtons}</div>
    <span>To stock a shelf, open it, choose an item at the top, and click a space. Right-click a space to empty it.</span>
    <span>In the shop:</span>
    <div data-fixture-list style="display:flex;flex-direction:column;gap:4px"></div>
  `;
  document.getElementById("ui-layer").appendChild(panel);
  const list = panel.querySelector("[data-fixture-list]");

  let shown = "";
  const refreshList = () => {
    const fixtures = scene.fixtures.fixtures;
    const signature = fixtures.map((fixture) => fixture.id).join(",");
    if (signature === shown) return;
    shown = signature;
    list.replaceChildren(...fixtures.map((fixture) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:4px;align-items:center";
      const name = document.createElement("span");
      name.style.flex = "1";
      name.textContent = scene.fixtures.displayName(fixture);
      row.append(name);
      for (const [label, attribute] of [["Move", "moveFixture"], ["Remove", "removeFixture"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hud-pause-btn";
        button.dataset[attribute] = fixture.id;
        button.textContent = label;
        row.append(button);
      }
      return row;
    }));
  };
  refreshList();
  const unsubscribe = scene.gameState.subscribe(refreshList);

  const onClick = (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const { addFixture, moveFixture, removeFixture } = button.dataset;
    if (addFixture) scene.fixturePlacement.beginFree(addFixture);
    else if (moveFixture) scene.fixturePlacement.begin(moveFixture);
    else if (removeFixture) scene.fixtureSystem.removeFree(removeFixture);
    button.blur();
  };
  panel.addEventListener("click", onClick);

  return {
    panel,
    destroy() {
      unsubscribe?.();
      panel.removeEventListener("click", onClick);
      panel.remove();
      scene.shelfBrush = null;
    },
  };
}
