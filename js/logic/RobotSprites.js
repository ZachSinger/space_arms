// The hover bot's sheet: 8 hover-bob frames of 96 px per row, rows facing down/left/right/up.
const FACING_ROWS = Object.freeze({ down: 0, left: 1, right: 2, up: 3 });
const FRAMES_PER_ROW = 8;
const HOVER_FRAME_RATE = 10;
const ROBOT_DOCKED_SIZE = 84;
const ROBOT_DOCKED_FRAME_SIZE = 96;

export const HOVER_BOT_SPRITE = Object.freeze({ key: "robot_hover_bot", path: "img/Generated/hover_bot.png" });
const ROBOT_DOCKED_TEXTURE_PREFIX = `${HOVER_BOT_SPRITE.key}_docked`;

export function loadRobotSprites(load) {
  load.spritesheet(HOVER_BOT_SPRITE.key, HOVER_BOT_SPRITE.path, { frameWidth: 96, frameHeight: 96 });
}

function hoverAnimationKey(facing) {
  return `${HOVER_BOT_SPRITE.key}_hover_${facing}`;
}

export function registerRobotAnimations(textures, anims) {
  textures.get(HOVER_BOT_SPRITE.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  for (const [facing, row] of Object.entries(FACING_ROWS)) {
    const key = hoverAnimationKey(facing);
    if (anims.exists(key)) continue;
    anims.create({
      key,
      frames: anims.generateFrameNumbers(HOVER_BOT_SPRITE.key, {
        start: row * FRAMES_PER_ROW, end: row * FRAMES_PER_ROW + FRAMES_PER_ROW - 1,
      }),
      frameRate: HOVER_FRAME_RATE,
      repeat: -1,
    });
  }
}

export function showRobotFacing(sprite, facing) {
  sprite.play(hoverAnimationKey(facing), true);
}

// The bot fills less of its frame than people do, so it's drawn larger to stand about chest-high
// to a person. Its collision box stays the same size and stays at its shadow.
const ROBOT_DISPLAY_SIZE = 84;
const FRAME_SIZE = 96;

export function sizeRobotSprite(sprite) {
  const { width, height } = sprite.body;
  const scale = ROBOT_DISPLAY_SIZE / FRAME_SIZE;
  const footY = sprite.originY * FRAME_SIZE;
  sprite.setDisplaySize(ROBOT_DISPLAY_SIZE, ROBOT_DISPLAY_SIZE);
  sprite.body.setSize(width / scale, height / scale, false);
  sprite.body.setOffset(FRAME_SIZE / 2 - width / scale / 2, footY - height / scale / 2);
  sprite.body.updateFromGameObject();
}

export function robotDockedTexture(scene, battery = null) {
  const chargeLevel = battery === null ? "idle" : Math.round(Math.max(0, Math.min(1, battery)) * 7);
  const key = `${ROBOT_DOCKED_TEXTURE_PREFIX}_${chargeLevel}`;
  if (scene.textures.exists(key)) return key;

  const texture = scene.textures.createCanvas(key, ROBOT_DOCKED_SIZE, ROBOT_DOCKED_SIZE);
  const context = texture.context;
  context.imageSmoothingEnabled = false;
  const source = scene.textures.get(HOVER_BOT_SPRITE.key).getSourceImage();
  context.drawImage(source, 0, 0, ROBOT_DOCKED_FRAME_SIZE, ROBOT_DOCKED_FRAME_SIZE,
    0, 0, ROBOT_DOCKED_SIZE, ROBOT_DOCKED_SIZE);

  const image = context.getImageData(0, 0, ROBOT_DOCKED_SIZE, ROBOT_DOCKED_SIZE);
  const pixels = image.data;
  for (let y = 55; y < ROBOT_DOCKED_SIZE; y++) {
    for (let x = 0; x < ROBOT_DOCKED_SIZE; x++) {
      if (y >= 59 || (x >= 30 && x <= 50)) pixels[(y * ROBOT_DOCKED_SIZE + x) * 4 + 3] = 0;
    }
  }

  if (battery !== null) drawBatteryFace(pixels, chargeLevel);
  context.putImageData(image, 0, 0);
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return key;
}

export function robotChargingStationTexture(scene, sourceKey) {
  const key = `${sourceKey}_charging`;
  if (scene.textures.exists(key)) return key;

  const source = scene.textures.get(sourceKey).getSourceImage();
  const width = source.width;
  const height = source.height;
  const texture = scene.textures.createCanvas(key, width, height);
  const context = texture.context;
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  for (let y = 29; y < Math.min(57, height); y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2];
      if (pixels[index + 3] > 0 && (green + blue) / 2 - red > 50) {
        const value = Math.max(green, blue);
        pixels[index] = value;
        pixels[index + 1] = Math.round(value * 0.22);
        pixels[index + 2] = Math.round(value * 0.2);
      }
    }
  }
  context.putImageData(image, 0, 0);
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return key;
}

function drawBatteryFace(pixels, chargeLevel) {
  const isScreenPixel = (x, y) => {
    const index = (y * ROBOT_DOCKED_SIZE + x) * 4;
    const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2];
    return pixels[index + 3] > 200 && (red + green + blue < 200 || (blue > 140 && red < 150));
  };
  const start = 22 * ROBOT_DOCKED_SIZE + 42;
  if (!isScreenPixel(42, 22)) throw new Error("Could not find the robot's face screen.");

  const screen = [];
  const visited = new Uint8Array(ROBOT_DOCKED_SIZE * ROBOT_DOCKED_SIZE);
  const pending = [start];
  while (pending.length) {
    const pixel = pending.pop();
    const x = pixel % ROBOT_DOCKED_SIZE;
    const y = Math.floor(pixel / ROBOT_DOCKED_SIZE);
    if (visited[pixel] || x < 0 || x >= ROBOT_DOCKED_SIZE || y < 0 || y >= 40 ||
      !isScreenPixel(x, y)) continue;
    visited[pixel] = 1;
    screen.push([x, y]);
    pending.push(pixel - 1, pixel + 1, pixel - ROBOT_DOCKED_SIZE, pixel + ROBOT_DOCKED_SIZE);
  }

  const xs = screen.map(([x]) => x);
  const ys = screen.map(([, y]) => y);
  const leftEdge = Math.min(...xs), rightEdge = Math.max(...xs);
  const topEdge = Math.min(...ys), bottomEdge = Math.max(...ys);
  const batteryWidth = 10, batteryHeight = 5;
  const left = Math.round((leftEdge + rightEdge + 1) / 2 - batteryWidth / 2);
  const top = Math.round((topEdge + bottomEdge + 1) / 2 - batteryHeight / 2);
  const setPixel = (x, y, color) => {
    const index = (y * ROBOT_DOCKED_SIZE + x) * 4;
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
    pixels[index + 3] = 255;
  };

  for (const [x, y] of screen) setPixel(x, y, [14, 20, 30]);
  const outline = [120, 240, 255], fill = [90, 230, 255];
  for (let x = left; x < left + 9; x++) {
    setPixel(x, top, outline);
    setPixel(x, top + batteryHeight - 1, outline);
  }
  for (let y = top; y < top + batteryHeight; y++) {
    setPixel(left, y, outline);
    setPixel(left + 8, y, outline);
  }
  for (let y = top + 1; y < top + batteryHeight - 1; y++) setPixel(left + 9, y, outline);
  for (let column = 0; column < chargeLevel; column++) {
    for (let y = top + 1; y < top + batteryHeight - 1; y++) setPixel(left + 1 + column, y, fill);
  }
}
