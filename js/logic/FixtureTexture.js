// Temporary overhead shelf art, shared by placed fixtures and placement previews.
import { TILE_SIZE } from "./RoomLayout.js";
import { SHELF_VISUAL_SLOTS_PER_TILE } from "./FixtureLayout.js";

export const TEST_SHELF_SURFACE_COLOR = 0x18212c;

export function getFixtureTexture(scene, spec) {
  if (spec.kind !== "shelf") return spec.texture;
  const key = `test-shelf:${spec.id}`;
  if (scene.textures.exists(key)) return key;

  const width = spec.w * TILE_SIZE;
  const height = spec.h * TILE_SIZE;
  const slotSize = TILE_SIZE / SHELF_VISUAL_SLOTS_PER_TILE;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  try {
    graphics.fillStyle(0x526576).fillRect(0, 0, width, height);
    graphics.fillStyle(TEST_SHELF_SURFACE_COLOR).fillRect(2, 2, width - 4, height - 4);
    graphics.fillStyle(0x324353);
    for (let x = slotSize; x < width; x += slotSize) {
      graphics.fillRect(x - 1, 2, 2, height - 4);
    }
    for (let y = slotSize; y < height; y += slotSize) {
      graphics.fillRect(2, y - 1, width - 4, 2);
    }
    // The light front edge faces the customer; stock boxes leave this rim visible.
    graphics.fillStyle(0xb7cad6).fillRect(2, height - 2, width - 4, 2);
    graphics.generateTexture(key, width, height);
  } finally {
    graphics.destroy();
  }
  return key;
}
