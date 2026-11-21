// =============================================================================
// FILE: PlayerControls.js
// =============================================================================
// Every key, mouse guard, and controller button the shop listens to, and the tap-vs-hold
// timing for E/A, Ctrl, Space/X, and Q/Y. What each action does lives in the systems; this
// file only decides when to ask for it.
//
// See also: ControlMode.js (which actions the current mode allows), GamepadInput.js (raw
// controller state), UINavigator.js (the menu cursor), InteractionSystem.js (what E does).
// =============================================================================

import { CONTROL_MODES } from "./ControlMode.js";
import { GamepadInput, PAD } from "./GamepadInput.js";
import { setInputDevice } from "./InputDevice.js";
import { UINavigator } from "../logic/UINavigator.js";
import { HOLD_KEY_MS } from "../logic/CrateStack.js";

const PAUSE_GUARDED_EVENTS = [
  "keydown", "mousedown", "pointerdown", "click", "dblclick",
  "contextmenu", "wheel", "touchstart", "touchmove", "mousemove", "pointermove",
];

export class PlayerControls {
  /** @param {object} shop - the shop scene */
  constructor(shop) {
    this.shop = shop;
    // The E/A press facing a movable fixture, until it's released (tap) or held long enough.
    this.interactPress = null;
    // Ctrl held facing a fixture, until it's held long enough to pick the fixture up.
    this.fixtureMovePress = null;
    // The pick-up or put-down button being held, until it's released (tap) or held long enough (hold).
    this.cratePress = null;
    this.padInput = null;
    this.uiNavigator = null;
    this.highlightTrashKey = null;
  }

  /** Binds every key, guard, and controller; all are removed when the scene shuts down. */
  install() {
    const shop = this.shop;
    this.bindPauseInputGuard();

    // E opens fixtures or delivers/places crates; holding Ctrl facing a fixture picks it up
    // to move. Space picks crates up and Q puts them down (tap: one crate, hold: a stack);
    // Q with empty hands packs the Go-Backs. See bindCrateKeys.
    shop.input.keyboard.on("keydown-E", (event) => {
      if (!event.repeat) shop.interactionSystem.handleInteract();
    });
    this.bindCrateKeys();
    // Hold H: every piece of trash on the floor lights up, even behind shelves.
    this.highlightTrashKey = shop.cleaningSystem ? shop.input.keyboard.addKey("H", false) : null;

    // I or Tab opens the tablet and, while it's open, closes it again.
    const handleTabletKey = (event) => {
      if (event.code !== "KeyI" && event.code !== "Tab") return;
      if (event.code === "Tab") event.preventDefault();
      if (event.repeat) return;
      const tablet = shop.managerTablet;
      if (tablet.uiWindow.isOpen) {
        if (event.code === "KeyI" && event.target?.matches?.("input, textarea")) return;
        tablet.uiWindow.close();
      } else if (shop.controlMode.allows("tablet")) {
        tablet.openWindow();
      }
    };
    document.addEventListener("keydown", handleTabletKey);

    // The shop camera: PageUp zooms in, PageDown zooms out (never past the whole shop).
    this.bindKey("keydown-PAGE_UP", "cameraZoom", () => shop.cameraRig.zoomBy(1));
    this.bindKey("keydown-PAGE_DOWN", "cameraZoom", () => shop.cameraRig.zoomBy(-1));
    // The shift clock's manual pause: freezes time entirely so the player can think.
    this.bindKey("keydown-P", "pause", () => shop.shiftClock.togglePause());
    // Esc pauses too, unless it just closed a window. Other screens on top block pausing
    // anyway; the register doesn't, so Esc pauses there like P.
    // A plain window listener rather than Phaser's: some browsers cancel Esc before the page
    // sees it, and Phaser ignores cancelled keys. This runs after WindowManager's document
    // listener, so a press that closed a window is already marked consumed.
    const handleEscPause = (event) => {
      if (event.key !== "Escape" || event.repeat) return;
      if (shop.windowManager.isConsumed(event)) return;
      if (!shop.controlMode.allows("pause")) return;
      shop.shiftClock.togglePause();
    };
    window.addEventListener("keydown", handleEscPause);

    // Controller: the same actions as the keys above (see handleGamepad), plus a menu cursor
    // for every window.
    this.padInput = new GamepadInput();
    this.uiNavigator = new UINavigator({
      onUnhandled: (button) => this.handleUnusedMenuButton(button),
    });

    shop.events.once("shutdown", () => {
      document.removeEventListener("keydown", handleTabletKey);
      window.removeEventListener("keydown", handleEscPause);
      this.uiNavigator.destroy();
    });
  }

  /** Pausing drops any half-finished press, so nothing fires on resume. */
  cancelPresses() {
    this.cratePress = null;
    this.interactPress = null;
    this.fixtureMovePress = null;
  }

