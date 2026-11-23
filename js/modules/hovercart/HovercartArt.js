// The hovercart's pixel art, drawn once per game. The charger's picture is also the
// HOVERCART CHARGER fixture's texture, so it must exist before fixtures are drawn.
export const HOVERCART_TEXTURES = Object.freeze({
  charger: "hovercart-charger",
  docked: "hovercart-cart-docked",
  active: "hovercart-cart-active",
});

function drawTexture(scene, key, width, height, draw) {
  if (scene.textures.exists(key)) return;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  draw(graphics);
  graphics.generateTexture(key, width, height);
  graphics.destroy();
}

function pixel(g, x, y, width, height, color) {
  g.fillStyle(color, 1).fillRect(x, y, width, height);
}

export function createHovercartTextures(scene) {
  const colors = {
    outline: 0x0d1018,
    steel: 0x616a7c,
    light: 0x9aa7bb,
    dark: 0x3f485b,
    deep: 0x252c3b,
    green: 0x5ae678,
    cyan: 0x50c9e8,
  };
  drawTexture(scene, HOVERCART_TEXTURES.charger, 64, 88, (g) => {
    const c = colors;
    pixel(g, 20, 0, 24, 48, c.outline);
    pixel(g, 22, 2, 20, 44, c.steel);
    pixel(g, 23, 3, 3, 41, c.light);
    pixel(g, 41, 3, 1, 41, c.dark);
    pixel(g, 25, 7, 14, 17, c.deep);
    pixel(g, 27, 9, 10, 13, 0x10231a);
    pixel(g, 29, 11, 6, 2, c.green);
    pixel(g, 29, 15, 2, 2, c.green);
    pixel(g, 33, 15, 2, 2, c.green);
    pixel(g, 25, 28, 14, 5, c.dark);
    pixel(g, 27, 35, 10, 9, c.outline);
    pixel(g, 29, 36, 6, 6, c.deep);
    pixel(g, 31, 44, 2, 13, c.outline);
    pixel(g, 32, 45, 1, 11, c.steel);
    pixel(g, 5, 54, 54, 28, c.outline);
    pixel(g, 7, 56, 50, 24, c.steel);
    pixel(g, 9, 58, 46, 18, c.dark);
    pixel(g, 11, 60, 42, 14, c.deep);
    pixel(g, 17, 61, 30, 2, c.steel);
    pixel(g, 19, 62, 26, 3, c.dark);
    pixel(g, 28, 64, 8, 2, c.cyan);
  });
  drawTexture(scene, HOVERCART_TEXTURES.docked, 40, 24, (g) => {
    const c = colors;
    pixel(g, 3, 5, 34, 15, c.outline);
    pixel(g, 5, 6, 30, 12, c.steel);
    pixel(g, 6, 7, 27, 2, c.light);
    pixel(g, 6, 10, 28, 1, c.dark);
    pixel(g, 7, 12, 26, 4, c.deep);
    pixel(g, 11, 17, 18, 2, c.dark);
    pixel(g, 8, 19, 5, 3, c.outline);
    pixel(g, 27, 19, 5, 3, c.outline);
    pixel(g, 9, 20, 3, 1, c.dark);
    pixel(g, 28, 20, 3, 1, c.dark);
    pixel(g, 15, 9, 10, 2, c.outline);
    pixel(g, 16, 10, 2, 1, c.green);
    pixel(g, 19, 10, 2, 1, c.green);
    pixel(g, 22, 10, 2, 1, c.green);
  });
  drawTexture(scene, HOVERCART_TEXTURES.active, 40, 24, (g) => {
    const c = colors;
    pixel(g, 3, 4, 34, 15, c.outline);
    pixel(g, 5, 5, 30, 12, c.steel);
    pixel(g, 6, 6, 27, 2, c.light);
    pixel(g, 6, 9, 28, 1, c.dark);
    pixel(g, 7, 11, 26, 4, c.deep);
    pixel(g, 11, 16, 18, 2, c.dark);
    pixel(g, 8, 19, 5, 2, c.outline);
    pixel(g, 27, 19, 5, 2, c.outline);
    pixel(g, 9, 20, 3, 1, c.cyan);
    pixel(g, 28, 20, 3, 1, c.cyan);
    pixel(g, 15, 8, 10, 2, c.outline);
    pixel(g, 16, 9, 2, 1, c.green);
    pixel(g, 19, 9, 2, 1, c.green);
    pixel(g, 22, 9, 2, 1, c.green);
  });
}

