// ==========================================
// FILE: CheckoutWindow.js
// ==========================================
// Bible Step 54/55 checkout. The cart rides a conveyor belt
// to a scanner; clicking or dragging across items scans them. Once all are scanned, the
// player types the total, then counts cash change from an unlimited placeholder drawer.

import { UIWindow } from "./UIWindow.js";
import { CheckoutRenderer, cashFaceValue } from "./CheckoutRenderer.js";
import {
  CashPayment, creditCentsToScrips, formatCashAmount, splitCash,
} from "./CashPayment.js";
import { CHIT_DIRECTION_DIGITS, ChitPayment } from "./ChitPayment.js";
import { sumMoney, toCents } from "./Money.js";
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
export const EXACT_PAYMENT_CHANCE = 0.25;
export const CASH_PAYMENT_CHANCE = 0.5;

export function customerPaysCash(random = Math.random) {
  return random() < CASH_PAYMENT_CHANCE;
}

function formatCheckoutTotal(total, currency = "credits") {
  const cents = toCents(total);
  return formatCashAmount(currency === "m-scrips" ? creditCentsToScrips(cents) : cents, currency);
}

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
        y: 80,
        closable: false,
      },
      windowManager,
    );
    this.bodyElement = this.uiWindow.element.querySelector(
      ".retro-window-body",
    );
    // Controller B steps away from the register instead of clearing the keypad.
    this.uiWindow.element.dataset.padBack = "world";
    this.onComplete = null;
    this.mode = null; // "checkout" while ringing up a cart
    this.isScanning = false;
    this.paymentBuffer = "";
    this.total = 0;
    this.chitPayment = null;

    // Global, so a drag-scan works even if it doesn't start on a card.
    this.handleMouseDown = (event) => {
      this.isScanning = event.button === 0 && !this.paused;
      this.lastPointer = { x: event.clientX, y: event.clientY };
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
    for (const timer of this.registerTimers ?? []) clearTimeout(timer.id);
    window.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  // While counting change, Space hands it over, so the game's crate key leaves it alone.
  usesSpaceKey() {
    return this.paymentStage === "change" && !this.uiWindow.element.classList.contains("hidden");
  }

  usesChitInput() {
    return this.paymentStage === "chit" && !this.paused &&
      !this.uiWindow.element.classList.contains("hidden");
  }

  /**
   * Ignored unless the window is open and the payment panel (shown after scanning) is visible.
   * @param {KeyboardEvent} event
   */
  handleNumpadKeydown(event) {
    if (this.paused) return;
    if (this.windowManager?.isConsumed(event)) return;
    if (this.uiWindow.element.classList.contains("hidden")) return;
    const panel = this.bodyElement.querySelector("#checkout-payment");
    if (!panel || panel.classList.contains("hidden")) return;
    if (event.repeat) return;
    if (this.paymentStage === "take") return;

    if (this.paymentStage === "chit") {
      const direction = {
        ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      }[event.key];
      if (direction) {
        event.preventDefault();
        this.enterChitDirection(direction);
      }
      return;
    }

    if (this.paymentStage === "change") {
      if (event.key === " ") {
        event.preventDefault();
        this.handOverChange();
      }
      return;
    }
    if (/^[0-9.]$/.test(event.key)) {
      event.preventDefault?.();
      this.appendDigit?.(event.key);
    } else if (event.key === "Backspace" || event.key === "Delete" || event.key === "Escape") {
      this.clearBuffer?.();
    } else if (event.key === "Enter") {
      event.preventDefault?.();
      this.confirmPayment?.();
    }
  }

  close() {
    this.mode = null;
    this.cart = null;
    this.onComplete = null;
    this.onWrongChange = null;
    this.cashPayment = null;
    this.chitPayment = null;
    this.removeTenderOverlay();
    this.uiWindow.close();
  }

  suspend() {
    this.isScanning = false;
    this.tenderOverlay?.classList.add("hidden");
    this.uiWindow.close();
  }

  /**
   * While the shift is paused, a cover blocks scanning, typing, and handling cash.
   * @param {boolean} paused
   */
  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    this.isScanning = false;
    this.uiWindow.element.classList.toggle("checkout-paused", paused);
    this.tenderOverlay?.classList.toggle("checkout-paused", paused);
    this.freezeMotion(paused);
    if (paused && !this.pauseCover) {
      this.pauseCover = document.createElement("div");
      this.pauseCover.className = "checkout-pause-cover";
      this.pauseCover.textContent = "PAUSED: resume the shift to keep ringing up";
      this.uiWindow.element.appendChild(this.pauseCover);
    }
  }

  /**
   * Holds every belt slide and register delay in place while paused, then carries on from
   * exactly where they stopped.
   * @param {boolean} frozen
   */
  freezeMotion(frozen) {
    const animations = this.uiWindow.element.getAnimations?.({ subtree: true }) ?? [];
    const now = Date.now();
    for (const animation of animations) {
      if (!frozen) animation.play();
    }
    if (frozen) this.pauseAnimations();
    for (const timer of this.registerTimers ?? []) {
      clearTimeout(timer.id);
      if (frozen) {
        timer.remaining = Math.max(0, timer.remaining - (now - timer.startedAt));
      } else {
        this.startRegisterTimer(timer);
      }
    }
    // The belt's "rolling" stripes stop on a timer, so restart it from the cards' positions.
    if (!frozen && this.mode === "checkout") this.advanceBelt();
  }

  /**
   * A setTimeout that waits out pauses instead of firing during them.
   * @param {() => void} callback
   * @param {number} ms
   */
  delayRegister(callback, ms) {
    this.registerTimers ??= new Set();
    const timer = { callback, remaining: ms };
    this.registerTimers.add(timer);
    if (!this.paused) this.startRegisterTimer(timer);
  }

  startRegisterTimer(timer) {
    timer.startedAt = Date.now();
    timer.id = setTimeout(() => {
      this.registerTimers.delete(timer);
      timer.callback();
    }, timer.remaining);
  }

  resume() {
    if (this.mode !== "checkout") return;
    this.uiWindow.openWindow();
    this.tenderOverlay?.classList.remove("hidden");
  }

  /**
   * True while this cart's sale is underway, open or set aside.
   * @param {object[]} cart
   */
  isCheckingOut(cart) {
    return this.mode === "checkout" && this.cart === cart;
  }

  /**
   * Render and open the register for one customer's cart (also used to switch customers).
   * @param {{ itemId: string, price: number }[]} cart - prices in credits
   * @param {() => void} onComplete - fired when payment and change are correct
   * @param {{ cash?: boolean, exact?: boolean, currency?: string, chitCode?: string,
   *   paymentType?: string, onWrongChange?: () => void }} [options]
   *   exact: the customer pays the exact cash amount; rolled here if not given
   */
  openForCustomer(cart, onComplete, {
    cash = true, exact = null, currency = "credits", chitCode, paymentType, onWrongChange = null,
  } = {}) {
    this.mode = "checkout";
    this.cart = cart;
    this.onComplete = onComplete;
    this.onWrongChange = onWrongChange;
    this.paymentBuffer = "";
    this.paymentStage = "total";
    this.total = sumMoney(cart.map((entry) => entry.price));
    this.paymentType = paymentType ?? (currency === "m-scrips" ? "m-scrips" : cash ? "cash" : "card");
    this.currency = this.paymentType === "m-scrips" ? "m-scrips" : "credits";
    // Some customers count out the exact amount, coins included, so no change is owed.
    const usesCash = this.paymentType === "cash" || this.paymentType === "m-scrips";
    const isExact = usesCash && (exact ?? Math.random() < EXACT_PAYMENT_CHANCE);
    const exactTender = this.currency === "m-scrips"
      ? creditCentsToScrips(toCents(this.total))
      : this.total;
    this.cashPayment = usesCash
      ? new CashPayment(this.total, isExact ? exactTender : undefined, this.currency)
      : null;
    this.chitPayment = this.paymentType === "chit" ? new ChitPayment(this.total, chitCode) : null;
    this.removeTenderOverlay();

    this.bodyElement.innerHTML = CheckoutRenderer.generateHTML(
      cart,
      database,
      this.cashPayment,
      this.chitPayment,
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
    const positions = waiting.map((card, queueIndex) => ({
      card,
      currentX: card.offsetLeft,
      targetX: frontX - queueIndex * (CARD_SIZE + CARD_GAP),
    }));
    // Commit the visible positions before retargeting an in-progress CSS transition.
    positions.forEach(({ card, currentX }) => {
      card.style.transition = "none";
      card.style.left = `${currentX}px`;
    });
    // eslint-disable-next-line no-unused-expressions
    belt.offsetWidth;
    let longestSeconds = 0;
    positions.forEach(({ card, currentX, targetX }) => {
      const seconds = Math.abs(targetX - currentX) / BELT_SPEED_PX_PER_S;
      longestSeconds = Math.max(longestSeconds, seconds);
      card.style.transition = `left ${seconds}s linear, border-color 0.1s ease`;
      card.style.left = `${targetX}px`;
    });
    clearTimeout(this.beltStopTimer);
    belt.classList.toggle("rolling", longestSeconds > 0);
    this.beltStopTimer = setTimeout(() => belt.classList.remove("rolling"), longestSeconds * 1000);
    // A register opened during a pause waits, frozen, for the shift to resume.
    if (this.paused) this.pauseAnimations();
  }

  pauseAnimations() {
    for (const animation of this.uiWindow.element.getAnimations?.({ subtree: true }) ?? []) {
      animation.pause();
    }
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
    this.delayRegister(() => card.classList.add("scanned"), SCAN_SLIDE_MS);
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

    let scannedCount = 0;
    let runningTotal = 0;

    if (cart.length === 0) this.beginPayment();

    const scan = (card) => {
      if (card.dataset.scanned === "true") return;
      card.dataset.scanned = "true";
      scannedCount += 1;

      const index = Number(card.dataset.index);
      runningTotal = sumMoney([runningTotal, cart[index].price]);
      totalValueElement.textContent = formatCheckoutTotal(runningTotal, this.currency);

      playScanBeep();
      this.slideOverScanner(card);
      this.advanceBelt();

      if (scannedCount === cart.length) this.beginPayment();
    };

    cards.forEach((card) => {
      // The global mousedown listener (constructor) sets isScanning for click-and-drag.
      card.addEventListener("mousedown", () => {
        scan(card);
      });
      card.addEventListener("mousemove", (event) => {
        // The controller cursor fakes hover events when it refocuses the next card; letting
        // those scan would chain through the whole cart in a few frames.
        if (!event.isTrusted) return;
        // Chromium fires mousemove when a card rolls under a still cursor; only a real sweep scans.
        const moved = this.lastPointer?.x !== event.clientX || this.lastPointer?.y !== event.clientY;
        this.lastPointer = { x: event.clientX, y: event.clientY };
        if (this.isScanning && moved) scan(card);
      });
    });

    this.bindNumpad(cart);
  }

  // Cash and M-Scrip customers hand over their money; Chit customers unlock their Chit.
  // Only card customers need the total keyed in.
  beginPayment() {
    if (!this.cashPayment && !this.chitPayment) {
      this.bodyElement.querySelector("#checkout-payment").classList.remove("hidden");
      return;
    }
    const payment = this.cashPayment ?? this.chitPayment;
    // Let the last item finish sliding over the scanner first.
    this.delayRegister(() => {
      if (this.cashPayment === payment && this.paymentStage === "total") this.startTakingPayment();
      else if (this.chitPayment === payment && this.paymentStage === "total") this.startChitPayment();
    }, SCAN_SLIDE_MS);
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
      if (this.paymentStage !== "total") return;
      playKeypadClick();
      const next = this.paymentBuffer + digit;
      const maxWholeDigits = Math.floor(this.total).toString().length;
      if (!new RegExp(`^\\d{0,${maxWholeDigits}}(?:\\.\\d{0,2})?$`).test(next)) return;
      this.paymentBuffer = next === "." ? "0." : next;
      refreshDisplay();
    };

    this.clearBuffer = () => {
      playKeypadClick();
      this.paymentBuffer = "";
      feedbackElement.textContent = "";
      refreshDisplay();
    };

    this.confirmPayment = () => {
      if (this.paymentStage !== "total") return;
      if (this.cashPayment) return;
      if (this.paymentBuffer !== "" && toCents(Number(this.paymentBuffer)) === toCents(this.total)) {
        this.paymentStage = "complete";
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
    this.bodyElement.querySelectorAll("[data-chit-digit]").forEach((button) => {
      button.addEventListener("click", () => this.enterChitDigit(Number(button.dataset.chitDigit)));
    });
    if (this.cashPayment) {
      this.bodyElement.querySelectorAll("[data-cash-units]").forEach((button) => {
        const adjust = (direction) => {
          if (this.paymentStage !== "change") return;
          this.cashPayment.adjustChange(Number(button.dataset.cashUnits), direction);
          playKeypadClick();
          this.refreshCash();
        };
        button.addEventListener("click", () => adjust(1));
        // Keep focus off drawer buttons, or Space would also press the last one clicked.
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          adjust(-1);
        });
      });
      const handOverButton = this.bodyElement.querySelector("#cash-hand-over");
      handOverButton.addEventListener("click", () => this.handOverChange());
      handOverButton.addEventListener("mousedown", (event) => event.preventDefault());
    }
  }

  startChitPayment() {
    this.paymentStage = "chit";
    this.bodyElement.querySelector("#checkout-payment").classList.remove("hidden");
    this.bodyElement.querySelector(".checkout-belt").classList.add("hidden");
    this.bodyElement.querySelector(".checkout-numpad").classList.add("hidden");
    this.bodyElement.querySelector("#checkout-payment-display").classList.add("hidden");
    this.bodyElement.querySelector("#checkout-chit").classList.remove("hidden");
    this.bodyElement.querySelector(".checkout-payment-prompt").textContent = "UNLOCK THE EXPLORER CHIT";
    this.refreshChit();
    this.bodyElement.scrollTop = 0;
  }

  enterChitDigit(digit) {
    if (this.paymentStage !== "chit") return;
    const result = this.chitPayment.enterDigit(digit);
    playKeypadClick();
    this.refreshChit();
    if (result.restarted) {
      playErrorBuzz();
      this.bodyElement.querySelector("#checkout-chit-feedback").textContent = "WRONG KEY. START OVER.";
      return;
    }
    this.bodyElement.querySelector("#checkout-chit-feedback").textContent = "";
    if (result.completed) {
      this.paymentStage = "complete";
      playSaleComplete();
      this.onComplete?.();
    }
  }

  enterChitDirection(direction) {
    const digit = CHIT_DIRECTION_DIGITS[direction];
    if (!digit) throw new TypeError(`Unknown Chit direction: ${direction}.`);
    this.enterChitDigit(digit);
  }

  refreshChit() {
    const progress = Array.from({ length: this.chitPayment.code.length }, (_, index) =>
      index < this.chitPayment.progress ? this.chitPayment.code[index] : "_").join(" ");
    this.bodyElement.querySelector("#checkout-chit-progress").textContent = `INPUT: ${progress}`;
  }

  // The customer holds out their cash over a blurred screen. Each piece is taken by clicking
  // it or by holding the mouse button and sweeping over it, like scanning items.
  startTakingPayment() {
    this.isScanning = false;
    this.paymentStage = "take";
    this.renderTenderOverlay();
  }

  renderTenderOverlay() {
    this.removeTenderOverlay();
    const overlay = document.createElement("div");
    overlay.className = "cash-tender-overlay";
    overlay.innerHTML = `
      <div class="cash-tender-panel">
        <div class="cash-tender-title">THE CUSTOMER HANDS YOU ${formatCashAmount(this.cashPayment.tenderUnits, this.cashPayment.currency).toUpperCase()}</div>
        <div class="cash-tender-area"></div>
        <div class="cash-tender-hint kbd-only">Release the mouse button, then click each bill${this.cashPayment.currency === "credits" ? " or coin" : ""} or click and hold to sweep across them.</div>
        <div class="cash-tender-hint pad-only">Press A on each bill${this.cashPayment.currency === "credits" ? " or coin" : ""} to take it.</div>
      </div>`;
    const area = overlay.querySelector(".cash-tender-area");
    this.cashPayment.tenderPieces.forEach((piece, index) => {
      if (piece.taken) return;
      const element = document.createElement("button");
      element.type = "button";
      element.className = `cash-loose cash-${piece.kind}`;
      element.setAttribute("aria-label", `Take ${piece.label}`);
      element.innerHTML = `<span>${piece.label}</span>`;
      // Random spot and tilt inside the area, kept clear of its edges.
      element.style.left = `${8 + Math.random() * 64}%`;
      element.style.top = `${10 + Math.random() * 60}%`;
      element.style.transform = `translate(-50%, -50%) rotate(${Math.round(Math.random() * 50 - 25)}deg)`;
      // The global mousedown listener (constructor) sets isScanning for click-and-drag.
      element.addEventListener("mousedown", (event) => {
        if (event.button === 0) this.takeTenderPiece(index, element);
      });
      element.addEventListener("mouseenter", (event) => {
        if (this.isScanning && event.isTrusted) this.takeTenderPiece(index, element);
      });
      area.appendChild(element);
    });
    // The Manager's Tablet may have been opened while the last item was scanning.
    if (this.uiWindow.element.classList.contains("hidden")) overlay.classList.add("hidden");
    overlay.classList.toggle("checkout-paused", Boolean(this.paused));
    document.body.appendChild(overlay);
    this.tenderOverlay = overlay;
  }

  removeTenderOverlay() {
    this.tenderOverlay?.remove();
    this.tenderOverlay = null;
  }

  takeTenderPiece(index, element = null) {
    if (this.paymentStage !== "take" || !this.cashPayment.takeTenderPiece(index)) return;
    playKeypadClick();
    element?.remove();
    if (this.cashPayment.allTenderTaken) this.finishTakingPayment();
  }

  finishTakingPayment() {
    this.removeTenderOverlay();
    if (this.cashPayment.changeDueUnits === 0) {
      this.paymentStage = "complete";
      playSaleComplete();
      this.onComplete?.();
      return;
    }
    this.paymentStage = "change";
    // What the customer paid sits next to the total, in green.
    this.bodyElement.querySelector("#checkout-total-value").innerHTML =
      `${formatCheckoutTotal(this.total, this.cashPayment.currency)} - <span class="checkout-paid">${formatCashAmount(this.cashPayment.tenderUnits, this.cashPayment.currency)}</span>`;
    this.bodyElement.querySelector("#checkout-payment").classList.remove("hidden");
    this.bodyElement.querySelector("#checkout-payment-display").classList.add("hidden");
    this.bodyElement.querySelector(".checkout-belt").classList.add("hidden");
    this.bodyElement.querySelector(".checkout-numpad").classList.add("hidden");
    this.bodyElement.querySelector(".checkout-payment-prompt").textContent = "COUNT THE CUSTOMER'S CHANGE";
    this.bodyElement.querySelector("#checkout-cash").classList.remove("hidden");
    this.refreshCash();
    this.bodyElement.scrollTop = 0;
  }

  refreshCash() {
    const cash = this.cashPayment;
    this.bodyElement.querySelector("#checkout-change-selected").textContent =
      formatCashAmount(cash.changeUnits, cash.currency);
    this.bodyElement.querySelectorAll("[data-cash-count]").forEach((element) => {
      element.textContent = `${cash.change.get(Number(element.dataset.cashCount)) ?? 0} in change`;
    });
    const piecesHTML = (pieces) => pieces.map(({ kind, units, count }) => `
      <span class="cash-pile-item">
        <span class="cash-piece cash-${kind}">${cashFaceValue({ kind, units }, cash.currency)}</span>
        <span class="cash-pile-count">x${count}</span>
      </span>`).join("");
    const selected = [...cash.change].map(([units, count]) => ({
      ...splitCash(units, cash.currency)[0], count,
    }));
    this.bodyElement.querySelector("#checkout-change-pile").innerHTML = selected.length
      ? `<span class="cash-row-label">CHANGE TO HAND OVER</span>${piecesHTML(selected)}`
      : "No change selected.";
  }

  handOverChange() {
    if (this.paymentStage !== "change") return;
    const result = this.cashPayment.handOver();
    if (result.accepted) {
      this.paymentStage = "complete";
      playSaleComplete();
      this.onComplete?.();
      return;
    }
    playErrorBuzz();
    this.bodyElement.querySelector("#checkout-payment-feedback").textContent = result.penalty
      ? "Wrong change refused. Lose 1 store reputation at the end of the shift. Correct the change and try again."
      : "Wrong change refused. Correct it and try again. Another mistake will cost store reputation at the end of the shift.";
    if (result.penalty) this.onWrongChange?.();
  }
}
