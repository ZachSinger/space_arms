import test from "node:test";
import assert from "node:assert/strict";
import licenseData from "../data/Licenses.json" with { type: "json" };
import { SupplierLicense } from "../js/logic/Licenses.js";
import { HANDBOOK_TOPICS, HandbookRenderer, getLevelRewards } from "../js/logic/HandbookRenderer.js";
import { escapeHtml } from "../js/core/html.js";
import { defaultBindings, setBindings } from "../js/input/KeyBindings.js";
import { setControllerLabelStyle } from "../js/input/InputDevice.js";

const licenses = licenseData.map((data) => new SupplierLicense(data));
const render = (topic, shopLevel = 1, reputation = 0) =>
  HandbookRenderer.generateHTML({ topic, shopLevel, reputation, licenses });

test("every handbook topic renders with its title and the topic buttons", () => {
  for (const { id, label } of HANDBOOK_TOPICS) {
    const html = render(id);
    assert.ok(html.includes(`<h2 class="type-h2">${escapeHtml(label)}</h2>`));
    assert.match(html, new RegExp(`data-handbook-topic="${id}" aria-pressed="true"`));
    assert.equal(html.match(/data-handbook-topic=/g).length, HANDBOOK_TOPICS.length);
    assert.doesNotMatch(html, /undefined|NaN/);
  }
});

