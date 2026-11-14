// Close-up Budget Shelf view. It reads live placements; customers never use a separate copy.
import { UIWindow } from "./UIWindow.js";
import { database } from "../scenes/boot.js";
import { getFixtureType } from "./FixtureLayout.js";
import { getBudgetShelfArtForType } from "./BudgetShelfArt.js";
import { getShelfBoxes } from "./ShelfBoxLayout.js";
import { getItemCrateCategory } from "./CrateCategory.js";
import { moveShelfCrateItem } from "./LiveShelfStocking.js";
import { formatMoney } from "./Money.js";
import tilesetManifest from "../../data/TilesetManifest.json" with { type: "json" };
import { getInputDevice } from "./InputDevice.js";

const TEXTURE_PATHS = new Map(tilesetManifest.map(({ key, path }) => [key, path]));

function texturePath(key) {
  const path = TEXTURE_PATHS.get(key);
  if (!path) throw new Error(`Missing shelf texture path: ${key}`);
  return path;
}

export class ShelfStockingWindow {
  constructor(scene) {
    this.scene = scene;
    this.fixture = null;
    this.uiWindow = new UIWindow({
      id: "shelf-stocking-window", title: "SHELF",
      width: "min(900px, 94vw)", height: "auto", x: 30, y: 60,
      shouldCloseOtherWindows: true,
    }, scene.windowManager);
    this.body = this.uiWindow.element.querySelector(".retro-window-body");
    this.body.classList.add("shelf-stocking-body");
    this.hovered = null;
    this.uiWindow.onClose = () => {
      this.hovered = null;
      this.stopHolding();
      window.clearInterval(this.refreshTimer);
    };
    this.onRelease = () => this.stopHolding();
    this.onBlur = () => this.stopHolding();
    this.onKey = (event) => {
      if (this.uiWindow.isOpen && event.code === "KeyE" && !event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.uiWindow.close();
      }
    };
    document.addEventListener("pointerup", this.onRelease);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("keydown", this.onKey, true);
    this.body.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const cell = event.target.closest("[data-shelf-cell]");
      if (cell && getInputDevice() === "gamepad") {
        this.selected = Number(cell.dataset.shelfCell);
        if (this.clearIfSoldOut(this.selected)) return;
        this.holding = { index: this.selected, pull: true };
        this.moveOne();
        this.stopHolding();
      }
    });
    this.body.addEventListener("pointerdown", (event) => {
      const cell = event.target.closest("[data-shelf-cell]");
      if (!cell || ![0, 2].includes(event.button)) return;
      this.uiWindow.manager.focusWindow(this.uiWindow);
      event.preventDefault();
      this.stopHolding();
      this.selected = Number(cell.dataset.shelfCell);
      // Only a fresh right-click clears, so holding it to take the last item can't also clear.
      if (event.button === 2 && this.clearIfSoldOut(this.selected)) return;
      this.holding = { index: this.selected, pull: event.button === 2 };
      this.moveOne();
      if (this.holding) this.holdTimer = window.setInterval(() => this.moveOne(), 180);
    });
    this.body.addEventListener("pointerleave", () => this.stopHolding());
    this.body.addEventListener("pointerover", (event) => {
      const cell = event.target.closest("[data-shelf-cell]");
      if (cell && this.holding && Number(cell.dataset.shelfCell) !== this.holding.index) {
        this.stopHolding();
      }
    });
    // mouseover (not pointerover) so the controller cursor's fake hovers count too.
    this.body.addEventListener("mouseover", (event) => {
      const cell = event.target.closest("[data-shelf-cell]");
      this.hovered = cell ? Number(cell.dataset.shelfCell) : null;
    });
    this.body.addEventListener("mouseleave", () => { this.hovered = null; });
  }

  /**
   * The shelf space under the cursor, for the bottom bar: its item and how many are on it
   * (0 when sold out), or { empty: true } for a space with no item. Null when the cursor
   * isn't over a shelf space.
   * @returns {{ itemId: string, quantity: number } | { empty: true } | null}
   */
  getHoveredShelf() {
    if (!this.uiWindow.isOpen || this.hovered === null) return null;
    const placement = this.placementAt(this.hovered);
    return placement ? { itemId: placement.itemId, quantity: placement.quantity } : { empty: true };
  }

  // A sold-out space keeps its item, so customers still look for it there; clearing it frees
  // the space. Returns whether it cleared one.
  clearIfSoldOut(index) {
    const placement = this.placementAt(index);
    if (!placement || placement.quantity > 0) return false;
    this.fixture.removeEmptyPlacement(placement);
    this.notice = `Cleared the sold-out ${database.getItem(placement.itemId).name} space. Customers won't look for it there.`;
    this.scene.playerState.notifyListeners();
    this.refresh();
    return true;
  }

  openForFixture(fixture, title) {
    if (this.fixture === fixture && this.uiWindow.isOpen) return;
    this.stopHolding();
    window.clearInterval(this.refreshTimer);
    this.fixture = fixture;
    this.selected = null;
    this.hovered = null;
    this.notice = "";
    this.uiWindow.element.querySelector(".retro-window-title").textContent = title;
    const art = getBudgetShelfArtForType(getFixtureType(fixture.type));
    if (!art) throw new Error("Missing close-up shelf art.");
    this.art = art;
    this.body.replaceChildren();
    const hint = document.createElement("p");
    hint.textContent = getInputDevice() === "gamepad"
      ? "A: stock one from carried crates. X: take one into a crate, or clear a sold-out space. B: close."
      : "Hold left mouse: stock from carried crates. Hold right mouse: take into a crate. Right-click a sold-out space to clear it. E or Esc: close.";
    this.status = document.createElement("p");
    this.status.setAttribute("role", "status");
    this.stage = document.createElement("div");
    this.stage.className = "shelf-stocking-stage";
    this.stage.style.aspectRatio = `${art.width} / ${art.height}`;
    this.stage.style.width = `min(100%, calc((100vh - 370px) * ${art.width / art.height}))`;
    const shelf = document.createElement("img");
    shelf.src = texturePath(getFixtureType(fixture.type).facingTextures.down);
    shelf.alt = "";
    shelf.className = "shelf-stocking-art";
    this.stage.appendChild(shelf);
    this.cells = [];
    for (let gy = 0; gy < art.rows.length; gy++) {
      for (let gx = 0; gx < art.columns.length; gx++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.dataset.shelfCell = this.cells.length;
        cell.className = "shelf-stocking-cell";
        const [left, right] = art.columns[gx];
        const [top, bottom] = art.rows[gy];
        Object.assign(cell.style, {
          left: `${left / art.width * 100}%`, top: `${top / art.height * 100}%`,
          width: `${(right - left) / art.width * 100}%`, height: `${(bottom - top) / art.height * 100}%`,
        });
        cell.addEventListener("click", (event) => {
          if (event.detail !== 0) return;
          this.selected = Number(cell.dataset.shelfCell);
          this.holding = { index: this.selected, pull: false };
          this.moveOne();
          this.stopHolding();
        });
        this.cells.push(cell);
        this.stage.appendChild(cell);
      }
    }
    this.card = document.createElement("button");
    this.card.className = "shelf-stocking-card";
    this.card.title = "Set this item's price in the Manager's Tablet";
    this.card.addEventListener("click", () => {
      const placement = this.selectedPlacement();
      if (!placement) return;
      this.uiWindow.close();
      this.scene.managerTablet.openForItem(placement.itemId);
    });
    this.body.append(hint, this.status, this.stage, this.card);
    this.uiWindow.openWindow();
    this.refresh();
    this.refreshTimer = window.setInterval(() => this.refresh(), 100);
  }

  selectedPlacement() {
    return this.placementAt(this.selected);
  }

  placementAt(index) {
    if (index === null || index === undefined) return null;
    const gx = index % this.art.columns.length;
    const gy = Math.floor(index / this.art.columns.length);
    return this.fixture.placements.find((entry) => entry.gx === gx && entry.gy === gy);
  }

  moveOne() {
    if (!this.holding || !this.uiWindow.isOpen ||
      !this.uiWindow.element.classList.contains("active")) {
      this.stopHolding();
      return;
    }
    const { index, pull } = this.holding;
    const result = moveShelfCrateItem(this.fixture, this.scene.getCarriedCrates(),
      index % this.art.columns.length, Math.floor(index / this.art.columns.length), pull, this.scene.eventBus);
    this.notice = result.reservedFor
      ? `This space is saved for ${database.getItem(result.reservedFor).name}, which is sold out. ` +
        `To put something else here, ${getInputDevice() === "gamepad" ? "press X on" : "right-click"} the space to clear it first.`
      : result.message;
    if (!result.moved) this.stopHolding();
    else this.scene.playerState.notifyListeners();
    this.refresh();
  }

  refresh() {
    if (!this.uiWindow.isOpen) return;
    const crates = this.scene.getCarriedCrates().filter((crate) => crate.kind === "item");
    this.status.textContent = this.notice || (crates.length
      ? `Carrying: ${crates.map((crate) => crate.quantity > 0
        ? `${database.getItem(crate.itemId).name} (${crate.quantity})` : "Empty crate").join(" | ")}`
      : "Carry a crate to stock this shelf or take items off it.");
    for (let index = 0; index < this.cells.length; index++) {
      const cell = this.cells[index];
      const placement = this.placementAt(index);
      const signature = placement ? `${placement.itemId}:${placement.quantity}` : "";
      cell.classList.toggle("selected", index === this.selected);
      if (cell.dataset.stock === signature) continue;
      cell.dataset.stock = signature;
      cell.replaceChildren();
      const item = placement && database.getItem(placement.itemId);
      cell.setAttribute("aria-label", item
        ? `${item.name}: ${placement.quantity} of ${this.fixture.getPlacementCapacity(placement)}`
        : "Empty shelf space");
      if (!item) continue;
      const gx = index % this.art.columns.length;
      const gy = Math.floor(index / this.art.columns.length);
      const [left, right] = this.art.columns[gx];
      const [top, bottom] = this.art.rows[gy];
      const category = getItemCrateCategory(item.tags);
      for (const box of getShelfBoxes(this.art, gx, gy, item.boxSize, placement.quantity)) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = texturePath(`shelf_box_${category}`);
        Object.assign(image.style, {
          left: `${(box.x - left) / (right - left) * 100}%`,
          top: `${(box.y - top) / (bottom - top) * 100}%`,
          width: `${box.width / (right - left) * 100}%`,
          height: `${box.height / (bottom - top) * 100}%`,
          filter: box.back ? "brightness(0.55)" : "",
          zIndex: String(Math.round(box.depth * 100)),
        });
        cell.appendChild(image);
      }
    }
    const placement = this.selectedPlacement();
    this.card.hidden = !placement || placement.quantity === 0;
    if (placement) {
      this.card.textContent = `${database.getItem(placement.itemId).name}\nPrice: ${
        formatMoney(this.scene.getStorePrice(placement.itemId)).replace(/ credits$/, "")
      }\nQuantity: ${placement.quantity}`;
    }
  }

  stopHolding() {
    window.clearInterval(this.holdTimer);
    this.holding = null;
  }

  destroy() {
    this.stopHolding();
    window.clearInterval(this.refreshTimer);
    document.removeEventListener("pointerup", this.onRelease);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("keydown", this.onKey, true);
  }
}
