import { UIWindow } from "./UIWindow.js";
import { getBackroomBounds } from "./RoomLayout.js";
import { PEOPLE_DEPTH_BASE } from "../world/Depth.js";

export const DELIVERY_SHIP_ART = Object.freeze({
  key: "delivery_ship", path: "img/Generated/delivery_ship_side_left.png",
});
const FIRST_LAUNCH = 1.6;
const GAP = 0.2;
const DIVE_AFTER = 0.66;
const GLIDE_TIME = 1.3;
const W = 420, H = 230;
const SHIP_W = 250, SHIP_H = 250 * 103 / 560;
const SHIP_X = 156, SHIP_Y = 104;
const easeOut = (v) => 1 - (1 - v) ** 3;
const clamp = (v) => Math.max(0, Math.min(1, v));
const easeInOut = (v) => v < 0.5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2;

export function deliveryCratePosition(index, count, age) {
  const vx = count === 1 ? -235 : -300 + 130 * index / (count - 1);
  const hx = SHIP_X + SHIP_W * 215 / 560, hy = SHIP_Y + SHIP_H * 55 / 103;
  if (age < DIVE_AFTER) {
    return { x: hx + vx * age, y: hy - 210 * age + 190 * age ** 2 };
  }
  const a = age - DIVE_AFTER;
  return {
    x: hx + vx * DIVE_AFTER + vx * 0.15 * a,
    y: hy - 210 * DIVE_AFTER + 190 * DIVE_AFTER ** 2 +
      (-210 + 380 * DIVE_AFTER) * a + 750 * a ** 2,
  };
}

export function makeStars() {
  return Array.from({ length: 90 }, (_, i) => ({
    x: (i * 97 + i * i * 13) % W, y: (i * 59 + i * i * 7) % H,
    size: i % 11 === 0 ? 2 : 1, depth: 0.3 + i % 5 * 0.15,
  }));
}

// The drifting starfield and planet edge shared by the incoming and outgoing delivery windows.
export function drawSpaceBackdrop(ctx, stars, time) {
  const backdrop = ctx.createLinearGradient(0, 0, W, H);
  backdrop.addColorStop(0, "#050917");
  backdrop.addColorStop(0.55, "#121f37");
  backdrop.addColorStop(1, "#0a1022");
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, W, H);
  stars.forEach((star, i) => {
    ctx.fillStyle = `rgba(200,222,255,${0.35 + 0.25 * star.depth + 0.15 * Math.sin(time * 1.3 + i)})`;
    ctx.fillRect((star.x - time * 6 * star.depth + W * 10) % W, star.y, star.size, star.size);
  });
  const planet = ctx.createRadialGradient(W / 2, H + 330, 300, W / 2, H + 330, 360);
  planet.addColorStop(0, "#2a5470");
  planet.addColorStop(0.85, "#1b3a55");
  planet.addColorStop(1, "#6fb8d0");
  ctx.fillStyle = planet;
  ctx.beginPath();
  ctx.arc(W / 2, H + 330, 360, 0, Math.PI * 2);
  ctx.fill();
}

export function deliveryDropTime(index, count) {
  let age = DIVE_AFTER;
  while (deliveryCratePosition(index, count, age).y <= H + 30) age += 0.01;
  return FIRST_LAUNCH + index * GAP + age;
}

export function deliveryLift(time, start, height) {
  return height * (1 - easeInOut(clamp((time - start) / GLIDE_TIME)));
}

export class SupplyDeliveryAnimation {
  constructor(shop) {
    this.shop = shop;
    this.queue = [];
    this.active = null;
    this.uiWindow = new UIWindow({
      id: "supply-delivery-animation", title: "INCOMING DELIVERY", width: "420px",
      closable: false, passive: true,
      contentHTML: '<canvas width="420" height="230" aria-label="Ship delivering crates"></canvas>',
    }, shop.windowManager);
    this.uiWindow.element.classList.add("supply-delivery-window");
    this.context = this.uiWindow.element.querySelector("canvas").getContext("2d");
    this.ship = shop.textures.get(DELIVERY_SHIP_ART.key).getSourceImage();
    this.status = document.createElement("span");
    this.status.className = "supply-delivery-status";
    this.uiWindow.element.querySelector(".retro-window-header").append(this.status);
    this.stars = makeStars();
  }

