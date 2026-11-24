// ==========================================
// FILE: coopFriend.js
// ==========================================
// The friend's screen in co-op: a live copy of the host's shop (see DisplayMirror.js), with the
// camera on the friend's red partner. This game sends its walking controls to the host and
// draws whatever the host sends back; the shop itself only runs on the host's computer.
import Phaser from "phaser";
import { MirrorReader } from "../coop/DisplayMirror.js";
import { GamepadInput } from "../input/GamepadInput.js";
import { bindingForEvent, isBound } from "../input/KeyBindings.js";
import { setInputDevice } from "../input/InputDevice.js";
import { TILE_SIZE } from "../logic/RoomLayout.js";
import { UIWindow } from "../logic/UIWindow.js";
import { WindowManager } from "../logic/WindowManager.js";
import { hideLoadingScreen } from "./loadingScreen.js";

const BAR_HEIGHT = 38;
// Same limits as the host's camera (CameraRig.js): zoomed out, the whole shop fits with a
// small margin; zoomed in, at least this many tile rows show.
const MAP_SCREEN_MARGIN = 8;
const MIN_VISIBLE_ROWS = 8;
const ZOOM_STEP = 1.15;
const INPUT_KEEP_ALIVE_MS = 1000;
const RETURN_TO_TITLE_MS = 3500;
const HOST_AWAY_MS = 2500;

const END_MESSAGES = Object.freeze({
  left: "Your friend closed their shop.",
  lost: "Lost the connection to your friend's shop.",
  "no-answer": "Your friend's game didn't answer.",
  "join-failed": "Couldn't join your friend's shop.",
});

export class CoopFriendScene extends Phaser.Scene {
  constructor() {
    super("scene-coop-friend");
  }

