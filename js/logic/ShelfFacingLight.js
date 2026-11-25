// ==========================================
// FILE: ShelfFacingLight.js
// ==========================================
// A one-screen-pixel light marks the shopping edge without adding a floor marker.
import { getFixtureType, fixtureArtInset, fixtureFootprint, fixtureRotation } from "./FixtureLayout.js";
import { pulseAmount } from "./ShelfAttentionHighlight.js";

export class ShelfFacingLight {
  constructor(scene, fixture) {
    this.scene = scene;
    this.fixture = fixture;
    this.graphics = scene.add.graphics().setDepth(2.75);
  }

  /** @param {number} timeMs - scene time */
  update(timeMs) {
    const { fixture } = this;
    const spec = getFixtureType(fixture.type);
    const b = fixture.sprite.getBounds();
    const rotation = fixtureRotation(fixture);
    const camera = this.scene.cameras.main;
    const pixel = 1 / camera.zoom;
    // Budget art has transparent padding above shorter shelves and beside side views.
    const top = b.y + b.height * ((3 - spec.shelfRows) * 44 + 4) / 192;
    let x, y, width, height;
    if (rotation === 0 || rotation === 2) {
      x = b.x + 3;
      y = rotation === 0 ? b.bottom - pixel : top;
      width = b.width - 6;
      height = pixel;
    } else {
      const inset = fixtureArtInset(fixture);
      const { w } = fixtureFootprint(fixture);
      x = rotation === 1 ? b.x + b.width * inset.left / w : b.right - b.width * inset.right / w - pixel;
      y = b.y + 4;
      width = pixel;
      height = b.height - 8;
    }
    x = Math.round((x - camera.scrollX) * camera.zoom) * pixel + camera.scrollX;
    y = Math.round((y - camera.scrollY) * camera.zoom) * pixel + camera.scrollY;
    this.graphics.clear()
      .fillStyle(0xbff8ff, pulseAmount(timeMs, 3000))
      .fillRect(x, y, width, height);
  }

  destroy() {
    this.graphics.destroy();
  }
}
