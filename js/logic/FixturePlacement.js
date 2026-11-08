// ==========================================
// FILE: FixturePlacement.js
// ==========================================
// Placement mode for moving an existing fixture or unpacking a fixture crate: a ghost
// follows the cursor with valid/invalid and access-cell highlights, the camera pans with
// WASD/arrows, and left-click commits. Only allowed while the store is closed.
import { UIWindow } from "./UIWindow.js";
import { TILE_SIZE } from "./RoomLayout.js";
import { getFixtureType, fixtureAccessCells, fixtureFootprint } from "./FixtureLayout.js";
import { getFixtureTexture } from "./FixtureTexture.js";

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
        <p class="fixture-stock-meta">Left-click to place. R to turn it. Right-click or Esc to cancel.
          WASD / arrow keys pan the camera. The blue squares in front must stay clear.</p>
        <p data-placement-status role="status"></p>
        <button type="button" class="action-btn" data-cancel-fixture-move>CANCEL</button>
      `,
    }, scene.windowManager);
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
      this.updatePreview(pointer);
      const { id, gx, gy, rotation } = this.placement;
      const placed = this.original
        ? scene.moveFixture(id, gx, gy, rotation)
        : scene.placeFixtureFromCrate(this.fixtureCrate, gx, gy, rotation);
      if (placed) {
        const movedFromLayoutMenu = Boolean(this.original);
        this.cancel();
        // Back to the shop floor, not the Layout tab the move started from.
        if (movedFromLayoutMenu) scene.managerTablet.uiWindow.close();
      }
    };
    scene.input.on("pointerdown", this.handlePointerDown);
    this.handleRotateKey = () => {
      if (!this.active || !scene.controlMode.allows("rotateFixture")) return;
      this.rotation = (this.rotation + 1) % 4;
      this.updatePreview(scene.input.activePointer);
    };
    scene.input.keyboard.on("keydown-R", this.handleRotateKey);
    this.handleDocumentMouseMove = (event) => {
      if (!this.active) return;
      this.mouseClient = { x: event.clientX, y: event.clientY };
      this.updateWindowTransparency();
    };
    document.addEventListener("mousemove", this.handleDocumentMouseMove, true);
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
    this.updatePreview(this.scene.input.activePointer);
    return true;
  }

  /**
   * Center the candidate footprint on the pointer and redraw validity (green/red) and the
   * access cells that must stay clear (blue).
   * @param {Phaser.Input.Pointer} pointer
   */
  updatePreview(pointer) {
    const world = this.scene.screenToWorld?.(pointer.x, pointer.y) ?? this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const { w, h } = fixtureFootprint({ type: this.spec.id, rotation: this.rotation });
    this.placement = {
      id: this.original?.id ?? this.scene.fixtures.nextId(this.spec.id),
      type: this.spec.id,
      gx: Math.floor(world.x / TILE_SIZE) - Math.floor(w / 2),
      gy: Math.floor(world.y / TILE_SIZE) - Math.floor(h / 2),
      rotation: this.rotation,
    };
    const { id, gx, gy, rotation } = this.placement;
    const result = this.original
      ? this.scene.checkFixtureMove(id, gx, gy, rotation)
      : this.scene.checkFixturePlacement(this.spec.id, gx, gy, rotation);
    this.statusElement.textContent = result.reason;
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
   * Keep the preview under the pointer each frame. The whole map is always on screen,
   * so the camera never pans.
   */
  update() {
    if (!this.active) return;
    this.updatePreview(this.scene.input.activePointer);
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
