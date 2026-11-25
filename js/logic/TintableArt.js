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
