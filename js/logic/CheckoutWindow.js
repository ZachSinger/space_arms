// ==========================================
// FILE: CheckoutWindow.js
// ==========================================
import { UIWindow } from "./UIWindow.js";
import { CheckoutRenderer } from "./CheckoutRenderer.js";
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

// Click-to-scan mock of the bible's Step 54 checkout flow: each grabbed item appears as its
// own card; clicking "scans" it (price counts toward the total); once every item is scanned,
// the player clicks Complete Sale to resolve payment. Only one customer's cart is shown at a
// time — the scene is responsible for queueing additional customers at the register.
export class CheckoutWindow {
  constructor(windowManager) {
    this.uiWindow = new UIWindow(
      {
        id: "checkout-window",
        title: "REGISTER",
        contentHTML: "",
        width: "32vw",
        height: "40vh",
        x: 400,
        y: 160,
      },
      windowManager,
    );
    this.bodyElement = this.uiWindow.element.querySelector(
      ".retro-window-body",
    );
    this.onComplete = null;
  }

  openForCustomer(cart, onComplete) {
    this.onComplete = onComplete;
    this.bodyElement.innerHTML = CheckoutRenderer.generateHTML(
      cart,
      database,
    );
    this.bindEvents(cart);
    this.uiWindow.openWindow();
  }

  bindEvents(cart) {
    const cards = this.bodyElement.querySelectorAll(".checkout-item-card");
    const completeButton = this.bodyElement.querySelector(
      "#checkout-complete-btn",
    );
    const totalValueElement = this.bodyElement.querySelector(
      "#checkout-total-value",
    );

    let scannedCount = 0;
    let runningTotal = 0;

    if (cart.length === 0) {
      completeButton.disabled = false;
    }

    cards.forEach((card) => {
      card.addEventListener("click", () => {
        if (card.dataset.scanned === "true") return;

        card.dataset.scanned = "true";
        card.classList.add("scanned");
        scannedCount += 1;

        const index = Number(card.dataset.index);
        runningTotal += cart[index].price;
        totalValueElement.textContent = `${runningTotal.toLocaleString()}c`;

        if (scannedCount === cart.length) {
          completeButton.disabled = false;
        }
      });
    });

    completeButton.addEventListener("click", () => {
      this.uiWindow.close();
      this.onComplete?.();
    });
  }
}
