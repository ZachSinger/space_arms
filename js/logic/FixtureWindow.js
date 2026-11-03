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
  constructor(windowManager, playerState) {
    this.playerState = playerState;

    this.uiWindow = new UIWindow(
      {
        id: "fixture-window",
        title: "FIXTURE",
        contentHTML: "",
        width: "26vw",
        height: "56vh",
        x: 24,
        y: 160,
      },
      windowManager,
    );
    this.bodyElement = this.uiWindow.element.querySelector(".retro-window-body");
    this.titleElement = this.uiWindow.element.querySelector(".retro-window-title");
    this.fixture = null;

    // Delegated (one listener for the whole body, not one per row) since every row gets
    // fully re-rendered after each transfer -- see render().
    this.bodyElement.addEventListener("click", (event) => {
      const takeBtn = event.target.closest("[data-take-item-id]");
      if (takeBtn) this.transfer(this.fixture, this.playerState.hovercart, takeBtn.dataset.takeItemId);

      const depositBtn = event.target.closest("[data-deposit-item-id]");
      if (depositBtn) {
        this.transfer(this.playerState.hovercart, this.fixture, depositBtn.dataset.depositItemId);
      }
    });
  }

  openForFixture(fixture, title) {
    this.fixture = fixture;
    this.titleElement.textContent = title;
    this.render();
    this.uiWindow.openWindow();
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

  // A capacity bar + stock list for this fixture, and the same for the player's own
  // hovercart, each row with a button to move a unit the other way -- see
  // FixtureRenderer.generateHTML. Re-rendered on every open() call and after every
  // transfer; also exposed as refresh() so GameScene can update it live while the player
  // is standing there delivering a crate.
  render() {
    this.bodyElement.innerHTML = FixtureRenderer.generateHTML(
      this.fixture,
      this.playerState.hovercart,
      database,
    );
  }

  // Called by GameScene right after a delivery into whichever fixture this window is
  // currently showing, so the capacity bar/stock list don't go stale while it's open.
  refresh(fixture) {
    if (this.fixture !== fixture || !this.uiWindow.isOpen) return;
    this.render();
  }
}
