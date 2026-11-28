import { readFileSync } from "node:fs";

const STARTING_MONEY = JSON.parse(readFileSync(new URL("../../data/StartingTemplate.json", import.meta.url), "utf8")).money;

async function clickTitleCommand(page, label) {
  const position = await page.evaluate((target) => {
    const title = window.__game.scene.getScene("scene-title");
    const command = title.menuItems.find((item) => item.text.includes(target));
    if (!command) throw new Error(`The title screen ${target} option was not found`);
    const bounds = command.getBounds();
    const canvas = window.__game.canvas;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((bounds.x + bounds.width / 2) / canvas.width) * rect.width,
      y: rect.top + ((bounds.y + bounds.height / 2) / canvas.height) * rect.height,
    };
  }, label);
  await page.mouse.click(position.x, position.y);
}

async function startRealGame(h) {
  await h.page.evaluate(() => window.localStorage.clear());
  await clickTitleCommand(h.page, "REAL");
  await h.page.waitForFunction(() => {
    const scene = window.__game.scene.getScene("scene-game");
    return scene?.sys.isActive() && scene.player && scene.realMode;
  }, null, { timeout: 60000 });
  const ready = await h.game((scene) => ({
    realMode: scene.realMode,
    debugTools: scene.debugTools,
    day: scene.gameState.calendar.day,
    credits: scene.gameState.economy.credits,
  }));
  if (!ready.realMode || ready.debugTools) throw new Error("REAL did not start a debug-free game");
  if (ready.day !== 1 || ready.credits !== STARTING_MONEY) {
    throw new Error(`REAL did not start a fresh game: day ${ready.day}, money ${ready.credits}`);
  }
}

async function setUpShop(h) {
  return h.game((scene) => {
    scene.managerTablet.handleSignContract("lic_start_rations");
    if (!scene.gameState.catalog.owns("lic_start_rations")) {
      throw new Error("Could not sign the starter food contract");
    }
    if (!scene.fixtureSystem.buy("shelf_budget_2x2")) {
      throw new Error("Could not buy the starter shelf");
    }
    const fixtureCrate = scene.restockCrates.find((crate) =>
      crate.kind === "fixture" && crate.typeId === "shelf_budget_2x2");
    if (!fixtureCrate) throw new Error("The purchased shelf was not delivered");
    const fixtureStack = { base: fixtureCrate, crates: [fixtureCrate], marked: fixtureCrate };
    if (!scene.crateSystem.pickUpFromStack(fixtureStack, false)) {
      throw new Error("Could not pick up the purchased shelf");
    }
    const position = scene.fixtureSystem.findNearestCell("shelf_budget_2x2", { gx: 15, gy: 3 });
    if (!position || !scene.fixtureSystem.placeFromCrate(fixtureCrate, position.gx, position.gy)) {
      throw new Error("Could not place the purchased shelf");
    }
    const item = scene.supply.restockableItems().sort((a, b) => a.cost - b.cost)[0];
    if (!item) throw new Error("The starter food contract did not unlock any items");
    return { itemId: item.item.id };
  });
}

async function orderAndStock(h, itemId) {
  return h.game((scene, selectedItemId) => {
    const itemCount = scene.catalogSystem.getInventoryItems()
      .reduce((sum, item) => sum + item.offShelves + item.stock + item.inCustomerCarts, 0);
    let orderedUnits = 0;
    if (itemCount < 10) {
      const existingCrates = new Set(scene.restockCrates);
      if (!scene.supply.placeOrder(new Map([[selectedItemId, 1]]))) {
        throw new Error("Could not place the starter supply order");
      }
      const delivered = [...scene.restockCrates].reverse().find((candidate) =>
        !existingCrates.has(candidate) && candidate.kind === "item" && candidate.itemId === selectedItemId);
      if (!delivered) throw new Error("The ordered items were not delivered");
      orderedUnits = delivered.quantity;
    }
    const crate = [...scene.restockCrates].reverse().find((candidate) =>
      candidate.kind === "item" && candidate.itemId === selectedItemId && candidate.quantity > 0);
    if (!crate) return { itemCount, orderedUnits, stockedUnits: 0 };
    const stack = { base: crate, crates: [crate], marked: crate };
    if (!scene.crateSystem.pickUpFromStack(stack, false)) {
      throw new Error("Could not pick up the delivered items");
    }
    const shelf = scene.fixtures.shelves()[0];
    if (!shelf) throw new Error("The starter shelf is missing");
    scene.shelfStockingWindow.openForFixture(shelf, scene.fixtures.displayName(shelf));
    let stockedUnits = 0;
    while (crate.quantity > 0) {
      const before = crate.quantity;
      scene.shelfStockingWindow.holding = { index: 0, pull: false };
      scene.shelfStockingWindow.moveOne();
      scene.shelfStockingWindow.stopHolding();
      if (crate.quantity === before) break;
      stockedUnits += before - crate.quantity;
    }
    scene.shelfStockingWindow.uiWindow.close();
    if (!scene.crateSystem.dropTopCrate()) throw new Error("Could not set down the supply crate");
    return { itemCount, orderedUnits, stockedUnits };
  }, itemId);
}

