import assert from "node:assert/strict";
import test from "node:test";
import {
  BUG_REPORT_URL, BUG_REPORT_MAX_LENGTH, sendBugReport,
} from "../js/logic/BugReport.js";

test("bug reports send the Worker's multipart fields including screenshot and game data", async () => {
  const screenshotBlob = new Blob(["test-image"], { type: "image/png" });
  const sessionData = { version: "0.1.0", credits: 450, day: 3 };
  const result = await sendBugReport({
    title: " Test Bug Report ", message: " Testing the relay. ", screenshotBlob, sessionData,
  }, async (url, options) => {
    assert.equal(url, BUG_REPORT_URL);
    assert.equal(options.method, "POST");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.body.get("title"), "Test Bug Report");
    assert.equal(options.body.get("message"), "Testing the relay.");
    assert.deepEqual(JSON.parse(options.body.get("gameData")), sessionData);
    const image = options.body.get("screenshot");
    assert.equal(image.name, "screenshot.png");
    assert.equal(image.type, "image/png");
    assert.equal(await image.text(), "test-image");
    return Response.json({ ok: true });
  });
  assert.deepEqual(result, { ok: true });
});

test("bug reports support the user's quick test without a screenshot", async () => {
  await sendBugReport({ title: "Test", message: "No screenshot" }, async (_url, { body }) => {
    assert.equal(body.has("screenshot"), false);
    assert.equal(body.has("gameData"), false);
    return Response.json({ ok: true });
  });
});

test("invalid reports never make a network request", async () => {
  const unexpectedFetch = () => assert.fail("Invalid report was sent");
  for (const [report, expected] of [
    [{ title: " ", message: "Problem" }, /Enter a title/],
    [{ title: "x".repeat(201), message: "Problem" }, /200 characters/],
    [{ title: "Problem", message: " " }, /Describe what went wrong/],
    [{ title: "Problem", message: "x".repeat(BUG_REPORT_MAX_LENGTH + 1) }, /4000 characters/],
  ]) {
    await assert.rejects(sendBugReport(report, unexpectedFetch), expected);
  }
});

test("failed HTTP, network, and invalid responses are surfaced instead of reporting success", async () => {
  const report = { title: "Problem", message: "Something broke" };
  await assert.rejects(sendBugReport(report, async () => new Response("Error", { status: 502 })),
    /Bug report failed: 502/);
  await assert.rejects(sendBugReport(report, async () => { throw new Error("Offline"); }), /Offline/);
  await assert.rejects(sendBugReport(report, async () => new Response("Not JSON")), SyntaxError);
});
