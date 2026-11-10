// ==========================================
// FILE: FixtureWindow.js
// ==========================================
// The DOM window for whichever fixture the player has open: a Storage Fixture's capacity
// bar + stock list, or a sales shelf's manual item-placement grid (click, drag, rotate).
// See also: FixtureRenderer.js (the HTML), ShelfFixture.js (the grid rules).

import { UIWindow } from "./UIWindow.js";
import { FixtureRenderer } from "./FixtureRenderer.js";
import { ShelfFixture } from "./ShelfFixture.js";
import { transferItems } from "./InventoryTransfer.js";
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

// Mouse travel (px) while held on a shelf placement before it's a drag (move the stack)
// rather than a click (stock 1 into it).
const DRAG_THRESHOLD_PX = 6;

/**
 * Short floating message at the cursor (e.g. "No Space In Hovercart").
 * @param {number} x - client px
 * @param {number} y - client px
 * @param {string} text
 */
export function showPopupText(x, y, text) {
  const popup = document.createElement("div");
  popup.className = "fixture-popup-text";
  popup.textContent = text;
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  document.body.appendChild(popup);
  popup.addEventListener("animationend", () => popup.remove());
}

/**
 * One shared window, re-targeted and re-titled for each fixture opened.
 * Owns the shelf placement UI state (pending placement, drag).
 */
export class FixtureWindow {
  constructor(windowManager, playerState, eventBus = null) {
    this.playerState = playerState;
    this.eventBus = eventBus;

    this.uiWindow = new UIWindow(
      {
        id: "fixture-window",
        title: "FIXTURE",
        contentHTML: "",
        width: "30vw",
        height: "62vh",
        x: 24,
        y: 120,
      },
      windowManager,
    );
    this.bodyElement = this.uiWindow.element.querySelector(".retro-window-body");
    this.titleElement = this.uiWindow.element.querySelector(".retro-window-title");
    this.fixture = null;

    // Shelf-only: the item being placed and its rotation; null when not placing.
    this.pendingPlacement = null;
    // Placement anchor, tracked from hover rather than the click target because the
    // preview can span several cells and must still anchor at its top-left one.
    this.hoveredCell = null;

    // Delegated, since the body is fully re-rendered after each click.
    this.bodyElement.addEventListener("click", (event) => this.handleClick(event));
    this.bodyElement.addEventListener("contextmenu", (event) => this.handleContextMenu(event));
    this.bodyElement.addEventListener("mousedown", (event) => this.handleMouseDown(event));
    this.bodyElement.addEventListener("mousemove", (event) => {
      if (!this.handleDragMove(event)) this.handleGridHover(event);
      this.updateItemTooltip(event);
    });
    this.bodyElement.addEventListener("mouseleave", () => {
      this.clearPlacementPreview();
      this.hideItemTooltip();
    });
    this.tooltip = document.createElement("div");
    this.tooltip.className = "fixture-item-tooltip";
    this.tooltip.hidden = true;
    document.body.appendChild(this.tooltip);
    // On document so releasing a drag outside the window still ends it cleanly.
    this.handleDocumentMouseUp = (event) => this.handleMouseUp(event);
    document.addEventListener("mouseup", this.handleDocumentMouseUp);
    // Capture phase on window, so Esc cancels placement before WindowManager closes the window.
    this.handlePlacementKey = (event) => this.handlePlacementKeyDown(event);
    window.addEventListener("keydown", this.handlePlacementKey, true);
    this.dragStart = null;
    this.isDragging = false;
    this.suppressClick = false;

    // Closing mid-move must put the lifted stack back where it came from, or it'd vanish.
    this.uiWindow.onClose = () => {
      this.cancelPendingPlacement();
      this.hideItemTooltip();
    };
  }

  destroy() {
    this.cancelPendingPlacement();
    document.removeEventListener("mouseup", this.handleDocumentMouseUp);
    window.removeEventListener("keydown", this.handlePlacementKey, true);
    this.tooltip.remove();
  }

