import test from "node:test";
import assert from "node:assert/strict";
import licenseData from "../data/Licenses.json" with { type: "json" };
import { SupplierLicense } from "../js/logic/Licenses.js";
import { HANDBOOK_TOPICS, HandbookRenderer, getLevelRewards } from "../js/logic/HandbookRenderer.js";

const licenses = licenseData.map((data) => new SupplierLicense(data));
const render = (topic, shopLevel = 1, reputation = 0) =>
  HandbookRenderer.generateHTML({ topic, shopLevel, reputation, licenses });

test("every handbook topic renders with its title and the topic buttons", () => {
  for (const { id, label } of HANDBOOK_TOPICS) {
    const html = render(id);
    assert.ok(html.includes(`<h2>${label}</h2>`));
    assert.match(html, new RegExp(`data-handbook-topic="${id}" aria-pressed="true"`));
    assert.equal(html.match(/data-handbook-topic=/g).length, HANDBOOK_TOPICS.length + 1);
    assert.match(html, new RegExp(`handbook-back-btn" data-handbook-topic="${id}"`));
    assert.doesNotMatch(html, /undefined|NaN/);
  }
});

test("an unknown handbook topic is an error", () => {
  assert.throws(() => render("nope"), /Unknown handbook topic/);
});

test("the store page shows the player's level and the next goal", () => {
  const html = render("store", 2, 20);
  assert.match(html, /Store Level 2<\/strong> with <strong>20<\/strong>/);
  assert.match(html, /at least <strong>35<\/strong> to reach Level 3/);
});

test("level rewards come from the game's own unlock data", () => {
  const rewards = getLevelRewards(licenses);
  assert.ok(rewards.get(2).some((text) => text.startsWith("Supply license: Civilian Threads")));
  assert.ok(rewards.get(3).includes("Fixture license: Expanded Fixture Supply"));
  assert.ok(rewards.get(4).includes("Staff limit: up to 1 employee hired at once"));
  assert.ok(rewards.get(23).includes("Staff limit: up to 6 employees hired at once"));
  assert.ok(rewards.get(5).some((text) => text.includes("Sales Floor Expansion West")));
  assert.ok(rewards.get(13).some((text) => text.includes("Backroom Upgrade A")));
  assert.ok(rewards.get(8).some((text) => text.includes("25 spaces")));
});

test("level rewards mark the levels already reached", () => {
  const html = render("levels", 3);
  assert.equal(html.match(/handbook-level-reached/g).length, 2);
});

test("handbook key names match the device in use", () => {
  const html = render("stocking");
  assert.match(html, /<span class="kbd-only">Space<\/span><span class="pad-only">X<\/span>/);
});

test("the handbook explains paid training absences, permanent skills, and on/off shift", () => {
  const html = render("employees");
  assert.match(html, /Level 1 and can reach Level 5/);
  assert.match(html, /entire next shift/);
  assert.match(html, /still pay their current wage/);
  assert.match(html, /work\s+50% faster\s+at Level 3/);
  assert.match(html, /2 times normal speed at Level 5/);
  assert.match(html, /25 at Level 3, and 35 at Level 5/);
  assert.match(html, /Skills and higher wages are permanent/);
  assert.match(html, /On Shift &amp; Off Shift/);
  assert.match(html, /stay home and aren't paid/);
  assert.match(html, /not available/);
  assert.doesNotMatch(html, /fire|let go|LET GO|rehir|TAKE OFF|PUT ON/i);
});

test("the handbook describes duplicate purchases and the new cash collection gesture", () => {
  const html = render("customers");
  assert.match(html, /1, 2, or 3 of the same item/);
  assert.match(html, /Start a new click or click-and-hold/);
});
