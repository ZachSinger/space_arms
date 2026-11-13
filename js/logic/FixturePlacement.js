// ==========================================
// FILE: FixturePlacement.js
// ==========================================
// Placement mode for moving an existing fixture or unpacking a fixture crate: a ghost
// follows the cursor on the 8-pixel grid, with valid/invalid and standing-space outlines.
// Left-click or A commits. Only allowed while the store is closed.
import { UIWindow } from "./UIWindow.js";
import { TILE_SIZE } from "./RoomLayout.js";
import {
  getFixtureType, fixtureAccessCells, fixtureAtWorldPoint, fixtureFootprint, fixtureFrontClearance, FIXTURE_SNAP_STEP, snapFixturePosition,
} from "./FixtureLayout.js";
import { getFixtureTexture, hasFacingTextures } from "./FixtureTexture.js";
import { PAD } from "./GamepadInput.js";
import { getInputDevice } from "./InputDevice.js";

const PAD_STEPS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const PAD_STEP = FIXTURE_SNAP_STEP;
const VALID_COLOR = 0x10b981;
const INVALID_COLOR = 0xef4444;
const STANDING_COLOR = 0x38bdf8;

/**
 * Outline a fixture's footprint and the standing space in front of it that must stay clear.
 * @param {Phaser.GameObjects.Graphics} graphics
 * @param {{ type: string, gx: number, gy: number, rotation: number }} placement
 * @param {number} color - footprint color
 * @param {number} alpha - line opacity; the footprint fill is fainter
 */
