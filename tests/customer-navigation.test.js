import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("queue shuffling follows a new obstacle-aware path instead of cutting through fixtures", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "space-arms-navigation-test-"));
  let server;
  try {
    server = await createServer({
      root: fileURLToPath(new URL("..", import.meta.url)),
      configFile: false,
      logLevel: "silent",
      cacheDir,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true },
    });
    const { Customer } = await server.ssrLoadModule("/js/logic/Customer.js");
    const waypoints = [{ x: 96, y: 160 }, { x: 160, y: 160 }, { x: 160, y: 96 }];
    const calls = [];
    const visited = [];
    const customer = Object.create(Customer.prototype);
    customer.sprite = { x: 96, y: 96 };
    customer.state = "QUEUEING";
    customer.scene = { findPath: (...args) => {
      calls.push(args);
      return [...waypoints];
    } };
    customer.updateFacing = () => {};
    customer.moveToward = (x, y, onArrive) => {
      visited.push({ x, y });
      customer.sprite.x = x;
      customer.sprite.y = y;
      onArrive();
    };
    customer.setQueueTarget(160, 96);
    for (let i = 0; i <= waypoints.length; i += 1) customer.update(16);
    assert.deepEqual(calls, [[96, 96, 160, 96]]);
    assert.deepEqual(visited.slice(0, waypoints.length), waypoints);
    customer.setQueueTarget(224, 96);
    assert.deepEqual(calls[1], [160, 96, 224, 96]);
    assert.deepEqual(customer.path, waypoints);
  } finally {
    if (server) await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
