import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PendingErrorStore } from "../js/logic/PendingErrors.js";

test("pending errors survive restart, redact local paths, and clear only reported entries", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "space-arms-pending-errors-"));
  try {
    const file = path.join(directory, "pending-errors.json");
    const firstStore = new PendingErrorStore(file);
    const saved = firstStore.append({
      type: "renderer-error",
      message: "Failed in C:\\Users\\Private\\game.js",
      stack: "at run (C:\\Users\\Private\\game.js:8:2)",
      line: 8,
    });
    const restartedStore = new PendingErrorStore(file);
    assert.deepEqual(restartedStore.read(), [saved]);
    assert.doesNotMatch(saved.message, /Private/);
    assert.doesNotMatch(saved.stack, /Private/);

    restartedStore.append({ type: "main-process-error", message: "Another error" });
    assert.equal(restartedStore.clear([saved.id]).length, 1);
    assert.equal(restartedStore.read()[0].message, "Another error");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pending error storage keeps only the newest 20 records", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "space-arms-pending-errors-"));
  try {
    const store = new PendingErrorStore(path.join(directory, "pending-errors.json"));
    for (let index = 0; index < 25; index += 1) {
      store.append({ message: `Error ${index}` });
    }
    const records = store.read();
    assert.equal(records.length, 20);
    assert.equal(records[0].message, "Error 5");
    assert.equal(records.at(-1).message, "Error 24");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