async function continueGame(h, expectedDay, expectedSave) {
  await h.resumeLoop();
  await h.page.evaluate(() => {
    window.__threeShiftPreviousPlayer = window.__game.scene.getScene("scene-game").player;
    window.__game.scene.getScene("scene-game").scene.start("scene-title");
  });
  await h.page.waitForFunction(() =>
    window.__game.scene.getScene("scene-title")?.sys.isActive(), null, { timeout: 30000 });
  await clickTitleCommand(h.page, "CONTINUE");
  await h.page.locator('#title-save-slots [data-save-slot]').first().click();
  await h.page.waitForFunction((day) => {
    const scene = window.__game.scene.getScene("scene-game");
    return scene?.sys.isActive() && scene.player && scene.player !== window.__threeShiftPreviousPlayer &&
      scene.gameState.calendar.day === day;
  }, expectedDay, { timeout: 60000 });
  const reloaded = await h.game((scene) => ({
    day: scene.gameState.calendar.day,
    snapshot: JSON.stringify(scene.saves.serialize()),
  }));
  if (reloaded.snapshot !== expectedSave) {
    throw new Error(`Continue changed the saved shop on day ${expectedDay}`);
  }
}

async function playShift(h, itemId) {
  await h.game((scene) => {
    window.__threeShiftLog ??= { sales: 0, angry: 0, spawned: 0 };
    window.__threeShiftError = null;
    const log = window.__threeShiftLog;
    scene.eventBus.on("customer-sale-completed", () => { log.sales += 1; });
    scene.eventBus.on("customer-left-angry", () => { log.angry += 1; });
    const spawn = scene.customerFlow.spawn.bind(scene.customerFlow);
    scene.customerFlow.spawn = (...args) => {
      const before = scene.customers.length;
      const result = spawn(...args);
      if (scene.customers.length > before) log.spawned += 1;
      return result;
    };
    // Simulate the player's scanner and payment actions through the checkout window.
    scene.events.on("postupdate", () => {
      const checkout = scene.checkoutWindow;
      if (checkout.mode !== "checkout") return;
      for (const card of checkout.bodyElement.querySelectorAll('.checkout-item-card[data-scanned="false"]')) {
        card.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      }
      if (checkout.paymentStage === "total" && !checkout.cashPayment && !checkout.chitPayment) {
        for (const digit of checkout.total.toFixed(2)) checkout.appendDigit(digit);
        checkout.confirmPayment();
      } else if (checkout.paymentStage === "chit") {
        for (const digit of checkout.chitPayment.code) checkout.enterChitDigit(Number(digit));
      } else if (checkout.paymentStage === "take") {
        checkout.cashPayment.tenderPieces.forEach((piece, index) => {
          if (!piece.taken) checkout.takeTenderPiece(index);
        });
      } else if (checkout.paymentStage === "change") {
        let remaining = checkout.cashPayment.changeDueUnits;
        const denominations = [...new Set([...checkout.bodyElement.querySelectorAll("[data-cash-units]")]
          .map((button) => Number(button.dataset.cashUnits)))].sort((a, b) => b - a);
        for (const denomination of denominations) {
          const count = Math.floor(remaining / denomination);
          for (let index = 0; index < count; index += 1) {
            checkout.cashPayment.adjustChange(denomination, 1);
          }
          remaining -= count * denomination;
        }
        if (remaining !== 0) {
          window.__threeShiftError = `Could not make exact change for ${checkout.cashPayment.changeDueUnits}`;
          return;
        }
        checkout.refreshCash();
        checkout.handOverChange("test");
      }
    });
  });
  const startingLog = await h.page.evaluate(() => ({ ...window.__threeShiftLog }));
  await h.game((scene) => scene.shift.start());
  await h.page.waitForFunction(() =>
    window.__game.scene.getScene("scene-game").shiftClock.started, null, { timeout: 30000 });
  await h.game((scene) => {
    const register = scene.fixtures.register();
    scene.checkoutSystem.beginRegisterSession(register);
    if (!scene.checkoutSystem.operatingRegister) {
      throw new Error("Could not start the player's register session");
    }
  });
  await h.step(12 * 35 * 60, { perFrame: 120 });
  let ended = await h.game((scene) => scene.shift.ended);
  for (let attempt = 0; !ended && attempt < 6; attempt += 1) {
    await h.game((scene) => {
      scene.shiftClock.elapsedMs = Math.max(scene.shiftClock.elapsedMs, 12 * 35 * 1000 - 500);
    });
    await h.step(3000, { perFrame: 120 });
    ended = await h.game((scene) => scene.shift.ended);
  }
  if (!ended) {
    const remaining = await h.game((scene) => scene.customers.length);
    throw new Error(`Day did not close; ${remaining} customers remained inside`);
  }
  const day = await h.game((scene, selectedItemId) => {
    if (scene.checkoutSystem.operatingRegister) scene.checkoutSystem.endRegisterSession();
    const lines = scene.gameState.economy.dayLedger.lines;
    const sum = (category) => lines
      .filter((line) => line.category === category)
      .reduce((total, line) => total + line.amount, 0);
    const inventory = scene.catalogSystem.getInventoryItems()
      .reduce((total, item) => total + item.offShelves + item.stock + item.inCustomerCarts, 0);
    const soldUnits = lines.filter((line) => line.category === "sales")
      .reduce((total, line) => total + (line.quantity ?? 1), 0);
    return {
      day: scene.gameState.calendar.day,
      ended: scene.shift.ended,
      softClosed: scene.shiftClock.softClosed,
      customersLeft: scene.customers.length,
      served: scene.shift.customersServed,
      inventory,
      soldUnits,
      sales: sum("sales"),
      stockOrders: -sum("stock_orders"),
      deliveryFees: -sum("delivery_fees"),
      wages: -sum("wages"),
      itemId: selectedItemId,
    };
  }, itemId);
  const automationError = await h.page.evaluate(() => window.__threeShiftError);
  if (automationError) throw new Error(automationError);
  const endingLog = await h.page.evaluate(() => ({ ...window.__threeShiftLog }));
  day.spawned = endingLog.spawned - startingLog.spawned;
  day.angry = endingLog.angry - startingLog.angry;
  day.salesCompleted = endingLog.sales - startingLog.sales;
  return day;
}

