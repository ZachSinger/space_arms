// The approved mop-window mockup, drawn at its original pixel size.
export const MOP_WINDOW_WIDTH = 40;
export const MOP_WINDOW_HEIGHT = 36;
export const MOP_WINDOW_FRAMES = 8;

const COLORS = Object.freeze({
  ink: "#101222",
  panel: "#1e243a",
  floor: "#3a4254",
  floorEdge: "#485266",
  water: "#547496",
  waterLight: "#6e96ba",
  shine: "#c8ebfa",
  handle: "#d9b178",
  handleLight: "#f0ce96",
  head: "#c84646",
  headDark: "#962c34",
  headLight: "#f48478",
  strand: "#e2e8ec",
  strandMid: "#bac4ce",
  strandBack: "#808c9a",
});

export function mopWindowTexture(frame) {
  return `mop-window-${frame}`;
}

function rectangle(ctx, color, x, y, width, height) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

function drawBackground(ctx) {
  const { ink, panel, floor, floorEdge, water, waterLight } = COLORS;
  rectangle(ctx, ink, 3, 0, 34, 32);
  rectangle(ctx, ink, 1, 1, 38, 30);
  rectangle(ctx, ink, 0, 3, 40, 26);
  rectangle(ctx, panel, 3, 1, 34, 30);
  rectangle(ctx, panel, 2, 2, 36, 28);
  rectangle(ctx, panel, 1, 3, 38, 26);
  rectangle(ctx, floor, 2, 21, 36, 9);
  rectangle(ctx, floorEdge, 2, 21, 36, 1);
  rectangle(ctx, water, 4, 26, 28, 3);
  rectangle(ctx, waterLight, 6, 26, 24, 1);
  rectangle(ctx, ink, 17, 31, 7, 1);
  rectangle(ctx, ink, 18, 32, 5, 1);
  rectangle(ctx, ink, 19, 33, 3, 1);
  rectangle(ctx, ink, 20, 34, 1, 1);
  rectangle(ctx, panel, 19, 31, 3, 1);
  rectangle(ctx, panel, 19, 32, 3, 1);
  rectangle(ctx, panel, 20, 33, 1, 1);
}

function drawMop(ctx, frame) {
  const angle = frame * Math.PI / 4;
  const position = Math.sin(angle);
  const velocity = Math.cos(angle);
  const headX = Math.round(16 + position * 8);
  const lean = Math.abs(velocity) < 0.4 ? 0 : velocity > 0 ? -1 : 1;
  const pixels = new Map();
  const pointKey = (x, y) => y * MOP_WINDOW_WIDTH + x;
  const put = (x, y, color) => {
    if (x >= 1 && x <= 38 && y >= 1 && y <= 29) pixels.set(pointKey(x, y), color);
  };
  const strand = (x, top, color, number, fan) => {
    const points = [[x, top], [x, top + 1]];
    let endX = x;
    for (let y = top + 2; y <= 26; y += 1) {
      const step = y - top - 2 < 2 ? lean : (lean || fan);
      if ((y - top - 2) % 2 === 0) endX += step;
      points.push([endX, y]);
    }
    const trail = lean || fan;
    if (trail) {
      const length = (lean ? 2 : 1) + (frame + number) % 2;
      for (let n = 1; n <= length; n += 1) points.push([endX + trail * n, 26]);
    }
    return { points, color };
  };
  const back = [0, 2, 4].map((offset, index) => strand(
    headX - 1 + offset, 20, COLORS.strandBack, index,
    Math.abs(velocity) <= 0.4 && offset > 1 ? 1 : 0,
  ));
  const front = [0, 2, 4].map((offset, index) => strand(
    headX - 3 + offset, 21, index % 2 === 0 ? COLORS.strand : COLORS.strandMid, index + 3,
    Math.abs(velocity) <= 0.4 ? Math.sign(offset - 2) : 0,
  ));
  for (const group of [back, front]) {
    for (const { points } of group) {
      const keys = new Set(points.map(([x, y]) => pointKey(x, y)));
      for (const [x, y] of points) {
        for (const dx of [-1, 1]) {
          const adjacent = pointKey(x + dx, y);
          if (!keys.has(adjacent) &&
            ![COLORS.strand, COLORS.strandMid, COLORS.strandBack].includes(pixels.get(adjacent))) {
            put(x + dx, y, COLORS.ink);
          }
        }
      }
    }
    for (const { points, color } of group) {
      for (const [x, y] of points) put(x, y, color);
    }
  }

  const head = [];
  for (let n = 0; n < 6; n += 1) {
    head.push([headX - 3 + n, 20, COLORS.head], [headX - 3 + n, 21, COLORS.headDark]);
    head.push([headX - 2 + n, 19, COLORS.headLight]);
  }
  const headPoints = new Set(head.map(([x, y]) => pointKey(x, y)));
  for (const [x, y] of head) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (y + dy < 22 && !headPoints.has(pointKey(x + dx, y + dy))) put(x + dx, y + dy, COLORS.ink);
    }
  }
  for (const [x, y, color] of head) put(x, y, color);

  const handle = new Set();
  for (let n = 0; n < 18; n += 1) {
    if (headX + 1 + n < MOP_WINDOW_WIDTH) handle.add(pointKey(headX + 1 + n, 18 - n));
    if (headX + 2 + n < MOP_WINDOW_WIDTH) handle.add(pointKey(headX + 2 + n, 18 - n));
  }
  for (const key of handle) {
    const x = key % MOP_WINDOW_WIDTH;
    const y = Math.floor(key / MOP_WINDOW_WIDTH);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1]]) {
      const adjacent = pointKey(x + dx, y + dy);
      if (!handle.has(adjacent) && !headPoints.has(adjacent)) put(x + dx, y + dy, COLORS.ink);
    }
  }
  for (let n = 0; n < 18; n += 1) {
    put(headX + 1 + n, 18 - n, COLORS.handle);
    put(headX + 2 + n, 18 - n, COLORS.handleLight);
  }
  for (const [key, color] of pixels) {
    rectangle(ctx, color, key % MOP_WINDOW_WIDTH, Math.floor(key / MOP_WINDOW_WIDTH), 1, 1);
  }
  if (Math.abs(velocity) < 0.75) {
    const side = position > 0 ? 1 : -1;
    for (const [x, y, color] of [
      [headX + side * 8, 24, COLORS.shine],
      [headX + side * 10, 22, COLORS.waterLight],
      [headX + side * 7, 21, COLORS.shine],
    ]) {
      if (x >= 2 && x <= 37) rectangle(ctx, color, x, y, 1, 1);
    }
  }
}

export function ensureMopWindowTextures(scene) {
  for (let frame = 0; frame < MOP_WINDOW_FRAMES; frame += 1) {
    const key = mopWindowTexture(frame);
    if (scene.textures.exists(key)) continue;
    const texture = scene.textures.createCanvas(key, MOP_WINDOW_WIDTH, MOP_WINDOW_HEIGHT);
    drawBackground(texture.context);
    drawMop(texture.context, frame);
    texture.refresh().setFilter(1);
  }
}
