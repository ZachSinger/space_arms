// ==========================================
// FILE: CheckoutWindow.js
// ==========================================
// Bible Step 54/55 checkout (card payment only for now). The cart rides a conveyor belt
// to a scanner; clicking or dragging across items scans them. Once all are scanned, the
// player types the exact total on a numpad to complete the sale.

import { UIWindow } from "./UIWindow.js";
import { CheckoutRenderer } from "./CheckoutRenderer.js";
import {
  playScanBeep,
  playKeypadClick,
  playSaleComplete,
  playErrorBuzz,
} from "./Sfx.js";
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

// Belt layout (px) and animation speeds.
const CARD_SIZE = 72;
const CARD_GAP = 8;
const SCANNER_GAP = 12;
const BELT_SPEED_PX_PER_S = 260;
const SCAN_SLIDE_MS = 220;

// UIWindow's x is plain px, so right-aligning a vw-wide window is computed here.
const CHECKOUT_WIDTH_VW = 44;
const RIGHT_MARGIN_PX = 24;

/**
 * The single register window, re-rendered for each customer at checkout.
 * Only shown while there's something to scan, so it has no close button.
 */
export class CheckoutWindow {
  constructor(windowManager) {
    this.windowManager = windowManager;
    const rightAlignedX =
      window.innerWidth - (window.innerWidth * CHECKOUT_WIDTH_VW) / 100 - RIGHT_MARGIN_PX;

    this.uiWindow = new UIWindow(
      {
        id: "checkout-window",
        title: "REGISTER",
        contentHTML: "",
        width: `${CHECKOUT_WIDTH_VW}vw`,
        height: "auto",
        x: Math.round(rightAlignedX),
        y: 160,
        closable: false,
      },
      windowManager,
    );
    this.bodyElement = this.uiWindow.element.querySelector(
      ".retro-window-body",
    );
    this.onComplete = null;
    this.mode = null; // "checkout" while ringing up a cart
    this.isScanning = false;
    this.paymentBuffer = "";
    this.total = 0;

    // Global, so a drag-scan works even if it doesn't start on a card.
    this.handleMouseDown = () => {
      this.isScanning = true;
    };
    this.handleMouseUp = () => {
      this.isScanning = false;
    };
    window.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("mouseup", this.handleMouseUp);

    // Physical-keyboard payment entry. Bound once, since the window is reused per customer.
    this.handleKeyDown = (event) => this.handleNumpadKeydown(event);
    window.addEventListener("keydown", this.handleKeyDown);
  }

