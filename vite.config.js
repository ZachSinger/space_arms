// ==========================================
// FILE: vite.config.js
// ==========================================
// Production build settings. Phaser, data JSON, and DOM <img> tags load images and data by
// plain path, which Vite can't see, so the build copies them into dist/ itself.
// See also: package.json "build" (electron-builder packaging of dist/).
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defineConfig } from "vite";

// An "img/..." image path inside built code or data files.
const IMAGE_PATH = /img\/[^"'`\s)$]+?\.(?:png|jpe?g|webp|gif)/g;

const listFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));

// Copies data/ and only the images the game references. img/ also holds ~200 MB of source
// sheets that must not ship. Fails the build if a referenced image is missing.
function copyRuntimeAssets() {
  let root;
  let outDir;
  return {
    name: "copy-runtime-assets",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = resolve(root, config.build.outDir);
    },
    closeBundle() {
      cpSync(join(root, "data"), join(outDir, "data"), { recursive: true });

      const sources = [...listFiles(join(root, "data")), ...listFiles(join(outDir, "assets"))]
        .filter((file) => /\.(json|js)$/.test(file));
      const images = new Set();
      for (const file of sources) {
        for (const [match] of readFileSync(file, "utf8").matchAll(IMAGE_PATH)) images.add(match);
      }

      const missing = [...images].filter((image) => !existsSync(join(root, image)));
      if (missing.length) {
        throw new Error(`Referenced images are missing:\n  ${missing.join("\n  ")}`);
      }
      for (const image of images) {
        const target = join(outDir, image);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(root, image), target);
      }
      this.info(`copied data/ and ${images.size} referenced images`);
    },
  };
}

export default defineConfig({
  plugins: [copyRuntimeAssets()],
});
