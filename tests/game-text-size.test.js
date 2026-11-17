import test from "node:test";
import assert from "node:assert/strict";
import { GameTextSizeController } from "../js/logic/GameTextSize.js";

class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, handler) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(handler);
    this.listeners.set(event, listeners);
  }

  once(event, handler) {
    const wrapped = (...args) => {
      this.off(event, wrapped);
      handler(...args);
    };
    this.on(event, wrapped);
  }

  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event, ...args) {
    for (const handler of this.listeners.get(event) ?? []) handler(...args);
  }
}

function createText(fontSize) {
  const events = new EventEmitter();
  return {
    style: { fontSize },
    setFontSize(size) {
      this.style.fontSize = `${size}px`;
    },
    once: events.once.bind(events),
    destroy() {
      events.emit("destroy");
    },
  };
}

function assertFontSize(text, expectedSize) {
  assert.ok(Math.abs(Number.parseFloat(text.style.fontSize) - expectedSize) < 1e-9);
}

test("the text-size setting scales existing and newly created Phaser text", (t) => {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  globalThis.window = {
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    removeEventListener(event, handler) {
      if (listeners.get(event) === handler) listeners.delete(event);
    },
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  const existingText = createText("14px");
  const sceneEvents = new EventEmitter();
  const scene = {
    sys: {
      events: sceneEvents,
      displayList: { list: [existingText] },
    },
  };
  const controller = new GameTextSizeController([scene], {
    initialScale: 1.15,
    sceneAddedEvent: "added",
    sceneStartEvent: "start",
    sceneShutdownEvent: "shutdown",
    gameObjectDestroyedEvent: "destroy",
  });
  t.after(() => controller.destroy());

  assertFontSize(existingText, 16.1);

  listeners.get("text-size-changed")({ detail: { scale: 0.95 } });
  assertFontSize(existingText, 13.3);

  const newText = createText("10px");
  sceneEvents.emit("added", newText, scene);
  assertFontSize(newText, 9.5);

  listeners.get("text-size-changed")({ detail: { scale: 1.4 } });
  assertFontSize(existingText, 19.6);
  assertFontSize(newText, 14);

  newText.destroy();
  listeners.get("text-size-changed")({ detail: { scale: 1.15 } });
  assertFontSize(existingText, 16.1);
});

test("text size scales Phaser text nested inside existing containers", (t) => {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  globalThis.window = {
    addEventListener: (event, handler) => listeners.set(event, handler),
    removeEventListener() {},
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  const nestedText = createText("8px");
  const scene = {
    sys: {
      events: new EventEmitter(),
      displayList: { list: [{ list: [nestedText] }] },
    },
  };
  const controller = new GameTextSizeController([scene], {
    initialScale: 1.4,
    sceneAddedEvent: "added",
    sceneStartEvent: "start",
    sceneShutdownEvent: "shutdown",
    gameObjectDestroyedEvent: "destroy",
  });
  t.after(() => controller.destroy());

  assertFontSize(nestedText, 11.2);
});
