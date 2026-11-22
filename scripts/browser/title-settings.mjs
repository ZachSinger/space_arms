import assert from "node:assert/strict";
import { PAD } from "../../js/input/GamepadInput.js";
import { defaultControllerBindings, swapControllerBinding } from "../../js/input/ControllerBindings.js";

const STORAGE_KEY = "space-arms-dealer.controller-bindings";

async function openTitleSettings(page) {
  const position = await page.evaluate(() => {
    const title = window.__game.scene.getScene("scene-title");
    const settings = title.menuItems.find((item) => item.text.includes("SETTINGS"));
    if (!settings) throw new Error("The title screen Settings option was not found");
    const bounds = settings.getBounds();
    const canvas = window.__game.canvas;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((bounds.x + bounds.width / 2) / canvas.width) * rect.width,
      y: rect.top + ((bounds.y + bounds.height / 2) / canvas.height) * rect.height,
    };
  });
  await page.mouse.click(position.x, position.y);
  await page.locator(".settings-window").waitFor({ state: "visible" });
  await page.locator('[data-settings-tab="controller"]').click();
  await page.locator('[data-controller-binding-action="interact"]').waitFor({ state: "visible" });
  await page.locator(".settings-controller-layout").selectOption("xbox");
}

async function assignButton(page, buttonIndex, label) {
  await page.locator('[data-controller-binding-action="interact"]').click();
  await page.evaluate((index) => {
    window.__controllerTestPad.buttons[index] = { pressed: true, value: 1 };
  }, buttonIndex);
  await page.waitForFunction(({ expected }) =>
    document.querySelector('[data-controller-binding-action="interact"]')?.textContent.trim() === expected,
  { expected: label }, { timeout: 5000 });
  await page.evaluate((index) => {
    window.__controllerTestPad.buttons[index] = { pressed: false, value: 0 };
  }, buttonIndex);
}

export async function checkTitleSettings(h) {
  const { page } = h;
  const defaults = defaultControllerBindings();
  const applied = swapControllerBinding(defaults, "interact", PAD.RB).bindings;
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "getGamepads");
    window.__controllerTestOriginalGamepadDescriptor = descriptor;
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    window.__controllerTestPad = {
      connected: true,
      mapping: "standard",
      id: "Xbox 360 Controller",
      buttons,
      axes: [0, 0, 0, 0],
    };
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [window.__controllerTestPad],
    });
  });

  try {
    await openTitleSettings(page);
    await assignButton(page, PAD.RB, "RB");
    assert.equal(await page.locator('[data-controller-binding-action="zoomIn"]').textContent(), "A");
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), null,
      "previewing a controller assignment must not save it");
    await page.locator(".settings-cancel").click();
    assert.deepEqual(JSON.parse(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)), defaults,
      "Cancel must restore the original assignments");

    await openTitleSettings(page);
    await assignButton(page, PAD.RB, "RB");
    await page.locator(".settings-apply").click();
    assert.deepEqual(JSON.parse(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)), applied,
      "Apply must save the previewed assignments");

    await assignButton(page, PAD.Y, "Y");
    assert.equal(await page.locator('[data-controller-binding-action="putDown"]').textContent(), "RB");
    await page.locator(".settings-cancel").click();
    assert.deepEqual(JSON.parse(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)), applied,
      "Cancel must return to the last applied assignments");
  } finally {
    await page.evaluate(() => {
      delete window.__controllerTestPad;
      const descriptor = window.__controllerTestOriginalGamepadDescriptor;
      if (descriptor) Object.defineProperty(navigator, "getGamepads", descriptor);
      else delete navigator.getGamepads;
      delete window.__controllerTestOriginalGamepadDescriptor;
    });
  }
}
