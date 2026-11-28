// ==========================================
// FILE: UINavigator.js
// ==========================================
// Controller menu cursor for the DOM screens. Whichever screen is on top (settings, the top
// bar, the customer's cash, or the focused window) becomes the scope; the D-pad or left
// stick moves a highlight between its buttons and items, and mapped buttons act on it.
// Clicks are faked as the same mouse events a real click sends, so every screen works with
// no controller-specific code. Screens can opt in to more:
//   data-pad-autofocus  where the cursor lands when its previous target disappears
//   data-pad-row        one stop for a whole row; A clicks its [data-pad-a], X its [data-pad-x]
//   data-pad-world      on a window: the controller drives the world instead (placement)
//   data-pad-back="world"  on a window: B goes to the game instead of acting as Esc
//   data-pad-hold       keep a pointer press down until the face button is released
//   data-pad-repeat     repeat primary clicks at this interval (ms), within the same screen
//   "pad-alt" event     cancelable; call preventDefault() when the screen used it
import { controllerButtonFor } from "../input/ControllerBindings.js";
import { getInputDevice } from "../input/InputDevice.js";
import { pickNearest, pickNeighbor } from "./PadNavigation.js";

const TARGET_SELECTOR = [
  "button:not([disabled])",
  "select:not([disabled])",
  ".checkout-item-card[data-scanned='false']",
  "[data-pick-item-id]",
  "[data-placement-index]",
  "[data-grid-cell]",
  "[data-go-backs-item-id]",
  "[data-save-slot]",
  "[data-pad-row]",
].join(",");

// px per second at full right-stick tilt.
const SCROLL_SPEED = 900;

const rectOf = (element) => element.getBoundingClientRect();
const centerOf = (element) => {
  const rect = rectOf(element);
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
};

// Data attributes that say what a target is, so a re-rendered copy can be found again.
function identityOf(element) {
  const entries = Object.entries(element.dataset).filter(([key]) => key !== "padAutofocus");
  if (element.id) entries.push(["#id", element.id]);
  return entries.length ? JSON.stringify(entries.sort()) : null;
}

export class UINavigator {
  /**
   * @param {{ onUnhandled?: (button: number, scope: HTMLElement) => void }} [options]
   *   called for B, Y, LB, and RB when the screen didn't use them
   */
  constructor({ onUnhandled = null } = {}) {
    this.onUnhandled = onUnhandled;
    this.scope = null;
    this.focused = null;
    this.lostIdentity = null;
    this.lastCenter = null;
    this.hudOpen = false;
    this.onBlur = () => this.stopActions();
    if (typeof window !== "undefined") window.addEventListener("blur", this.onBlur);
  }

  destroy() {
    this.stopActions();
    if (typeof window !== "undefined") window.removeEventListener("blur", this.onBlur);
    this.setHighlight(null);
    this.setHudOpen(false);
  }

  // Start toggles the top bar (PAUSE, START SHIFT, SAVE, ...), which sits outside any window.
  toggleHud() {
    const hud = document.getElementById("persistent-hud");
    if (!hud || hud.classList.contains("hidden")) return;
    this.setHudOpen(!this.hudOpen);
  }

  setHudOpen(open) {
    this.hudOpen = open;
    document.getElementById("persistent-hud")?.classList.toggle("pad-hud-open", open);
  }

  getScope() {
    const settings = document.querySelector(".settings-window:not(.hidden)");
    if (settings) return settings;
    if (this.hudOpen) {
      const hud = document.getElementById("persistent-hud");
      if (hud && !hud.classList.contains("hidden")) return hud;
      this.setHudOpen(false);
    }
    const cash = document.querySelector(".cash-tender-overlay:not(.hidden):not(.checkout-paused)");
    if (cash) return cash;
    const active = document.querySelector(".retro-window.active:not(.hidden)");
    if (active && !active.hasAttribute("data-pad-world")) return active;
    return null;
  }

  /** @returns {boolean} whether a screen is in charge of the controller this frame */
  hasScope() {
    return Boolean(this.scope);
  }

  /**
   * @param {HTMLElement} scope
   * @returns {HTMLElement[]}
   */
  getTargets(scope) {
    return [...scope.querySelectorAll(TARGET_SELECTOR)].filter((element) => {
      // A whole row is one stop; the buttons inside it are reached with A and X instead.
      const row = element.closest("[data-pad-row]");
      return (!row || row === element) &&
        !element.closest(".retro-window-header, .tablet-tab-bar, .settings-tabs, .checkout-paused, .hidden") &&
        element.getClientRects().length > 0;
    });
  }

