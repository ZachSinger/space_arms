import { controlLabel, getInputDevice } from "../input/InputDevice.js";
import { getFixtureType } from "../logic/FixtureLayout.js";

const stockCrate = (crate) => crate.kind === "item" && crate.quantity > 0;
const shelfCrate = (crate) => crate.kind === "fixture" && getFixtureType(crate.typeId)?.kind === "shelf";

/** @param {GameScene} scene @param {number} firstDay */
export function tutorialHint(scene, firstDay) {
  const { calendar, catalog, items } = scene.gameState;
  const key = (action) => controlLabel(action);
  const gamepad = getInputDevice() === "gamepad";
  const shelves = scene.fixtures.shelves();
  const hasShelfStock = shelves.some((shelf) => shelf.placements.some((item) => item.quantity > 0));
  if (calendar.day > firstDay) {
    return { stage: "complete", text: "First day complete! The shop is ready for its next day." };
  }
  if (calendar.awaitingEndDay) {
    return { stage: "end-day", text: "The shift is over. Select END DAY on the top bar to start the next day." };
  }
  if (scene.shiftClock.started) {
    const checkout = scene.checkoutWindow;
    if (checkout.uiWindow.isOpen) {
      if (checkout.paymentStage === "take") {
        return { stage: "take-payment", text: gamepad
          ? `Hold ${key("tenderAdd")} to take the customer's money.`
          : "Release the mouse, then click each bill or coin to take the customer's money." };
      }
      if (checkout.paymentStage === "change") {
        return { stage: "change", text: `Use the drawer to match CHANGE OWED, then press ${key("handOverChange")} to hand it over.` };
      }
      if (checkout.paymentStage === "chit") {
        return { stage: "chit", text: "Enter the customer's code using the arrows shown on the register." };
      }
      if (checkout.paymentStage === "total" &&
        !checkout.bodyElement.querySelector("#checkout-payment")?.classList.contains("hidden")) {
        return { stage: "total", text: "Enter the total, including both decimal places, then select CONFIRM TOTAL." };
      }
      return { stage: "scan", text: gamepad
        ? `Select each item and press ${key("tenderAdd")} to scan it.`
        : "Click each item on the belt to scan it." };
    }
    if (scene.shiftClock.softClosed) {
      return { stage: "closing", text: "The doors are closed. Serve anyone still waiting, then wait for everyone to leave." };
    }
    const needsStock = !hasShelfStock && scene.shift.customersServed === 0 &&
      !scene.customers.some((customer) => customer.cart.length > 0);
    if (needsStock && scene.checkoutSystem.operatingRegister) {
      return { stage: "leave-register", text: `Press ${key("interact")} to leave the register and stock a shelf.` };
    }
    if (!needsStock) {
      if (!scene.checkoutSystem.operatingRegister) {
        const carrying = scene.crateSystem.getCarriedCrates().length > 0;
        return { stage: "register", text: carrying
          ? `Press ${key("putDown")} to put down your crate. Then face the register and press ${key("interact")}.`
          : `Face the register and press ${key("interact")} to work it.` };
      }
      return { stage: "customers", text: scene.shift.customersServed > 0
        ? "Keep serving customers. The doors close at 20:00."
        : "Wait for a customer to bring items to the register." };
    }
  }

  const carried = scene.crateSystem.getCarriedCrates();
  const floor = scene.crateSystem.getFloorCrates();
  if (shelves.length === 0) {
    if (scene.fixturePlacement.active) {
      return { stage: "place-shelf", text: gamepad
        ? `Move the shelf with the right stick. Press ${key("place")} to place it.`
        : "Move the shelf with the mouse. Click to place it." };
    }
    if (carried.some(shelfCrate)) {
      return { stage: "unpack-shelf", text: `Carry the shelf crate to the shop floor and press ${key("interact")} to place it.` };
    }
    if (floor.some(shelfCrate)) {
      return { stage: "pickup-shelf", text: `Find the shelf crate on the loading pad in the backroom. Face it and press ${key("crate")} to pick it up.` };
    }
    return { stage: "buy-shelf", text: `Open the tablet with ${key("tablet")}. In Fixtures, buy a Budget Shelf.` };
  }
  const hasSupply = items.some((item) => item.license && catalog.owns(item.license));
  if (!hasSupply) {
    return { stage: "contract", text: `Open the tablet with ${key("tablet")}. In Contracts, sign Basic Rations.` };
  }
  if (scene.shelfStockingWindow.uiWindow.isOpen && carried.some(stockCrate)) {
    return { stage: "stock", text: gamepad
      ? `Select a shelf space and hold ${key("tenderAdd")} to stock it. Close the shelf when ready.`
      : "Hold the left mouse button on a shelf space to stock it. Close the shelf when ready." };
  }
  if (hasShelfStock) {
    return { stage: "start-shift", text: scene.shelfStockingWindow.uiWindow.isOpen
      ? "Your shelf is stocked. Close the shelf, then select START SHIFT on the top bar."
      : "Your shelf is stocked. Select START SHIFT on the top bar to open the store." };
  }
  if (carried.some(stockCrate)) {
    return { stage: "open-shelf", text: `Carry the crate to a shelf. Face it and press ${key("interact")} to open it.` };
  }
  if (floor.some(stockCrate)) {
    return { stage: "pickup-stock", text: `Find your stock crate. Orders arrive in the backroom through the top-right door. Face the crate and press ${key("crate")}.` };
  }
  return { stage: "order", text: `Open the tablet with ${key("tablet")}. In Supply, add a crate with +, then place the order.` };
}

/** @param {GameScene} scene */
export function setupTutorialLab(scene) {
  const firstDay = scene.gameState.calendar.day;
  const panel = document.createElement("section");
  panel.className = "tutorial-hint";
  panel.setAttribute("aria-label", "First day tutorial");
  panel.setAttribute("aria-live", "polite");
  const title = document.createElement("strong");
  title.className = "tutorial-hint-title";
  title.textContent = "FIRST DAY";
  const instruction = document.createElement("div");
  panel.append(title, instruction);
  document.getElementById("ui-layer").append(panel);

  const refresh = () => {
    const hint = tutorialHint(scene, firstDay);
    panel.dataset.stage = hint.stage;
    panel.classList.toggle("complete", hint.stage === "complete");
    if (instruction.textContent !== hint.text) instruction.textContent = hint.text;
  };
  refresh();
  const timer = scene.time.addEvent({ delay: 200, loop: true, callback: refresh });
  return {
    noteGaveUp() {},
    destroy() {
      timer.remove();
      panel.remove();
    },
  };
}
