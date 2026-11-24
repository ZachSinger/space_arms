import { ensureMopWindowTextures, mopWindowTexture, MOP_WINDOW_HEIGHT } from "./MopWindowArt.js";

const WINDOW_PIXEL_SCALE = 3;
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

export function mopWindowFrame(motion) {
  const step = motion.target === 1 ? 6 + motion.phase * 4 : 6 - motion.phase * 4;
  return Math.round(step) % 8;
}

export class MopAnimation {
  constructor(scene, actor) {
    this.scene = scene;
    this.actor = actor;
    this.motion = new MopMotion();
    ensureMopWindowTextures(scene);
    this.window = scene.add.image(0, 0, mopWindowTexture(6))
      .setOrigin(0.5, 1).setDepth(9999).setVisible(false);
    this.top = 0;
  }

  press(time) {
    this.motion.press(time);
  }

  update(delta, canScrub = true) {
    this.motion.update(delta);
    this.window.setVisible(canScrub);
    if (!canScrub) return;
    const { sprite } = this.actor;
    const scale = this.scene.cameraRig.popupScale(sprite.x, sprite.y);
    const bottom = sprite.y - sprite.displayHeight * sprite.originY - 5 * scale;
    this.top = bottom - MOP_WINDOW_HEIGHT * WINDOW_PIXEL_SCALE * scale;
    const texture = mopWindowTexture(mopWindowFrame(this.motion));
    if (this.window.texture.key !== texture) this.window.setTexture(texture);
    this.window.setPosition(sprite.x, bottom).setScale(WINDOW_PIXEL_SCALE * scale);
  }

  destroy() {
    this.window.destroy();
  }
}