  enqueue(crates) {
    const ordered = [...crates].sort((a, b) => a.sprite.y - b.sprite.y || a.sprite.x - b.sprite.x);
    for (const crate of ordered) {
      crate.incomingDelivery = true;
      crate.sprite.setVisible(false);
      crate.sprite.body.enable = false;
    }
    this.queue.push(ordered);
  }

  update(delta) {
    if (!this.active && this.queue.length) {
      const crates = this.queue.shift();
      this.active = {
        time: 0,
        crates: crates.map((crate, index) => ({
          crate, start: deliveryDropTime(index, crates.length),
          height: crate.sprite.y - getBackroomBounds(this.shop.room.zones).y + 40,
          glow: this.shop.add.graphics().setDepth(0.75),
          flame: this.shop.add.graphics(),
        })),
      };
      this.uiWindow.openWindow();
    }
    if (!this.active) return;
    this.active.time += delta / 1000;
    const { time, crates } = this.active;
    this.drawSpace(time, crates);
    for (const entry of crates) {
      if (!entry.crate.incomingDelivery || time < entry.start) continue;
      const { crate, start, height, glow, flame } = entry;
      const lift = deliveryLift(time, start, height);
      crate.sprite.setVisible(true);
      crate.setThrowHeight(lift);
      const { x, y, displayHeight } = crate.sprite;
      glow.clear();
      flame.clear();
      if (time >= start + GLIDE_TIME) {
        crate.incomingDelivery = false;
        crate.sprite.body.enable = true;
        crate.sprite.body.updateFromGameObject();
        this.shop.supply.freePlayerFromPad();
        glow.destroy();
        flame.destroy();
        continue;
      }
      glow.fillStyle(0x6cc9ff, 0.08 + 0.22 * (1 - lift / height));
      glow.fillEllipse(x, y + displayHeight / 2 - 3, crate.sprite.displayWidth + 4, 10);
      const fy = y - lift + displayHeight / 2 - 2;
      const length = (8 + 10 * lift / height) * (0.85 + 0.15 * Math.sin(time * 45));
      flame.setDepth(PEOPLE_DEPTH_BASE + crate.sprite.body.bottom - 0.51);
      flame.fillStyle(0x6cc9ff, 0.6);
      flame.fillTriangle(x - 7, fy, x + 7, fy, x, fy + length);
      flame.fillStyle(0xe6fbff, 0.9);
      flame.fillTriangle(x - 4, fy, x + 4, fy, x, fy + length * 0.55);
    }
    const landed = crates.filter(({ crate }) => !crate.incomingDelivery).length;
    this.status.textContent = `${crates.length} ${crates.length === 1 ? "crate" : "crates"}${landed === crates.length ? " landed" : ""}`;
    const last = crates.at(-1).start;
    if (time > last + GLIDE_TIME + 1.7) {
      this.uiWindow.close();
      this.active = null;
    }
  }

  // The crate's own frame in its pad color, so each crate in space matches the one that lands.
  crateImage(sprite) {
    const tint = sprite.isTinted ? sprite.tintTopLeft : 0xffffff;
    const key = `${sprite.texture.key}:${sprite.frame.name}:${tint}`;
    this.crateImages ??= new Map();
    if (this.crateImages.has(key)) return this.crateImages.get(key);
    const { cutX, cutY, cutWidth, cutHeight } = sprite.frame;
    const canvas = document.createElement("canvas");
    canvas.width = cutWidth;
    canvas.height = cutHeight;
    const ctx = canvas.getContext("2d");
    const source = sprite.texture.getSourceImage();
    ctx.drawImage(source, cutX, cutY, cutWidth, cutHeight, 0, 0, cutWidth, cutHeight);
    if (tint !== 0xffffff) {
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `#${tint.toString(16).padStart(6, "0")}`;
      ctx.fillRect(0, 0, cutWidth, cutHeight);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(source, cutX, cutY, cutWidth, cutHeight, 0, 0, cutWidth, cutHeight);
    }
    this.crateImages.set(key, canvas);
    return canvas;
  }

