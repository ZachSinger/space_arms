// Catalog-driven pixel art. Each design has its own silhouette or emblem, not just a tint.
// Every design loops through DECORATION_FRAMES frames: holograms float and scan, banners
// ripple and shimmer, and lights glow in their own way.
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

function mix(color, target, amount) {
  const channel = (shift) => {
    const a = (color >> shift) & 0xff;
    const b = (target >> shift) & 0xff;
    return Math.round(a + (b - a) * amount) << shift;
  };
  return channel(16) | channel(8) | channel(0);
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

function star(g, x, y, color) {
  const points = [];
  for (let i = 0; i <= 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 ? 4 : 10;
    points.push([Math.round(x + Math.cos(angle) * radius), Math.round(y + Math.sin(angle) * radius)]);
  }
  path(g, points, color, 2);
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
  robot(g, c) {
    line(g, 24, 5, 24, 12, c, 2);
    pixel(g, 22, 4, 5, 3, WHITE);
    pixel(g, 12, 13, 25, 24, c);
    pixel(g, 14, 15, 21, 20, DARK);
    pixel(g, 16, 19, 5, 5, WHITE);
    pixel(g, 27, 19, 5, 5, WHITE);
    path(g, [[19, 28], [19, 30], [29, 30], [29, 28]], c, 2);
    pixel(g, 8, 20, 4, 10, c);
    pixel(g, 37, 20, 4, 10, c);
  },
  waveform(g, c) {
    for (const x of [8, 16, 24, 32, 40]) line(g, x, 10, x, 37, STEEL);
    for (const y of [10, 19, 28, 37]) line(g, 8, y, 40, y, STEEL);
    path(g, [[8, 26], [13, 26], [16, 13], [20, 35], [24, 18], [28, 26],
      [34, 26], [37, 20], [40, 26]], c, 2);
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
  salvageGear(g, c) {
    ellipse(g, 24, 28, 9, 9, c);
    ellipse(g, 24, 28, 4, 4, c);
    for (const [x, y, w, h] of [[21, 14, 6, 5], [21, 38, 6, 5],
      [10, 25, 5, 6], [34, 25, 5, 6], [13, 17, 5, 5], [30, 34, 5, 5],
      [30, 17, 5, 5], [13, 34, 5, 5]]) pixel(g, x, y, w, h, c);
    path(g, [[15, 49], [24, 54], [32, 49]], c, 2);
  },
  crossedBlades(g, c) {
    line(g, 14, 16, 34, 42, c, 3);
    line(g, 34, 16, 14, 42, c, 3);
    line(g, 11, 34, 21, 42, WHITE, 2);
    line(g, 27, 42, 37, 34, WHITE, 2);
    pixel(g, 21, 49, 7, 5, c);
  },
  compass(g, c) {
    ellipse(g, 24, 31, 12, 12, c);
    path(g, [[24, 13], [28, 27], [39, 31], [28, 35], [24, 49], [20, 35],
      [9, 31], [20, 27], [24, 13]], c, 2);
    line(g, 24, 20, 24, 41, WHITE);
    line(g, 17, 31, 31, 31, WHITE);
  },
  tradeRoutes(g, c) {
    path(g, [[14, 18], [31, 18], [31, 35], [17, 35], [17, 51], [33, 51]], c, 2);
    for (const [x, y] of [[12, 16], [29, 33], [31, 49]]) {
      pixel(g, x, y, 5, 5, WHITE);
    }
    path(g, [[22, 24], [25, 27], [22, 30]], c, 2);
    path(g, [[24, 42], [27, 45], [24, 48]], c, 2);
  },
  frontierStar(g, c) {
    star(g, 24, 29, c);
    for (const y of [45, 50, 55]) pixel(g, 16, y, 17, 2, c);
  },
  circuit(g, c) {
    pixel(g, 18, 25, 13, 13, c);
    pixel(g, 21, 28, 7, 7, DARK);
    for (const x of [20, 24, 28]) {
      path(g, [[x, 25], [x, 18], [x - 3, 15]], c);
      path(g, [[x, 38], [x, 46], [x + 3, 49]], c);
    }
    path(g, [[18, 30], [12, 30], [12, 41]], c, 2);
    path(g, [[31, 32], [36, 32], [36, 20]], c, 2);
    pixel(g, 10, 41, 4, 4, WHITE);
    pixel(g, 34, 17, 4, 4, WHITE);
  },
  ionTube(g, c, frame = 0) {
    pixel(g, 9, 4, 14, 43, EDGE);
    pixel(g, 11, 6, 10, 39, mix(c, WHITE, pulse(frame) * 0.25));
    pixel(g, 14, 8, 3, 35, WHITE);
    // Bubbles rise up the tube and wrap back to the bottom.
    for (const [k, x] of [[0, 12], [1, 18], [2, 12]]) {
      pixel(g, x, 41 - (frame * 7 + k * 11) % 33, 2, 2, WHITE);
    }
    for (const y of [4, 17, 33, 45]) pixel(g, 7, y, 18, 3, STEEL);
    pixel(g, 6, 4, 2, 43, STEEL);
    pixel(g, 24, 4, 2, 43, STEEL);
    pixel(g, 13, 48, 6, 6, STEEL);
  },
  hexLantern(g, c, frame = 0) {
    path(g, [[11, 9], [21, 9], [26, 18], [26, 32], [21, 41], [11, 41],
      [5, 32], [5, 18], [11, 9]], STEEL, 2);
    pixel(g, 9, 18, 15, 15, mix(c, WHITE, pulse(frame) * 0.2));
    pixel(g, 13, 13, 7, 25, mix(c, WHITE, pulse(frame) * 0.2));
    // The flame inside flickers taller and shorter.
    const flame = [17, 14, 16, 13, 15][frame];
    pixel(g, 15, 34 - flame, 3, flame, WHITE);
    line(g, 8, 23, 24, 23, STEEL, 2);
    pixel(g, 13, 43, 6, 11, STEEL);
    path(g, [[12, 9], [12, 4], [20, 4], [20, 9]], STEEL, 2);
  },
  surveyBeacon(g, c, frame = 0) {
    pixel(g, 9, 10, 14, 19, EDGE);
    pixel(g, 11, 12, 10, 14, c);
    pixel(g, 14, 13, 3, 11, WHITE);
    // A bright band sweeps down the lens.
    pixel(g, 11, 12 + frame * 3, 10, 2, WHITE, 0.7);
    pixel(g, 7, 8, 18, 4, STEEL);
    pixel(g, 7, 27, 18, 4, STEEL);
    pixel(g, 14, 31, 4, 11, STEEL);
    path(g, [[16, 38], [5, 57]], STEEL, 3);
    path(g, [[16, 38], [25, 57]], STEEL, 3);
    line(g, 16, 38, 16, 58, STEEL, 2);
    // Signal ticks blink on and off.
    if (frame % 2 === 0) {
      line(g, 6, 5, 9, 7, c);
      line(g, 22, 7, 25, 5, c);
    }
  },
  arcLamp(g, c, frame = 0) {
    // A soft cone of light below the shade, breathing brighter and dimmer.
    for (let k = 0; k < 20; k++) {
      const spread = Math.floor(k / 4);
      pixel(g, 21 - spread, 31 + k, 2 + spread * 2, 1, c, 0.08 + pulse(frame) * 0.1);
    }
    // A speck of light drifts down through the glow.
    pixel(g, 21 + (frame % 2), 33 + frame * 4, 2, 2, WHITE, 0.6);
    path(g, [[7, 53], [7, 16], [10, 7], [17, 4], [23, 9], [23, 16]], STEEL, 3);
    pixel(g, 17, 16, 11, 5, EDGE);
    pixel(g, 15, 21, 13, 4, STEEL);
    pixel(g, 17, 25, 9, 3, c);
    pixel(g, 19, 28, 5, 3, mix(c, WHITE, 0.5 + pulse(frame) * 0.5));
    pixel(g, 7, 49, 3, 5, WHITE);
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

// The tail ripples, a glint runs down the trim, and the emblem glows softly.
function drawBanner(g, spec, color, frame) {
  pixel(g, 22, 4, 4, 69, EDGE);
  pixel(g, 23, 5, 2, 66, STEEL);
  pixel(g, 4, 2, 40, 4, EDGE);
  pixel(g, 6, 3, 36, 2, STEEL);
  pixel(g, 9, 6, 30, 55, EDGE);
  pixel(g, 11, 7, 26, 52, DARK);
  pixel(g, 11, 7, 2, 52, color);
  pixel(g, 35, 7, 2, 52, color);
  const glint = 7 + Math.round(frame * 52 / DECORATION_FRAMES);
  pixel(g, 11, glint, 2, 4, WHITE);
  pixel(g, 35, glint, 2, 4, WHITE);
  const phase = frame / DECORATION_FRAMES * Math.PI * 2;
  for (let i = 0; i < 7; i++) {
    const sway = Math.round(Math.sin(phase + i * 0.8));
    pixel(g, 12 + i * 2 + sway, 59 + i, 24 - i * 4, 1, color);
  }
  MOTIFS[spec.motif](g, mix(color, WHITE, pulse(frame) * 0.3));
  pixel(g, 7, 71, 34, 5, EDGE);
  pixel(g, 10, 72, 28, 2, STEEL);
}

function drawLight(g, spec, color, frame) {
  MOTIFS[spec.motif](g, color, frame);
  if (spec.motif === "surveyBeacon") return;
  pixel(g, 4, 54, 24, 6, EDGE);
  pixel(g, 6, 55, 20, 3, STEEL);
  pixel(g, 10, 56, 12, 1, DARK);
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
      if (spec.artFamily === "hologram") drawHologram(graphics, spec, color, frame);
      else if (spec.artFamily === "banner") drawBanner(graphics, spec, color, frame);
      else drawLight(graphics, spec, color, frame);
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
