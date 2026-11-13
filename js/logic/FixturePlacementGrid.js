import { FIXTURE_SNAP_STEP, fixtureFootprint } from "./FixtureLayout.js";
import { TILE_SIZE } from "./RoomLayout.js";

const SNAP_STEP = FIXTURE_SNAP_STEP * TILE_SIZE;
const COVERAGE_STEP = SNAP_STEP / 2;
const FRAME_BUDGET_MS = 4;
const REDRAW_INTERVAL_MS = 80;

function addFootprint(scan, bounds) {
  const left = Math.max(bounds.left, scan.left);
  const right = Math.min(bounds.right, scan.right);
  const top = Math.max(bounds.top, scan.top);
  const bottom = Math.min(bounds.bottom, scan.bottom);
  if (left >= right || top >= bottom) return;

  // Four corner updates record the union without drawing overlapping transparent fills.
  const fromX = (left - scan.left) / COVERAGE_STEP;
  const toX = (right - scan.left) / COVERAGE_STEP;
  const fromY = (top - scan.top) / COVERAGE_STEP;
  const toY = (bottom - scan.top) / COVERAGE_STEP;
  scan.coverage[fromY * scan.stride + fromX] += 1;
  scan.coverage[fromY * scan.stride + toX] -= 1;
  scan.coverage[toY * scan.stride + fromX] -= 1;
  scan.coverage[toY * scan.stride + toX] += 1;
  scan.dirty = true;
}

function finishRun(scan) {
  if (!scan.run) return;
  addFootprint(scan, scan.run);
  scan.run = null;
}

function drawCoverage(graphics, scan) {
  graphics.clear().fillStyle(0x00ff00, 0.3);
  const columns = new Int32Array(scan.stride);
  let active = new Map();
  const fill = (rect) => graphics.fillRect(rect.x, rect.y, rect.width, rect.height);
  for (let row = 0; row < scan.rows; row++) {
    let occupied = 0;
    let start = -1;
    const next = new Map();
    for (let column = 0; column < scan.stride; column++) {
      columns[column] += scan.coverage[row * scan.stride + column];
      occupied += columns[column];
      if (occupied > 0 && start === -1) start = column;
      if (occupied === 0 && start !== -1) {
        const key = `${start},${column}`;
        const rect = active.get(key) ?? {
          x: scan.left + start * COVERAGE_STEP,
          y: scan.top + row * COVERAGE_STEP,
          width: (column - start) * COVERAGE_STEP,
          height: 0,
        };
        rect.height += COVERAGE_STEP;
        next.set(key, rect);
        active.delete(key);
        start = -1;
      }
    }
    for (const rect of active.values()) fill(rect);
    active = next;
  }
  for (const rect of active.values()) fill(rect);
  scan.dirty = false;
  scan.lastDraw = performance.now();
}

export class FixturePlacementGrid {
  constructor(scene) {
    this.scene = scene;
    this.enabled = false;
    this.signature = null;
    this.scan = null;
    this.graphics = scene.add.graphics().setDepth(9998).setVisible(false);
  }

  toggle() {
    this.enabled = !this.enabled;
    this.update();
  }

  update() {
    const scene = this.scene;
    const placement = scene.fixturePlacement;
    placement.gridHintElement?.classList.toggle("hidden", !this.enabled || !placement.active);
    if (!this.enabled || !placement.active) {
      this.graphics.clear().setVisible(false);
      this.signature = null;
      this.scan = null;
      return;
    }
    const camera = scene.playerInBackroom ? scene.backroomCamera : scene.cameras.main;
    const view = camera.worldView;
    const zones = scene.room.zones.filter((zone) =>
      !zone.locked && (scene.playerInBackroom ? zone.backroom : zone.salesFloor));
    const left = Math.floor(Math.max(view.x, Math.min(...zones.map((z) => z.gridX * TILE_SIZE)) - TILE_SIZE) / SNAP_STEP) * SNAP_STEP;
    const top = Math.floor(Math.max(view.y, Math.min(...zones.map((z) => z.gridY * TILE_SIZE)) - TILE_SIZE) / SNAP_STEP) * SNAP_STEP;
    const right = Math.ceil(Math.min(view.right, Math.max(...zones.map((z) => (z.gridX + z.gridW) * TILE_SIZE)) + TILE_SIZE) / SNAP_STEP) * SNAP_STEP;
    const bottom = Math.ceil(Math.min(view.bottom, Math.max(...zones.map((z) => (z.gridY + z.gridH) * TILE_SIZE)) + TILE_SIZE) / SNAP_STEP) * SNAP_STEP;
    const bodies = [scene.player.sprite.body, ...scene.restockCrates.map((crate) => crate.sprite.body)]
      .filter((body) => body.enable)
      .map(({ left, right, top, bottom }) => ({ left, right, top, bottom }));
    const signature = JSON.stringify([
      placement.spec.id, placement.rotation, placement.original?.id,
      scene.fixtures.layout(), bodies, scene.playerInBackroom,
      scene.room.zones.map((zone) => [zone.id, zone.locked]),
      [...scene.room.wallCells].map(([key, wall]) => [key, wall.door]), left, top, right, bottom,
    ]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.graphics.clear().setVisible(true);
      this.scan = null;
      if (left < right && top < bottom) {
        const candidate = {
          id: placement.original?.id ?? scene.fixtures.nextId(placement.spec.id),
          type: placement.spec.id, rotation: placement.rotation,
        };
        const footprint = fixtureFootprint(candidate);
        const width = footprint.w * TILE_SIZE;
        const height = footprint.h * TILE_SIZE;
        const stride = (right - left) / COVERAGE_STEP + 1;
        const rows = (bottom - top) / COVERAGE_STEP;
        const startX = Math.ceil((left - width) / SNAP_STEP) * SNAP_STEP;
        const startY = Math.ceil((top - height) / SNAP_STEP) * SNAP_STEP;
        this.scan = {
          left, top, right, bottom, width, height,
          x: startX, y: startY,
          startX, run: null,
          stride, rows, coverage: new Int32Array(stride * (rows + 1)),
          connectivityCache: new Map(), candidate, dirty: false, lastDraw: 0,
        };
      }
    }
    const scan = this.scan;
    if (!scan) return;
    const started = performance.now();
    let complete = false;
    do {
      if (scan.x > scan.right) {
        finishRun(scan);
        scan.x = scan.startX;
        scan.y += SNAP_STEP;
      }
      if (scan.y > scan.bottom) {
        complete = true;
        break;
      }
      const { x, y } = scan;
      const candidate = { ...scan.candidate, gx: x / TILE_SIZE, gy: y / TILE_SIZE };
      const result = placement.original
        ? scene.checkFixtureMove(candidate.id, candidate.gx, candidate.gy, candidate.rotation, scan.connectivityCache)
        : scene.checkFixturePlacement(candidate.type, candidate.gx, candidate.gy, candidate.rotation, scan.connectivityCache);
      if (result.valid) {
        if (scan.run && x <= scan.run.right) {
          scan.run.right = x + scan.width;
        } else {
          finishRun(scan);
          scan.run = { left: x, right: x + scan.width, top: y, bottom: y + scan.height };
        }
      } else {
        finishRun(scan);
      }
      scan.x += SNAP_STEP;
    } while (performance.now() - started < FRAME_BUDGET_MS);
    finishRun(scan);
    if (scan.dirty && (complete || performance.now() - scan.lastDraw >= REDRAW_INTERVAL_MS)) {
      drawCoverage(this.graphics, scan);
    }
    if (complete) this.scan = null;
  }

  destroy() {
    this.graphics.destroy();
    this.scan = null;
  }
}
