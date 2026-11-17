import test from "node:test";
import assert from "node:assert/strict";
import {
  applyGameRenderResolution,
  getGameViewportLayout,
  getGameRenderSize,
  setGameDisplaySettings,
} from "../js/logic/GameViewport.js";

test("game viewport scales uniformly and centers the design frame", () => {
  assert.deepEqual(getGameViewportLayout(1920, 1080), {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  assert.deepEqual(getGameViewportLayout(1280, 720), {
    scale: 2 / 3,
    offsetX: 0,
    offsetY: 0,
  });
});

test("game viewport preserves the full frame with bars on mismatched aspect ratios", () => {
  assert.deepEqual(getGameViewportLayout(2560, 1080), {
    scale: 1,
    offsetX: 320,
    offsetY: 0,
  });
});

test("the viewport still fills the window at higher output resolutions", () => {
  assert.deepEqual(getGameViewportLayout(2560, 1440), {
    scale: 4 / 3,
    offsetX: 0,
    offsetY: 0,
  });
});

test("selected resolution determines the output canvas size while preserving aspect ratio", () => {
  assert.deepEqual(getGameRenderSize(), { width: 1920, height: 1080 });
  assert.deepEqual(getGameRenderSize({ current: { width: 1280, height: 720 } }), {
    width: 1280,
    height: 720,
  });
  assert.deepEqual(getGameRenderSize({ current: { width: 2560, height: 1440 } }), {
    width: 2560,
    height: 1440,
  });
  assert.deepEqual(getGameRenderSize({ current: { width: 2560, height: 1080 } }), {
    width: 1920,
    height: 1080,
  });
});

test("selected resolution is drawn into a scaled output canvas", () => {
  const draws = [];
  const outputCanvas = {
    id: "",
    width: 0,
    height: 0,
    style: {},
    getContext: () => ({
      clearRect: (...args) => draws.push(["clear", ...args]),
      drawImage: (...args) => draws.push(["draw", ...args]),
    }),
  };
  const children = [];
  const parent = { appendChild: (child) => children.push(child) };
  const sourceCanvas = {
    width: 1920,
    height: 1080,
    style: {},
    parentElement: parent,
  };
  const renders = new Map();
  const game = {
    canvas: sourceCanvas,
    renderer: {
      on: (event, callback) => renders.set(event, callback),
    },
  };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousEvent = globalThis.Event;
  globalThis.Event = class { constructor(type) { this.type = type; } };
  globalThis.window = { dispatchEvent() {} };
  globalThis.document = { createElement: () => outputCanvas };
  try {
    setGameDisplaySettings({
      current: { width: 1280, height: 720 },
      displaySize: { width: 2560, height: 1440 },
      displayMode: "fullscreen",
    });
    applyGameRenderResolution(game);
    assert.equal(outputCanvas.width, 1280);
    assert.equal(outputCanvas.height, 720);
    assert.equal(sourceCanvas.style.opacity, "0");
    assert.deepEqual(children, [outputCanvas]);

    setGameDisplaySettings({
      current: { width: 2560, height: 1440 },
      displaySize: { width: 2560, height: 1440 },
      displayMode: "fullscreen",
    });
    applyGameRenderResolution(game);
    assert.equal(outputCanvas.width, 2560);
    assert.equal(outputCanvas.height, 1440);

    renders.get("postrender")();
    assert.deepEqual(draws, [
      ["clear", 0, 0, 2560, 1440],
      ["draw", sourceCanvas, 0, 0, 2560, 1440],
    ]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousEvent === undefined) delete globalThis.Event;
    else globalThis.Event = previousEvent;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
