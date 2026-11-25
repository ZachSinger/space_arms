// ==========================================
// FILE: PartnerActions.js
// ==========================================
// What the co-op friend's red shopkeeper can do with their hands: carry, stack, and throw
// crates, stock shelves, pick up trash, mop, and fill remote orders. It runs on the host.
//
// The shop's systems are written for one shopkeeper (shop.player, the crate system's carried
// crates, the cleaning system's held trash, and so on). withPartner() briefly swaps the
// partner's hands and position into those places, runs the same code the player's buttons
// run, and swaps everything back, so both shopkeepers share one set of rules.
import { CONTROL_MODES, modeAllows } from "../input/ControlMode.js";
import { controlLabel, withInputDevice } from "../input/InputDevice.js";
import { HOLD_KEY_MS } from "../logic/CrateStack.js";
import { WindowManager } from "../logic/WindowManager.js";

// The kinds of things the partner can use. The register, drone terminal, hovercart, and moving
// or placing fixtures stay with the shop owner; doors are handled by CoopHost.
export const PARTNER_KINDS = Object.freeze(new Set([
  "crate-control", "fixture", "trashcan", "trash", "dirt", "cleaning", "remote-order-stock",
]));
const CRATE_KEYS = ["carriedCrates", "carriedCrate", "markedStackBase", "markedFromTop"];
const CLEANING_KEYS = ["heldTrash", "heldMop", "mopAnimation", "mopBar"];
const GREY = "#94a3b8";
const SHELF_SEND_MS = 100;

export class PartnerActions {
  /**
   * @param {import("./CoopHost.js").CoopHost} host
   * @param {object} partner - the Partner shopkeeper
   * @param {{ createShelfWindow?: (scene: object) => object }} [options]
   */
  constructor(host, partner, { createShelfWindow = null } = {}) {
    this.host = host;
    this.shop = host.shop;
    this.partner = partner;
    this.carriedCrates = [];
    this.carriedCrate = null;
    this.markedStackBase = null;
    this.markedFromTop = 0;
    this.heldTrash = null;
    this.heldMop = false;
    this.mopAnimation = null;
    this.mopBar = null;
    this.device = "keyboard";
    this.cratePress = null;
    this.hint = "";
    this.sentHint = null;
    this.shelfSentAt = 0;
    this.sentShelf = null;
    this.sentArt = null;
    partner.carry = this;

    const shop = this.shop;
    // The partner's own green arrow. The host's camera skips it; the friend's mirror shows it.
    this.marker = shop.add.graphics().setDepth(20000).setVisible(false);
    this.marker.fillStyle(0x22c55e).lineStyle(1, 0x052e16)
      .fillTriangle(-5, -4, 5, -4, 0, 4).strokeTriangle(-5, -4, 5, -4, 0, 4);
    shop.cameras.main.ignore(this.marker);
    // The host's own arrow points at what the host would pick up, which would only confuse the friend.
    if (shop.crateSystem?.pickupMarker) shop.crateSystem.pickupMarker.mirrorSkip = true;

    // Things the shop says while the partner acts go to the friend's screen, not the host's.
    this.messages = Object.create(shop.messages, {
      show: { value: (text, color) => host.send({ t: "say", text, color }) },
      setHint: { value: (text) => { this.hint = text; } },
    });
    this.controlMode = {
      getMode: () => this.mode(),
      refresh: () => this.mode(),
      allows: (action) => modeAllows(this.mode(), action),
    };
    // The partner never stands at the register, so the register's change keys never apply to them.
    this.checkoutWindow = shop.checkoutWindow && Object.create(shop.checkoutWindow, {
      usesSpaceKey: { value: () => false },
      usesChitInput: { value: () => false },
    });
    this.shelf = createShelfWindow ? this.buildShelfWindow(createShelfWindow) : null;
  }

  /** The partner's own control mode, worked out like the player's (see ControlMode.js). */
  mode() {
    const shop = this.shop;
    if (shop.saves?.loadFailed || shop.shift?.starting) return CONTROL_MODES.LOADING;
    if (shop.gamePaused || (shop.shiftClock?.started && shop.shiftClock.isPaused)) return CONTROL_MODES.PAUSED;
    if (this.shelf?.uiWindow.isOpen) return CONTROL_MODES.MODAL;
    if (this.carriedCrate) return CONTROL_MODES.CARRYING;
    return CONTROL_MODES.WALKING;
  }