  create() {
    hideLoadingScreen();
    this.api = window.desktopApi.coop;
    this.mirror = new MirrorReader(this, (key) => this.send({ t: "texture?", key }));
    this.focusId = 0;
    this.joined = false;
    this.ended = false;
    this.heldBindings = new Map();
    this.lastInput = "";
    this.lastInputAt = 0;
    this.shopBounds = null;
    this.viewZoom = null;
    this.pad = new GamepadInput();
    this.windowManager = new WindowManager();
    this.buildScreen();
    this.layoutCamera();

    const onKeyDown = (event) => this.handleKey(event, true);
    const onKeyUp = (event) => this.handleKey(event, false);
    const onBlur = () => this.heldBindings.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    this.input.on("wheel", (_pointer, _objects, _dx, dy) => this.zoom(dy < 0 ? 1 : -1));
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layoutCamera, this);
    const unsubscribe = [
      this.api.onMessage((text) => this.handleMessage(text)),
      this.api.onStatus((status) => this.handleStatus(status)),
    ];
    this.events.once("shutdown", () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layoutCamera, this);
      unsubscribe.forEach((stop) => stop());
      this.windowManager.destroy();
      this.bar.remove();
      this.notice.remove();
    });
    void this.api.status().then((status) => this.handleStatus(status));
    // Ask for the whole picture; anything sent before this screen opened was missed.
    this.send({ t: "sync" });
  }

  buildScreen() {
    const layer = document.getElementById("ui-layer");
    this.bar = document.createElement("div");
    this.bar.className = "coop-bar";
    this.bar.innerHTML = `
      <span data-coop-host>Joining your friend's shop</span>
      <span>Money <span class="coop-bar-value" data-coop-money>-</span></span>
      <span>Time <span class="coop-bar-value" data-coop-time>-</span></span>
      <span class="coop-bar-hint">You're the red shopkeeper. Press Esc to leave.</span>`;
    layer.appendChild(this.bar);
    this.notice = document.createElement("div");
    this.notice.className = "coop-notice";
    this.notice.textContent = "Joining your friend's shop...";
    layer.appendChild(this.notice);
    this.leaveWindow = new UIWindow({
      id: "coop-leave", title: "LEAVE", width: "380px", height: "auto", x: 80, y: 120,
      contentHTML: `
        <p>Leave your friend's shop and go back to the title screen?</p>
        <button class="action-btn" data-coop-leave>LEAVE</button>
        <button class="action-btn" data-coop-stay data-pad-autofocus>STAY</button>`,
    }, this.windowManager);
    this.leaveWindow.element.querySelector("[data-coop-leave]").addEventListener("click", () => void this.leave());
    this.leaveWindow.element.querySelector("[data-coop-stay]").addEventListener("click", () => this.leaveWindow.close());
  }

  layoutCamera() {
    const camera = this.cameras.main;
    const width = Math.max(1, this.scale.width);
    const height = Math.max(1, this.scale.height - BAR_HEIGHT);
    camera.setViewport(0, BAR_HEIGHT, width, height);
    const shop = this.shopBounds;
    if (!shop) return;
    const fit = Math.min((width - 2 * MAP_SCREEN_MARGIN) / shop.width, (height - 2 * MAP_SCREEN_MARGIN) / shop.height);
    const min = Math.max(0.05, fit);
    const max = Math.max(min, height / (MIN_VISIBLE_ROWS * TILE_SIZE));
    this.viewZoom = Phaser.Math.Clamp(this.viewZoom ?? min, min, max);
    camera.setZoom(this.viewZoom);
    // Like the host's camera: a margin around the shop, centered when it's smaller than the screen.
    const margin = MAP_SCREEN_MARGIN / this.viewZoom;
    const boundsW = Math.max(shop.width + 2 * margin, width / this.viewZoom);
    const boundsH = Math.max(shop.height + 2 * margin, height / this.viewZoom);
    camera.setBounds(shop.x + shop.width / 2 - boundsW / 2, shop.y + shop.height / 2 - boundsH / 2, boundsW, boundsH);
  }

  zoom(direction) {
    if (!this.shopBounds) return;
    this.viewZoom = (this.viewZoom ?? this.cameras.main.zoom) * ZOOM_STEP ** direction;
    this.layoutCamera();
  }

  // Centers on the partner, snapped to whole screen pixels the way the host's camera is,
  // so the floor doesn't shimmer and jump while walking.
  followFocus() {
    const focus = this.mirror.objectFor(this.focusId);
    if (!focus) return;
    const camera = this.cameras.main;
    const zoom = camera.zoom;
    const visibleW = camera.width / zoom;
    const visibleH = camera.height / zoom;
    const bounds = camera.getBounds();
    const snap = (target, min, max) => {
      if (max <= min) return min;
      const clamped = Phaser.Math.Clamp(target, min, max);
      return Phaser.Math.Clamp(Math.round(clamped * zoom) / zoom, Math.ceil(min * zoom) / zoom, Math.floor(max * zoom) / zoom);
    };
    const left = snap(focus.x - visibleW / 2, bounds.x, bounds.x + bounds.width - visibleW);
    const top = snap(focus.y - visibleH / 2, bounds.y, bounds.y + bounds.height - visibleH);
    camera.setScroll(left - (camera.width - visibleW) / 2, top - (camera.height - visibleH) / 2);
  }

  send(message) {
    this.api.send(JSON.stringify(message));
  }

  handleKey(event, down) {
    if (event.repeat) return;
    const binding = bindingForEvent(event);
    if (!binding) return;
    if (!down) {
      this.heldBindings.delete(event.code || binding);
      return;
    }
    if (event.target?.closest?.("input, textarea")) return;
    if (isBound("pause", binding) || isBound("cancel", binding)) {
      if (this.windowManager.isConsumed(event)) return;
      if (this.leaveWindow.isOpen) this.leaveWindow.close();
      else this.leaveWindow.openWindow();
      return;
    }
    if (this.leaveWindow.isOpen) return;
    if (isBound("zoomIn", binding)) this.zoom(1);
    else if (isBound("zoomOut", binding)) this.zoom(-1);
    else if (isBound("interact", binding)) this.send({ t: "use" });
    this.heldBindings.set(event.code || binding, binding);
  }

  actionDown(action) {
    return [...this.heldBindings.values()].some((binding) => isBound(action, binding));
  }

  readInput() {
    if (this.leaveWindow.isOpen || this.ended) return { x: 0, y: 0, dash: false };
    let x = (this.actionDown("moveRight") ? 1 : 0) - (this.actionDown("moveLeft") ? 1 : 0);
    let y = (this.actionDown("moveDown") ? 1 : 0) - (this.actionDown("moveUp") ? 1 : 0);
    let dash = this.actionDown("dash");
    if (x === 0 && y === 0 && this.pad.connected) ({ x, y } = this.pad.moveVector());
    if (this.pad.connected) dash ||= this.pad.wantsDash();
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, dash };
  }

  handleMessage(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.t === "snap") {
      this.mirror.apply(message);
      if (message.f) this.focusId = message.f;
      if (message.bg) this.cameras.main.setBackgroundColor(message.bg);
      if (Array.isArray(message.sb) && message.sb.join() !== this.shopBoundsKey) {
        this.shopBoundsKey = message.sb.join();
        const [x, y, width, height] = message.sb;
        this.shopBounds = { x, y, width, height };
        this.layoutCamera();
      }
      this.showAway(false);
      this.lastSnapAt = performance.now();
      if (message.hud) this.showHud(message.hud);
      if (!this.joined) {
        this.joined = true;
        this.notice.classList.add("hidden");
      }
    } else if (message.t === "texture") {
      void this.mirror.addTexture(message).catch((error) => console.error("Could not load a picture from the host:", error));
    }
  }

  // The host's game sends a picture at least every second while it runs. When those stop
  // (their game is in the background), their shop is on hold until they come back.
  showAway(away) {
    if (this.ended || !this.joined || away === this.away) return;
    this.away = away;
    this.notice.textContent = "Your friend switched away from the game. Their shop is on hold until they come back.";
    this.notice.classList.toggle("hidden", !away);
  }

  showHud(hud) {
    this.bar.querySelector("[data-coop-host]").textContent = hud.host ? `${hud.host}'s shop` : "Your friend's shop";
    this.bar.querySelector("[data-coop-money]").textContent = hud.money || "-";
    this.bar.querySelector("[data-coop-time]").textContent = hud.time || "-";
  }

  handleStatus(status) {
    if (this.ended || status.role === "friend") return;
    this.ended = true;
    this.leaveWindow.close();
    this.notice.textContent = END_MESSAGES[status.error] ?? END_MESSAGES.left;
    this.notice.classList.remove("hidden");
    this.time.delayedCall(RETURN_TO_TITLE_MS, () => window.location.reload());
  }

  async leave() {
    this.ended = true;
    await this.api.leave();
    window.location.reload();
  }

  update(time) {
    this.pad.poll(time);
    if (this.pad.hadInput) setInputDevice("gamepad");
    if (this.pad.justPressedAction("pause")) {
      if (this.leaveWindow.isOpen) this.leaveWindow.close();
      else this.leaveWindow.openWindow();
    }
    if (!this.leaveWindow.isOpen && this.pad.justPressedAction("interact")) this.send({ t: "use" });
    const input = this.readInput();
    const key = JSON.stringify(input);
    if (key !== this.lastInput || time - this.lastInputAt >= INPUT_KEEP_ALIVE_MS) {
      this.lastInput = key;
      this.lastInputAt = time;
      this.send({ t: "input", ...input });
    }
    this.mirror.update(time);
    this.followFocus();
    if (this.joined && performance.now() - this.lastSnapAt > HOST_AWAY_MS) this.showAway(true);
  }
}