  /**
   * Run one frame of controller input against the top screen.
   * @param {import("../input/GamepadInput.js").GamepadInput} pad
   * @param {number} delta - ms since last frame
   * @returns {boolean} true if a screen took the input (the world should ignore it)
   */
  handle(pad, delta = 16) {
    const scope = this.getScope();
    if (scope !== this.scope) {
      this.stopActions();
      this.scope = scope;
      this.focused = null;
      this.lostIdentity = null;
      this.lastCenter = null;
      this.supplyRowIdentity = null;
    }
    if (!scope) {
      this.setHighlight(null);
      return false;
    }

    const targets = this.getTargets(scope);
    if (!this.focused || !targets.includes(this.focused)) this.recoverFocus(targets);

    if (this.held && (!pad.isDown(this.held.padButton) || !this.held.element.isConnected)) this.stopHold();
    if (getInputDevice() !== "gamepad") this.stopActions();
    if (pad.navDirection) this.move(pad.navDirection, targets);
    if (pad.justPressedAction("interact")) {
      const interval = Number(this.focused?.dataset.padRepeat);
      this.activate(scope);
      this.repeating = interval > 0 ? { scope, interval, elapsed: 0 } : null;
    } else if (this.repeating) {
      if (!pad.isActionDown("interact") || this.repeating.scope !== scope || !this.focused?.hasAttribute("data-pad-repeat")) {
        this.repeating = null;
      } else {
        this.repeating.elapsed += delta;
        if (this.repeating.elapsed >= this.repeating.interval) {
          this.repeating.elapsed %= this.repeating.interval;
          this.activate(scope);
        }
      }
    }
    if (pad.justPressedAction("crate")) this.secondary();
    if (pad.justPressedAction("putDown")) this.alt(scope);
    if (pad.justPressedAction("cancel")) this.back(scope);
    if (pad.justPressedAction("zoomOut")) this.switchTab(scope, -1, controllerButtonFor("zoomOut"));
    if (pad.justPressedAction("zoomIn")) this.switchTab(scope, 1, controllerButtonFor("zoomIn"));
    if (pad.rightStick.y) this.scroll(scope, pad.rightStick.y * SCROLL_SPEED * delta / 1000);

    if (this.focused?.isConnected) {
      this.lastCenter = centerOf(this.focused);
      this.lostIdentity = identityOf(this.focused);
    }
    this.setHighlight(getInputDevice() === "gamepad" ? this.focused : null);
    return true;
  }

  // The same target re-rendered, else the screen's preferred spot, else whatever is nearest.
  recoverFocus(targets) {
    if (targets.length === 0) {
      this.focused = null;
      return;
    }
    const sameTarget = this.lostIdentity && targets.find((element) => identityOf(element) === this.lostIdentity);
    const autofocus = targets.find((element) => element.hasAttribute("data-pad-autofocus"));
    const nearest = this.lastCenter &&
      pickNearest(this.lastCenter, targets.map((element) => ({ rect: rectOf(element), item: element })));
    this.focus(sameTarget || autofocus || nearest || targets[0]);
  }

  /**
   * @param {"up"|"down"|"left"|"right"} direction
   * @param {HTMLElement[]} targets
   */
  move(direction, targets) {
    const current = this.focused;
    if (!current) return;
    this.stopActions();
    const supply = current.closest(".supply-panel");
    if (supply) {
      const rows = targets.filter((element) => supply.contains(element) && element.hasAttribute("data-pad-row"));
      const actions = targets.filter((element) => supply.contains(element) &&
        element.matches("[data-supply-clear], [data-supply-place]"));
      const inList = Boolean(current.closest(".supply-list"));
      if (direction === "left" || direction === "right") {
        if (inList && direction === "right" && actions.length) this.focus(actions[0]);
        else if (!inList && direction === "left") {
          const row = rows.find((element) => identityOf(element) === this.supplyRowIdentity) ?? rows[0];
          if (row) this.focus(row);
        }
        return;
      }
      targets = inList ? rows : actions;
    }
    if (current instanceof HTMLSelectElement && (direction === "left" || direction === "right")) {
      this.stepSelect(current, direction === "left" ? -1 : 1);
      return;
    }
    const candidates = targets
      .filter((element) => element !== current)
      .map((element) => ({ rect: rectOf(element), item: element }));
    const next = pickNeighbor(rectOf(current), candidates, direction);
    if (next) this.focus(next);
  }

  focus(element) {
    if (element !== this.focused) this.stopHold();
    this.focused = element;
    if (!element) return;
    if (element.closest(".supply-list")) this.supplyRowIdentity = identityOf(element);
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    // Hover effects (shelf placement preview, item tooltips) follow the cursor.
    for (const type of ["mouseover", "mouseenter", "pointerenter", "mousemove"]) {
      this.dispatchMouse(element, type, { bubbles: type !== "mouseenter" && type !== "pointerenter" });
    }
  }

