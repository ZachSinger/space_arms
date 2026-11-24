import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

async function sizeOf(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sizeOf(path);
    if (entry.isFile()) return (await stat(path)).size;
    throw new Error(`Unexpected build entry: ${path}`);
  }));
  return sizes.reduce((total, size) => total + size, 0);
}

const size = await sizeOf("dist");
const items = JSON.parse(await readFile(join("dist", "data", "Items.json"), "utf8"));
const images = new Set(items.map((item) => item.image).filter(Boolean));
for (const image of images) {
  const metadata = await sharp(join("dist", image)).metadata();
  if (metadata.format !== "png" || metadata.width > 192 || metadata.height > 192) {
    throw new Error(`Invalid optimized item picture: ${image}`);
  }
}
console.log(`Built game: ${size} bytes; ${images.size} item pictures verified.`);
