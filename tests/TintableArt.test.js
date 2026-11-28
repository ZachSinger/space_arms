import test from "node:test";
import assert from "node:assert/strict";
import { grayscalePixels, repaintPurplePixels } from "../js/logic/TintableArt.js";

test("gray shelf art keeps transparency and light-to-dark order, and has no color left", () => {
  const pixels = new Uint8ClampedArray([
    18, 23, 61, 255,
    123, 106, 165, 255,
    165, 150, 204, 128,
    250, 10, 10, 0,
  ]);
  grayscalePixels(pixels);
  const grays = [0, 4, 8].map((index) => pixels[index]);
  for (const index of [0, 4, 8]) {
    assert.equal(pixels[index], pixels[index + 1]);
    assert.equal(pixels[index], pixels[index + 2]);
  }
  assert.deepEqual([pixels[3], pixels[7], pixels[11], pixels[15]], [255, 255, 128, 0]);
  assert.ok(grays[0] < grays[1] && grays[1] < grays[2]);
  // Brightened so tints show strongly: the lightest visible paint ends up near white.
  assert.ok(grays[2] > 200);
});

test("register repaint changes only the purple body, leaving the outline, lights, and white alone", () => {
  const pixels = new Uint8ClampedArray([
    150, 110, 230, 255, // purple body
    30, 40, 110, 255, // navy outline
    40, 220, 210, 255, // teal light
    250, 250, 250, 255, // white
  ]);
  const original = [...pixels];
  repaintPurplePixels(pixels, 0xff0000);
  assert.ok(pixels[0] > 0 && pixels[1] === 0 && pixels[2] === 0, "the body takes the red paint");
  assert.equal(pixels[3], 255);
  assert.deepEqual([...pixels.slice(4)], original.slice(4));
});