  /**
   * A Phaser key that only acts while the current mode allows `action`.
   * @param {string} eventName - e.g. "keydown-P"
   * @param {string} action - a ControlMode action
   * @param {Function} callback
   */
  bindKey(eventName, action, callback) {
    this.shop.input.keyboard.on(eventName, (...args) => {
      if (this.shop.controlMode.allows(action)) callback(...args);
    });
  }

  bindPauseInputGuard() {
    const handler = (event) => this.handlePausedInput(event);
    for (const type of PAUSE_GUARDED_EVENTS) window.addEventListener(type, handler, { capture: true, passive: false });
    this.shop.events.once("shutdown", () => {
      for (const type of PAUSE_GUARDED_EVENTS) window.removeEventListener(type, handler, true);
    });
  }

  handlePausedInput(event) {
    const shop = this.shop;
    if (shop.controlMode.getMode() !== CONTROL_MODES.PAUSED) return;
    if (event.type !== "keydown" && event.target?.closest?.("#hud-pause-btn")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Handle resume before window-close handlers or Phaser see the key.
    if (event.type === "keydown" && !event.repeat &&
      (event.code === "KeyP" || event.key === "Escape")) {
      shop.shiftClock.togglePause();
    }
  }

  /**
   * One frame of controller input. A screen on top gets it through the menu cursor;
   * otherwise each button runs the same action as its keyboard key:
   *   A = E (interact)   X = Space (pick up / throw)   Y = Q (put down; packs the Go-Backs with empty hands)
   *   R3 (right stick click) = Ctrl (green arrow one crate down)   Back = I (tablet)
   *   LB/RB = PageDown/PageUp (zoom)   Start = top bar (pause, start shift, save, ...)
   *   B = leave the register   left stick / D-pad = walk   triggers = dash
   * @param {number} time
   * @param {number} delta
   */
  handleGamepad(time, delta) {
    const shop = this.shop;
    const pad = this.padInput;
    pad.poll(time);
    if (pad.hadInput) setInputDevice("gamepad");
    const mode = shop.controlMode.getMode();
    if (mode === CONTROL_MODES.LOADING && !shop.saves.loadFailed) return;
    if (mode === CONTROL_MODES.PAUSED) {
      if (pad.justPressed(PAD.START)) {
        shop.shiftClock.togglePause();
        this.uiNavigator.setHudOpen(false);
      }
      return;
    }

    if (pad.justPressed(PAD.START)) this.uiNavigator.toggleHud();
    if (pad.justPressed(PAD.BACK)) {
      if (shop.managerTablet.uiWindow.isOpen) shop.managerTablet.uiWindow.close();
      else if (shop.controlMode.allows("tablet")) shop.managerTablet.openWindow();
    }
    if (shop.checkoutWindow.usesChitInput()) {
      const chitKeys = [
        [PAD.UP, "up"],
        [PAD.DOWN, "down"],
        [PAD.LEFT, "left"],
        [PAD.RIGHT, "right"],
      ];
      const pressedKey = chitKeys.find(([button]) => pad.justPressed(button));
      if (pressedKey) {
        shop.checkoutWindow.enterChitDirection(pressedKey[1]);
        return;
      }
    }
    if (this.uiNavigator.handle(pad, delta)) return;

    if (mode === CONTROL_MODES.PLACING) {
      shop.fixturePlacement.handlePad(pad, delta);
    } else {
      if (pad.justPressed(PAD.A)) this.startInteractPress({ button: PAD.A });
      if (pad.justPressed(PAD.X) && !shop.checkoutWindow.usesSpaceKey()) {
        this.startCratePress("pickUp", { button: PAD.X });
      }
      if (pad.justPressed(PAD.Y)) this.startCratePress("putDown", { button: PAD.Y });
      if (pad.justPressed(PAD.R3)) shop.crateSystem.markNextCrateDown();
      if (pad.justPressed(PAD.B) && shop.checkoutSystem.operatingRegister) shop.checkoutSystem.endRegisterSession();
    }
    if (pad.justPressed(PAD.LB)) this.handleUnusedMenuButton(PAD.LB);
    if (pad.justPressed(PAD.RB)) this.handleUnusedMenuButton(PAD.RB);
  }

  // Buttons the open screen had no use for, e.g. B or Y while ringing up a customer.
  handleUnusedMenuButton(button) {
    const shop = this.shop;
    if (button === PAD.B && shop.checkoutSystem.operatingRegister) shop.checkoutSystem.endRegisterSession();
    if ((button === PAD.LB || button === PAD.RB) && shop.controlMode.allows("cameraZoom")) {
      shop.cameraRig.zoomBy(button === PAD.RB ? 1 : -1);
    }
  }

  /**
   * Controller walking for Player.update, or null while a screen has the controller.
   * @returns {{x: number, y: number, dash: boolean} | null}
   */
  padMovement() {
    if (!this.padInput?.connected || this.uiNavigator?.hasScope()) return null;
    return { ...this.padInput.moveVector(), dash: this.padInput.wantsDash() };
  }

  /** Each frame, after the world moves: finishes or fires every press being held. */
  updatePresses() {
    this.updateCratePress();
    this.updateInteractPress();
    this.updateFixtureMovePress();
  }

  /**
   * A (on a controller) went down. Facing a fixture you could move, it waits to see whether
   * this is a tap (open it) or a hold (pick it up to move); otherwise it acts right away.
   * @param {{ button?: number }} [options] - the controller button, which is polled for release
   */
  startInteractPress({ button = null } = {}) {
    const shop = this.shop;
    if (!shop.controlMode.allows("interact")) return;
    const action = shop.interactionSystem.getFixtureMoveAction();
    if (!action) {
      this.interactPress = null;
      shop.interactionSystem.handleInteract();
      return;
    }
    this.interactPress = { fixture: action.target, action, button, startedAt: shop.time.now };
  }

  // Releasing before the hold fired is a tap.
  endInteractPress() {
    const press = this.interactPress;
    this.interactPress = null;
    if (press) this.shop.interactionSystem.handleInteract();
  }

  updateInteractPress() {
    const press = this.interactPress;
    if (!press) return;
    if (press.button !== null && !this.padInput?.isDown(press.button)) {
      this.endInteractPress();
      return;
    }
    if (this.shop.time.now - press.startedAt < HOLD_KEY_MS) return;
    this.interactPress = null;
    const action = this.shop.interactionSystem.getFixtureMoveAction();
    if (action?.target === press.fixture) action.perform();
  }

  // Ctrl went down. Facing a fixture with empty hands while the store is closed, keeping it
  // held picks the fixture up to move; releasing sooner leaves it alone.
  startFixtureMovePress() {
    const action = this.shop.interactionSystem.getFixtureMoveAction();
    this.fixtureMovePress = action
      ? { fixture: action.target, action, startedAt: this.shop.time.now }
      : null;
  }

  updateFixtureMovePress() {
    const press = this.fixtureMovePress;
    if (!press || this.shop.time.now - press.startedAt < HOLD_KEY_MS) return;
    this.fixtureMovePress = null;
    const action = this.shop.interactionSystem.getFixtureMoveAction();
    if (action?.target === press.fixture) action.perform();
  }

  // Space picks up and Q puts down. Each waits for release to tell a tap (one crate) from a
  // hold (a stack); a hold fires as soon as the key has been down for HOLD_KEY_MS.
  bindCrateKeys() {
    const shop = this.shop;
    const keyboard = shop.input.keyboard;
    // Cursor keys capture Space by default, which blocks focused UI controls.
    keyboard.removeCapture("SPACE");
    keyboard.on("keydown-SPACE", (event) => {
      if (event.target?.closest?.("#ui-layer")) return;
      event.preventDefault();
      if (event.repeat || shop.checkoutWindow?.usesSpaceKey()) return;
      this.startCratePress("pickUp");
    });
    keyboard.on("keydown-Q", (event) => {
      if (!event.repeat) this.startCratePress("putDown");
    });
    keyboard.on("keyup-SPACE", () => this.endCratePress("pickUp"));
    keyboard.on("keyup-Q", () => this.endCratePress("putDown"));
    keyboard.on("keydown-CTRL", (event) => {
      if (!event.repeat) this.startFixtureMovePress();
      shop.crateSystem.markNextCrateDown();
    });
    keyboard.on("keyup-CTRL", () => { this.fixtureMovePress = null; });
  }

  allowsCrateAction() {
    return this.shop.controlMode.allows("crate");
  }

  /**
   * A pick-up or put-down button went down. Actions with no hold version (like throwing)
   * happen right away; the rest wait to see whether it's a tap or a hold.
   * @param {"pickUp"|"putDown"} which
   * @param {{ button?: number }} [options] - the controller button, which is polled for release
   */
  startCratePress(which, { button = null } = {}) {
    if (!this.allowsCrateAction(which)) return;
    const action = this.shop.interactionSystem.getCrateControlAction(which);
    if (!action) return;
    if (!action.hold) {
      this.cratePress = null;
      action.perform();
      return;
    }
    this.cratePress = { which, button, startedAt: this.shop.time.now, fired: false };
  }

  // Releasing before the hold fired is a tap.
  endCratePress(which) {
    const press = this.cratePress;
    if (press?.which !== which) return;
    this.cratePress = null;
    if (press.fired || !this.allowsCrateAction(which)) return;
    this.shop.interactionSystem.getCrateControlAction(which)?.perform();
  }

  // Each frame: ends controller presses on release, and fires a hold once it's long enough.
  updateCratePress() {
    const press = this.cratePress;
    if (!press) return;
    if (press.button !== null && !this.padInput?.isDown(press.button)) {
      this.endCratePress(press.which);
      return;
    }
    if (press.fired || this.shop.time.now - press.startedAt < HOLD_KEY_MS) return;
    press.fired = true;
    if (!this.allowsCrateAction(press.which)) return;
    const action = this.shop.interactionSystem.getCrateControlAction(press.which);
    (action?.hold ?? action?.perform)?.();
  }
}
