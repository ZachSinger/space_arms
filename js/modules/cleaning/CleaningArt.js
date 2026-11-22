// Pixel artwork approved in the dirt/mop mockups: three flat marks and the yellow bucket.
export const DIRT_KINDS = Object.freeze(["smudge", "footprints", "scuff"]);

const MARKS = {
  smudge: [
    ".........dddddd...........",
    ".....ddddmmmmmmddd........",
    "...ddmmmmmmhmmmmmmdd......",
    "..dmmmmhhhmmmhhhhmmmdd....",
    ".ddmmhhhhhhhhhhmmmmmmdd...",
    "..dmmmmhhhhmmmmmmmmmmmd...",
    "...ddmmmmmmmmmmmmmdddd....",
    ".....ddddmmmmmmdddd.......",
    ".........dddddd...........",
  ],
  footprints: [
    "................mmmm.....",
    "...............mmhhmm....",
    "...............mhhmhm....",
    "...mmmm.........mhmhm....",
    "..mmhhmm........mmhmm....",
    "..mhhmhm.........mmmm....",
    "...mhmhm................",
    "...mmhmm.........mmm.....",
    "....mmmm........mmhmm....",
    "................mmmmm...",
    "....mmm..........mmm.....",
    "...mmhmm.................",
    "...mmmmm.................",
    "....mmm..................",
  ],
  scuff: [
    "...............dd...........",
    "..........dddddhmd..........",
    "....ddd.ddmmmmhhmd..........",
    "..ddmmmddmmhhmmmdd...dd.....",
    ".dmmhhmmmmmmmmmdd..ddmmd....",
    "..dmmmmmmhmmmmdd..dmhhmd....",
    "...ddddmmmmdddd....dmmd.....",
    ".......dddd.........dd......",
  ],
};
const PALETTES = {
  smudge: { d: "rgba(28,27,38,.49)", m: "rgba(48,41,46,.78)", h: "rgba(115,93,82,.67)" },
  footprints: { m: "rgba(93,75,67,.78)", h: "rgba(151,125,99,.73)" },
  scuff: { d: "rgba(38,39,55,.43)", m: "rgba(85,82,84,.71)", h: "rgba(150,140,123,.67)" },
};

export function ensureCleaningTextures(scene) {
  for (const kind of DIRT_KINDS) {
    const key = `dirt-${kind}`;
    if (scene.textures.exists(key)) continue;
    const rows = MARKS[kind];
    const texture = scene.textures.createCanvas(key, Math.max(...rows.map((row) => row.length)), rows.length);
    const ctx = texture.context;
    rows.forEach((row, y) => [...row].forEach((pixel, x) => {
      const color = PALETTES[kind][pixel];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }));
    texture.refresh().setFilter(1);
  }
  if (scene.textures.exists("mop_bucket")) return;
  const texture = scene.textures.createCanvas("mop_bucket", 64, 64);
  const ctx = texture.context;
  ctx.translate(16, 15);
  ctx.scale(1.5, 1.5);
  const rect = (color, x, y, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const polygon = (color, points) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.fill();
  };
  rect("#101426", 4, 1, 13, 7);
  rect("#e7bb55", 5, 2, 11, 5);
  polygon("#101426", [[2, 6], [18, 6], [16, 19], [14, 21], [6, 21], [4, 19]]);
  polygon("#b98a31", [[4, 7], [16, 7], [14, 19], [6, 19]]);
  polygon("#e7bb55", [[5, 9], [6, 9], [8, 18], [12, 18], [12, 19], [7, 19]]);
  polygon("#735128", [[14, 9], [16, 9], [14, 19], [12, 19]]);
  rect("#101426", 1, 5, 19, 4);
  rect("#e7bb55", 3, 5, 15, 3);
  rect("#8596a7", 5, 6, 11, 1);
  rect("#101426", 13, 3, 7, 5);
  rect("#b98a31", 14, 3, 5, 4);
  rect("#e7bb55", 15, 3, 1, 4);
  rect("#735128", 17, 3, 1, 4);
  texture.refresh().setFilter(1);
}