function drawFixtureOutline(graphics, placement, color, alpha, showStandingSpace = true) {
  const { w, h } = fixtureFootprint(placement);
  const x = placement.gx * TILE_SIZE;
  const y = placement.gy * TILE_SIZE;
  graphics.fillStyle(color, 0.22 * alpha).lineStyle(2, color, alpha)
    .fillRect(x, y, w * TILE_SIZE, h * TILE_SIZE)
    .strokeRect(x, y, w * TILE_SIZE, h * TILE_SIZE);
  if (!showStandingSpace) return;
  graphics.lineStyle(2, STANDING_COLOR, alpha);
  const clearance = fixtureFrontClearance(placement);
  if (clearance) {
    graphics.strokeRect(clearance.left * TILE_SIZE, clearance.top * TILE_SIZE,
      (clearance.right - clearance.left) * TILE_SIZE, (clearance.bottom - clearance.top) * TILE_SIZE);
    return;
  }
  // Registers also need the side behind them clear -- that's where the player stands.
  const accessCells = getFixtureType(placement.type).kind === "register"
    ? [...fixtureAccessCells(placement), ...fixtureAccessCells(placement, true)]
    : fixtureAccessCells(placement);
  for (const cell of accessCells) {
    graphics.strokeRect(cell.gx * TILE_SIZE + 3, cell.gy * TILE_SIZE + 3, TILE_SIZE - 6, TILE_SIZE - 6);
  }
}

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
          WASD / arrow keys pan the camera. Keep the blue area in front clear for someone to stand.</p>
        <p class="fixture-stock-meta pad-only">Move it with the left stick or D-pad. A to place. Y to turn it.
          B to cancel. Keep the blue area in front clear for someone to stand.</p>
        <p class="fixture-stock-meta hidden" data-placement-grid-hint>The fixture snaps to an 8-pixel grid.
          Green shows where its body can be placed.</p>
        <p data-placement-status role="status"></p>
        <button type="button" class="action-btn" data-cancel-fixture-move>CANCEL</button>
      `,
    }, scene.windowManager);
    // The controller moves the fixture, not a menu cursor, while this window is up.
    this.uiWindow.element.setAttribute("data-pad-world", "");
    this.bodyElement = this.uiWindow.element.querySelector(".retro-window-body");
    this.nameElement = this.bodyElement.querySelector("[data-placement-name]");
    this.statusElement = this.bodyElement.querySelector("[data-placement-status]");
    this.gridHintElement = this.bodyElement.querySelector("[data-placement-grid-hint]");
    this.bodyElement.querySelector("[data-cancel-fixture-move]").addEventListener("click", () => this.cancel());
    this.uiWindow.onClose = () => this.finish();
    this.graphics = scene.add.graphics().setDepth(9997).setVisible(false);
    // Every other fixture's outline, so you can see what's in the way before moving there.
    this.placedGraphics = scene.add.graphics().setDepth(9995).setVisible(false);
    this.handlePointerDown = (pointer) => {
      // Ignore clicks that land on DOM windows over the canvas.
      if (!this.active || pointer.event?.target !== scene.game.canvas) return;
      if (pointer.rightButtonDown()) {
        this.cancel();
        return;
      }
      if (!pointer.leftButtonDown()) return;
      this.padPoint = null;
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
      if (event.isTrusted) this.padPoint = null;
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
   * Controller: D-pad or left stick moves fixtures by one snap-grid step.
   * @param {import("./GamepadInput.js").GamepadInput} pad
   */
  handlePad(pad) {
    if (!this.active) return;
    if (pad.navDirection || pad.justPressed(PAD.A) || pad.justPressed(PAD.Y)) this.usePadPoint();
    if (pad.navDirection) {
      const [dx, dy] = PAD_STEPS[pad.navDirection];
      this.padPoint = { x: this.padPoint.x + dx * PAD_STEP, y: this.padPoint.y + dy * PAD_STEP };
      this.refreshPreview();
    }
    if (pad.justPressed(PAD.Y)) this.rotate();
    if (pad.justPressed(PAD.A)) this.confirm();
    else if (pad.justPressed(PAD.B)) this.cancel();
  }

  // Switch from the mouse to controller steps, starting where the preview already is.
  usePadPoint() {
    if (this.padPoint) return;
    const { w, h } = fixtureFootprint({ type: this.spec.id, rotation: this.rotation });
    this.padPoint = { x: this.placement.gx + w / 2, y: this.placement.gy + h / 2 };
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
    const areaBlock = this.scene.getFixtureMoveAreaBlockReason(original);
    if (areaBlock) {
      this.scene.showShopMessage(areaBlock);
      return false;
    }
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
    this.ghost = this.scene.add.image(x, y, getFixtureTexture(this.spec))
      .setDisplaySize(this.spec.w * TILE_SIZE, this.spec.h * TILE_SIZE)
      .setAlpha(0.5).setDepth(9996);
    this.graphics.setVisible(true);
    this.drawPlacedFixtures();
    this.uiWindow.openWindow();
    this.mouseClient = null;
    // On a controller the fixture starts where it stands (or where its crate is).
    this.padPoint = getInputDevice() === "gamepad"
      ? { x: snapFixturePosition(x / TILE_SIZE), y: snapFixturePosition(y / TILE_SIZE) }
      : null;
    this.refreshPreview();
    return true;
  }

  // Fixtures can't move while one is being placed, so these are drawn once per placement.
  drawPlacedFixtures() {
    this.placedGraphics.clear().setVisible(true);
    for (const fixture of this.scene.fixtures.layout()) {
      if (fixture.id === this.original?.id) continue;
      drawFixtureOutline(this.placedGraphics, fixture, VALID_COLOR, 0.6, false);
    }
  }

  // Follow the controller's point if it's in use, else the mouse pointer.
  refreshPreview() {
    if (this.padPoint) {
      this.updatePreviewAt(this.padPoint.x * TILE_SIZE, this.padPoint.y * TILE_SIZE);
    } else {
      this.updatePreview(this.scene.input.activePointer);
    }
  }

  /**
   * Center the candidate footprint on the pointer and redraw validity (green/red) and the
   * standing space that must stay clear (blue).
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
    this.placement = fixtureAtWorldPoint({
      id: this.original?.id ?? this.scene.fixtures.nextId(this.spec.id),
      type: this.spec.id,
      rotation: this.rotation,
    }, worldX, worldY);
    const { id, gx, gy, rotation } = this.placement;
    const result = this.original
      ? this.scene.checkFixtureMove(id, gx, gy, rotation)
      : this.scene.checkFixturePlacement(this.spec.id, gx, gy, rotation);
    this.statusElement.textContent = result.valid && getInputDevice() === "gamepad"
      ? result.reason.replace(/^Click to place\./, "Press A to place.")
      : result.reason;
    const x = gx * TILE_SIZE;
    const y = gy * TILE_SIZE;
    drawFixtureOutline(this.graphics.clear(), this.placement, result.valid ? VALID_COLOR : INVALID_COLOR, 1);
    this.ghost.setPosition(x + w * TILE_SIZE / 2, y + h * TILE_SIZE / 2);
    if (hasFacingTextures(this.spec)) {
      // Upright art for the chosen facing, at the same size as the placed fixture.
      this.ghost.setTexture(getFixtureTexture(this.spec, rotation)).setAngle(0);
      this.scene.sizeFacingArt(this.ghost, this.spec, rotation);
    } else {
      this.ghost.setAngle(rotation * 90);
    }
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
    this.placedGraphics.clear().setVisible(false);
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
    this.placedGraphics.destroy();
  }
}
