// ==========================================
// FILE: CheckoutWindow.js
// ==========================================
import { UIWindow } from "./UIWindow.js";
import { CheckoutRenderer } from "./CheckoutRenderer.js";
import {
  playScanBeep,
  playKeypadClick,
  playSaleComplete,
  playErrorBuzz,
} from "./Sfx.js";
import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

const CARD_WIDTH = 72;
const CARD_HEIGHT = 72;
const MAX_PLACEMENT_ATTEMPTS = 30;

// Matches the window's own "32vw" width so it can be right-aligned at construction time
// (UIWindow's x/y are plain pixel offsets, not vw-aware, so this has to be computed here).
const CHECKOUT_WIDTH_VW = 32;
const RIGHT_MARGIN_PX = 24;

// Mock of the bible's Step 54/55 checkout flow (card payment only for now; cash/change-owed
// and the patience/Go-Backs systems are a later pass). Items scatter randomly around the
// window; the player scans each one by clicking it, or by holding the mouse button down and
// dragging the cursor across several cards in a row. Each scan beeps and slides the card into
// the bag. Once every item is scanned, a numpad appears and the player must type the exact
// total to complete the sale.
export class CheckoutWindow {
  constructor(windowManager) {
    // Pinned to the right edge of the screen (rather than the old fixed x:400, which sat
    // over the middle of the shop floor) so it doesn't cover the customer queue/shelf area
    // -- that's the view that actually needs to stay visible while customers are on screen.
    const rightAlignedX =
      window.innerWidth - (window.innerWidth * CHECKOUT_WIDTH_VW) / 100 - RIGHT_MARGIN_PX;

    this.uiWindow = new UIWindow(
      {
        id: "checkout-window",
        title: "REGISTER",
        contentHTML: "",
        width: `${CHECKOUT_WIDTH_VW}vw`,
        height: "44vh",
        x: Math.round(rightAlignedX),
        y: 160,
      },
      windowManager,
    );
    this.bodyElement = this.uiWindow.element.querySelector(
      ".retro-window-body",
    );
    this.onComplete = null;
    this.isScanning = false;
    this.paymentBuffer = "";
    this.total = 0;

    // Global mousedown/mouseup so a click-and-drag scan works no matter where the drag
    // starts -- not just when the first mousedown happens to land directly on a card.
    window.addEventListener("mousedown", () => {
      this.isScanning = true;
    });
    window.addEventListener("mouseup", () => {
      this.isScanning = false;
    });

    // Lets the player type the payment amount on their physical keyboard instead of only
    // clicking the on-screen numpad. Bound once here (rather than per-customer in
    // bindNumpad) and dispatches to whichever handler is currently assigned, since the
    // window/body element itself is reused across every customer.
    window.addEventListener("keydown", (event) => this.handleNumpadKeydown(event));
  }

  // Ignores keystrokes unless the checkout window is actually open and the payment panel
  // (which only appears once every item is scanned) is visible.
  handleNumpadKeydown(event) {
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

  openForCustomer(cart, onComplete) {
    this.onComplete = onComplete;
    this.paymentBuffer = "";
    this.total = cart.reduce((sum, entry) => sum + entry.price, 0);

    this.bodyElement.innerHTML = CheckoutRenderer.generateHTML(
      cart,
      database,
    );
    // Open the window before scattering cards: the scatter zone needs real, laid-out
    // dimensions (clientWidth/clientHeight), which read as 0 while the window still has
    // its "hidden" class applied, collapsing every card onto the same (0, 0) spot.
    this.uiWindow.openWindow();
    this.scatterCards();
    this.bindEvents(cart);
  }

  // Randomly (and non-overlapping, best-effort) positions every unscanned card
  // within the scatter zone, now that it has real rendered dimensions.
  scatterCards() {
    const zone = this.bodyElement.querySelector("#checkout-scatter-zone");
    const cards = [...zone.querySelectorAll(".checkout-item-card")];
    const zoneWidth = zone.clientWidth;
    const zoneHeight = zone.clientHeight;
    const placed = [];

    cards.forEach((card) => {
      let x;
      let y;
      let attempts = 0;

      do {
        x = Math.random() * Math.max(zoneWidth - CARD_WIDTH, 0);
        y = Math.random() * Math.max(zoneHeight - CARD_HEIGHT, 0);
        attempts += 1;
      } while (
        attempts < MAX_PLACEMENT_ATTEMPTS &&
        placed.some(
          (p) => Math.abs(p.x - x) < CARD_WIDTH && Math.abs(p.y - y) < CARD_HEIGHT,
        )
      );

      placed.push({ x, y });
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
    });
  }

  bindEvents(cart) {
    const zone = this.bodyElement.querySelector("#checkout-scatter-zone");
    const cards = [...zone.querySelectorAll(".checkout-item-card")];
    const bagElement = this.bodyElement.querySelector("#checkout-bag");
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
      totalValueElement.textContent = `${runningTotal.toLocaleString()}c`;

      playScanBeep();
      this.slideToBag(card, bagElement);

      if (scannedCount === cart.length) {
        paymentSection.classList.remove("hidden");
      }
    };

    cards.forEach((card) => {
      // The global window "mousedown" listener (constructor) already sets isScanning;
      // this just scans the specific card the press landed on directly.
      card.addEventListener("mousedown", () => {
        scan(card);
      });
      // Supports "click and hold, drag cursor across cards" -- works regardless of
      // whether the drag started on a card or empty space, since isScanning is now
      // tracked globally for the whole window rather than per-card.
      card.addEventListener("mouseenter", () => {
        if (this.isScanning) scan(card);
      });
    });

    this.bindNumpad(cart);
  }

  // Animates a scanned card sliding toward the bag indicator, then removes it.
  slideToBag(card, bagElement) {
    const cardRect = card.getBoundingClientRect();
    const bagRect = bagElement.getBoundingClientRect();
    const dx = bagRect.left + bagRect.width / 2 - (cardRect.left + cardRect.width / 2);
    const dy = bagRect.top + bagRect.height / 2 - (cardRect.top + cardRect.height / 2);

    card.classList.add("scanned");
    card.style.setProperty("--slide-x", `${dx}px`);
    card.style.setProperty("--slide-y", `${dy}px`);

    card.addEventListener(
      "transitionend",
      () => {
        card.style.visibility = "hidden";
      },
      { once: true },
    );
  }

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

    // Shared handlers so both clicking the on-screen numpad and typing on the physical
    // keyboard (see handleNumpadKeydown) drive the exact same logic.
    this.appendDigit = (digit) => {
      playKeypadClick();
      // A sensible cap: never type more digits than the total itself has.
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
        // Deliberately NOT closing the window here -- the caller (GameScene.startCheckout)
        // decides what happens next: if there's another customer waiting, it just
        // refreshes this same window's content for them (openForCustomer() re-renders
        // regardless of whether the window was ever actually hidden); it only explicitly
        // closes it if there's truly nothing left to scan. Closing unconditionally here
        // used to eject the player from the register (see GameScene.endRegisterSession)
        // after literally every single sale, not just the last one.
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