test("handbook level rewards escape license names", () => {
  const html = HandbookRenderer.generateHTML({
    topic: "levels",
    shopLevel: 1,
    reputation: 0,
    licenses: [{
      name: '<img src=x onerror="run()">',
      requiredShopLevel: 2,
      unlocksFixtures: [],
    }],
  });

  assert.match(html, /Supply license: &lt;img src=x onerror=&quot;run\(\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

test("an unknown handbook topic is an error", () => {
  assert.throws(() => render("nope"), /Unknown handbook topic/);
});

test("the store page shows the player's level and the next goal", () => {
  const html = render("store", 2, 20);
  assert.match(html, /Store Level 2<\/strong> with <strong>20<\/strong>/);
  assert.match(html, /at least <strong>50<\/strong> to reach Level 3/);
});

test("level rewards come from the game's own unlock data", () => {
  const rewards = getLevelRewards(licenses);
  assert.ok(rewards.get(2).some((text) => text.startsWith("Supply license: Frontier Survival Kit")));
  assert.ok(rewards.get(3).some((text) => text.startsWith("Supply license: Standard Pistol Ammo")));
  assert.ok(rewards.get(5).includes("Supply license: Scrap-Yard Melee"));
  assert.ok(rewards.get(50).some((text) => text.startsWith("Supply license: Exotic Ordinance")));
  assert.ok(rewards.get(4).includes("Staff limit: up to 1 employee hired at once"));
  assert.ok(rewards.get(23).includes("Staff limit: up to 6 employees hired at once"));
  assert.ok(rewards.get(6).some((text) => text.includes("Sales Floor Expansion West")));
  assert.ok(rewards.get(22).some((text) => text.includes("Backroom Upgrade A")));
  assert.ok(![...rewards.values()].flat().some((text) => /hovercart|spaces/i.test(text)));
});

test("every level after the first unlocks one or two things", () => {
  const html = render("store", 49, 16572);
  assert.match(html, /at least <strong>17148<\/strong> to reach Level 50/);
  assert.match(render("store", 50, 17148), /Store Level 50<\/strong>, the highest level/);
  const rewards = getLevelRewards(licenses);
  for (let level = 2; level <= 50; level += 1) {
    const count = rewards.get(level).length;
    assert.ok(count >= 1 && count <= 2, `Level ${level} unlocks ${count} things`);
  }
});

test("level rewards mark the levels already reached", () => {
  const html = render("levels", 3);
  assert.equal(html.match(/handbook-level-reached/g).length, 2);
});

test("handbook key names match the device in use", () => {
  const html = render("stocking");
  assert.match(html, /<span class="kbd-only">Space<\/span><span class="pad-only">X<\/span>/);
});

test("the controls table uses the same labels as live action hints", () => {
  const html = render("controls");
  assert.match(html, /<td>Use or open<\/td><td>E<\/td><td>A<\/td>/);
  assert.match(html, /<td>Put a crate down \(hold: your whole stack\)<\/td><td>Q<\/td><td>Y<\/td>/);
  assert.match(html, /<td>Pick up a fixture to move it[^<]*<\/td><td>Hold Ctrl<\/td><td>Hold A<\/td>/);
  assert.match(html, /<td>Manager&#39;s Tablet<\/td><td>I or Tab<\/td><td>View<\/td>/);
  assert.match(html, /<td>Zoom in \(sales floor only\)<\/td><td>Page Up<\/td><td>RB<\/td>/);
  assert.match(html, /<td>Zoom out \(sales floor only\)<\/td><td>Page Down<\/td><td>LB<\/td>/);
});

test("controller menu instructions use the selected button-name layout", (t) => {
  setControllerLabelStyle("playstation");
  t.after(() => setControllerLabelStyle("automatic"));
  const html = render("controls");
  assert.match(html, /✕ selects\. ○ goes back\./);
  assert.match(html, /L1 and R1 switch tablet tabs/);
  assert.match(html, /Options jumps to the buttons on the top bar/);
});

test("the handbook reflects changed controls", (t) => {
  const bindings = defaultBindings();
  bindings.interact[0] = "Mouse1";
  setBindings(bindings);
  t.after(() => setBindings(defaultBindings()));
  assert.match(render("controls"), /<td>Use or open<\/td><td>Middle click<\/td><td>A<\/td>/);
  assert.match(render("store"), /<span class="kbd-only">Middle click<\/span>/);
});

test("the handbook explains paid training absences, permanent skills, and on/off shift", () => {
  const html = render("employees");
  assert.match(html, /Level 1 and can reach Level 5/);
  assert.match(html, /entire next shift/);
  assert.match(html, /still pay their current wage/);
  assert.match(html, /work\s+50% faster\s+at Level 3/);
  assert.match(html, /2 times normal speed at Level 5/);
  assert.match(html, /Stock shelves makes restocking trips faster with each level/);
  assert.match(html, /existing crate stack with room/);
  assert.match(html, /Deliveries are put away in the backroom/);
  assert.match(html, /carry it to the nearest reachable trashcan/);
  assert.match(html, /Skills and higher wages are permanent/);
  assert.match(html, /On Shift &amp; Off Shift/);
  assert.match(html, /stay home and aren't paid/);
  assert.match(html, /not available/);
  assert.match(html, /highest priority\s+at the top/);
  assert.match(html, /Move up/);
  assert.match(html, /Move down/);
  assert.match(html, /choose a skill under that employee's Training section/);
  assert.match(html, /Each course costs more than that employee's previous course/);
  assert.doesNotMatch(html, /Booking new training courses is not currently available/);
  assert.doesNotMatch(html, /fire|let go|LET GO|rehir|TAKE OFF|PUT ON/i);
});

test("the handbook describes duplicate purchases and the new cash collection gesture", () => {
  const html = render("customers");
  assert.match(html, /1, 2, or 3 of the same item/);
  assert.match(html, /10 extra seconds for each person ahead/);
  assert.match(html, /5 more seconds unless they reach the front/);
  assert.match(html, /Start a new click or click-and-hold/);
  assert.match(html, /the others keep moving at normal belt speed/);
  assert.match(html, /120 M-Scrips equal 1 credit/);
  assert.match(html, /1,000 M-Scrips/);
  assert.match(html, /travel Chit/);
  assert.match(html, /2 to 5 digits/);
  assert.match(html, /The sale completes when you enter the last digit correctly/);
});
