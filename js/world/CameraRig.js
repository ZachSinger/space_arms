// ==========================================
// FILE: CameraRig.js
// ==========================================
// The cameras: the shop camera (zoom, following the player, keeping the same view across
// window resizes) and a framed camera shared by the backroom and module rooms.
// Also answers which camera shows a point or an area, so
// pop-ups stay the same size on screen and clicks land on the right spot.
import { CRATE_FOOTER_HEIGHT_PX } from "../logic/CrateFooter.js";
import { TILE_SIZE } from "../logic/RoomLayout.js";
import { AREA } from "./Areas.js";

// Screen space kept clear when fitting the map: the top status bar (36px + 2px border),
// the bottom crate bar (#crate-footer, 96px), and a small margin around the map.
const MAP_SCREEN_TOP = 38;
const MAP_SCREEN_BOTTOM = CRATE_FOOTER_HEIGHT_PX;
const MAP_SCREEN_MARGIN = 8;
// Closest zoom-in still shows this many tile rows top to bottom.
const CAMERA_MIN_VISIBLE_ROWS = 8;
const CAMERA_ZOOM_STEP = 1.15;
// The backroom window: at most this share of the screen below the status bar, tiles never
// drawn larger than this zoom, and a title strip above the window's map.
const BACKROOM_WINDOW_SHARE = 0.9;
const BACKROOM_MAX_ZOOM = 1.25;
const BACKROOM_TITLE_HEIGHT = 26;
const BACKROOM_FRAME_BORDER = 3;