  get shelfOpen() {
    return Boolean(this.shelf?.uiWindow.isOpen);
  }

  /**
   * Runs `fn` as if the partner were the shop's player, then puts the player back.
   * @template T
   * @param {() => T} fn
   * @param {{ anyKind?: boolean }} [options] - anyKind: offer owner-only actions too (to explain them)
   * @returns {T}
   */
  withPartner(fn, { anyKind = false } = {}) {
    const shop = this.shop;
    const crates = shop.crateSystem;
    const cleaning = shop.cleaningSystem;
    const { x, y } = this.partner.sprite;
    const swaps = [
      [shop, {
        player: this.partner,
        messages: this.messages,
        controlMode: this.controlMode,
        hovercart: null,
        ...(this.checkoutWindow ? { checkoutWindow: this.checkoutWindow } : {}),
        ...(this.shelf ? { shelfStockingWindow: this.shelf } : {}),
      }],
      [shop.interactables, { allowedKinds: anyKind ? null : PARTNER_KINDS }],
      [shop.areas, shop.areas ? { playerArea: shop.areas.areaAt(x, y) } : {}],
      [shop.checkoutSystem, { operatingRegister: false }],
      [crates, { ...pick(this, CRATE_KEYS), pickupMarker: this.marker }],
      [cleaning, pick(this, CLEANING_KEYS)],
    ].filter(([target]) => target);
    const previous = swaps.map(([target, values]) => {
      const old = {};
      for (const key of Object.keys(values)) {
        old[key] = target[key];
        target[key] = values[key];
      }
      return old;
    });
    try {
      return withInputDevice(this.device, fn);
    } finally {
      if (crates) Object.assign(this, pick(crates, CRATE_KEYS));
      if (cleaning) Object.assign(this, pick(cleaning, CLEANING_KEYS));
      swaps.forEach(([target], index) => Object.assign(target, previous[index]));
    }
  }

  /**
   * A button on the friend's side went down or up.
   * @param {"interact"|"crate"|"putDown"|"nextCrate"} action
   * @param {boolean} down
   */
  press(action, down) {
    if (this.host.frozen && down) return;
    if (this.shelfOpen) {
      if (!down) return;
      if (action === "interact") this.shelf.uiWindow.close();
      else if (action === "putDown") this.shelf.chooseNextCrate();
      return;
    }
    if (action === "interact" && down) this.interact();
    else if (action === "nextCrate" && down) this.withPartner(() => this.shop.crateSystem.markNextCrateDown());
    else if (action === "crate" || action === "putDown") {
      const which = action === "crate" ? "pickUp" : "putDown";
      if (down) this.startCratePress(which);
      else this.endCratePress(which);
    }
  }

  // The friend's use button: doors first, then whatever the partner faces.
  interact() {
    if (this.host.partnerDoor()) {
      this.host.usePartnerDoor();
      return;
    }
    if (!this.controlMode.allows("interact")) return;
    this.withPartner(() => {
      const shop = this.shop;
      const origin = shop.interactionSystem.getInteractionOrigin();
      const action = shop.interactables.findTarget("interact", origin);
      if (action?.perform) {
        action.perform();
        return;
      }
      shop.interactables.allowedKinds = null;
      const ownerOnly = shop.interactables.findTarget("interact", origin);
      if (ownerOnly?.perform && ownerOnly.kind !== "portal") {
        shop.messages.show(this.ownerOnlyMessage(ownerOnly.kind), GREY);
        return;
      }
      if (this.heldTrash) {
        shop.messages.show(`Face a trashcan and press ${controlLabel("interact")} to throw the trash away, ` +
          `or press ${controlLabel("putDown")} to drop it.`, GREY);
      } else if (this.carriedCrate?.kind === "fixture") {
        shop.messages.show("Only the shop owner can place fixtures.", GREY);
      } else if (this.carriedCrate?.kind === "item") {
        shop.messages.show(shop.fixtureSystem.getNearbyTrashcan()
          ? "Only empty crates go in the trashcan."
          : "Too far from a shelf", GREY);
      } else {
        shop.messages.show("Nothing nearby to interact with", GREY);
      }
    });
  }

