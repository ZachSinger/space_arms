// ==========================================
// FILE: LoadingPadEscape.js
// ==========================================
// Crates on the Loading Pad are solid to the player and the gaps between them are narrower
// than he is, so a delivery landing around him can box him in. This checks for that.

const overlaps = (a, b) =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

/**
 * Whether the player could walk from where he stands to floor fully above the Loading Pad.
 * Only the area between the backroom's side walls, from just above the pad down to the
 * bottom wall, is searched, one pixel at a time.
 * @param {object} options
 * @param {{left:number, top:number, width:number, height:number}} options.player - his body, px
 * @param {{left:number, top:number, width:number, height:number}[]} options.crates - pad crate bodies, px
 * @param {{top:number}} options.pad - the Loading Pad, px
 * @param {{left:number, right:number, bottom:number}} options.floor - backroom floor edges, px
 * @returns {boolean}
 */
export function canLeaveLoadingPad({ player, crates, pad, floor }) {
  const { width, height } = player;
  const goalTop = pad.top - height;
  if (player.top <= goalTop) return true;
  const startX = Math.round(player.left);
  const startY = Math.round(player.top);
  const minX = floor.left;
  const maxX = floor.right - width;
  const maxY = floor.bottom - height;
  const columns = maxX - minX + 1;
  const isOpen = (x, y) => !crates.some((crate) => overlaps({ left: x, top: y, width, height }, crate));
  if (startX < minX || startX > maxX || startY > maxY || !isOpen(startX, startY)) return false;

  const seen = new Set([(startY - goalTop) * columns + (startX - minX)]);
  const queue = [[startX, startY]];
  for (let index = 0; index < queue.length; index += 1) {
    const [x, y] = queue[index];
    if (y <= goalTop) return true;
    for (const [nextX, nextY] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nextX < minX || nextX > maxX || nextY < goalTop || nextY > maxY) continue;
      const key = (nextY - goalTop) * columns + (nextX - minX);
      if (seen.has(key)) continue;
      seen.add(key);
      if (isOpen(nextX, nextY)) queue.push([nextX, nextY]);
    }
  }
  return false;
}
