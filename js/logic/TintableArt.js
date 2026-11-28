// ==========================================
// FILE: TintableArt.js
// ==========================================
// Gray copies of fixture art for color customization. Phaser tints multiply each pixel by
// the chosen color, so the gray copy is brightened until the shelf's lightest paint is
// near white; any tint then shows at almost full strength, while outlines stay dark.
// See also: js/scenes/shelfColorLab.js (the DEV room that tries this out).

// The lightest paint on the shelf becomes this gray; full white would wash out highlights.
const BRIGHTEST_GRAY = 240;

/** Rewrites RGBA pixels in place as tint-ready gray, keeping transparency and shading order. */
export function grayscalePixels(data) {
  let brightest = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3]) brightest = Math.max(brightest, luminance(data, index));
  }
  if (!brightest) return data;
  const scale = BRIGHTEST_GRAY / brightest;
  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.min(255, Math.round(luminance(data, index) * scale));
    data[index] = gray;
    data[index + 1] = gray;
    data[index + 2] = gray;
  }
  return data;
}

function luminance(data, index) {
  return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
}

export function grayTextureKey(sourceKey) {
  return `${sourceKey}_gray`;
}

/** Makes (once) and returns the gray copy of an already-loaded texture. */
export function ensureGrayTexture(scene, sourceKey) {
  const key = grayTextureKey(sourceKey);
  if (scene.textures.exists(key)) return key;
  if (!scene.textures.exists(sourceKey)) throw new Error(`Missing artwork: ${sourceKey}`);
  const source = scene.textures.get(sourceKey).getSourceImage();
  const texture = scene.textures.createCanvas(key, source.width, source.height);
  if (!texture) throw new Error(`Could not create artwork: ${key}`);
  texture.context.drawImage(source, 0, 0);
  const pixels = texture.context.getImageData(0, 0, source.width, source.height);
  grayscalePixels(pixels.data);
  texture.context.putImageData(pixels, 0, 0);
  texture.refresh().setFilter(1);
  return key;
}

const paintedUrls = new Map();

/**
 * A picture address for page elements (not the game map) showing gray art in a tint, the
 * same way the map's tint multiplies it. Made once per art and color.
 */
export function paintedArtUrl(scene, grayKey, tint) {
  const cacheKey = `${grayKey}:${tint}`;
  if (paintedUrls.has(cacheKey)) return paintedUrls.get(cacheKey);
  const source = scene.textures.get(grayKey).getSourceImage();
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0);
  context.globalCompositeOperation = "multiply";
  context.fillStyle = `#${tint.toString(16).padStart(6, "0")}`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  // Multiplying fills the see-through parts too; put the art's own outline back.
  context.globalCompositeOperation = "destination-in";
  context.drawImage(source, 0, 0);
  const url = canvas.toDataURL();
  paintedUrls.set(cacheKey, url);
  return url;
}

// The purple body color of art that has other colors too (a register's lights and screen).
function isPurplePaint(data, index) {
  const r = data[index], g = data[index + 1], b = data[index + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (!max || (max - min) / max < 0.2) return false;
  let hue;
  if (max === r) hue = ((g - b) / (max - min)) * 60;
  else if (max === g) hue = (2 + (b - r) / (max - min)) * 60;
  else hue = (4 + (r - g) / (max - min)) * 60;
  hue = (hue + 360) % 360;
  return hue >= 245 && hue <= 285;
}

/**
 * Rewrites RGBA pixels in place: only the purple body turns the paint color, shaded the way
 * tinted gray art is; every other color stays as drawn.
 */
export function repaintPurplePixels(data, tint) {
  let brightest = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] && isPurplePaint(data, index)) brightest = Math.max(brightest, luminance(data, index));
  }
  if (!brightest) return data;
  const scale = BRIGHTEST_GRAY / brightest;
  const channels = [(tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff];
  for (let index = 0; index < data.length; index += 4) {
    if (!data[index + 3] || !isPurplePaint(data, index)) continue;
    const gray = Math.min(255, luminance(data, index) * scale);
    for (let channel = 0; channel < 3; channel += 1) {
      data[index + channel] = Math.round(gray * channels[channel] / 255);
    }
  }
  return data;
}

/** Makes (once) and returns a copy of an already-loaded texture with its purple body repainted. */
export function ensureRepaintedTexture(scene, sourceKey, tint) {
  const key = `${sourceKey}_paint_${tint.toString(16).padStart(6, "0")}`;
  if (scene.textures.exists(key)) return key;
  if (!scene.textures.exists(sourceKey)) throw new Error(`Missing artwork: ${sourceKey}`);
  const source = scene.textures.get(sourceKey).getSourceImage();
  const texture = scene.textures.createCanvas(key, source.width, source.height);
  if (!texture) throw new Error(`Could not create artwork: ${key}`);
  texture.context.drawImage(source, 0, 0);
  const pixels = texture.context.getImageData(0, 0, source.width, source.height);
  repaintPurplePixels(pixels.data, tint);
  texture.context.putImageData(pixels, 0, 0);
  texture.refresh().setFilter(1);
  return key;
}