  ownerOnlyMessage(kind) {
    return {
      register: "Only the shop owner can run the register.",
      "drone-terminal": "Only the shop owner can check remote orders.",
      hovercart: "Only the shop owner can drive the hovercart.",
      "hovercart-station": "Only the shop owner can use the hovercart charger.",
      "fixture-placement": "Only the shop owner can place fixtures.",
    }[kind] ?? "Only the shop owner can use that.";
  }

  // Like PlayerControls: actions with no hold version happen right away; the rest wait to
  // see whether the button is tapped or held.
  startCratePress(which) {
    if (!this.controlMode.allows("crate")) return;
    this.withPartner(() => {
      const action = this.shop.interactionSystem.getCrateControlAction(which);
      if (!action) return;
      if (!action.hold) {
        this.cratePress = null;
        action.perform();
        return;
      }
      this.cratePress = { which, startedAt: this.shop.time.now, fired: false };
    });
  }

  endCratePress(which) {
    const press = this.cratePress;
    if (press?.which !== which) return;
    this.cratePress = null;
    if (press.fired || !this.controlMode.allows("crate")) return;
    this.withPartner(() => this.shop.interactionSystem.getCrateControlAction(which)?.perform());
  }

  /**
   * Each unfrozen frame, after the partner walks.
   * @param {number} delta - ms
   */
  update(delta) {
    const press = this.cratePress;
    if (press && !press.fired && this.shop.time.now - press.startedAt >= HOLD_KEY_MS) {
      press.fired = true;
      if (this.controlMode.allows("crate")) {
        this.withPartner(() => {
          const action = this.shop.interactionSystem.getCrateControlAction(press.which);
          (action?.hold ?? action?.perform)?.();
        });
      }
    }
    if (this.heldMop) this.withPartner(() => this.shop.cleaningSystem?.updateMop(delta));
  }

  /** Walking into floor crates pushes them, after the player's own pushing this frame. */
  pushCrates(delta) {
    this.shop.crateWorld?.updateCratePushing(delta, {
      walker: this.partner, holding: this.carriedCrates.length, stopOthers: false,
    });
  }

  /** After physics each frame: carried things follow the partner; the arrow and hint update. */
  afterPhysics() {
    const shop = this.shop;
    if (this.shelf?.uiWindow.isOpen && !shop.fixtures?.shelves?.().includes(this.shelf.fixture)) {
      this.shelf.uiWindow.close();
    }
    this.withPartner(() => {
      shop.crateSystem?.syncCarriedCrate();
      const mode = this.mode();
      const stack = mode === CONTROL_MODES.WALKING || mode === CONTROL_MODES.CARRYING
        ? shop.crateSystem?.markedFloorStack()
        : null;
      this.marker.setVisible(Boolean(stack));
      if (stack) {
        const bounds = stack.marked.sprite.getBounds();
        if (shop.crateSystem.markedFromTop === 0) this.marker.setAngle(0).setPosition(bounds.centerX, bounds.top - 7);
        else this.marker.setAngle(-90).setPosition(bounds.left - 7, bounds.centerY);
      }
      shop.interactionSystem?.updateHint();
      const portal = this.host.partnerDoor();
      if (portal) {
        const door = `${controlLabel("interact")}: ${portal.hint ?? (portal.to === "shop" ? "Go back out to the shop" : "Go into the backroom")}`;
        this.hint = [door, ...this.hint.split("\n").filter(Boolean)].join("\n");
      }
    });
    if (this.shelfOpen) this.hint = "";
    if (this.hint !== this.sentHint) {
      this.sentHint = this.hint;
      this.host.send({ t: "hint", text: this.hint });
    }
    this.sendShelf();
  }

  // --- The partner's shelf window ---

