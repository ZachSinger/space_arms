import assert from "node:assert/strict";
import test from "node:test";
import { ErrorReportPrompt, createErrorReportPrefill } from "../js/debug/ErrorReportPrompt.js";

function element() {
  return {
    listeners: new Map(),
    value: "",
    textContent: "",
    disabled: false,
    open: false,
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    removeEventListener(name) { this.listeners.delete(name); },
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
}

function environment(api) {
  const fields = {
    title: element(),
    message: element(),
    status: element(),
    send: element(),
    dismiss: element(),
  };
  const dialog = {
    ...element(),
    querySelector(selector) {
      return ({
        "[data-runtime-error-title]": fields.title,
        "[data-runtime-error-message]": fields.message,
        "[data-runtime-error-status]": fields.status,
        "[data-runtime-error-send]": fields.send,
        "[data-runtime-error-dismiss]": fields.dismiss,
      })[selector];
    },
  };
  const listeners = new Map();
  return {
    desktopApi: api,
    document: { getElementById: () => dialog },
    listeners,
    fields,
    dialog,
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); },
  };
}

test("a saved error opens a prefilled prompt and is cleared only after sending", async () => {
  const error = {
    id: "saved-error-1",
    type: "renderer-error",
    at: "2026-11-22T10:00:00.000Z",
    message: "The shop failed to load",
    stack: "at createShop (game.js:12)",
  };
  let sent;
  let cleared;
  const env = environment({
    getPendingRuntimeErrors: async () => [error],
    sendBugReport: async (report) => { sent = report; },
    clearPendingRuntimeErrors: async (ids) => { cleared = ids; },
  });
  const prompt = new ErrorReportPrompt(env);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(env.dialog.open, true);
  assert.match(env.fields.title.value, /The shop failed to load/);
  assert.match(env.fields.message.value, /createShop/);
  assert.equal(sent, undefined);

  await prompt.submit();
  assert.deepEqual(sent.sessionData.diagnostics.pendingErrors, [error]);
  assert.deepEqual(cleared, ["saved-error-1"]);
  assert.equal(env.dialog.open, false);
  prompt.destroy();
});

test("a current runtime error opens a consent-based prompt and remains pending when deferred", async () => {
  let recorded;
  const env = environment({
    recordRuntimeError: async (error) => {
      recorded = { ...error, id: "new-error-1" };
      return recorded;
    },
  });
  let pauseCalls = 0;
  env.__game = {
    scene: {
      getScene: () => ({ pauseMenu: { isOpen: false, open() { pauseCalls += 1; } } }),
    },
  };
  const prompt = new ErrorReportPrompt(env);
  env.listeners.get("error")({
    message: "Unexpected failure",
    filename: "game.js",
    lineno: 5,
    error: new Error("Unexpected failure"),
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(env.dialog.open, true);
  assert.match(env.fields.title.value, /Unexpected failure/);
  assert.equal(recorded.type, "renderer-error");
  assert.equal(prompt.errors[0].id, "new-error-1");
  assert.equal(pauseCalls, 1);

  env.fields.dismiss.listeners.get("click")();
  assert.equal(env.dialog.open, false);
  assert.deepEqual(prompt.errors.map(({ id }) => id), ["new-error-1"]);
  prompt.destroy();
});

test("prefilled reports stay within the report form limits", () => {
  const prefill = createErrorReportPrefill(Array.from({ length: 30 }, (_, index) => ({
    type: "renderer-error",
    message: `Error ${index}`,
    stack: "frame".repeat(1000),
  })));
  assert.ok(prefill.title.length <= 200);
  assert.ok(prefill.message.length <= 4000);
  assert.match(prefill.title, /Error 29/);
});
