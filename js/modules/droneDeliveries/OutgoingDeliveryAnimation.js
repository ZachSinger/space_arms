import { UIWindow } from "../../logic/UIWindow.js";
import { drawSpaceBackdrop, makeStars } from "../../logic/SupplyDeliveryAnimation.js";
import { REMOTE_ORDER_CRATE_SPRITES } from "./DroneTerminalArt.js";

const W = 420, H = 230;
const LAUNCH = 0.45;
const FLIGHT = 2.7;
const CLOSE_AT = LAUNCH + FLIGHT + 1.1;
const clamp = (v) => Math.max(0, Math.min(1, v));

// The crate climbs off the planet, bends right, and shrinks into the distance.
export function outgoingCratePosition(age) {
  const v = clamp(age / FLIGHT);
  return { x: 130 + 280 * v * v, y: H + 32 - 320 * v ** 1.35, scale: 1 - 0.94 * v, v };
}

export class OutgoingDeliveryAnimation {
  constructor(shop) {
    this.shop = shop;
    this.queue = [];
    this.active = null;
    this.uiWindow = new UIWindow({
      id: "outgoing-delivery-animation", title: "OUTGOING DELIVERY", width: "420px",
      closable: false, passive: true,
      contentHTML: '<canvas width="420" height="230" aria-label="Order crate flying off into space"></canvas>',
    }, shop.windowManager);
    this.uiWindow.element.classList.add("supply-delivery-window", "outgoing-delivery-window");
    this.context = this.uiWindow.element.querySelector("canvas").getContext("2d");
    this.crate = shop.textures.get(REMOTE_ORDER_CRATE_SPRITES.complete.key).getSourceImage();
    this.status = document.createElement("span");
    this.status.className = "supply-delivery-status";
    this.uiWindow.element.querySelector(".retro-window-header").append(this.status);
    this.stars = makeStars();
  }

  enqueue(orderNumber) {
    this.queue.push(orderNumber);
  }

  update(delta) {
    if (!this.active && this.queue.length) {
      this.active = { time: 0, orderNumber: this.queue.shift() };
      this.uiWindow.openWindow();
    }
    if (!this.active) return;
    // Sit above the incoming window when a supply ship is arriving at the same time.
    this.uiWindow.element.classList.toggle("stacked", Boolean(this.shop.supply?.animation?.uiWindow.isOpen));
    this.active.time += delta / 1000;
    const { time, orderNumber } = this.active;
    this.draw(time);
    this.status.textContent = time - LAUNCH >= FLIGHT
      ? `Order #${orderNumber} on its way`
      : `Order #${orderNumber} launching`;
    if (time > CLOSE_AT) {
      this.uiWindow.close();
      this.active = null;
    }
  }

  draw(time) {
    const ctx = this.context;
    drawSpaceBackdrop(ctx, this.stars, time);
    const age = time - LAUNCH;
    if (age >= 0 && age < 0.5) {
      // A puff of exhaust where the crate leaves the planet surface.
      const puff = clamp(age / 0.5);
      ctx.fillStyle = `rgba(157,228,255,${0.5 * (1 - puff)})`;
      ctx.beginPath();
      ctx.ellipse(130, H - 4, 14 + 40 * puff, 4 + 8 * puff, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (age < 0 || age >= FLIGHT) return;
    const p = outgoingCratePosition(age);
    const previous = outgoingCratePosition(Math.max(0, age - 0.22));
    const next = outgoingCratePosition(age + 0.015);
    const angle = Math.atan2(next.x - p.x, p.y - next.y);
    const trail = ctx.createLinearGradient(previous.x, previous.y, p.x, p.y);
    trail.addColorStop(0, "#6cc9ff00");
    trail.addColorStop(1, "#9de4ff88");
    ctx.strokeStyle = trail;
    ctx.lineWidth = 5 * p.scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.scale(p.scale, p.scale);
    const length = (30 + 12 * p.v) * (0.88 + 0.12 * Math.sin(time * 45));
    const flame = ctx.createLinearGradient(0, 15, 0, 15 + length);
    flame.addColorStop(0, "#e6fbff");
    flame.addColorStop(0.35, "#6cc9ff");
    flame.addColorStop(1, "#4aa9ff00");
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-8, 15);
    ctx.quadraticCurveTo(-6, 15 + length * 0.5, 0, 15 + length);
    ctx.quadraticCurveTo(6, 15 + length * 0.5, 8, 15);
    ctx.fill();
    ctx.fillStyle = "#e6fbff";
    ctx.beginPath();
    ctx.moveTo(-3, 15);
    ctx.lineTo(3, 15);
    ctx.lineTo(0, 15 + length * 0.48);
    ctx.fill();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.crate, 0, 0, 29, 35, -16, -18, 32, 36);
    ctx.restore();
  }

  destroy() {
    this.queue = [];
    this.active = null;
    this.uiWindow.element.remove();
    this.shop.windowManager.windows.delete(this.uiWindow.id);
  }
}
