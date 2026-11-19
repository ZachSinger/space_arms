// Close-up Budget Shelf view. It reads live placements; customers never use a separate copy.
import { UIWindow } from "./UIWindow.js";
import { database } from "../scenes/boot.js";
import { getFixtureType } from "./FixtureLayout.js";
import { getBudgetShelfArtForType } from "./BudgetShelfArt.js";
import { getShelfBoxes } from "./ShelfBoxLayout.js";
import { getItemCrateCategory } from "./CrateCategory.js";
import { moveShelfCrateItem } from "./LiveShelfStocking.js";
import { adjustStorePrice, formatMoneyAmount } from "./Money.js";
import tilesetManifest from "../../data/TilesetManifest.json" with { type: "json" };
import { getInputDevice } from "../input/InputDevice.js";
import { DESIGN_HEIGHT, getGameScale } from "./GameViewport.js";

const TEXTURE_PATHS = new Map(tilesetManifest.map(({ key, path }) => [key, path]));

function texturePath(key) {
  const path = TEXTURE_PATHS.get(key);
  if (!path) throw new Error(`Missing shelf texture path: ${key}`);
  return path;
}

// Always two decimals, like a real price tag: 9 credits reads "9.00".
function formatStickerPrice(price) {
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export class ShelfStockingWindow {
  constructor(scene) {
    this.scene = scene;
    this.fixture = null;
    this.uiWindow = new UIWindow({
      id: "shelf-stocking-window", title: "SHELF",
      width: "min(900px, 94%)", height: "auto", x: 30, y: 60,
      shouldCloseOtherWindows: true,
    }, scene.windowManager);
    this.body = this.uiWindow.element.querySelector(".retro-window-body");
    this.body.classList.add("shelf-stocking-body");
    this.hovered = null;
    this.uiWindow.onClose = () => {
      this.hovered = null;
      this.stopHolding();
      this.closePriceWidget();
      window.clearInterval(this.refreshTimer);
    };
    this.onRelease = () => this.stopHolding();
    this.onBlur = () => this.stopHolding();
    this.onKey = (event) => {
      if (!this.uiWindow.isOpen) return;
      // Esc (or the controller's B) closes the price widget before the shelf window.
      if (this.priceWidget && event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.closePriceWidget();
        return;
      }
      // E and other letters are typing while the price box has focus.
      if (event.target?.matches?.("input")) return;
      if (event.code === "KeyQ") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) this.chooseNextCrate();
        return;
      }
      if (event.code === "KeyE" && !event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.uiWindow.close();
      }
    };
    document.addEventListener("pointerup", this.onRelease);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("keydown", this.onKey, true);
    // The controller's Y does what Q does here.
    this.uiWindow.element.addEventListener("pad-alt", (event) => {
      event.preventDefault();
      this.chooseNextCrate();
    });
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
      if (this.priceWidget && !event.target.closest(".shelf-price-widget, [data-shelf-price]")) {
        this.closePriceWidget();
      }
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
      const cell = event.target.closest("[data-shelf-cell], [data-shelf-price]");
      this.hovered = cell ? Number(cell.dataset.shelfCell ?? cell.dataset.shelfPrice) : null;
    });
    this.body.addEventListener("mouseleave", () => { this.hovered = null; });
  }

  /**
   * The carried crate that stocks next: the one the player chose with Q, or else the highest
   * crate with items in it. Null when the window is closed or no carried crate has items.
   */
  getStockingCrate() {
    if (!this.uiWindow.isOpen) return null;
    const stockable = this.scene.getStockableCrates()
      .filter((crate) => crate.kind === "item" && crate.quantity > 0);
    return stockable.includes(this.chosenCrate) ? this.chosenCrate : stockable.at(-1) ?? null;
  }

  // Q: the next crate down the stack (wrapping back to the top) stocks next.
  chooseNextCrate() {
    const topFirst = this.scene.getStockableCrates()
      .filter((crate) => crate.kind === "item" && crate.quantity > 0).reverse();
    if (topFirst.length === 0) {
      this.notice = "None of your crates have items to stock.";
    } else {
      const current = topFirst.indexOf(this.getStockingCrate());
      this.chosenCrate = topFirst[(current + 1) % topFirst.length];
      this.notice = `Stocking from your ${database.getItem(this.chosenCrate.itemId).name} crate next.`;
    }
    this.refresh();
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
    this.scene.gameState.shop.changed();
    this.refresh();
    return true;
  }

  openForFixture(fixture, title) {
    if (this.fixture === fixture && this.uiWindow.isOpen) return;
    this.stopHolding();
    this.closePriceWidget();
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
    this.status = document.createElement("p");
    this.status.className = "type-description shelf-stocking-status";
    this.status.setAttribute("role", "status");
    this.stage = document.createElement("div");
    this.stage.className = "shelf-stocking-stage";
    // Crop the empty strip above the shelf picture so the window hugs the art.
    const visibleHeight = art.height - art.top;
    this.stage.style.aspectRatio = `${art.width} / ${visibleHeight}`;
    this.stage.style.width = `min(100%, calc((${DESIGN_HEIGHT}px - 370px) * ${art.width / visibleHeight}))`;
    const shelf = document.createElement("img");
    shelf.src = texturePath(getFixtureType(fixture.type).facingTextures.down);
    shelf.alt = "";
    shelf.className = "shelf-stocking-art";
    shelf.style.height = `${art.height / visibleHeight * 100}%`;
    shelf.style.top = `${-art.top / visibleHeight * 100}%`;
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
          left: `${left / art.width * 100}%`, top: `${(top - art.top) / visibleHeight * 100}%`,
          width: `${(right - left) / art.width * 100}%`, height: `${(bottom - top) / visibleHeight * 100}%`,
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
    // Stickers sit on each space's top-right corner. They're siblings of the spaces, not
    // inside them, so clicking one never also stocks or takes items.
    this.stickers = this.cells.map((cell, index) => {
      const sticker = document.createElement("button");
      sticker.type = "button";
      sticker.className = "shelf-price-sticker";
      sticker.dataset.shelfPrice = index;
      sticker.hidden = true;
      const gx = index % art.columns.length;
      const gy = Math.floor(index / art.columns.length);
      sticker.style.left = `${art.columns[gx][1] / art.width * 100}%`;
      sticker.style.top = `${(art.rows[gy][0] - art.top) / visibleHeight * 100}%`;
      sticker.addEventListener("click", () => this.togglePriceWidget(index));
      this.stage.appendChild(sticker);
      return sticker;
    });
    this.body.append(this.status, this.stage);
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
    const result = moveShelfCrateItem(this.fixture, this.scene.getStockableCrates(),
      index % this.art.columns.length, Math.floor(index / this.art.columns.length), pull, this.scene.eventBus,
      this.getStockingCrate());
    this.notice = result.reservedFor
      ? `This space is saved for ${database.getItem(result.reservedFor).name}, which is sold out. ` +
        `To put something else here, ${getInputDevice() === "gamepad" ? "press X on" : "right-click"} the space to clear it first.`
      : result.message;
    if (!result.moved) this.stopHolding();
    else this.scene.gameState.shop.changed();
    this.refresh();
  }

  refresh() {
    if (!this.uiWindow.isOpen) return;
    const crates = this.scene.getStockableCrates().filter((crate) => crate.kind === "item");
    const stockableItemIds = new Set(crates.filter((crate) => crate.quantity > 0).map((crate) => crate.itemId));
    this.status.textContent = this.notice || "";
    for (let index = 0; index < this.cells.length; index++) {
      const cell = this.cells[index];
      const placement = this.placementAt(index);
      const signature = placement ? `${placement.itemId}:${placement.quantity}` : "";
      cell.classList.toggle("selected", index === this.selected);
      cell.classList.toggle("matches-stockable", !!placement && stockableItemIds.has(placement.itemId));
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
      const picture = document.createElement("img");
      picture.className = "shelf-stocking-item";
      picture.src = item.image;
      picture.alt = "";
      cell.appendChild(picture);
    }
    for (let index = 0; index < this.stickers.length; index++) {
      const placement = this.placementAt(index);
      const sticker = this.stickers[index];
      sticker.hidden = !placement;
      if (!placement) continue;
      const price = formatStickerPrice(this.scene.getStorePrice(placement.itemId));
      const soldOut = placement.quantity === 0;
      const signature = `${placement.itemId}:${price}:${soldOut}`;
      if (sticker.dataset.price === signature) continue;
      sticker.dataset.price = signature;
      sticker.classList.toggle("sold-out", soldOut);
      sticker.textContent = price;
      if (soldOut) {
        const label = document.createElement("small");
        label.textContent = "SOLD OUT";
        sticker.appendChild(label);
      }
      const name = database.getItem(placement.itemId).name;
      sticker.title = `${name} sells for ${price} each. Click to change the price.`;
      sticker.setAttribute("aria-label", `${name} price: ${price}${soldOut ? ", sold out" : ""}. Change price`);
    }
    this.refreshPriceWidget();
  }

  // --- Price widget ---

  togglePriceWidget(index) {
    const placement = this.placementAt(index);
    if (!placement) return;
    if (this.priceWidget?.index === index) {
      this.closePriceWidget();
      return;
    }
    this.closePriceWidget();
    const { itemId } = placement;
    const item = database.getItem(itemId);
    const element = document.createElement("div");
    element.className = "shelf-price-widget";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", `Price for ${item.name}`);
    element.innerHTML = `
      <div class="shelf-price-widget-head">
        <span class="shelf-price-widget-name"></span>
        <button type="button" data-price-close aria-label="Close price controls">X</button>
      </div>
      <div class="shelf-price-widget-market"></div>
      <label class="shelf-price-widget-label">Your price
        <input class="inventory-price-input" type="number" min="1" step="0.01" />
      </label>
      <div class="inventory-price-buttons">
        <button type="button" data-price-action="decrease"
          title="Decrease by 10% (never below 1)">-10%</button>
        <button type="button" data-price-action="increase"
          title="Increase by 10% (at least 1)">+10%</button>
        <button type="button" data-price-action="market"
          title="Set price to today's market price">MARKET</button>
      </div>`;
    element.querySelector(".shelf-price-widget-name").textContent = item.name;
    const input = element.querySelector("input");
    input.setAttribute("aria-label", `Store price for ${item.name}`);
    input.value = this.scene.getStorePrice(itemId);
    element.addEventListener("click", (event) => {
      if (event.target.closest("[data-price-close]")) {
        this.closePriceWidget();
        return;
      }
      const action = event.target.closest("[data-price-action]")?.dataset.priceAction;
      if (!action) return;
      const nextPrice = adjustStorePrice(
        this.scene.getStorePrice(itemId), this.scene.gameState.market.getPrice(itemId), action,
      );
      if (nextPrice !== null) this.scene.setStorePrice(itemId, nextPrice);
      input.value = this.scene.getStorePrice(itemId);
      this.refresh();
    });
    input.addEventListener("change", () => {
      if (!this.scene.setStorePrice(itemId, Number(input.value))) input.value = this.scene.getStorePrice(itemId);
      this.refresh();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
    });
    // While a price control has focus, keys type or press it instead of moving the player.
    const keyboard = this.scene.input?.keyboard;
    element.addEventListener("focusin", () => this.lockGameKeyboard(true));
    element.addEventListener("focusout", (event) => {
      if (!element.contains(event.relatedTarget)) this.lockGameKeyboard(false);
    });
    this.priceWidget = { index, itemId, element, input, keyboard };
    this.stage.appendChild(element);
    this.refreshPriceWidget();
    this.positionPriceWidget();
    if (getInputDevice() !== "gamepad") {
      input.focus();
      input.select();
    }
  }

  // Below the sticker, or above it when there's no room, kept inside the shelf picture.
  positionPriceWidget() {
    const { index, element } = this.priceWidget;
    const stage = this.stage.getBoundingClientRect();
    const sticker = this.stickers[index].getBoundingClientRect();
    const scale = getGameScale();
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.min(
      Math.max(0, (sticker.right - stage.left) / scale - width),
      Math.max(0, stage.width / scale - width),
    );
    let top = (sticker.bottom - stage.top) / scale + 4;
    if (top + height > stage.height / scale) top = Math.max(0, (sticker.top - stage.top) / scale - height - 4);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  refreshPriceWidget() {
    if (!this.priceWidget) return;
    const { index, itemId, element, input } = this.priceWidget;
    // The space was cleared or now holds a different item.
    if (this.placementAt(index)?.itemId !== itemId) {
      this.closePriceWidget();
      return;
    }
    element.querySelector(".shelf-price-widget-market").textContent =
      `Market price today: ${formatMoneyAmount(this.scene.gameState.market.getPrice(itemId))}`;
    if (document.activeElement !== input) input.value = this.scene.getStorePrice(itemId);
  }

  closePriceWidget() {
    if (!this.priceWidget) return;
    this.priceWidget.element.remove();
    this.lockGameKeyboard(false);
    this.priceWidget = null;
  }

  lockGameKeyboard(locked) {
    const keyboard = this.priceWidget?.keyboard;
    if (!keyboard || this.keyboardLocked === locked) return;
    this.keyboardLocked = locked;
    keyboard.enabled = !locked;
    if (locked) {
      keyboard.disableGlobalCapture();
      keyboard.resetKeys();
    } else {
      keyboard.enableGlobalCapture();
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
