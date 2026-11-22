// Pixel artwork approved in the dirt/mop mockups: three flat marks.
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
}
