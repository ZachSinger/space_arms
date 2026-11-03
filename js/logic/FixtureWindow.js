// ==========================================
// FILE: FixtureWindow.js
// ==========================================
import { UIWindow } from "./UIWindow.js";
import { FixtureRenderer } from "./FixtureRenderer.js";
import { ShelfFixture } from "./ShelfFixture.js";
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

// One shared window reused for whichever fixture the player currently has open (the shelf
// or a Storage Fixture) -- same idea as there only ever being one CheckoutWindow, just
// re-targeted/re-titled per open() call rather than one instance per fixture. Renders
// completely differently depending on which kind of fixture it's showing: a Storage
// Fixture is a flat capacity-pool bar + stock list (see ShopInventory.js); a sales shelf
// is a manual item-placement grid (see ShelfFixture.js) -- "fixture" here just means
// "whichever one the player is currently looking at."
export class FixtureWindow {
  constructor(windowManager, playerState) {
    this.playerState = playerState;

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

    // Shelf-only UI state -- which item (if any) the player is currently in the middle of
    // placing on the grid, and whether it's rotated. null means "not currently placing
    // anything" (the normal grid + placement-list view). Reset every time a different
    // fixture is opened (see openForFixture) so it never leaks between sessions.
    this.pickingItem = false;
    this.pendingPlacement = null;
    // The last empty grid cell the cursor was over during placement mode -- used both to
    // draw the hover preview and, on click, as the actual placement anchor (see
    // handleGridHover/handleClick). Tracking this ourselves rather than re-deriving it
    // from the click's own event.target matters because the preview itself can visually
    // cover several cells at once (a 2-wide item's preview spans 2 cells) -- clicking
    // anywhere on that preview has to still anchor the placement at its own top-left
    // cell, not whichever specific sub-cell happened to be directly under the pointer.
    this.hoveredCell = null;

    // Delegated (one listener for the whole body, not one per row/cell) since everything
    // gets fully re-rendered after each click -- see render().
    this.bodyElement.addEventListener("click", (event) => this.handleClick(event));
    this.bodyElement.addEventListener("mousemove", (event) => this.handleGridHover(event));
    this.bodyElement.addEventListener("mouseleave", () => this.clearPlacementPreview());
  }

  // Phaser's input manager listens for mousedown at the *window* level, not just on the
  // canvas -- so clicking a DOM button inside this very window (while standing near the
  // fixture it represents) also reaches the fixture sprite's own pointerdown handler and
  // calls this again, mid-click, for the fixture that's already open. A genuine no-op in
  // that case is essential, not just "reset less" -- re-rendering at all (even with
  // identical, preserved state) replaces the DOM node the real click was actually aimed
  // at mid-event, and the browser silently drops the "click" event entirely rather than
  // retargeting it, so the player's own click (e.g. ROTATE) would never even reach
  // handleClick(). Only actually do anything here when genuinely switching to a
  // different fixture, or opening fresh.
  openForFixture(fixture, title) {
    if (this.fixture === fixture && this.uiWindow.isOpen) return;

    this.fixture = fixture;
    this.titleElement.textContent = title;
    this.pickingItem = false;
    this.pendingPlacement = null;
    this.hoveredCell = null;
    this.render();
    this.uiWindow.openWindow();
  }

  isShelf() {
    return this.fixture instanceof ShelfFixture;
  }

  // The item's actual footprint right now, accounting for the current rotation state --
  // shared by the hover preview and the click-to-confirm handler so they always agree on
  // what "fits" means for the exact same pending item.
  getPendingFootprint() {
    const item = database.getItem(this.pendingPlacement.itemId);
    return this.pendingPlacement.rotated
      ? { w: item.dimensions.h, h: item.dimensions.w }
      : { w: item.dimensions.w, h: item.dimensions.h };
  }

  // Updates (creating it the first time) a preview block showing the item's own image at
  // its real w x h footprint, anchored at (gx, gy) -- green if it would actually fit
  // there, red if not (still shown, just so hovering an invalid spot gives feedback
  // instead of silently doing nothing). `pointer-events: none` (see CSS) is what lets
  // mousemove keep reporting the *underlying* empty cell while the cursor is visually
  // over this overlay instead of the overlay stealing hover from itself.
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

