// ==========================================
// FILE: FixtureWindow.js
// ==========================================
import { UIWindow } from "./UIWindow.js";
import { FixtureRenderer } from "./FixtureRenderer.js";
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

// One shared window reused for whichever fixture the player currently has open (the shelf
// or the Storage Fixture) -- same idea as there only ever being one CheckoutWindow, just
// re-targeted/re-titled per open() call rather than one instance per fixture.
export class FixtureWindow {
  constructor(windowManager) {
    this.uiWindow = new UIWindow(
      {
        id: "fixture-window",
        title: "FIXTURE",
        contentHTML: "",
        width: "26vw",
        height: "40vh",
        x: 24,
        y: 160,
      },
      windowManager,
    );
    this.bodyElement = this.uiWindow.element.querySelector(".retro-window-body");
    this.titleElement = this.uiWindow.element.querySelector(".retro-window-title");
    this.fixture = null;
  }

  openForFixture(fixture, title) {
    this.fixture = fixture;
    this.titleElement.textContent = title;
    this.renderGrid();
    this.uiWindow.openWindow();
  }

  renderGrid() {
    this.bodyElement.innerHTML = FixtureRenderer.generateGridHTML(this.fixture, database);

    this.bodyElement.querySelectorAll("[data-slot-index]").forEach((cell) => {
      cell.addEventListener("click", () => {
        const slot = this.fixture.slots[Number(cell.dataset.slotIndex)];

        if (!slot.itemId) {
          this.renderPicker(slot);
        } else if (slot.quantity === 0) {
          // Only an assigned-but-still-empty block can be undone this way -- a block
          // already holding physical stock needs somewhere for that stock to go first
          // (bible Step 63: the hovercart), which doesn't exist yet.
          this.fixture.unassignItem(slot);
          this.renderGrid();
        }
      });
    });
  }

  renderPicker(slot) {
    this.bodyElement.innerHTML = FixtureRenderer.generatePickerHTML(database);

    this.bodyElement
      .querySelector("[data-picker-back]")
      .addEventListener("click", () => this.renderGrid());

    this.bodyElement.querySelectorAll("[data-item-id]").forEach((row) => {
      row.addEventListener("click", () => {
        this.fixture.assignItem(slot, row.dataset.itemId);
        this.renderGrid();
      });
    });
  }
}
