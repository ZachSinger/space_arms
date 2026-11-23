// ==========================================
// FILE: DecorationGalleryLab.js
// ==========================================
// DEV "Decoration Gallery": the sales floor cleared of everything but the register, with every
// decoration standing in one block of numbered rows and playing its animation, so they can be
// compared side by side. Each one is labeled with its number and shop name. Nothing is saved.
import { FIXTURE_TYPES } from "../logic/FixtureLayout.js";
import { BACKROOM_GRID_Y, TILE_SIZE } from "../logic/RoomLayout.js";
import { unlockEverything } from "./SandboxRoom.js";

const PER_ROW = 7;
const STEP_X = 2.5;
// First row sits below the register and front door; the gap fits the labels.
const FIRST_ROW_Y = 4.5;
const STEP_Y = 2.5;
const CAMERA_ZOOM = 1.25;
const NUDGES = [0, 0.125, -0.125, 0.25, -0.25, 0.5, -0.5];
const GROUPS = ["decor_holo_", "decor_banner_", "decor_light_"];
const PANEL_STYLE = [
  "position:fixed", "right:12px", "top:84px", "z-index:50", "width:260px", "padding:10px",
  "background:rgba(15,23,42,0.92)", "border:1px solid #38bdf8", "color:#e2e8f0", "font:13px monospace",
  "display:flex", "flex-direction:column", "gap:4px", "pointer-events:auto",
].join(";");

/** Every decoration type in shop order: holograms, then banners, then lights. */
export function galleryDecorations() {
  const decorations = Object.entries(FIXTURE_TYPES).filter(([, type]) => type.kind === "decoration");
  return GROUPS.flatMap((prefix) => decorations.filter(([id]) => id.startsWith(prefix)))
    .map(([id, type]) => ({ id, name: type.name ?? id }));
}

/** The label's second line: the shop name without the trailing "HOLOGRAM"/"BANNER". */
function shortName(name) {
  return name.replace(/\s+(HOLOGRAM|BANNER)$/u, "");
}

function salesFloorBounds(scene) {
  const zones = scene.room.zones.filter((zone) => !zone.locked && zone.gridY < BACKROOM_GRID_Y);
  const left = Math.min(...zones.map((zone) => zone.gridX));
  const right = Math.max(...zones.map((zone) => zone.gridX + zone.gridW));
  return { left, right, top: Math.min(...zones.map((zone) => zone.gridY)) };
}

function clearSalesFloor(scene) {
  for (const fixture of [...scene.fixtures.all()]) {
    const type = FIXTURE_TYPES[fixture.type];
    if (!type || type.kind === "register" || fixture.gy >= BACKROOM_GRID_Y) continue;
    scene.fixtureSystem.removeFree(fixture.id);
  }
}

function placeNear(scene, typeId, gx, gy) {
  for (const dy of NUDGES) {
    for (const dx of NUDGES) {
      if (scene.fixtureSystem.checkPlacement(typeId, gx + dx, gy + dy).valid) {
        scene.fixtureSystem.placeFree(typeId, gx + dx, gy + dy);
        return scene.fixtures.ofKind("decoration").at(-1);
      }
    }
  }
  return null;
}

/**
 * @param {Phaser.Scene} scene - the game scene, started with { sandbox: true, lab: "decorations" }
 * @returns {{ placed: { number: number, id: string, name: string, fixtureId: string | null }[],
 *   noteGaveUp: () => void, destroy: () => void }}
 */
export function setupDecorationGallery(scene) {
  unlockEverything(scene);
  clearSalesFloor(scene);
  const floor = salesFloorBounds(scene);
  const decorations = galleryDecorations();
  const blockWidth = (Math.min(PER_ROW, decorations.length) - 1) * STEP_X + 1;
  const startX = Math.round((floor.left + floor.right - blockWidth) / 2);
  const labels = [];
  const placed = decorations.map((decoration, index) => {
    const gx = startX + (index % PER_ROW) * STEP_X;
    const gy = floor.top + FIRST_ROW_Y + Math.floor(index / PER_ROW) * STEP_Y;
    const fixture = placeNear(scene, decoration.id, gx, gy);
    const number = index + 1;
    if (fixture) {
      const type = FIXTURE_TYPES[decoration.id];
      labels.push(scene.add.text((fixture.gx + type.w / 2) * TILE_SIZE, (fixture.gy + type.h) * TILE_SIZE + 2,
        `${number}\n${shortName(decoration.name)}`, {
          fontFamily: "monospace", fontSize: "12px", color: "#fde68a", align: "center",
          backgroundColor: "rgba(15,23,42,0.75)", padding: { x: 3, y: 1 },
        }).setOrigin(0.5, 0).setDepth(100000));
    }
    return { number, id: decoration.id, name: decoration.name, fixtureId: fixture?.id ?? null };
  });
  scene.gameState.shop.changed();

  // Close enough to see the animations, held still over the whole block instead of the player.
  const rows = Math.ceil(decorations.length / PER_ROW);
  const centerX = (startX + blockWidth / 2) * TILE_SIZE;
  const centerY = (floor.top + FIRST_ROW_Y + ((rows - 1) * STEP_Y + 1.5) / 2) * TILE_SIZE;
  scene.cameraRig.zoom = CAMERA_ZOOM;
  scene.cameraRig.refresh();
  scene.cameraRig.following = false;
  scene.cameras.main.centerOn(centerX, centerY);
  for (const label of labels) label.setScale(scene.cameraRig.popupScale(label.x, label.y));

  const missing = placed.filter((entry) => !entry.fixtureId).map((entry) => `${entry.number}. ${entry.name}`);
  const panel = document.createElement("div");
  panel.className = "sandbox-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Decoration Gallery");
  panel.style.cssText = PANEL_STYLE;
  panel.innerHTML = `<strong>DECORATION GALLERY</strong>
    <div>All ${decorations.length} decorations, numbered, each playing its animation. Nothing here is saved.</div>
    ${missing.length ? `<div style="color:#fca5a5">Did not fit: ${missing.join(", ")}</div>` : ""}`;
  document.getElementById("ui-layer").appendChild(panel);

  return {
    placed,
    noteGaveUp() {},
    destroy() {
      for (const label of labels) label.destroy();
      panel.remove();
    },
  };
}