    // Clamped only for the visual span -- hovering near an edge with a footprint that
    // would run off the grid should still show (in red) rather than being clipped into
    // an implicit (and potentially oddly-sized) extra grid track.
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

  // Only relevant while actually choosing where to place something (see
  // handleClick's data-pick-item-id branch). Re-draws the preview only when the hovered
  // cell actually changes, not on every pixel of mouse movement within the same cell.
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

  handleClick(event) {
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

    // --- Shelf-only: picking what to place ---
    const addItemBtn = event.target.closest("[data-add-item]");
    if (addItemBtn) {
      this.pickingItem = true;
      this.render();
      return;
    }
    const backBtn = event.target.closest("[data-picker-back]");
    if (backBtn) {
      this.pickingItem = false;
      this.render();
      return;
    }
    const pickBtn = event.target.closest("[data-pick-item-id]");
    if (pickBtn) {
      this.pickingItem = false;
      this.pendingPlacement = { itemId: pickBtn.dataset.pickItemId, rotated: false };
      this.hoveredCell = null;
      this.render();
      return;
    }

    // --- Shelf-only: choosing where to place it ---
    const rotateBtn = event.target.closest("[data-rotate-placement]");
    if (rotateBtn) {
      this.pendingPlacement.rotated = !this.pendingPlacement.rotated;
      this.hoveredCell = null; // the old anchor may no longer fit at all once rotated
      this.render();
      return;
    }
    const cancelBtn = event.target.closest("[data-cancel-placement]");
    if (cancelBtn) {
      this.pendingPlacement = null;
      this.hoveredCell = null;
      this.render();
      return;
    }
    // Clicking anywhere on an empty cell (including the hover preview sitting on top of
    // it, thanks to pointer-events: none -- see showPlacementPreview) confirms placement
    // at whatever cell hover last anchored it to, not necessarily the literal cell under
    // the cursor at this exact pixel (the preview itself can span several cells).
    const gridCell = event.target.closest("[data-grid-cell]");
    if (gridCell && this.hoveredCell) {
      const { gx, gy } = this.hoveredCell;
      const { w, h } = this.getPendingFootprint();
      if (this.fixture.canPlaceAt(gx, gy, w, h)) {
        this.fixture.placeItem(this.pendingPlacement.itemId, gx, gy, this.pendingPlacement.rotated);
        this.pendingPlacement = null;
        this.hoveredCell = null;
        this.render();
      }
      return;
    }

    // --- Shelf-only: removing an empty (never-stocked) placement ---
    const removeCell = event.target.closest("[data-remove-placement-index]");
    if (removeCell) {
      const placement = this.fixture.placements[Number(removeCell.dataset.removePlacementIndex)];
      this.fixture.removePlacement(placement);
      this.render();
    }
  }

  // Moves exactly 1 unit of itemId from one capacity pool to another (fixture <-> player's
  // hovercart) -- always safe to call: remove() can't take more than `from` actually has,
  // and add() can't accept more than `to` actually has room for, so this never creates or
  // destroys units even if the buttons somehow get out of sync with capacity.
  transfer(from, to, itemId) {
    const removed = from.remove(itemId, 1);
    if (removed === 0) return;

    const accepted = to.add(itemId, removed);
    if (accepted < removed) from.add(itemId, removed - accepted); // put back what didn't fit

    this.render();
    this.playerState.notifyListeners(); // keeps the HUD's hovercart readout live
  }

  // Dispatches to the right renderer for whatever's currently open -- a Storage
  // Fixture's flat capacity bar/list, or a sales shelf's grid (either its normal view, or
  // mid-placement with the item picker/toolbar, depending on this window's own UI state).
  render() {
    if (this.isShelf()) {
      this.bodyElement.innerHTML = this.pickingItem
        ? FixtureRenderer.itemPickerHTML(database, this.playerState.hovercart)
        : FixtureRenderer.generateShelfHTML(
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

  // Called by GameScene right after a delivery into whichever fixture this window is
  // currently showing, so the capacity bar/stock list don't go stale while it's open.
  refresh(fixture) {
    if (this.fixture !== fixture || !this.uiWindow.isOpen) return;
    this.render();
  }
}
