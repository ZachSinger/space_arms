// Catalog-driven pixel art. Each design has its own silhouette or emblem, not just a tint.
// Every design loops through DECORATION_FRAMES frames: the hologram floats while scanlines drift.
import { FIXTURE_TYPES, getFixtureType } from "../logic/FixtureLayout.js";
import { TILE_SIZE } from "../logic/RoomLayout.js";

const STEEL = 0x616a7c;
const EDGE = 0x0d1018;
const DARK = 0x252c3b;
const WHITE = 0xdffaff;

export const DECORATION_FRAMES = 5;
export const DECORATION_FRAME_MS = 180;
const HOLOGRAM_BOB = [0, -1, -1, 0, 1];

// Smooth 0..1..0 swell over one loop.
function pulse(frame) {
  return (1 - Math.cos(frame / DECORATION_FRAMES * Math.PI * 2)) / 2;
}

// Draws through `g` shifted by (dx, dy).
function shifted(g, dx, dy) {
  return {
    fillStyle(color, alpha) { g.fillStyle(color, alpha); return this; },
    fillRect(x, y, w, h) { g.fillRect(x + dx, y + dy, w, h); return this; },
  };
}

function pixel(g, x, y, w, h, color, alpha = 1) {
  g.fillStyle(color, alpha).fillRect(x, y, w, h);
}

function line(g, x1, y1, x2, y2, color, size = 1) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    pixel(g, Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t),
      size, size, color);
  }
}

function path(g, points, color, size = 1) {
  for (let i = 1; i < points.length; i++) {
    line(g, ...points[i - 1], ...points[i], color, size);
  }
}

function ellipse(g, x, y, rx, ry, color, tilt = 0) {
  const points = [];
  for (let i = 0; i <= 64; i++) {
    const angle = i / 64 * Math.PI * 2;
    const dx = Math.cos(angle) * rx;
    const dy = Math.sin(angle) * ry;
    points.push([
      Math.round(x + dx * Math.cos(tilt) - dy * Math.sin(tilt)),
      Math.round(y + dx * Math.sin(tilt) + dy * Math.cos(tilt)),
    ]);
  }
  path(g, points, color);
}

const MOTIFS = {
  ringworld(g, c) {
    ellipse(g, 24, 23, 10, 10, c);
    ellipse(g, 24, 23, 17, 5, WHITE, -0.35);
    path(g, [[19, 15], [25, 17], [28, 23], [24, 29]], c, 2);
    pixel(g, 33, 7, 2, 2, WHITE);
  },
  starship(g, c) {
    path(g, [[24, 5], [30, 14], [30, 29], [24, 33], [18, 29], [18, 14], [24, 5]], c, 2);
    path(g, [[18, 23], [10, 33], [18, 31]], c, 2);
    path(g, [[30, 23], [37, 33], [30, 31]], c, 2);
    pixel(g, 22, 15, 5, 6, WHITE);
    path(g, [[20, 35], [23, 42], [26, 35], [29, 39]], c, 2);
  },
  galaxy(g, c) {
    for (const offset of [0, Math.PI]) {
      const points = [];
      for (let i = 0; i < 45; i++) {
        const angle = i * 0.12 + offset;
        const radius = 2 + i * 0.32;
        points.push([Math.round(24 + Math.cos(angle) * radius),
          Math.round(24 + Math.sin(angle) * radius * 0.8)]);
      }
      path(g, points, c, 2);
    }
    pixel(g, 22, 22, 5, 5, WHITE);
    for (const [x, y] of [[8, 10], [36, 8], [11, 36], [37, 34]]) pixel(g, x, y, 2, 2, c);
  },
  crystal(g, c) {
    path(g, [[24, 5], [35, 17], [32, 33], [24, 42], [15, 33], [12, 17], [24, 5]], c, 2);
    path(g, [[24, 5], [20, 18], [24, 42], [28, 18], [24, 5]], WHITE);
    path(g, [[12, 17], [20, 18], [28, 18], [35, 17]], c);
    line(g, 7, 30, 40, 30, c);
  },
  atom(g, c) {
    for (const tilt of [0, Math.PI / 3, -Math.PI / 3]) ellipse(g, 24, 23, 17, 6, c, tilt);
    pixel(g, 21, 20, 7, 7, WHITE);
    for (const [x, y] of [[7, 22], [30, 8], [30, 36]]) pixel(g, x, y, 3, 3, WHITE);
  },
  shield(g, c) {
    path(g, [[12, 8], [35, 8], [34, 26], [30, 34], [24, 41], [17, 34],
      [13, 26], [12, 8]], c, 2);
    line(g, 24, 12, 24, 32, WHITE, 2);
    line(g, 17, 20, 31, 20, WHITE, 2);
    path(g, [[8, 12], [8, 32], [12, 37]], c);
    path(g, [[39, 12], [39, 32], [35, 37]], c);
  },
  jumpgate(g, c) {
    ellipse(g, 24, 24, 15, 17, c);
    ellipse(g, 24, 24, 11, 13, c);
    for (const [x, y] of [[21, 5], [21, 39], [7, 21], [37, 21]]) pixel(g, x, y, 4, 5, WHITE);
    path(g, [[24, 14], [26, 22], [33, 24], [26, 26], [24, 34], [22, 26],
      [15, 24], [22, 22], [24, 14]], c);
  },
  orrery(g, c) {
    for (const radius of [7, 12, 18]) ellipse(g, 24, 23, radius, radius * 0.8, c);
    pixel(g, 21, 20, 7, 7, WHITE);
    pixel(g, 29, 17, 3, 3, WHITE);
    pixel(g, 12, 25, 4, 4, c);
    pixel(g, 35, 10, 5, 5, WHITE);
  },
};