  setHighlight(element) {
    if (this.highlighted === element) return;
    this.highlighted?.classList.remove("pad-focus");
    this.highlighted = element;
    element?.classList.add("pad-focus");
  }

  dispatchMouse(element, type, { bubbles = true, button = 0 } = {}) {
    const { x, y } = centerOf(element);
    const EventType = type.startsWith("pointer") ? (window.PointerEvent ?? MouseEvent) : MouseEvent;
    const event = new EventType(type, {
      bubbles,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      button,
      buttons: type === "mousedown" || type === "pointerdown" ? { 0: 1, 1: 4, 2: 2 }[button] ?? 0 : 0,
      detail: ["mousedown", "mouseup", "click"].includes(type) ? 1 : 0,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    });
    element.dispatchEvent(event);
    return event;
  }

  // A: a full left click; on a row, its [data-pad-a] button.
  activate(scope) {
    let element = this.focused;
    if (!element) return;
    if (element.hasAttribute("data-pad-row")) {
      element = element.querySelector("[data-pad-a]:not([disabled])");
      if (!element) return;
    }
    if (element instanceof HTMLSelectElement) {
      this.stepSelect(element, 1);
      return;
    }
    if (element.hasAttribute("data-pad-hold")) {
      this.startHold(element, controllerButtonFor("interact"), 0);
      return;
    }
    this.click(element);
    if (scope.id === "persistent-hud") this.setHudOpen(false);
  }

  // Press, release, then click, as some screens act on the press.
  click(element) {
    this.dispatchMouse(element, "mousedown");
    this.dispatchMouse(element.isConnected ? element : document.body, "mouseup");
    if (element.isConnected) this.dispatchMouse(element, "click");
  }

  // X: right-click (take one back, remove one, ...); on a row, its [data-pad-x] button.
  secondary() {
    const element = this.focused;
    if (!element) return;
    if (element.hasAttribute("data-pad-hold")) {
      this.startHold(element, controllerButtonFor("crate"), 2);
      return;
    }
    if (element.hasAttribute("data-pad-row")) {
      const button = element.querySelector("[data-pad-x]:not([disabled])");
      if (button) this.click(button);
      return;
    }
    this.dispatchMouse(element, "contextmenu", { button: 2 });
  }

  startHold(element, padButton, button) {
    this.stopActions();
    this.held = { element, padButton, button };
    this.dispatchMouse(element, "pointerdown", { button });
  }

  stopHold() {
    if (!this.held) return;
    const { element, button } = this.held;
    this.held = null;
    this.dispatchMouse(element.isConnected ? element : document.body, "pointerup", { button });
  }

  stopActions() {
    this.stopHold();
    this.repeating = null;
  }

  alt(scope) {
    const event = new CustomEvent("pad-alt", { bubbles: true, cancelable: true });
    (this.focused ?? scope).dispatchEvent(event);
    if (!event.defaultPrevented) this.onUnhandled?.(controllerButtonFor("putDown"), scope);
  }

  back(scope) {
    this.stopActions();
    if (scope.classList.contains("settings-window")) {
      scope.querySelector(".settings-cancel")?.click();
      return;
    }
    if (scope.id === "persistent-hud") {
      this.setHudOpen(false);
      return;
    }
    if (scope.dataset.padBack === "world") {
      this.onUnhandled?.(controllerButtonFor("cancel"), scope);
      return;
    }
    // Esc, exactly as the keyboard sends it: shelves cancel placing, windows close.
    for (const type of ["keydown", "keyup"]) {
      document.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    }
  }

  switchTab(scope, step, button) {
    const tabs = [...scope.querySelectorAll(".tablet-tab-bar .retro-tab-btn, .settings-tabs .retro-tab-btn")]
      .filter((tab) => tab.getClientRects().length > 0);
    if (tabs.length === 0) {
      this.onUnhandled?.(button, scope);
      return;
    }
    const current = Math.max(0, tabs.findIndex((tab) => tab.classList.contains("active")));
    const next = tabs[(current + step + tabs.length) % tabs.length];
    this.stopActions();
    next.click();
    this.focused = null;
    this.lostIdentity = null;
    this.lastCenter = null;
    this.recoverFocus(this.getTargets(scope));
  }

  /**
   * Scroll whatever scrollable area holds the cursor (or the screen itself).
   * @param {HTMLElement} scope
   * @param {number} amount - px
   */
  scroll(scope, amount) {
    let element = this.focused ?? scope;
    while (element && element !== scope.parentElement) {
      const { overflowY } = getComputedStyle(element);
      if ((overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight + 1) {
        element.scrollTop += amount;
        return;
      }
      element = element.parentElement;
    }
  }

  stepSelect(select, step) {
    const index = Math.max(0, Math.min(select.options.length - 1, select.selectedIndex + step));
    if (index === select.selectedIndex) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}
