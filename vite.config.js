// ==========================================
// FILE: vite.config.js
// ==========================================
// Build settings, plus the dev server's Starting Template snapshot endpoint. Phaser, data JSON,
// and DOM <img> tags load images and data by plain path, which Vite can't see, so the build
// copies them into dist/ itself.
// See also: package.json "build" (electron-builder packaging of dist/).
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defineConfig } from "vite";
import sharp from "sharp";

// An "img/..." image path inside built code or data files.
const IMAGE_PATH = /img\/[^"'`\s)$]+?\.(?:png|jpe?g|webp|gif)/g;

const listFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));

// Copy referenced art only; item pictures are resized for the shipped game without changing
// the originals. img/ also holds source sheets that must not ship.
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
    async closeBundle() {
      cpSync(join(root, "data"), join(outDir, "data"), { recursive: true });

      const sources = [...listFiles(join(root, "data")), ...listFiles(join(outDir, "assets"))]
        .filter((file) => /\.(json|js)$/.test(file));
      const itemImages = new Set(JSON.parse(readFileSync(join(root, "data", "Items.json"), "utf8"))
        .map((item) => item.image).filter(Boolean));
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
        const source = join(root, image);
        if (itemImages.has(image)) {
          await sharp(source).resize({
            width: 192, height: 192, fit: "inside", withoutEnlargement: true,
          }).png({ palette: true, colours: 256, dither: 0, effort: 10 }).toFile(target);
        } else {
          copyFileSync(source, target);
        }
      }
      this.info(`copied data/ and ${images.size} referenced images (${itemImages.size} optimized item pictures)`);
    },
  };
}

// DEV "Starting Template" snapshot: writes data/StartingTemplate.json. The page that sent it
// already uses the new template, so the file is left out of the watcher (no forced reload)
// and only dropped from Vite's cache for the next page load.
function startingTemplateEndpoint() {
  return {
    name: "starting-template-endpoint",
    apply: "serve",
    config: () => ({ server: { watch: { ignored: ["**/data/StartingTemplate.json"] } } }),
    configureServer(server) {
      const file = resolve(server.config.root, "data", "StartingTemplate.json");
      server.middlewares.use("/__dev/starting-template", (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Only POST is allowed.");
          return;
        }
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (!Number.isFinite(data?.money) || !Array.isArray(data?.fixtures)) {
              throw new Error("A template needs starting money and a fixture list.");
            }
            writeFileSync(file, `${JSON.stringify({ money: data.money, fixtures: data.fixtures }, null, 2)}\n`);
            for (const module of server.moduleGraph.getModulesByFile(file) ?? []) {
              server.moduleGraph.invalidateModule(module);
            }
            response.statusCode = 204;
            response.end();
          } catch (error) {
            response.statusCode = 400;
            response.end(error.message);
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [copyRuntimeAssets(), startingTemplateEndpoint()],
});