// The projection floats gently while scanlines drift down through it.
function drawHologram(g, spec, color, frame) {
  pixel(g, 6, 2, 36, 43, color, 0.07 + pulse(frame) * 0.04);
  const drift = Math.round(frame * 8 / DECORATION_FRAMES);
  for (let k = 0; k < 5; k++) pixel(g, 7, 6 + (k * 8 + drift) % 40, 34, 1, color, 0.14);
  MOTIFS[spec.motif](shifted(g, 0, HOLOGRAM_BOB[frame]), color);
  path(g, [[11, 43], [19, 50], [29, 50], [37, 43]], color);
  pixel(g, 4, 50, 40, 10, EDGE);
  pixel(g, 6, 52, 36, 6, STEEL);
  pixel(g, 8, 53, 31, 2, DARK);
  pixel(g, 20, 53, 8, 2, color);
  pixel(g, 22, 53, 4, 2, WHITE, 0.2 + pulse(frame) * 0.6);
  pixel(g, 8, 57, 3, 1, WHITE);
}

/** Frame 0 is the catalog texture itself, so shop previews show it unchanged. */
export function decorationFrameKey(spec, frame) {
  return frame ? `${spec.texture}_${frame}` : spec.texture;
}

export function createDecorationTextures(scene) {
  for (const spec of Object.values(FIXTURE_TYPES)) {
    if (spec.kind !== "decoration") continue;
    const color = Number.parseInt(spec.accent.slice(1), 16);
    for (let frame = 0; frame < DECORATION_FRAMES; frame++) {
      const key = decorationFrameKey(spec, frame);
      if (scene.textures.exists(key)) continue;
      const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
      drawHologram(graphics, spec, color, frame);
      graphics.generateTexture(key, spec.w * TILE_SIZE, spec.h * TILE_SIZE);
      graphics.destroy();
    }
  }
}

// Each placed decoration starts its loop at its own point so matching pieces don't pulse in step.
function loopOffset(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % DECORATION_FRAMES;
}

/** Advances placed decorations' animation; elapsed time stops while the game is paused. */
export function animateDecorations(shop, elapsedMs) {
  const tick = Math.floor(elapsedMs / DECORATION_FRAME_MS);
  for (const fixture of shop.fixtures?.ofKind("decoration") ?? []) {
    const sprite = fixture.sprite;
    if (!sprite?.active) continue;
    const key = decorationFrameKey(getFixtureType(fixture.type),
      (tick + loopOffset(fixture.id)) % DECORATION_FRAMES);
    if (sprite.texture.key !== key) sprite.setTexture(key);
  }
}