  // A second shelf window that stocks from the partner's crates. It's never shown on the
  // host's screen; its contents are sent to the friend, whose presses come back here.
  buildShelfWindow(createShelfWindow) {
    const shop = this.shop;
    const scene = Object.create(shop);
    scene.crateSystem = { getStockableCrates: () => [...this.carriedCrates] };
    scene.windowManager = detachedWindowManager();
    scene.shelfBrush = null;
    const shelf = createShelfWindow(scene);
    this.shelfHolder = document.createElement("div");
    this.shelfHolder.appendChild(shelf.uiWindow.element);
    return shelf;
  }

  /** @param {{ t: string, index?: number, pull?: boolean }} message */
  handleShelfMessage(message) {
    const shelf = this.shelf;
    if (!shelf?.uiWindow.isOpen) return;
    if (message.t === "shelfPress" && Number.isInteger(message.index) && message.index >= 0 &&
      message.index < (shelf.cells?.length ?? 0)) {
      shelf.pressCell(message.index, Boolean(message.pull));
    } else if (message.t === "shelfRelease") {
      shelf.stopHolding();
    } else if (message.t === "shelfClose") {
      shelf.uiWindow.close();
    }
  }

  sendShelf() {
    const shelf = this.shelf;
    if (!shelf) return;
    if (!shelf.uiWindow.isOpen) {
      if (this.sentShelf !== null) {
        this.sentShelf = null;
        this.host.send({ t: "shelf", close: true });
      }
      return;
    }
    const now = performance.now();
    if (now - this.shelfSentAt < SHELF_SEND_MS) return;
    this.shelfSentAt = now;
    const body = shelf.body.cloneNode(true);
    const art = body.querySelector(".shelf-stocking-art");
    const artUrl = art?.getAttribute("src") ?? "";
    art?.removeAttribute("src");
    const title = shelf.uiWindow.element.querySelector(".retro-window-title")?.textContent ?? "SHELF";
    const html = body.innerHTML;
    const key = `${title}\n${html}`;
    if (key === this.sentShelf && artUrl === this.sentArt) return;
    this.sentShelf = key;
    const message = { t: "shelf", title, html };
    if (artUrl !== this.sentArt) {
      this.sentArt = artUrl;
      message.art = artUrl;
    }
    this.host.send(message);
  }

  // --- Saving and leaving ---

  /** The partner's crates, saved as floor crates at their feet. */
  savedCrates(payload) {
    const { x, y } = this.partner.sprite;
    return this.carriedCrates.map((crate) => ({
      ...payload(crate), onPad: false, x, y, velocityX: 0, velocityY: 0,
    }));
  }

  savedTrash() {
    if (!this.heldTrash) return [];
    const { x } = this.partner.sprite;
    const y = this.partner.sprite.body?.bottom ?? this.partner.sprite.y;
    return [{ kind: this.heldTrash.kind, x, y }];
  }

  /** The friend left: everything in the partner's hands goes on the floor where they stood. */
  destroy() {
    const shop = this.shop;
    this.shelf?.uiWindow.close();
    this.withPartner(() => {
      shop.cleaningSystem?.putAwayMop();
      if (this.heldTrash && !shop.cleaningSystem.dropHeldTrash()) {
        this.heldTrash.sprite.destroy();
        this.heldTrash = null;
      }
      const crates = shop.crateSystem;
      while (crates.getCarriedCrates().length) {
        if (crates.dropWholeStack() || crates.dropTopCrate()) continue;
        // No room around them: set the crates down right where they stood.
        const { x, y } = this.partner.sprite;
        for (const crate of [...crates.getCarriedCrates()]) {
          crate.drop(x, y, 0, 0, crates.motionPaused);
          crates.restockCrates.push(crate);
          crates.removeCarriedCrate(crate);
        }
        shop.gameState?.crates.changed();
      }
    });
    this.mopBar?.destroy();
    this.marker.destroy();
    this.shelf?.destroy();
    this.shelf?.uiWindow.manager.destroy();
    this.partner.carry = null;
  }
}

function pick(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

// A window manager for a window that's never on this screen: no Escape, drag, or focus
// handling from the host's keyboard and mouse.
function detachedWindowManager() {
  const manager = new WindowManager();
  document.removeEventListener("mousemove", manager.handleMouseMove);
  document.removeEventListener("mouseup", manager.handleMouseUp);
  document.removeEventListener("keydown", manager.handleKeyDown);
  return manager;
}