  /**
   * While placing on a shelf: R turns the item, Esc cancels placing (the window stays open).
   * @param {KeyboardEvent} event
   */
  handlePlacementKeyDown(event) {
    if (!this.pendingPlacement || !this.uiWindow.isOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.cancelPendingPlacement();
      this.render();
    } else if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      this.rotatePendingPlacement();
    }
  }

  rotatePendingPlacement() {
    this.pendingPlacement.rotated = !this.pendingPlacement.rotated;
    const hovered = this.hoveredCell;
    this.render();
    // Keep the preview under the cursor, now turned.
    if (hovered) {
      this.hoveredCell = hovered;
      this.showPlacementPreview(hovered.gx, hovered.gy);
    }
  }

  // --- Item tooltip ---

  /**
   * Floating name card for whichever shelf placement is under the cursor. Lives on
   * document.body because the window body is re-rendered on every click.
   * @param {MouseEvent} event
   */
  updateItemTooltip(event) {
    const cell = this.isShelf() && !this.pendingPlacement && !this.isDragging
      ? event.target.closest("[data-placement-index]")
      : null;
    const placement = cell && this.fixture.placements[Number(cell.dataset.placementIndex)];
    const item = placement && database.getItem(placement.itemId);
    if (!item) {
      this.hideItemTooltip();
      return;
    }

    const capacity = this.fixture.getPlacementCapacity(placement);
    const rightClick = placement.quantity <= 0 ? "remove empty slot" : "take 1";
    this.tooltip.replaceChildren(
      Object.assign(document.createElement("div"), { className: "fixture-item-tooltip-name", textContent: item.name }),
      Object.assign(document.createElement("div"), { textContent: `On shelf: ${placement.quantity} / ${capacity}` }),
      Object.assign(document.createElement("div"), {
        className: "fixture-item-tooltip-hint",
        textContent: `Click: stock 1 · Drag: move · Right-click: ${rightClick}`,
      }),
    );
    this.tooltip.hidden = false;
    const margin = 16;
    const { offsetWidth: width, offsetHeight: height } = this.tooltip;
    const left = Math.min(event.clientX + margin, window.innerWidth - width - 4);
    const top = event.clientY + margin + height > window.innerHeight
      ? event.clientY - margin - height
      : event.clientY + margin;
    this.tooltip.style.left = `${Math.max(4, left)}px`;
    this.tooltip.style.top = `${Math.max(4, top)}px`;
  }

  hideItemTooltip() {
    this.tooltip.hidden = true;
  }

  // --- Opening and placement mode ---

  // Abandons whatever placement mode is active. A brand new placement just evaporates
  // (nothing was taken from the hovercart yet); a moved stack goes back to its origin.
  cancelPendingPlacement() {
    const moving = this.pendingPlacement?.moving;
    if (moving && this.fixture) {
      const { gx, gy, rotated } = this.pendingPlacement.origin;
      this.fixture.attachPlacement(moving, gx, gy, rotated);
    }
    this.pendingPlacement = null;
    this.hoveredCell = null;
    if (moving) this.playerState.notifyListeners();
  }

  /**
   * Right-click a shelf placement: pull 1 unit into the hovercart. Right-clicking a slot
   * that's already empty removes the slot itself (the only way a slot is ever removed).
   * @param {MouseEvent} event
   */
  handleContextMenu(event) {
    if (!this.isShelf()) return;
    const cell = event.target.closest("[data-placement-index]");
    if (!cell) return;
    event.preventDefault();

    const placement = this.fixture.placements[Number(cell.dataset.placementIndex)];
    if (!placement) return;

    if (placement.quantity <= 0) {
      if (this.fixture.removeEmptyPlacement(placement)) {
        this.render();
        this.playerState.notifyListeners();
      }
      return;
    }

    const hovercart = this.playerState.hovercart;
    const result = transferItems(this.fixture, hovercart, placement.itemId, 1, {
      sourceEntry: placement,
      eventBus: this.eventBus,
      sourceName: "shelf",
      destinationName: "hovercart",
    });
    if (result.moved === 0 && result.reason === "destination-full") {
      this.showPopupText(event.clientX, event.clientY, "No Space In Hovercart");
      return;
    }
    if (result.moved === 0) return;

    this.render();
    this.playerState.notifyListeners();
  }

  showPopupText(x, y, text) {
    showPopupText(x, y, text);
  }

  /**
   * Phaser listens for mousedown at the window level, so clicking a button in this window
   * re-calls this for the already-open fixture. That must be a true no-op: re-rendering
   * mid-click replaces the clicked node and the browser drops the click.
   * @param {object} fixture - a ShelfFixture or Storage Fixture
   * @param {string} title
   */
  openForFixture(fixture, title) {
    if (this.fixture === fixture && this.uiWindow.isOpen) return;

    this.cancelPendingPlacement(); // restores a mid-move stack to the fixture it came from
    this.fixture = fixture;
    this.titleElement.textContent = title;
    this.render();
    this.uiWindow.openWindow();
  }

  isShelf() {
    return this.fixture instanceof ShelfFixture;
  }

  // The pending item's rotated footprint; shared by preview and confirm so they agree on fit.
  getPendingFootprint() {
    const item = database.getItem(this.pendingPlacement.itemId);
    return this.pendingPlacement.rotated
      ? { w: item.dimensions.h, h: item.dimensions.w }
      : { w: item.dimensions.w, h: item.dimensions.h };
  }

  /**
   * Draw the pending item at its real footprint: green if it fits, red if not. The CSS
   * `pointer-events: none` keeps hover reporting the empty cell underneath.
   * @param {number} gx - grid column
   * @param {number} gy - grid row
   */
  showPlacementPreview(gx, gy) {
    const { w, h } = this.getPendingFootprint();
    const isValid = this.fixture.canPlaceAt(gx, gy, w, h);
    const item = database.getItem(this.pendingPlacement.itemId);

    const grid = this.bodyElement.querySelector(".fixture-placement-grid");
    if (!grid) return;

    let preview = grid.querySelector(".fixture-placement-preview");
    if (!preview) {
      preview = document.createElement("div");
      preview.className = "fixture-cell fixture-placement-preview";
      preview.innerHTML = `<img class="fixture-cell-image" alt="" />`;
      grid.appendChild(preview);
    }

    // Clamp only the visual span so an off-grid footprint shows in red instead of
    // creating implicit extra grid tracks.
    const { w: gridW, h: gridH } = this.fixture.displayGrid;
    const visualW = Math.min(w, gridW - gx);
    const visualH = Math.min(h, gridH - gy);
    preview.style.gridColumn = `${gx + 1} / span ${visualW}`;
    preview.style.gridRow = `${gy + 1} / span ${visualH}`;
    preview.classList.toggle("fixture-placement-preview-valid", isValid);
    preview.classList.toggle("fixture-placement-preview-invalid", !isValid);

    const img = preview.querySelector("img");
    if (item.image) img.src = item.image;
  }

  clearPlacementPreview() {
    this.hoveredCell = null;
    this.bodyElement.querySelector(".fixture-placement-preview")?.remove();
  }

  /**
   * During placement mode, redraw the preview only when the hovered cell changes.
   * @param {MouseEvent} event
   */
  handleGridHover(event) {
    if (!this.isShelf() || !this.pendingPlacement) return;

    const cell = event.target.closest("[data-grid-cell]");
    if (!cell) {
      this.clearPlacementPreview();
      return;
    }

    const [gx, gy] = cell.dataset.gridCell.split(",").map(Number);
    if (this.hoveredCell?.gx === gx && this.hoveredCell?.gy === gy) return;

    this.hoveredCell = { gx, gy };
    this.showPlacementPreview(gx, gy);
  }

  // --- Clicks ---

  handleClick(event) {
    if (this.suppressClick) return;

    // --- Shared: fixture <-> hovercart stock transfers ---
    const takeBtn = event.target.closest("[data-take-item-id]");
    if (takeBtn) {
      this.transfer(this.fixture, this.playerState.hovercart, takeBtn.dataset.takeItemId);
      return;
    }
    const depositBtn = event.target.closest("[data-deposit-item-id]");
    if (depositBtn) {
      this.transfer(this.playerState.hovercart, this.fixture, depositBtn.dataset.depositItemId);
      return;
    }

    if (!this.isShelf()) return;

    // --- Shelf-only: clicking a hovercart item starts placing it ---
    const pickBtn = event.target.closest("[data-pick-item-id]");
    if (pickBtn) {
      if (this.fixture.getPlacementCapacity({ itemId: pickBtn.dataset.pickItemId }) < 1) {
        this.showPopupText(event.clientX, event.clientY, "Too Bulky For This Shelf");
        return;
      }
      this.pendingPlacement = { itemId: pickBtn.dataset.pickItemId, rotated: false };
      this.hoveredCell = null;
      this.render();
      return;
    }

    // --- Shelf-only: choosing where to place it (R turns it, Esc cancels) ---
    // Confirms at the hover anchor, not the literal cell under the cursor (the preview
    // can span several cells).
    const gridCell = event.target.closest("[data-grid-cell]");
    if (gridCell && this.hoveredCell) {
      this.confirmPlacement();
      return;
    }

    // --- Shelf-only: left-click a placement to stock 1 unit into it from the hovercart ---
    const placementCell = event.target.closest("[data-placement-index]");
    if (placementCell && !this.pendingPlacement) {
      const placement = this.fixture.placements[Number(placementCell.dataset.placementIndex)];
      if (placement) this.stockPlacement(placement, event);
    }
  }

  // Places/drops the pending item at hoveredCell if it fits there. Returns whether it did.
  confirmPlacement() {
    if (!this.pendingPlacement || !this.hoveredCell) return false;
    const { gx, gy } = this.hoveredCell;
    const { w, h } = this.getPendingFootprint();
    if (!this.fixture.canPlaceAt(gx, gy, w, h)) return false;

    const { itemId, rotated, moving } = this.pendingPlacement;
    if (moving) {
      this.fixture.attachPlacement(moving, gx, gy, rotated);
    } else {
      const placement = this.fixture.placeItem(itemId, gx, gy, rotated, 0);
      if (placement) {
        const result = transferItems(this.playerState.hovercart, this.fixture, itemId, 1, {
          destinationEntry: placement,
          eventBus: this.eventBus,
          sourceName: "hovercart",
          destinationName: "shelf",
        });
        if (result.moved === 0) this.fixture.removeEmptyPlacement(placement);
        else this.playerState.notifyListeners();
      }
    }
    this.pendingPlacement = null;
    this.hoveredCell = null;
    this.render();
    if (moving) this.playerState.notifyListeners();
    return true;
  }

  /**
   * Move 1 unit from the hovercart into this placement, if there's stock and room.
   * @param {object} placement
   * @param {MouseEvent} event - for popup position
   */
  stockPlacement(placement, event) {
    const result = transferItems(
      this.playerState.hovercart,
      this.fixture,
      placement.itemId,
      1,
      {
        destinationEntry: placement,
        eventBus: this.eventBus,
        sourceName: "hovercart",
        destinationName: "shelf",
      },
    );
    if (result.moved === 0 && result.reason === "source-empty") {
      this.showPopupText(event.clientX, event.clientY, "None In Hovercart");
      return;
    }
    if (result.moved === 0 && result.reason === "destination-full") {
      this.showPopupText(event.clientX, event.clientY, "Slot Full");
      return;
    }
    if (result.moved === 0) return;
    this.render();
    this.playerState.notifyListeners();
  }

  // --- Dragging placements ---

  /**
   * Shelf-only: start a possible drag that lifts a placement's whole stack into move mode.
   * Releasing over a valid cell drops it; elsewhere it stays in move mode.
   * @param {MouseEvent} event
   */
  handleMouseDown(event) {
    if (!this.isShelf() || event.button !== 0 || this.pendingPlacement) return;
    const cell = event.target.closest("[data-placement-index]");
    if (!cell) return;
    event.preventDefault(); // stops the browser's own image ghost-drag
    this.dragStart = { x: event.clientX, y: event.clientY, index: Number(cell.dataset.placementIndex) };
  }

  /**
   * @param {MouseEvent} event
   * @returns {boolean} true if a press is in progress, so hover handling should be skipped
   */
  handleDragMove(event) {
    if (!this.dragStart) return false;
    const dx = event.clientX - this.dragStart.x;
    const dy = event.clientY - this.dragStart.y;
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return true;

    const placement = this.fixture.placements[this.dragStart.index];
    this.dragStart = null;
    if (!placement) return true;
    this.isDragging = true;
    this.beginMove(placement);
    return true;
  }

  handleMouseUp(event) {
    this.dragStart = null; // a press with no real movement is just a click (see handleClick)
    if (!this.isDragging) return;
    this.isDragging = false;

    // The release also fires a click; it mustn't be read as "stock 1" or "place here".
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 0);

    if (this.bodyElement.contains(event.target) && event.target.closest("[data-grid-cell]")) {
      this.confirmPlacement();
    }
  }

  /**
   * Detach a placement from the grid into move mode, remembering where to restore it.
   * @param {object} placement
   */
  beginMove(placement) {
    this.fixture.detachPlacement(placement);
    this.pendingPlacement = {
      itemId: placement.itemId,
      rotated: placement.rotated,
      moving: placement,
      origin: { gx: placement.gx, gy: placement.gy, rotated: placement.rotated },
    };
    this.hoveredCell = null;
    this.render();
    this.playerState.notifyListeners();
  }

  // --- Transfers and rendering ---

  /**
   * Move 1 unit between capacity pools (fixture <-> hovercart). Never creates or destroys
   * units, even if the buttons get out of sync with capacity.
   * @param {object} from
   * @param {object} to
   * @param {string} itemId
   */
  transfer(from, to, itemId) {
    const containerName = (container) => {
      if (container === this.playerState.hovercart) return "hovercart";
      if (container === this.fixture) return this.isShelf() ? "shelf" : "locker";
      return "fixture";
    };
    const result = transferItems(from, to, itemId, 1, {
      eventBus: this.eventBus,
      sourceName: containerName(from),
      destinationName: containerName(to),
    });
    if (result.moved === 0) return;

    this.render();
    this.playerState.notifyListeners(); // keeps the HUD's hovercart readout live
  }

  // Storage bar/list or shelf grid, depending on fixture and UI state.
  render() {
    if (this.isShelf()) {
      this.bodyElement.innerHTML = FixtureRenderer.generateShelfHTML(
        this.fixture,
        this.playerState.hovercart,
        database,
        this.pendingPlacement,
      );
    } else {
      this.bodyElement.innerHTML = FixtureRenderer.generateStorageHTML(
        this.fixture,
        this.playerState.hovercart,
        database,
      );
    }
  }

  /**
   * Re-render if this fixture is the one open, e.g. after a delivery into it.
   * @param {object} fixture
   */
  refresh(fixture) {
    if (this.fixture !== fixture || !this.uiWindow.isOpen) return;
    this.render();
  }
}