export class CameraRig {
  /** @param {object} shop - the game scene, with its room already built */
  constructor(shop) {
    this.shop = shop;
    this.zoom = null;
    this.viewHeight = null;
    this.backroomCamera = null;
    this.backroomFrame = null;
    shop.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    shop.events.once("shutdown", () => shop.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this));
    this.refresh();
  }

  // Back to the widest view, as on a fresh shop (after loading a save).
  reset() {
    this.zoom = null;
    this.viewHeight = null;
    this.refresh();
  }

  mapViewHeight() {
    return Math.max(1, this.shop.scale.height - MAP_SCREEN_TOP - MAP_SCREEN_BOTTOM);
  }

  // Keeps the same amount of shop visible when the window or resolution changes.
  handleResize() {
    const viewH = this.mapViewHeight();
    if (this.zoom && this.viewHeight) this.zoom *= viewH / this.viewHeight;
    this.refresh();
  }

  zoomRange() {
    const viewW = Math.max(1, this.shop.scale.width);
    const viewH = this.mapViewHeight();
    const shop = this.shop.room.getCameraBounds();
    const fitZoom = Math.min(
      Math.max(1, viewW - 2 * MAP_SCREEN_MARGIN) / shop.width,
      Math.max(1, viewH - 2 * MAP_SCREEN_MARGIN) / shop.height,
    );
    const closestZoom = viewH / (CAMERA_MIN_VISIBLE_ROWS * TILE_SIZE);
    return { min: fitZoom, max: Math.max(fitZoom, closestZoom) };
  }

  // Pop-ups drawn in the map (prompts, labels, customer bubbles) use this scale so they
  // stay the same size on screen no matter how far the camera showing them is zoomed.
  popupScale(worldX, worldY) {
    return 1 / (this.cameraAt(worldX, worldY)?.zoom || 1);
  }

  /** Other rooms share the framed camera; only the player's current room is shown. */
  cameraFor(area) {
    return area === AREA.SHOP ? this.shop.cameras.main : this.backroomCamera;
  }

  /**
   * The camera that draws a world point: the framed camera for the active room's points,
   * otherwise the shop camera. With no point, the shop camera.
   * @param {number} [worldX]
   * @param {number} [worldY]
   */
  cameraAt(worldX, worldY) {
    const backroom = this.backroomCamera;
    if (backroom?.visible && Number.isFinite(worldX) && Number.isFinite(worldY) &&
      this.shop.areas.areaAt(worldX, worldY) === this.shop.areas.playerArea) {
      return backroom;
    }
    return this.shop.cameras?.main;
  }

  /**
   * Screen position to world position, through whichever camera is drawn there.
   * @param {number} screenX
   * @param {number} screenY
   */
  screenToWorld(screenX, screenY) {
    const backroom = this.backroomCamera;
    const overBackroom = backroom?.visible &&
      Phaser.Geom.Rectangle.Contains(new Phaser.Geom.Rectangle(backroom.x, backroom.y, backroom.width, backroom.height), screenX, screenY);
    return (overBackroom ? backroom : this.shop.cameras.main).getWorldPoint(screenX, screenY);
  }

  zoomBy(direction) {
    if (this.shop.areas.playerArea !== AREA.SHOP) return;
    this.zoom = (this.zoom ?? this.shop.cameras.main.zoom) * CAMERA_ZOOM_STEP ** direction;
    this.refresh();
  }

  refresh() {
    const { shop: scene } = this;
    const camera = scene.cameras.main;
    const viewW = Math.max(1, scene.scale.width);
    const viewH = this.mapViewHeight();
    // The map is drawn only between the top status bar and the bottom crate bar.
    camera.setViewport(0, MAP_SCREEN_TOP, viewW, viewH);

    const { min, max } = this.zoomRange();
    const zoom = Phaser.Math.Clamp(this.zoom ?? min, min, max);
    this.zoom = zoom;
    this.viewHeight = viewH;
    camera.setZoom(zoom);

    // Pad the shop's edges with a small margin, and widen any side shorter than the
    // screen so the shop sits centered instead of stuck to one edge.
    const shop = scene.room.getCameraBounds();
    const margin = MAP_SCREEN_MARGIN / zoom;
    const visibleW = viewW / zoom;
    const visibleH = viewH / zoom;
    const boundsW = Math.max(shop.width + 2 * margin, visibleW);
    const boundsH = Math.max(shop.height + 2 * margin, visibleH);
    camera.setBounds(
      shop.x + shop.width / 2 - boundsW / 2,
      shop.y + shop.height / 2 - boundsH / 2,
      boundsW,
      boundsH,
    );

    // Inside another room the shop view holds still where the player left it.
    if (scene.player?.sprite && scene.areas.playerArea === AREA.SHOP) {
      camera.startFollow(scene.player.sprite, true);
    } else if (scene.player?.sprite) {
      camera.stopFollow();
    } else {
      camera.centerOn(shop.x + shop.width / 2, shop.y + shop.height / 2);
    }
    this.refreshBackroomWindow();
  }

  // --- Backroom window ---

  // The backroom has its own camera, drawn as a framed window over the middle of the shop
  // while the player is inside. The shop keeps running behind it.
  createBackroomWindow() {
    const scene = this.shop;
    this.backroomCamera = scene.cameras.add(0, 0, 1, 1, false, "backroom")
      .setBackgroundColor("#05080f")
      .setVisible(false);
    const frame = document.createElement("div");
    frame.id = "backroom-window";
    frame.className = "backroom-window hidden";
    frame.innerHTML = '<div class="backroom-window-title">BACKROOM</div>';
    document.getElementById("ui-layer")?.appendChild(frame);
    this.backroomFrame = frame;
    scene.events.once("shutdown", () => {
      frame.remove();
      this.backroomFrame = null;
    });
    this.refreshBackroomWindow();
  }

  // Fit the current room's bounds, including expansions.
  refreshBackroomWindow() {
    const camera = this.backroomCamera;
    if (!camera) return;
    const scene = this.shop;
    const area = scene.areas.playerArea;
    const open = area !== AREA.SHOP;
    camera.setVisible(open);
    this.backroomFrame?.classList.toggle("hidden", !open);
    if (!open) return;

    const screenW = Math.max(1, scene.scale.width);
    const screenH = this.mapViewHeight();
    const room = scene.areas.boundsFor(area);
    const zoom = Math.min(
      (screenW * BACKROOM_WINDOW_SHARE) / room.width,
      (screenH * BACKROOM_WINDOW_SHARE - BACKROOM_TITLE_HEIGHT) / room.height,
      BACKROOM_MAX_ZOOM,
    );
    const width = Math.round(room.width * zoom);
    const height = Math.round(room.height * zoom);
    const x = Math.round((screenW - width) / 2);
    const y = Math.round(MAP_SCREEN_TOP + (screenH - height + BACKROOM_TITLE_HEIGHT) / 2);
    camera.setViewport(x, y, width, height).setZoom(zoom);
    camera.setBounds(room.x, room.y, room.width, room.height);
    camera.centerOn(room.x + room.width / 2, room.y + room.height / 2);

    const frame = this.backroomFrame;
    if (!frame) return;
    frame.querySelector(".backroom-window-title").textContent = scene.areas.titleFor(area);
    const border = BACKROOM_FRAME_BORDER;
    Object.assign(frame.style, {
      left: `${x - border}px`,
      top: `${y - BACKROOM_TITLE_HEIGHT - border}px`,
      width: `${width}px`,
      height: `${height + BACKROOM_TITLE_HEIGHT}px`,
      borderWidth: `${border}px`,
    });
  }
}