  destroy() {
    clearTimeout(this.beltStopTimer);
    window.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  /**
   * Ignored unless the window is open and the payment panel (shown after scanning) is visible.
   * @param {KeyboardEvent} event
   */
  handleNumpadKeydown(event) {
    if (this.windowManager?.isConsumed(event)) return;
    if (this.uiWindow.element.classList.contains("hidden")) return;
    const panel = this.bodyElement.querySelector("#checkout-payment");
    if (!panel || panel.classList.contains("hidden")) return;

    if (/^[0-9]$/.test(event.key)) {
      this.appendDigit?.(event.key);
    } else if (event.key === "Backspace" || event.key === "Delete" || event.key === "Escape") {
      this.clearBuffer?.();
    } else if (event.key === "Enter") {
      this.confirmPayment?.();
    }
  }

  close() {
    this.mode = null;
    this.onComplete = null;
    this.uiWindow.close();
  }

  suspend() {
    this.isScanning = false;
    this.uiWindow.close();
  }

  resume() {
    if (this.mode === "checkout") this.uiWindow.openWindow();
  }

  /**
   * Render and open the register for one customer's cart (also used to switch customers).
   * @param {{ itemId: string, price: number }[]} cart - prices in credits
   * @param {() => void} onComplete - fired when the exact total is entered
   */
  openForCustomer(cart, onComplete) {
    this.mode = "checkout";
    this.onComplete = onComplete;
    this.paymentBuffer = "";
    this.total = cart.reduce((sum, entry) => sum + entry.price, 0);

    this.bodyElement.innerHTML = CheckoutRenderer.generateHTML(
      cart,
      database,
    );
    // Open first: the belt needs real laid-out dimensions to place the cards.
    this.uiWindow.openWindow();
    this.loadBelt();
    this.bindEvents(cart);
  }

  // Cards start off the left edge in cart order and ride in as one train.
  loadBelt() {
    const cards = [...this.bodyElement.querySelectorAll(".checkout-item-card")];
    cards.forEach((card, index) => {
      card.style.transition = "none";
      card.style.left = `${-(index + 1) * (CARD_SIZE + CARD_GAP)}px`;
    });
    // eslint-disable-next-line no-unused-expressions
    this.bodyElement.offsetWidth; // commit the start positions before animating
    this.advanceBelt();
  }

  // Moves every unscanned card to its queue spot behind the scanner at belt speed.
  advanceBelt() {
    const belt = this.bodyElement.querySelector("#checkout-belt");
    const scanner = this.bodyElement.querySelector("#checkout-scanner");
    if (!belt || !scanner) return;
    const frontX = scanner.offsetLeft - SCANNER_GAP - CARD_SIZE;
    const waiting = [...belt.querySelectorAll('.checkout-item-card[data-scanned="false"]')];
    let longestSeconds = 0;
    waiting.forEach((card, queueIndex) => {
      const currentX = card.offsetLeft;
      const targetX = frontX - queueIndex * (CARD_SIZE + CARD_GAP);
      const seconds = Math.abs(targetX - currentX) / BELT_SPEED_PX_PER_S;
      longestSeconds = Math.max(longestSeconds, seconds);
      card.style.transition = `left ${seconds}s linear, border-color 0.1s ease`;
      card.style.left = `${targetX}px`;
    });
    clearTimeout(this.beltStopTimer);
    belt.classList.toggle("rolling", longestSeconds > 0);
    this.beltStopTimer = setTimeout(() => belt.classList.remove("rolling"), longestSeconds * 1000);
  }

  /**
   * Lifts the card over the red bar, then lets it drop out of view past the scanner.
   * @param {HTMLElement} card
   */
  slideOverScanner(card) {
    const scanner = this.bodyElement.querySelector("#checkout-scanner");
    const currentX = card.offsetLeft;
    card.style.transition = "none";
    card.style.left = `${currentX}px`;
    card.classList.add("scanning");
    // eslint-disable-next-line no-unused-expressions
    card.offsetWidth;
    card.style.transition = `left ${SCAN_SLIDE_MS}ms ease-in, transform 0.15s ease`;
    card.style.left = `${scanner.offsetLeft + scanner.offsetWidth / 2 - CARD_SIZE / 2}px`;
    setTimeout(() => card.classList.add("scanned"), SCAN_SLIDE_MS);
  }

  /**
   * Wire click/drag scanning; reveals the payment panel once every item is scanned.
   * @param {{ itemId: string, price: number }[]} cart
   */
  bindEvents(cart) {
    const belt = this.bodyElement.querySelector("#checkout-belt");
    const cards = [...belt.querySelectorAll(".checkout-item-card")];
    const totalValueElement = this.bodyElement.querySelector(
      "#checkout-total-value",
    );
    const paymentSection = this.bodyElement.querySelector("#checkout-payment");

    let scannedCount = 0;
    let runningTotal = 0;

    if (cart.length === 0) {
      paymentSection.classList.remove("hidden");
    }

    const scan = (card) => {
      if (card.dataset.scanned === "true") return;
      card.dataset.scanned = "true";
      scannedCount += 1;

      const index = Number(card.dataset.index);
      runningTotal += cart[index].price;
      totalValueElement.textContent = `${runningTotal.toLocaleString()} credits`;

      playScanBeep();
      this.slideOverScanner(card);
      this.advanceBelt();

      if (scannedCount === cart.length) {
        paymentSection.classList.remove("hidden");
      }
    };

    cards.forEach((card) => {
      // The global mousedown listener (constructor) sets isScanning for click-and-drag.
      card.addEventListener("mousedown", () => {
        scan(card);
      });
      card.addEventListener("mouseenter", () => {
        if (this.isScanning) scan(card);
      });
    });

    this.bindNumpad(cart);
  }

  /**
   * @param {{ itemId: string, price: number }[]} cart
   */
  bindNumpad(cart) {
    const displayElement = this.bodyElement.querySelector(
      "#checkout-payment-display",
    );
    const feedbackElement = this.bodyElement.querySelector(
      "#checkout-payment-feedback",
    );
    const digitButtons = this.bodyElement.querySelectorAll(
      ".numpad-btn[data-digit]",
    );
    const clearButton = this.bodyElement.querySelector("#numpad-clear");
    const confirmButton = this.bodyElement.querySelector("#numpad-confirm");

    const refreshDisplay = () => {
      displayElement.textContent = this.paymentBuffer || "0";
    };

    // Shared by the on-screen numpad and the physical keyboard (handleNumpadKeydown).
    this.appendDigit = (digit) => {
      playKeypadClick();
      // Never more digits than the total itself has.
      if (this.paymentBuffer.length >= String(this.total).length) return;
      this.paymentBuffer += digit;
      refreshDisplay();
    };

    this.clearBuffer = () => {
      playKeypadClick();
      this.paymentBuffer = "";
      feedbackElement.textContent = "";
      refreshDisplay();
    };

    this.confirmPayment = () => {
      if (Number(this.paymentBuffer) === this.total) {
        playSaleComplete();
        // Don't close here: the caller either re-renders for the next queued customer or
        // closes when no one is left, so the player isn't ejected after every sale.
        this.onComplete?.();
        return;
      }

      playErrorBuzz();
      feedbackElement.textContent = "AMOUNT INCORRECT";
      this.paymentBuffer = "";
      refreshDisplay();
      const panel = this.bodyElement.querySelector("#checkout-payment");
      panel.classList.remove("shake");
      // eslint-disable-next-line no-unused-expressions
      panel.offsetWidth; // force reflow so the shake animation can replay
      panel.classList.add("shake");
    };

    digitButtons.forEach((button) => {
      button.addEventListener("click", () => this.appendDigit(button.dataset.digit));
    });

    clearButton.addEventListener("click", () => this.clearBuffer());
    confirmButton.addEventListener("click", () => this.confirmPayment());
  }
}
