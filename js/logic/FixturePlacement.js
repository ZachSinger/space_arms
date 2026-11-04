import { UIWindow } from "./UIWindow.js";
import { TILE_SIZE } from "./RoomLayout.js";
import { getFixtureType, fixtureAccessCells } from "./FixtureLayout.js";

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
        <p class="fixture-stock-meta">Left-click to place. Right-click or Esc to cancel.
          WASD / arrow keys pan the camera. The front must remain accessible.</p>
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
      if (!this.active || pointer.event?.target !== scene.game.canvas) return;
      if (pointer.rightButtonDown()) {
        this.cancel();
        return;
      }
      if (!pointer.leftButtonDown()) return;
      this.updatePreview(pointer);
      const placed = this.original
        ? scene.moveFixture(this.placement.id, this.placement.gx, this.placement.gy)
        : scene.placeFixtureFromCrate(this.fixtureCrate, this.placement.gx, this.placement.gy);
      if (placed) {
        this.cancel();
      }
    };
    scene.input.on("pointerdown", this.handlePointerDown);
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

  begin(id) {
    if (!this.scene.canRearrangeFixtures()) {
      this.scene.showShopMessage("Fixtures can only move while the store is closed.");
      return false;
    }
    const original = this.scene.fixtures.get(id);
    if (!original) throw new Error(`Unknown fixture: ${id}`);
    return this.start(original.type, original, null);
  }

  beginFromCrate(crate) {
    if (!this.scene.canRearrangeFixtures()) {
      this.scene.showShopMessage("Fixtures can only be placed while the store is closed.");
      return false;
    }
    if (crate !== this.scene.carriedCrate || crate?.kind !== "fixture") return false;
    return this.start(crate.typeId, null, crate);
  }

  start(typeId, original, fixtureCrate) {
    this.cancel();
    this.scene.endRegisterSession();
    this.original = original;
    this.fixtureCrate = fixtureCrate;
    this.spec = getFixtureType(typeId);
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
    this.scene.cameras.main.stopFollow();
    this.scene.restockCrates.forEach((crate) => crate.setPaused(true));
    const x = original?.x ?? fixtureCrate.sprite.x;
    const y = original?.y ?? fixtureCrate.sprite.y;
    this.ghost = this.scene.add.image(x, y, this.spec.texture)
      .setDisplaySize(this.spec.w * TILE_SIZE, this.spec.h * TILE_SIZE)
      .setAlpha(0.5).setDepth(9996);
    this.graphics.setVisible(true);
    this.uiWindow.openWindow();
    this.mouseClient = null;
    this.updatePreview(this.scene.input.activePointer);
    return true;
  }

  updatePreview(pointer) {
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.placement = {
      id: this.original?.id ?? this.scene.fixtures.nextId(this.spec.id),
      type: this.spec.id,
      gx: Math.floor(world.x / TILE_SIZE) - Math.floor(this.spec.w / 2),
      gy: Math.floor(world.y / TILE_SIZE) - Math.floor(this.spec.h / 2),
    };
    const result = this.original
      ? this.scene.checkFixtureMove(this.placement.id, this.placement.gx, this.placement.gy)
      : this.scene.checkFixturePlacement(this.spec.id, this.placement.gx, this.placement.gy);
    this.statusElement.textContent = result.reason;
    const color = result.valid ? 0x10b981 : 0xef4444;
    const x = this.placement.gx * TILE_SIZE;
    const y = this.placement.gy * TILE_SIZE;
    this.graphics.clear().fillStyle(color, 0.22).lineStyle(2, color, 1)
      .fillRect(x, y, this.spec.w * TILE_SIZE, this.spec.h * TILE_SIZE)
      .strokeRect(x, y, this.spec.w * TILE_SIZE, this.spec.h * TILE_SIZE);
    this.graphics.lineStyle(2, 0x38bdf8, 1);
    // Registers also need the row behind them clear -- that's where the player stands.
    const accessCells = this.spec.kind === "register"
      ? [...fixtureAccessCells(this.placement), ...fixtureAccessCells(this.placement, true)]
      : fixtureAccessCells(this.placement);
    for (const cell of accessCells) {
      this.graphics.strokeRect(cell.gx * TILE_SIZE + 3, cell.gy * TILE_SIZE + 3, TILE_SIZE - 6, TILE_SIZE - 6);
    }
    this.ghost.setPosition(x + this.spec.w * TILE_SIZE / 2, y + this.spec.h * TILE_SIZE / 2);
  }

  update(delta) {
    if (!this.active) return;
    const camera = this.scene.cameras.main;
    const { cursors, wasd } = this.scene.player;
    const amount = 400 * delta / 1000;
    camera.scrollX += amount * (Number(cursors.right.isDown || wasd.right.isDown) - Number(cursors.left.isDown || wasd.left.isDown));
    camera.scrollY += amount * (Number(cursors.down.isDown || wasd.down.isDown) - Number(cursors.up.isDown || wasd.up.isDown));
    this.updatePreview(this.scene.input.activePointer);
  }

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
    this.scene.input.keyboard.resetKeys();
    this.scene.cameras.main.startFollow(this.scene.player.sprite, true, 0.1, 0.1);
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
    document.removeEventListener("mousemove", this.handleDocumentMouseMove, true);
    this.graphics.destroy();
  }
}
