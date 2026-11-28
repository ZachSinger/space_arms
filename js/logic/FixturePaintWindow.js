// ==========================================
// FILE: FixturePaintWindow.js
// ==========================================
// The window for choosing one shelf's or register's color, opened by holding the paint key
// while facing it (js/input/PlayerControls.js). Picking a color repaints it right away.
import { UIWindow } from "./UIWindow.js";
import { SHELF_PAINTS, DEFAULT_SHELF_PAINT } from "./ShelfPaint.js";

// Swatches show the paint at the art's usual brightness, so white "Gray" reads as gray.
function swatchColor(tint) {
  const channel = (shift) => Math.round(((tint >> shift) & 0xff) * 0.78);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

export class FixturePaintWindow {
  /** @param {object} shop - the shop scene */
  constructor(shop) {
    this.shop = shop;
    this.fixture = null;
    this.uiWindow = new UIWindow({
      id: "fixture-paint-window", title: "CHANGE COLOR", width: "420px", height: "auto", x: 40, y: 90,
      shouldCloseOtherWindows: true, contentHTML: "",
      onClose: () => { this.fixture = null; },
    }, shop.windowManager);
    this.body = this.uiWindow.element.querySelector(".retro-window-body");
    this.body.classList.add("fixture-paint-body");
    this.body.addEventListener("click", (event) => {
      const button = event.target.closest("[data-paint]");
      if (button) this.choose(button.dataset.paint);
    });
  }

  get isOpen() { return this.uiWindow.isOpen; }

  /** @param {object} fixture - the shelf or register to repaint */
  open(fixture) {
    this.fixture = fixture;
    this.render();
    this.uiWindow.openWindow();
    this.body.querySelector("[aria-pressed='true']")?.focus();
  }

  render() {
    const fixture = this.fixture;
    const name = this.shop.fixtures.displayName(fixture);
    const current = fixture.paint ?? DEFAULT_SHELF_PAINT;
    this.body.innerHTML = `
      <p class="fixture-paint-intro">Pick a new color for this ${name}. Only this one changes; the others keep their colors.</p>
      <div class="fixture-paint-swatches">
        ${Object.values(SHELF_PAINTS).map((paint) => `
          <button type="button" class="fixture-paint-swatch" data-paint="${paint.id}"
            aria-pressed="${paint.id === current}"${paint.id === current ? " data-pad-autofocus" : ""}>
            <span class="fixture-paint-chip" style="background:${swatchColor(paint.tint)}"></span>
            <span>${paint.name}</span>
          </button>`).join("")}
      </div>`;
  }

  /** @param {string} paintId */
  choose(paintId) {
    const fixture = this.fixture;
    if (!fixture) return;
    if (this.shop.fixtures.get(fixture.id) !== fixture) {
      this.close();
      return;
    }
    this.shop.fixtureSystem.paintFixture(fixture, paintId);
    this.render();
    this.body.querySelector(`[data-paint="${paintId}"]`)?.focus();
  }

  /** Closes the window if it is showing `fixture`, e.g. when that fixture is crated. */
  closeFor(fixture) {
    if (this.fixture === fixture) this.close();
  }

  close() {
    this.uiWindow.close();
  }

  destroy() {
    this.uiWindow.onClose = null;
    this.uiWindow.element.remove();
  }
}