  drawSpace(time, entries) {
    const ctx = this.context, count = entries.length;
    const lastDrop = entries.at(-1).start;
    const leave = lastDrop + 0.3;
    drawSpaceBackdrop(ctx, this.stars, time);
    for (let index = 0; index < count; index++) {
      const age = time - FIRST_LAUNCH - index * GAP;
      if (age < 0 || time >= entries[index].start) continue;
      const at = deliveryCratePosition(index, count, age);
      const image = this.crateImage(entries[index].crate.sprite);
      if (age >= DIVE_AFTER) {
        const back = deliveryCratePosition(index, count, Math.max(DIVE_AFTER, age - 0.08));
        const trail = ctx.createLinearGradient(at.x, back.y - 10, at.x, at.y);
        trail.addColorStop(0, "#9de4ff00");
        trail.addColorStop(1, "#9de4ffaa");
        ctx.fillStyle = trail;
        ctx.fillRect(at.x - 6, back.y - 10, 12, at.y - back.y + 6);
      }
      ctx.save();
      ctx.translate(at.x, at.y);
      ctx.rotate(age >= DIVE_AFTER ? 0 : Math.sin(age * 9 + index) * 0.25);
      ctx.drawImage(image, -13, -11.5, 26, 23);
      ctx.restore();
    }
    let x = SHIP_X;
    if (time < 1.3) x = W + 10 - (W + 10 - SHIP_X) * easeOut(time / 1.3);
    if (time > leave) x = SHIP_X - (SHIP_X + SHIP_W + 20) * clamp((time - leave) / 1.2) ** 3;
    const y = SHIP_Y + Math.sin(time * 2.2) * 1.2;
    const nozzleX = x + SHIP_W - 2, nozzleY = y + SHIP_H * 0.47;
    const length = (time < 1.3 || time > leave ? 46 : 14) * (0.9 + 0.1 * Math.sin(time * 40));
    const fire = ctx.createLinearGradient(nozzleX, nozzleY, nozzleX + length, nozzleY);
    fire.addColorStop(0, "#e6fbff");
    fire.addColorStop(0.3, "#6cc9ff");
    fire.addColorStop(1, "#4aa9ff00");
    ctx.fillStyle = fire;
    ctx.beginPath();
    ctx.moveTo(nozzleX, nozzleY - 6);
    ctx.quadraticCurveTo(nozzleX + length * 0.6, nozzleY - 4, nozzleX + length, nozzleY);
    ctx.quadraticCurveTo(nozzleX + length * 0.6, nozzleY + 4, nozzleX, nozzleY + 6);
    ctx.fill();
    ctx.drawImage(this.ship, x, y, SHIP_W, SHIP_H);
  }

  destroy() {
    for (const entry of this.active?.crates ?? []) {
      entry.glow.destroy();
      entry.flame.destroy();
      entry.crate.incomingDelivery = false;
      entry.crate.setThrowHeight(0);
      entry.crate.sprite.setVisible(true);
      entry.crate.sprite.body.enable = true;
    }
    for (const crates of this.queue) for (const crate of crates) {
      crate.incomingDelivery = false;
      crate.sprite.setVisible(true);
      crate.sprite.body.enable = true;
    }
    this.queue = [];
    this.active = null;
    this.uiWindow.element.remove();
    this.shop.windowManager.windows.delete(this.uiWindow.id);
  }
}
