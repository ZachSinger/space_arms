import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let server;
let cacheDirectory;
let GameState;
let validateShopSave;
let database;

before(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "space-arms-state-test-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    cacheDir: cacheDirectory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    plugins: [{
      name: "game-state-test-database",
      enforce: "pre",
      resolveId(source) {
        if (source === "./boot.js" || source === "../scenes/boot.js") return "\0game-state-test-database";
      },
      load(id) {
        if (id === "\0game-state-test-database") return "export const database = { getAllLicenses: () => [] };";
      },
    }],
  });
  ({ GameState } = await server.ssrLoadModule("/js/state/GameState.js"));
  ({ validateShopSave } = await server.ssrLoadModule("/js/logic/ShopSave.js"));
  const { DatabaseManager } = await server.ssrLoadModule("/js/logic/DatabaseManager.js");
  database = new DatabaseManager();
  database.loadItemsJSON(JSON.parse(await readFile(new URL("../data/Items.json", import.meta.url), "utf8")));
  database.loadLicensesJSON(JSON.parse(await readFile(new URL("../data/Licenses.json", import.meta.url), "utf8")));
});

after(async () => {
  if (server) await server.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

const goldenDirectory = new URL("./golden-saves/", import.meta.url);
const noRandomNumbers = () => { throw new Error("loading a save must not roll new random numbers"); };

test("every golden save loads, saves, and loads again without changing or rolling new prices", async () => {
  const names = (await readdir(goldenDirectory))
    .filter((name) => name.endsWith(".json") && !name.includes(".expected") && !name.includes(".resaved"));
  assert.ok(names.length > 0);
  for (const name of names) {
    const upgraded = validateShopSave(JSON.parse(await readFile(new URL(name, goldenDirectory), "utf8")), database);
    const options = { items: database.getAllItems(), random: noRandomNumbers };
    const saved = JSON.parse(JSON.stringify(GameState.fromSave(upgraded, options).toSave()));
    assert.equal(saved.market.day, upgraded.market.day, name);
    assert.deepEqual(saved.market.prices, upgraded.market.prices, name);
    assert.deepEqual(GameState.fromSave(saved, options).toSave(), saved, name);
  }
});

test("loading swaps everything in, rebuilds the shop, and only then tells listeners, once", () => {
  const items = [{ id: "ration", baseCost: 10 }];
  const current = new GameState({ items, random: () => 0.5 });
  const source = new GameState({ items, random: () => 0.5 });
  source.economy.add(250, { category: "sales", label: "Ration" });
  source.reputation.global = 40;
  const next = GameState.fromSave(JSON.parse(JSON.stringify(source.toSave())), { items });

  const heard = [];
  current.subscribe((state) => heard.push(state.economy.credits), { immediate: false });
  const moneyShown = [];
  current.economy.subscribe((economy) => moneyShown.push(economy.credits), { immediate: false });
  let rebuiltWith = null;
  current.replaceWith(next, () => {
    rebuiltWith = current.economy.credits;
    assert.deepEqual(heard, [], "no one hears about a half-loaded game");
  });

  assert.equal(rebuiltWith, 1750);
  assert.deepEqual(heard, [1750]);
  assert.deepEqual(moneyShown, [1750]);
  assert.equal(current.reputation.global, 40);
});

test("saved trash locations belong to the trash state slice", () => {
  const items = [];
  const state = new GameState({ items, random: () => 0.5 });
  const pieces = [{ kind: "can", x: 96, y: 128 }, { kind: "paper", x: 160, y: 192 }];
  state.trash.setPieces(pieces);

  const saved = state.toSave();
  assert.deepEqual(saved.trash, pieces);
  assert.deepEqual(GameState.fromSave(saved, { items }).toSave().trash, pieces);
  assert.notEqual(saved.trash[0], pieces[0], "saved trash is detached from the state slice");
});

test("a screen watching one part of the state stops hearing about it once it unsubscribes", () => {
  const state = new GameState({ items: [], random: () => 0.5 });
  const shown = [];
  const unsubscribe = state.economy.subscribe((economy) => shown.push(economy.credits));
  state.reputation.gain(3);
  state.economy.add(5, { category: "sales", label: "Ration" });
  unsubscribe();
  state.economy.add(5, { category: "sales", label: "Ration" });
  assert.deepEqual(shown, [1500, 1505]);
});
