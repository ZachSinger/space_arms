// ==========================================
// FILE: FixturePlacement.js
// ==========================================
// Placement mode for moving an existing fixture or unpacking a fixture crate: a ghost
// follows the cursor (or, on a controller, steps tile by tile) with valid/invalid and
// access-cell highlights, and left-click or A commits. Only allowed while the store is closed.
import { UIWindow } from "./UIWindow.js";
import { TILE_SIZE } from "./RoomLayout.js";
import { getFixtureType, fixtureAccessCells, fixtureFootprint } from "./FixtureLayout.js";
import { getFixtureTexture } from "./FixtureTexture.js";
import { PAD } from "./GamepadInput.js";
import { getInputDevice } from "./InputDevice.js";

const PAD_STEPS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export class FixturePlacement {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.uiWindow = new UIWindow({
      id: "fixture-placement-window",
      title: "FIXTURE PLACEMENT",
      width: "350px",
      height: "auto",
      x: 24,
      y: 80,
      contentHTML: `
        <p data-placement-name></p>
        <p class="fixture-stock-meta kbd-only">Left-click to place. R to turn it. Right-click or Esc to cancel.
          WASD / arrow keys pan the camera. The blue squares in front must stay clear.</p>
        <p class="fixture-stock-meta pad-only">Move it with the left stick or D-pad. A to place. Y to turn it.
          B to cancel. The blue squares in front must stay clear.</p>
        <p data-placement-status role="status"></p>
        <button type="button" class="action-btn" data-cancel-fixture-move>CANCEL</button>
      `,
    }, scene.windowManager);
    // The controller moves the fixture, not a menu cursor, while this window is up.
    this.uiWindow.element.setAttribute("data-pad-world", "");
    this.bodyElement = this.uiWindow.element.querySelector(".retro-window-body");
    this.nameElement = this.bodyElement.querySelector("[data-placement-name]");
    this.statusElement = this.bodyElement.querySelector("[data-placement-status]");
    this.bodyElement.querySelector("[data-cancel-fixture-move]").addEventListener("click", () => this.cancel());
    this.uiWindow.onClose = () => this.finish();
    this.graphics = scene.add.graphics().setDepth(9997).setVisible(false);
    this.handlePointerDown = (pointer) => {
      // Ignore clicks that land on DOM windows over the canvas.
      if (!this.active || pointer.event?.target !== scene.game.canvas) return;
      if (pointer.rightButtonDown()) {
        this.cancel();
        return;
      }
      if (!pointer.leftButtonDown()) return;
      this.padCell = null;
      this.updatePreview(pointer);
      this.confirm();
    };
    scene.input.on("pointerdown", this.handlePointerDown);
    this.handleRotateKey = () => {
      if (!this.active || !scene.controlMode.allows("rotateFixture")) return;
      this.rotate();
    };
    scene.input.keyboard.on("keydown-R", this.handleRotateKey);
    this.handleDocumentMouseMove = (event) => {
      if (!this.active) return;
      this.mouseClient = { x: event.clientX, y: event.clientY };
      // Real mouse movement takes over from the controller.
      if (event.isTrusted) this.padCell = null;
      this.updateWindowTransparency();
    };
    document.addEventListener("mousemove", this.handleDocumentMouseMove, true);
  }

  // Place the fixture at the current preview; leaves placement mode if it fit.
  confirm() {
    const { id, gx, gy, rotation } = this.placement;
    const placed = this.original
      ? this.scene.moveFixture(id, gx, gy, rotation)
      : this.scene.placeFixtureFromCrate(this.fixtureCrate, gx, gy, rotation);
    if (placed) {
      const movedFromLayoutMenu = Boolean(this.original);
      this.cancel();
      // Back to the shop floor, not the Layout tab the move started from.
      if (movedFromLayoutMenu) this.scene.managerTablet.uiWindow.close();
    }
  }

  rotate() {
    this.rotation = (this.rotation + 1) % 4;
    this.refreshPreview();
  }

  /**
   * Controller: D-pad or left stick steps the fixture a tile, A places, Y turns, B cancels.
   * @param {import("./GamepadInput.js").GamepadInput} pad
   */
  handlePad(pad) {
    if (!this.active) return;
    if (pad.navDirection || pad.justPressed(PAD.A) || pad.justPressed(PAD.Y)) this.usePadCell();
    if (pad.navDirection) {
      const [dx, dy] = PAD_STEPS[pad.navDirection];
      this.padCell = { gx: this.padCell.gx + dx, gy: this.padCell.gy + dy };
      this.refreshPreview();
    }
    if (pad.justPressed(PAD.Y)) this.rotate();
    if (pad.justPressed(PAD.A)) this.confirm();
    else if (pad.justPressed(PAD.B)) this.cancel();
  }

  // Switch from the mouse to tile stepping, starting where the preview already is.
  usePadCell() {
    if (this.padCell) return;
    const { w, h } = fixtureFootprint({ type: this.spec.id, rotation: this.rotation });
    this.padCell = { gx: this.placement.gx + Math.floor(w / 2), gy: this.placement.gy + Math.floor(h / 2) };
  }

  // Faded windows ignore the pointer, so hover is tested against their bounds instead.
  updateWindowTransparency() {
    const point = this.active ? this.mouseClient : null;
    for (const win of this.scene.windowManager.windows.values()) {
      let over = false;
      if (point && win.isOpen) {
        const rect = win.element.getBoundingClientRect();
        over = point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
      }
      win.element.classList.toggle("placement-see-through", over);
    }
  }

  /**
   * Start moving a placed fixture, contents included.
   * @param {string} id - fixture id
   * @returns {boolean} false if the store is open
   */
  begin(id) {
    if (!this.scene.canRearrangeFixtures()) {
      this.scene.showShopMessage("Fixtures can only move while the store is closed.");
      return false;
    }
    const original = this.scene.fixtures.get(id);
    if (!original) throw new Error(`Unknown fixture: ${id}`);
    return this.start(original.type, original, null);
  }

  /**
   * Start placing the fixture packed in the crate the player is carrying.
   * @param {Crate} crate
   * @returns {boolean} false if the store is open or the crate isn't a carried fixture crate
   */
  beginFromCrate(crate) {
    if (!this.scene.canRearrangeFixtures()) {
      this.scene.showShopMessage("Fixtures can only be placed while the store is closed.");
      return false;
    }
    if (crate !== this.scene.carriedCrate || crate?.kind !== "fixture") return false;
    if (this.scene.playerInBackroom && getFixtureType(crate.typeId)?.kind === "shelf") {
      this.scene.showShopMessage("Shelves can only be placed on the sales floor.");
      return false;
    }
    return this.start(crate.typeId, null, crate);
  }

  /**
   * Enter placement mode: freeze the player and crates, unfollow the camera, show the ghost.
   * @param {string} typeId
   * @param {object|null} original - fixture being moved, or null when placing from a crate
   * @param {Crate|null} fixtureCrate
   */
  start(typeId, original, fixtureCrate) {
    this.cancel();
    this.scene.endRegisterSession();
    this.original = original;
    this.fixtureCrate = fixtureCrate;
    this.spec = getFixtureType(typeId);
    this.rotation = original?.rotation ?? 0;
    this.active = true;
    if (this.original) {
      this.original.sprite.setAlpha(0.35);
      this.nameElement.textContent = `Moving ${this.scene.fixtures.displayName(this.original)} with its contents`;
    } else {
      this.fixtureCrate.sprite.setVisible(false);
      this.nameElement.textContent = `Placing ${this.spec.name}`;
    }
    this.scene.player.inputEnabled = false;
    this.scene.player.sprite.body.stop();
    this.scene.restockCrates.forEach((crate) => crate.setPaused(true));
    const x = original?.x ?? fixtureCrate.sprite.x;
    const y = original?.y ?? fixtureCrate.sprite.y;
    this.ghost = this.scene.add.image(x, y, getFixtureTexture(this.scene, this.spec))
      .setDisplaySize(this.spec.w * TILE_SIZE, this.spec.h * TILE_SIZE)
      .setAlpha(0.5).setDepth(9996);
    this.graphics.setVisible(true);
    this.uiWindow.openWindow();
    this.mouseClient = null;
    // On a controller the fixture starts where it stands (or where its crate is).
    this.padCell = getInputDevice() === "gamepad"
      ? { gx: Math.floor(x / TILE_SIZE), gy: Math.floor(y / TILE_SIZE) }
      : null;
    this.refreshPreview();
    return true;
  }

  // Follow the controller's tile if it's in use, else the mouse pointer.
  refreshPreview() {
    if (this.padCell) {
      this.updatePreviewAt((this.padCell.gx + 0.5) * TILE_SIZE, (this.padCell.gy + 0.5) * TILE_SIZE);
    } else {
      this.updatePreview(this.scene.input.activePointer);
    }
  }

  /**
   * Center the candidate footprint on the pointer and redraw validity (green/red) and the
   * access cells that must stay clear (blue).
   * @param {Phaser.Input.Pointer} pointer
   */
  updatePreview(pointer) {
    const world = this.scene.screenToWorld?.(pointer.x, pointer.y) ?? this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.updatePreviewAt(world.x, world.y);
  }

  /**
   * @param {number} worldX
   * @param {number} worldY
   */
  updatePreviewAt(worldX, worldY) {
    const { w, h } = fixtureFootprint({ type: this.spec.id, rotation: this.rotation });
    this.placement = {
      id: this.original?.id ?? this.scene.fixtures.nextId(this.spec.id),
      type: this.spec.id,
      gx: Math.floor(worldX / TILE_SIZE) - Math.floor(w / 2),
      gy: Math.floor(worldY / TILE_SIZE) - Math.floor(h / 2),
      rotation: this.rotation,
    };
    const { id, gx, gy, rotation } = this.placement;
    const result = this.original
      ? this.scene.checkFixtureMove(id, gx, gy, rotation)
      : this.scene.checkFixturePlacement(this.spec.id, gx, gy, rotation);
    this.statusElement.textContent = result.valid && getInputDevice() === "gamepad"
      ? result.reason.replace(/^Click to place\./, "Press A to place.")
      : result.reason;
    const color = result.valid ? 0x10b981 : 0xef4444;
    const x = gx * TILE_SIZE;
    const y = gy * TILE_SIZE;
    this.graphics.clear().fillStyle(color, 0.22).lineStyle(2, color, 1)
      .fillRect(x, y, w * TILE_SIZE, h * TILE_SIZE)
      .strokeRect(x, y, w * TILE_SIZE, h * TILE_SIZE);
    this.graphics.lineStyle(2, 0x38bdf8, 1);
    // Registers also need the side behind them clear -- that's where the player stands.
    const accessCells = this.spec.kind === "register"
      ? [...fixtureAccessCells(this.placement), ...fixtureAccessCells(this.placement, true)]
      : fixtureAccessCells(this.placement);
    for (const cell of accessCells) {
      this.graphics.strokeRect(cell.gx * TILE_SIZE + 3, cell.gy * TILE_SIZE + 3, TILE_SIZE - 6, TILE_SIZE - 6);
    }
    this.ghost.setPosition(x + w * TILE_SIZE / 2, y + h * TILE_SIZE / 2).setAngle(rotation * 90);
  }

  /**
   * Keep the preview under the pointer (or the controller's tile) each frame.
   */
  update() {
    if (!this.active) return;
    this.refreshPreview();
  }

  // Leave placement mode and restore the player and crates. Doesn't close the
  // window (it calls this from onClose); use cancel() for that.
  finish() {
    if (!this.active) return;
    this.active = false;
    this.mouseClient = null;
    this.updateWindowTransparency();
    if (this.original) this.original.sprite.setAlpha(1);
    if (this.fixtureCrate?.sprite.active) this.fixtureCrate.sprite.setVisible(true);
    this.ghost.destroy();
    this.graphics.clear().setVisible(false);
    this.scene.player.inputEnabled = true;
    // Keys held while placing would otherwise keep the player walking.
    this.scene.input.keyboard.resetKeys();
    this.scene.restockCrates.forEach((crate) => crate.setPaused(this.scene.crateMotionPaused));
    this.original = null;
    this.fixtureCrate = null;
  }

  cancel() {
    this.finish();
    this.uiWindow.close();
  }

  destroy() {
    this.finish();
    this.scene.input.off("pointerdown", this.handlePointerDown);
    this.scene.input.keyboard.off("keydown-R", this.handleRotateKey);
    document.removeEventListener("mousemove", this.handleDocumentMouseMove, true);
    this.graphics.destroy();
  }
}