export async function runThreeShiftCheck(h) {
  await startRealGame(h);
  const setup = await setUpShop(h);
  const firstOrder = await orderAndStock(h, setup.itemId);
  const days = [];
  const failures = [];

  for (let index = 0; index < 3; index += 1) {
    const order = index === 0 ? firstOrder : await orderAndStock(h, setup.itemId);
    const day = await playShift(h, setup.itemId);
    day.expectedInventory = order.itemCount + order.orderedUnits - day.soldUnits;
    day.inventoryAddsUp = day.inventory === day.expectedInventory;
    day.costsCovered = day.sales >= day.stockOrders + day.deliveryFees + day.wages;
    days.push(day);
    if (!day.ended || !day.softClosed || day.customersLeft !== 0) {
      failures.push(`day ${day.day} did not finish after closing with the shop empty`);
    }
    if (day.inventoryAddsUp === false) {
      failures.push(`day ${day.day} stock does not add up: ${order.itemCount} + ${order.orderedUnits} delivered - ${day.soldUnits} sold != ${day.inventory}`);
    }
    if (day.spawned === 0) failures.push(`no customers arrived on day ${day.day}`);
    if (day.spawned > 0 && day.angry / day.spawned > 0.25) {
      failures.push(`${day.angry} of ${day.spawned} customers left angry on day ${day.day}`);
    }
    if (day.salesCompleted !== day.served) {
      failures.push(`day ${day.day} sale count did not match the shift summary`);
    }
    if (day.wages !== 0) failures.push(`day ${day.day} charged wages when no employee was hired`);

    const saved = await h.game(async (scene) => {
      if (!scene.shift.endDay()) throw new Error(`Could not end day ${scene.gameState.calendar.day}`);
      await scene.saves.saveManually();
      return {
        day: scene.gameState.calendar.day,
        snapshot: JSON.stringify(scene.saves.serialize()),
      };
    });
    if (index < 2) await continueGame(h, saved.day, saved.snapshot);
  }

  const totals = days.reduce((total, day) => ({
    sales: total.sales + day.sales,
    stockOrders: total.stockOrders + day.stockOrders,
    deliveryFees: total.deliveryFees + day.deliveryFees,
    wages: total.wages + day.wages,
    customers: total.customers + day.spawned,
    served: total.served + day.served,
  }), { sales: 0, stockOrders: 0, deliveryFees: 0, wages: 0, customers: 0, served: 0 });
  if (totals.sales === 0) failures.push("no sales happened across the three shifts");

  const detail = days.map((day) =>
    `day ${day.day}: ${day.sales.toFixed(2)} sales vs ` +
    `${(day.stockOrders + day.deliveryFees + day.wages).toFixed(2)} stock and wages ` +
    `(${day.costsCovered ? "covered" : "not covered"}), ${day.served}/${day.spawned} served, ` +
    `${day.customersLeft} left inside`).join("; ");
  await h.resumeLoop();
  return {
    name: "three shifts from a clean new game with save and continue",
    failures,
    detail: `${detail}; total ${totals.sales.toFixed(2)} sales, ` +
      `${totals.stockOrders.toFixed(2)} stock, ${totals.deliveryFees.toFixed(2)} delivery, ` +
      `${totals.wages.toFixed(2)} wages`,
  };
}
