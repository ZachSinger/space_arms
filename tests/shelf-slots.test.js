import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let server;
let cacheDirectory;
let ShelfFixture;

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-shelf-slots-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "shelf-slots-test-stubs",
      enforce: "pre",
      resolveId(source) {
        if (source === "../scenes/boot.js") return "\0shelf-slots-test-database";
      },
      load(id) {
        if (id === "\0shelf-slots-test-database") {
          return `export const database = { getItem: (id) => ({ id, dimensions: { w: 1, h: 1 }, stackSize: 1 }) };`;
        }
      },
    }],
  });
  ({ ShelfFixture } = await server.ssrLoadModule("/js/logic/ShelfFixture.js"));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

test("sold-out shelf slots keep their spot until deliberately removed while empty", () => {
  const shelf = new ShelfFixture({ displayGrid: { w: 2, h: 1 }, stackDepth: 4 });
  const slot = shelf.placeItem("amo_01", 0, 0);
  shelf.add("amo_01", 1);

  assert.equal(shelf.takeItem(slot), "amo_01");
  assert.equal(shelf.remove("amo_01", 5), 1);
  assert.equal(slot.quantity, 0);
  assert.deepEqual(shelf.placements, [slot]);
  assert.equal(shelf.findAvailableSlot(), null);
  assert.equal(shelf.canPlaceAt(0, 0, 1, 1), false);

  assert.equal(shelf.add("amo_01", 2), 2); // restocking refills the same slot
  assert.equal(shelf.removeEmptyPlacement(slot), false);
  shelf.remove("amo_01", 2);
  assert.equal(shelf.removeEmptyPlacement(slot), true);
  assert.deepEqual(shelf.placements, []);
});
