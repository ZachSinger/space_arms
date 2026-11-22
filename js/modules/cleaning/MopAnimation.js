const FACINGS = ["down", "left", "right", "up"];
const FRAMES = 8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Each fresh press reverses one sweep. Faster presses shorten the stroke, not a looping timer.
export class MopMotion {
  constructor() {
    this.phase = 0;
    this.from = 0;
    this.target = 0;
    this.elapsed = 0;
    this.duration = 400;
    this.lastPress = null;
    this.active = false;
  }

  press(time) {
    this.duration = this.lastPress === null ? 400 : clamp(time - this.lastPress, 90, 700);
    this.lastPress = time;
    this.from = this.phase;
    this.target = 1 - this.target;
    this.elapsed = 0;
    this.active = true;
  }

  update(delta) {
    if (!this.active) return;
    this.elapsed += delta;
    const fraction = clamp(this.elapsed / this.duration, 0, 1);
    this.phase = this.from + (this.target - this.from) * fraction * fraction * (3 - 2 * fraction);
    if (this.elapsed >= this.duration + 180) this.active = false;
  }
}

export function mopPose(facing, phase) {
  const sway = phase * 2 - 1;
  const direction = facing === "left" ? -1 : 1;
  const head = facing === "up" ? [24 + sway * 4, 10 + sway * 2]
    : facing === "down" ? [19 + sway * 3, 38 + sway * 3]
      : [16 + direction * (15 + sway * 4), 29 + sway * 2];
  const handle = facing === "up" ? [18 + sway, 24]
    : facing === "down" ? [14 + sway, 17] : [16 - direction * 3, 18];
  const frontOrBack = facing === "up" || facing === "down";
  const grips = frontOrBack ? [0.28, 0.42] : [0.38];
  return {
    hands: grips.map((fraction) => [
      handle[0] + (head[0] - handle[0]) * fraction,
      handle[1] + (head[1] - handle[1]) * fraction,
    ]),
    shoulders: frontOrBack ? [[12, 19], [19, 19]] : [[16, 19]],
    head,
    handle,
  };
}

function poseTexture(scene, baseKey) {
  const key = `${baseKey}_mopping`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, FRAMES * 96, 4 * 96);
  const ctx = texture.context;
  ctx.imageSmoothingEnabled = false;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const art = canvas.getContext("2d", { willReadFrequently: true });
  if (!art) throw new Error("Could not create character mopping artwork.");
  for (const [row, facing] of FACINGS.entries()) {
    const frame = scene.textures.get(baseKey).get(row * 3 + 1);
    art.clearRect(0, 0, 32, 32);
    art.imageSmoothingEnabled = false;
    art.drawImage(frame.source.image, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, 32, 32);
    const original = art.getImageData(0, 0, 32, 32);
    const sample = (x, y) => {
      const offset = (y * 32 + x) * 4;
      return `rgb(${original.data[offset]},${original.data[offset + 1]},${original.data[offset + 2]})`;
    };
    const sleeve = facing === "right" ? sample(13, 20) : facing === "left" ? sample(18, 20) : sample(11, 18);
    const skin = facing === "right" ? sample(13, 23) : facing === "left" ? sample(18, 23) : sample(10, 23);
    for (let index = 0; index < FRAMES; index += 1) {
      art.putImageData(original, 0, 0);
      if (facing === "down" || facing === "up") {
        art.clearRect(9, 19, 4, 6);
        art.clearRect(19, 19, 5, 6);
      } else {
        art.fillStyle = sleeve;
        art.fillRect(facing === "right" ? 13 : 17, 20, 3, 4);
      }
      const pose = mopPose(facing, index / (FRAMES - 1));
      for (const [handIndex, hand] of pose.hands.entries()) {
        const shoulder = pose.shoulders[handIndex];
        art.beginPath();
        art.moveTo(...shoulder);
        art.lineTo(...hand);
        art.strokeStyle = "#101222";
        art.lineWidth = 4;
        art.stroke();
        art.strokeStyle = sleeve;
        art.lineWidth = 2;
        art.stroke();
        art.fillStyle = skin;
        art.fillRect(Math.round(hand[0]) - 1, Math.round(hand[1]) - 1, 2, 2);
      }
      ctx.drawImage(canvas, index * 96, row * 96, 96, 96);
      texture.add(row * FRAMES + index, 0, index * 96, row * 96, 96, 96);
    }
  }
  texture.refresh().setFilter(1);
  return key;
}

// Any character with a four-direction walk sheet can use this, including employee uniforms.
export class MopAnimation {
  constructor(scene, actor) {
    this.scene = scene;
    this.actor = actor;
    this.baseKey = actor.sprite.texture.key;
    this.poseKey = poseTexture(scene, this.baseKey);
    this.motion = new MopMotion();
    this.tool = scene.add.graphics();
  }

  press(time) {
    this.motion.press(time);
  }

  restorePose() {
    const { sprite, currentFacing } = this.actor;
    if (sprite.scene && sprite.texture.key === this.poseKey) {
      sprite.setTexture(this.baseKey, FACINGS.indexOf(currentFacing) * 3 + 1);
    }
  }

  update(delta, canScrub = true) {
    this.motion.update(delta);
    const { sprite, currentFacing } = this.actor;
    const active = canScrub && this.motion.active;
    const phase = active ? this.motion.phase : 0.5;
    if (canScrub) {
      sprite.anims.stop();
      sprite.setTexture(this.poseKey,
        FACINGS.indexOf(currentFacing) * FRAMES + Math.round(phase * (FRAMES - 1)));
    } else {
      this.restorePose();
    }
    const pose = mopPose(currentFacing, phase);
    const scale = sprite.displayWidth / 32;
    const x = sprite.x - sprite.displayWidth * sprite.originX;
    const y = sprite.y - sprite.displayHeight * sprite.originY;
    const at = ([px, py]) => ({ x: x + px * scale, y: y + py * scale });
    const head = at(pose.head);
    const handle = at(pose.handle);
    const g = this.tool.clear().setDepth(sprite.depth + (currentFacing === "up" ? -0.5 : 0.5));
    g.lineStyle(3 * scale, 0x101222).lineBetween(handle.x, handle.y, head.x, head.y);
    g.lineStyle(1.5 * scale, 0xd9b178).lineBetween(handle.x, handle.y, head.x, head.y);
    g.fillStyle(0x101222).fillEllipse(head.x, head.y, 15 * scale, 7 * scale);
    g.fillStyle(0x596a83).fillEllipse(head.x, head.y, 12 * scale, 5 * scale);
    g.lineStyle(scale, 0xd0dce2);
    for (let offset = -4; offset <= 4; offset += 2) {
      g.lineBetween(head.x + offset * scale, head.y - 2 * scale,
        head.x + (offset + 1) * scale, head.y + 2 * scale);
    }
  }

  destroy() {
    this.restorePose();
    this.tool.destroy();
  }
}
