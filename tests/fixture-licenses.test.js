import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { FIXTURE_TYPES } from "../js/logic/FixtureLayout.js";

const licenses = JSON.parse(await readFile(
  new URL("../data/Licenses.json", import.meta.url),
  "utf8",
));
const licenseById = new Map(licenses.map((license) => [license.id, license]));

test("each fixture type is unlocked by its configured license", () => {
  for (const spec of Object.values(FIXTURE_TYPES)) {
    assert.ok(licenseById.get(spec.licenseId)?.unlocksFixtures.includes(spec.id));
  }
});
