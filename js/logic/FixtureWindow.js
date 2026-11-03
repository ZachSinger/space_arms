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
    this.render();
    this.uiWindow.openWindow();
  }

  // Pure display -- a capacity bar plus whatever's actually stocked. There's no more
  // per-block assignment to interact with (see ShopInventory.js); stocking happens
  // entirely via ordering from the Supply tab and hauling/delivering crates
  // (GameScene.tryDeliverCarriedCrate), so this window just needs to stay current
  // whenever it's open. Re-rendered on every open() call above; also exposed as refresh()
  // so GameScene can update it live while the player is standing there delivering.
  render() {
    this.bodyElement.innerHTML = FixtureRenderer.generateHTML(this.fixture, database);
  }

  // Called by GameScene right after a delivery into whichever fixture this window is
  // currently showing, so the capacity bar/stock list don't go stale while it's open.
  refresh(fixture) {
    if (this.fixture !== fixture || !this.uiWindow.isOpen) return;
    this.render();
  }
}
