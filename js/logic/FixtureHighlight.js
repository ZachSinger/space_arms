import { TILE_SIZE } from "./RoomLayout.js";
import { getFixtureType } from "./FixtureLayout.js";

const HIGHLIGHT_COLOR = 0x22c55e;
const CLEARANCE_PX = 12;
const SLIDE_MS = 180;
const HUD_HEIGHT_PX = 36;

const overlaps = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// Smallest horizontal and/or vertical shift that moves `windowRect` clear of `targetRect`,
// preferring shifts that keep the window inside `viewport`. Rects are {left, top, right, bottom}.
export function computeSlideOffset(windowRect, targetRect, viewport, clearance = CLEARANCE_PX) {
  const target = {
    left: targetRect.left - clearance,
    top: targetRect.top - clearance,
    right: targetRect.right + clearance,
    bottom: targetRect.bottom + clearance,
  };
  if (!overlaps(windowRect, target)) return { x: 0, y: 0 };

  const xs = [0, target.right - windowRect.left, target.left - windowRect.right];
  const ys = [0, target.bottom - windowRect.top, target.top - windowRect.bottom];
  const candidates = [];
  for (const x of xs) {
    for (const y of ys) {
      if (x === 0 && y === 0) continue;
      const moved = {
        left: windowRect.left + x,
        right: windowRect.right + x,
        top: windowRect.top + y,
        bottom: windowRect.bottom + y,
      };
      if (overlaps(moved, target)) continue;
      const inside =
        moved.left >= viewport.left &&
        moved.right <= viewport.right &&
        moved.top >= viewport.top &&
        moved.bottom <= viewport.bottom;
      candidates.push({ x, y, inside, cost: Math.abs(x) + Math.abs(y) });
    }
  }
  candidates.sort((a, b) => Number(b.inside) - Number(a.inside) || a.cost - b.cost);
  return { x: candidates[0].x, y: candidates[0].y };
}

// Hovering a fixture row in the Manager Tablet outlines that fixture in green on the shop
// floor. Left-clicking the row pins the highlight and slides the Tablet aside if it covers
// the fixture.
export class FixtureHighlight {
  constructor(scene, uiWindow) {
    this.scene = scene;
    this.uiWindow = uiWindow;
    this.element = uiWindow.element;
    this.pinnedId = null;
    this.offset = { x: 0, y: 0 };
    this.graphics = scene.add.graphics().setDepth(9995).setVisible(false);

    this.element.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;

    this.element.addEventListener("mouseover", (event) => {
      const row = event.target.closest("[data-fixture-row-id]");
      if (row) this.draw(row.dataset.fixtureRowId);
      else if (!event.target.closest(".retro-window-header")) this.draw(this.pinnedId);
    });
    this.element.addEventListener("mouseleave", () => this.draw(this.pinnedId));
    this.element.addEventListener("click", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const row = event.target.closest("[data-fixture-row-id]");
      if (row) this.pin(row.dataset.fixtureRowId);
    });

    // Bake any slide into the real position before a header drag, so the drag doesn't jump.
    this.element.querySelector(".retro-window-header").addEventListener("mousedown", () => {
      const rect = this.element.getBoundingClientRect();
      this.element.style.transition = "none";
      this.setOffset({ x: 0, y: 0 });
      this.element.style.left = `${rect.left}px`;
      this.element.style.top = `${rect.top}px`;
      this.uiWindow.screenX = rect.left;
      this.uiWindow.screenY = rect.top;
      void this.element.offsetWidth;
      this.element.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
    });
  }

  fixtureWorldRect(fixtureId) {
    const entry = this.scene.fixtures.get(fixtureId);
    const spec = entry && getFixtureType(entry.type);
    if (!spec) return null;
    return { x: entry.gx * TILE_SIZE, y: entry.gy * TILE_SIZE, width: spec.w * TILE_SIZE, height: spec.h * TILE_SIZE };
  }

  draw(fixtureId) {
    const rect = fixtureId && this.fixtureWorldRect(fixtureId);
    this.fixtureId = rect ? fixtureId : null;
    if (!rect) {
      this.graphics.clear().setVisible(false);
      return;
    }
    const { x, y, width, height } = rect;
    this.graphics.clear().setVisible(true)
      .fillStyle(HIGHLIGHT_COLOR, 0.3).fillRect(x, y, width, height)
      .lineStyle(3, HIGHLIGHT_COLOR, 1).strokeRect(x, y, width, height);
  }

  pin(fixtureId) {
    const rect = this.fixtureWorldRect(fixtureId);
    if (!rect) return;
    this.pinnedId = fixtureId;
    this.draw(fixtureId);
    this.setOffset(computeSlideOffset(this.baseRect(), this.worldToClientRect(rect.x, rect.y, rect.width, rect.height), {
      left: 0,
      top: HUD_HEIGHT_PX,
      right: window.innerWidth,
      bottom: window.innerHeight,
    }));
  }

  // The window's rect as if it were not slid.
  baseRect() {
    const rect = this.element.getBoundingClientRect();
    const transform = getComputedStyle(this.element).transform;
    const matrix = transform && transform !== "none" ? new DOMMatrixReadOnly(transform) : null;
    const dx = matrix ? matrix.m41 : 0;
    const dy = matrix ? matrix.m42 : 0;
    return { left: rect.left - dx, top: rect.top - dy, right: rect.right - dx, bottom: rect.bottom - dy };
  }

  worldToClientRect(x, y, width, height) {
    const camera = this.scene.cameras.main;
    const canvas = this.scene.game.canvas.getBoundingClientRect();
    const scaleX = canvas.width / this.scene.scale.width;
    const scaleY = canvas.height / this.scene.scale.height;
    const toClientX = (worldX) => canvas.left + (camera.x + (worldX - camera.worldView.x) * camera.zoom) * scaleX;
    const toClientY = (worldY) => canvas.top + (camera.y + (worldY - camera.worldView.y) * camera.zoom) * scaleY;
    return { left: toClientX(x), top: toClientY(y), right: toClientX(x + width), bottom: toClientY(y + height) };
  }

  setOffset(offset) {
    this.offset = offset;
    this.element.style.transform = offset.x || offset.y ? `translate(${offset.x}px, ${offset.y}px)` : "";
  }

  // Drop the highlight and slide the window home (tab switch / close).
  reset() {
    this.pinnedId = null;
    this.draw(null);
    this.setOffset({ x: 0, y: 0 });
  }

  destroy() {
    this.graphics.destroy();
  }
}
