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
import { controllerButtonFor } from "./ControllerBindings.js";
import { setInputDevice } from "./InputDevice.js";
import { UINavigator } from "../logic/UINavigator.js";
import { HOLD_KEY_MS } from "../logic/CrateStack.js";
import { bindingForEvent, isBound, isBoundAnywhere, matchesBinding } from "./KeyBindings.js";
import { ORDER_PACKING_KIND } from "../interaction/InteractionSystem.js";

// After the first item, how often holding E/A packs another item into the remote order.
const PACK_REPEAT_MS = 150;

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
    // F held facing a shelf or register, until it's held long enough to open its color window.
    this.paintPress = null;
    // The pick-up or put-down button being held, until it's released (tap) or held long enough (hold).
    this.cratePress = null;
    // E/A still held after packing an item into the remote order, so it keeps packing.
    this.packRepeat = null;
    this.padInput = null;
    this.uiNavigator = null;
    this.highlightTrashKey = null;
    this.heldBindings = new Map();
  }

  /** Binds every key, guard, and controller; all are removed when the scene shuts down. */
  install() {
    const shop = this.shop;
    this.bindPauseInputGuard();

    this.bindCrateKeys();
    this.highlightTrashKey = shop.cleaningSystem ? { get isDown() {
      return shop.controls.isActionDown("highlightTrash") || Boolean(shop.controls.padInput?.wantsTrashHighlight());
    } } : null;

    const handleTabletKey = (event) => {
      if (!matchesBinding("tablet", event)) return;
      if (shop.controlMode.getMode() === CONTROL_MODES.PAUSED) return;
      if (event.code === "Tab") event.preventDefault();
      if (event.repeat) return;
      const tablet = shop.managerTablet;
      if (tablet.uiWindow.isOpen) {
        if (event.target?.matches?.("input, textarea")) return;
        tablet.uiWindow.close();
      } else if (shop.controlMode.allows("tablet")) {
        tablet.openWindow();
      }
    };
    document.addEventListener("keydown", handleTabletKey);

    const handlePause = (event) => {
      if (!matchesBinding("pause", event) || event.repeat) return;
      if (shop.windowManager.isConsumed(event)) return;
      if (!shop.controlMode.allows("pause")) return;
      this.togglePause();
    };
    window.addEventListener("keydown", handlePause);
    const handleMouseDown = (event) => {
      if (event.target !== shop.game.canvas) return;
      this.handleBoundDown(event);
      if (matchesBinding("tablet", event)) handleTabletKey(event);
      if (matchesBinding("pause", event)) handlePause(event);
    };
    const handleMouseUp = (event) => this.handleBoundUp(event);
    const handleKeyUp = (event) => {
      if (!shop.input.keyboard.enabled) this.handleBoundUp(event);
    };
    const handleBlur = () => this.cancelPresses();
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleBlur);

    // Controller: the same actions as the keys above (see handleGamepad), plus a menu cursor
    // for every window.
    this.padInput = new GamepadInput();
    this.uiNavigator = new UINavigator({
      onUnhandled: (button) => this.handleUnusedMenuButton(button),
    });

    shop.events.once("shutdown", () => {
      document.removeEventListener("keydown", handleTabletKey);
      window.removeEventListener("keydown", handlePause);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleBlur);
      this.uiNavigator.destroy();
    });
  }

  /** Pausing drops any half-finished press, so nothing fires on resume. */
  cancelPresses() {
    this.heldBindings.clear();
    this.cratePress = null;
    this.interactPress = null;
    this.fixtureMovePress = null;
    this.paintPress = null;
    this.packRepeat = null;
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
    if (shop.pauseMenu?.settings?.isCapturing) return;
    if (event.target?.closest?.("#pause-menu, #pause-confirmation, #pause-save-slots, #pause-save-slots-confirmation, #bug-report-window, .settings-window, #shift-receipt")) return;
    if (event.type === "keydown" && event.key === "Escape" &&
      (shop.pauseMenu?.settingsOpen || shop.pauseMenu?.saveSlots?.uiWindow.isOpen)) return;
    if (event.type !== "keydown" && event.target?.closest?.("#hud-pause-btn")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Handle resume before window-close handlers or Phaser see the key.
    if ((event.type === "keydown" || event.type === "mousedown" || event.type === "pointerdown") && !event.repeat &&
      matchesBinding("pause", event)) {
      this.togglePause();
    }
  }

  togglePause() {
    if (this.shop.shift?.receiptWindow?.isOpen) return;
    if (this.shop.pauseMenu) this.shop.pauseMenu.toggle();
    else this.shop.shiftClock.togglePause();
  }

  /**
   * One frame of controller input. A screen on top gets it through the menu cursor;
   * otherwise each button runs the same action as its keyboard key:
   *   Default buttons: A = interact   X = pick up   Y = put down
   *   R3 = move the green arrow down   Back = tablet   LB/RB = zoom
   *   Start = top bar   B = leave the register / dash   triggers = dash
   *   Button actions can be remapped in Settings; the left stick and D-pad walk.
   * @param {number} time
   * @param {number} delta
   */
  handleGamepad(time, delta) {
    const shop = this.shop;
    const pad = this.padInput;
    pad.poll(time);
    if (pad.pressed?.size) {
      const buttonNames = Object.fromEntries(Object.entries(PAD).map(([name, index]) => [index, name]));
      shop.diagnostics?.recordInput({
        device: "gamepad",
        buttons: [...pad.pressed].map((button) => buttonNames[button] ?? `button-${button}`),
      });
    }
    if (pad.hadInput) setInputDevice("gamepad");
    const settings = shop.pauseMenu?.settings;
    if (settings?.isCapturingController) {
      for (const button of pad.pressed) settings.captureControllerButton(button);
      return;
    }
    const mode = shop.controlMode.getMode();
    if (mode === CONTROL_MODES.LOADING && !shop.saves.loadFailed) return;
    if (mode === CONTROL_MODES.PAUSED) {
      if (pad.justPressedAction("pause")) {
        this.togglePause();
        this.uiNavigator.setHudOpen(false);
      }
      if (shop.pauseMenu) this.uiNavigator.handle(pad, delta);
      return;
    }

    if (pad.justPressedAction("pause")) this.uiNavigator.toggleHud();
    if (pad.justPressedAction("tablet")) {
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
      if (pad.justPressedAction("interact")) {
        this.startInteractPress({ button: controllerButtonFor("interact") });
      }
      if (pad.justPressedAction("crate") && !shop.checkoutWindow.usesSpaceKey()) {
        this.startCratePress("pickUp", { button: controllerButtonFor("crate") });
      }
      if (pad.justPressedAction("putDown")) {
        this.startCratePress("putDown", { button: controllerButtonFor("putDown") });
      }
      if (pad.justPressedAction("nextCrate")) shop.crateSystem.markNextCrateDown();
      if (pad.justPressedAction("cancel") && shop.checkoutSystem.operatingRegister) {
        shop.checkoutSystem.endRegisterSession();
      }
    }
    if (pad.justPressedAction("zoomOut")) this.handleUnusedMenuButton(controllerButtonFor("zoomOut"));
    if (pad.justPressedAction("zoomIn")) this.handleUnusedMenuButton(controllerButtonFor("zoomIn"));
  }

  // Buttons the open screen had no use for, e.g. B or Y while ringing up a customer.
  handleUnusedMenuButton(button) {
    const shop = this.shop;
    if (button === controllerButtonFor("cancel") && shop.checkoutSystem.operatingRegister) {
      shop.checkoutSystem.endRegisterSession();
    }
    if ((button === controllerButtonFor("zoomOut") || button === controllerButtonFor("zoomIn")) &&
      shop.controlMode.allows("cameraZoom")) {
      shop.cameraRig.zoomBy(button === controllerButtonFor("zoomIn") ? 1 : -1);
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
    this.updatePackRepeat();
    this.updateFixtureMovePress();
    this.updatePaintPress();
  }

  // E/A acted right away; if it packed the remote order, keeping it held packs more.
  interactNow(button = null) {
    const action = this.shop.interactionSystem.handleInteract();
    this.packRepeat = action?.kind === ORDER_PACKING_KIND
      ? { button, nextAt: this.shop.time.now + HOLD_KEY_MS }
      : null;
  }

  updatePackRepeat() {
    const repeat = this.packRepeat;
    if (!repeat) return;
    const held = repeat.button === null
      ? this.isActionDown("interact")
      : Boolean(this.padInput?.isDown(repeat.button));
    if (!held) {
      this.packRepeat = null;
      return;
    }
    if (this.shop.time.now < repeat.nextAt) return;
    if (!this.shop.interactionSystem.packHeldOrderItem()) {
      this.packRepeat = null;
      return;
    }
    repeat.nextAt = this.shop.time.now + PACK_REPEAT_MS;
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
      this.interactNow(button);
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

  startPaintPress() {
    const fixture = this.shop.fixtureSystem.getPaintableFixture();
    this.paintPress = fixture ? { fixture, startedAt: this.shop.time.now } : null;
  }

  updatePaintPress() {
    const press = this.paintPress;
    if (!press || this.shop.time.now - press.startedAt < HOLD_KEY_MS) return;
    this.paintPress = null;
    if (this.shop.fixtureSystem.getPaintableFixture() === press.fixture) {
      this.shop.fixturePaintWindow.open(press.fixture);
    }
  }

  bindCrateKeys() {
    const keyboard = this.shop.input.keyboard;
    keyboard.removeCapture("SPACE");
    const seen = new WeakSet();
    const once = (handler) => (event) => {
      if (seen.has(event)) return;
      seen.add(event);
      handler(event);
    };
    keyboard.on("keydown", once((event) => this.handleBoundDown(event)));
    keyboard.on("keyup", once((event) => this.handleBoundUp(event)));
  }

  isActionDown(action) {
    return [...this.heldBindings.values()].some((binding) => isBound(action, binding));
  }

  handleBoundDown(event) {
    const shop = this.shop;
    if (event.target?.closest?.("#ui-layer") || event.repeat) return;
    const binding = bindingForEvent(event);
    if (!binding) return;
    if (event.type === "keydown" && isBoundAnywhere(binding)) event.preventDefault();
    const alreadyDown = (action) => this.isActionDown(action);
    const interactDown = alreadyDown("interact");
    const crateDown = alreadyDown("crate");
    const putDownDown = alreadyDown("putDown");
    const nextCrateDown = alreadyDown("nextCrate");
    const paintDown = alreadyDown("paint");
    this.heldBindings.set(event.code || binding, binding);
    if (shop.controlMode.allows("cameraZoom")) {
      if (matchesBinding("zoomIn", event)) shop.cameraRig.zoomBy(1);
      if (matchesBinding("zoomOut", event)) shop.cameraRig.zoomBy(-1);
    }
    if (shop.controlMode.getMode?.() === CONTROL_MODES.PLACING) return;
    if (!interactDown && matchesBinding("interact", event)) this.interactNow();
    if (!crateDown && matchesBinding("crate", event) && !shop.checkoutWindow?.usesSpaceKey()) {
      event.preventDefault();
      this.startCratePress("pickUp");
    }
    if (!putDownDown && matchesBinding("putDown", event)) this.startCratePress("putDown");
    if (!nextCrateDown && matchesBinding("nextCrate", event)) {
      this.startFixtureMovePress();
      shop.crateSystem.markNextCrateDown();
    }
    if (!paintDown && matchesBinding("paint", event)) this.startPaintPress();
  }

  handleBoundUp(event) {
    const binding = bindingForEvent(event);
    if (binding) this.heldBindings.delete(event.code || binding);
    if (matchesBinding("crate", event) && !this.isActionDown("crate")) this.endCratePress("pickUp");
    if (matchesBinding("putDown", event) && !this.isActionDown("putDown")) this.endCratePress("putDown");
    if (matchesBinding("nextCrate", event) && !this.isActionDown("nextCrate")) this.fixtureMovePress = null;
    if (matchesBinding("paint", event) && !this.isActionDown("paint")) this.paintPress = null;
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
