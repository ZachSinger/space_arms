// =============================================================================
// FILE: MainMenuPrompt.js
// =============================================================================
// The "go back to the title screen?" confirmation opened from the game menu.
// =============================================================================
import { UIWindow } from "../logic/UIWindow.js";

// Reloading the page (rather than switching scenes) guarantees a completely fresh start
// and also picks up code changes during development.
export function confirmReturnToMainMenu(shop) {
  if (!shop.mainMenuWindow) {
    shop.mainMenuWindow = new UIWindow({
      id: "main-menu-confirmation", title: "MAIN MENU", width: "400px", height: "auto",
      x: 80, y: 120, shouldCloseOtherWindows: true,
      contentHTML: `
        <p>Go back to the title screen? Anything you haven't saved will be lost.</p>
        <button class="action-btn" data-confirm-main-menu>GO TO TITLE SCREEN</button>
        <button class="action-btn" data-cancel-main-menu>KEEP PLAYING</button>
      `,
    }, shop.windowManager);
    shop.mainMenuWindow.element.querySelector("[data-confirm-main-menu]")
      .addEventListener("click", () => window.location.reload());
    shop.mainMenuWindow.element.querySelector("[data-cancel-main-menu]")
      .addEventListener("click", () => shop.mainMenuWindow.close());
  }
  shop.mainMenuWindow.openWindow();
}
