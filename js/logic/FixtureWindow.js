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

    // Delegated (one listener for the whole body, not one per row/cell) since everything
    // gets fully re-rendered after each click -- see render().
    this.bodyElement.addEventListener("click", (event) => this.handleClick(event));
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
    this.render();
    this.uiWindow.openWindow();
  }

  isShelf() {
    return this.fixture instanceof ShelfFixture;
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
      this.render();
      return;
    }

    // --- Shelf-only: choosing where to place it ---
    const rotateBtn = event.target.closest("[data-rotate-placement]");
    if (rotateBtn) {
      this.pendingPlacement.rotated = !this.pendingPlacement.rotated;
      this.render();
      return;
    }
    const cancelBtn = event.target.closest("[data-cancel-placement]");
    if (cancelBtn) {
      this.pendingPlacement = null;
      this.render();
      return;
    }
    const placeCell = event.target.closest("[data-place-at]");
    if (placeCell) {
      const [gx, gy] = placeCell.dataset.placeAt.split(",").map(Number);
      this.fixture.placeItem(this.pendingPlacement.itemId, gx, gy, this.pendingPlacement.rotated);
      this.pendingPlacement = null;
      this.render();
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
