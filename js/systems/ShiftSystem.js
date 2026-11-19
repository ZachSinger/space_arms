// ==========================================
// FILE: ShiftSystem.js
// ==========================================
// The shift and the day: starting a shift (checkpoint save, wages, staff on the floor),
// the soft close that waits for the last customer, the end-of-shift summary and Shop Level
// news, End Day, the day's sales on the receipt, the emergency loan, and the Finances view.
import { database } from "../scenes/boot.js";
import { GAME_EVENTS } from "../core/Events.js";
import { getStaffLimit, hasUnimplementedShopRewardBetween, STAFF_LIMIT_LEVELS } from "../logic/ShopProgression.js";
import { getEmergencyLoanOffer } from "../logic/EmergencyLoan.js";
import { DELIVERY_FEE } from "../logic/SupplyOrder.js";
import { summarizeReceipt } from "../logic/DayLedger.js";
import { formatMoneyAmount, sumMoney } from "../logic/Money.js";
import { sinkItems } from "../logic/InventoryTransfer.js";

export class ShiftSystem {
  constructor(shop) {
    this.shop = shop;
    this.starting = false;
    // Guards end() from firing more than once per shift.
    this.ended = false;
    this.customersServed = 0;
    this.creditsAtStart = shop.gameState.economy.credits;
    this.reputationAtStart = shop.gameState.reputation.global;
    this.closingOverlay = null;
  }

  // Every completed sale goes on today's receipt and counts toward the shift's summary.
  listen(eventBus) {
    eventBus.on(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, ({ customer }) => {
      this.recordSale(customer);
      this.shop.gameState.reputation.gain(1, customer.factionId);
      this.customersServed += 1;
      this.shop.debugInfo?.recordCustomer("customer-sale-completed", customer);
    });
  }

  get running() {
    return this.shop.shiftClock.started && !this.ended;
  }

  // A loaded game starts counting this shift's changes from what it loaded.
  resetStartingTotals() {
    this.creditsAtStart = this.shop.gameState.economy.credits;
    this.reputationAtStart = this.shop.gameState.reputation.global;
  }

  // Saves a checkpoint first; if that save fails, the shift doesn't start.
  async start() {
    const shop = this.shop;
    const { gameState } = shop;
    if (this.starting || shop.loadFailed || !shop.canSaveOffShift()) return;
    if (gameState.calendar.awaitingEndDay) {
      shop.showShopMessage("End the day first: click END DAY at the top.");
      return;
    }
    if (shop.fixturePlacement.active) {
      shop.showShopMessage("Finish or cancel fixture placement before starting the shift.");
      return;
    }
    this.starting = true;
    shop.shelfStockingWindow?.uiWindow.close();
    shop.managerTablet.uiWindow.close();
    shop.player.sprite.body.stop();
    try {
      await shop.saveOffShift();
    } catch (error) {
      this.starting = false;
      shop.handlePersistenceError(error);
      return;
    }
    shop.customerFlow.prepareSchedule();
    shop.customerFlow.clearTemporaryClosure();
    shop.hud.renderStoreStatus(false);
    const wages = shop.payEmployeeWages();
    if (wages > 0) {
      shop.showGameMessage(`Employee wages paid: ${wages}.`, "#f59e0b");
    }
    this.resetStartingTotals();
    shop.shiftClock.startNewShift();
    this.ended = false;
    this.starting = false;
    shop.spawnHiredEmployees();
    shop.setSaveStatus("Checkpoint saved. Autosaving resumes after this shift.");
    this.customersServed = 0;
    gameState.reputation.startShift();
    shop.eventBus.emit(GAME_EVENTS.SHIFT_STARTED, { pool: shop.customerFlow.pool });
    shop.managerTablet.refreshLayoutPanels();
    shop.managerTablet.refreshEmployeePanel();
  }

  // Soft close: once the store stops admitting customers, the shift ends only after
  // everyone already inside has left.
  update() {
    const shop = this.shop;
    if (!shop.shiftClock.softClosed) return;
    shop.employees.forEach((employee) => employee.requestClockOut());
    if (shop.customers.length === 0 &&
      shop.employees.every((employee) => employee.isReadyToClockOut()) && !this.ended) {
      this.end();
    }
  }

  // The shift ends quietly once the doors are locked and the last customer is gone. The
  // day stays open (prices, calendar) until the player clicks End Day.
  end() {
    const shop = this.shop;
    const { gameState } = shop;
    const previousLevel = gameState.reputation.shopLevel;
    shop.clearEmployees();
    this.ended = true;
    shop.shiftClock.started = false;
    shop.shiftClock.isPaused = true;
    shop.shiftClock.notifyListeners();
    shop.customerFlow.clearTemporaryClosure();
    shop.hud.renderStoreStatus(false);
    gameState.finishShift({
      customersServed: this.customersServed,
      customersTurnedAway: gameState.reputation.customersTurnedAway,
    });
    shop.eventBus.emit(GAME_EVENTS.SHIFT_ENDED, {
      served: this.customersServed,
      turnedAway: gameState.reputation.customersTurnedAway,
      reputation: gameState.reputation.global,
      factionReputation: gameState.reputation.factions,
    });
    const levelMessage = this.levelUpMessage(previousLevel);
    this.showClosingSequence();
    if (levelMessage) shop.showGameMessage(levelMessage, "#10b981");
  }

  // What a new Shop Level opened up, or "" when the level didn't change.
  levelUpMessage(previousLevel) {
    const { gameState, room } = this.shop;
    const level = gameState.reputation.shopLevel;
    if (level <= previousLevel) return "";
    const reachedNow = (required) => required > previousLevel && required <= level;
    const newContracts = database.getAllLicenses().filter((license) =>
      reachedNow(license.requiredShopLevel) &&
      !gameState.catalog.owns(license.id) &&
      license.isUnlocked(gameState));
    const staffLimitRaised = STAFF_LIMIT_LEVELS.some((required) => reachedNow(required));
    const newSalesExpansions = room.zones.filter((zone) =>
      reachedNow(zone.requiredShopLevel) && zone.locked && zone.salesFloor);
    const newBackroomExpansions = room.zones.filter((zone) =>
      reachedNow(zone.requiredShopLevel) && zone.locked && zone.backroom);
    let message = ` Shop Level ${level} reached!`;
    if (newContracts.length) {
      message += ` Contracts unlocked: ${newContracts.map((license) => license.name).join(", ")} (Contracts tab).`;
    }
    if (staffLimitRaised) {
      const limit = getStaffLimit(level);
      message += ` You can now have ${limit} employee${limit === 1 ? "" : "s"} hired at once (Employee tab).`;
    }
    if (newSalesExpansions.length) {
      message += ` Sales-floor expansion${newSalesExpansions.length > 1 ? "s" : ""} available to buy in the Layout tab.`;
    }
    if (newBackroomExpansions.length) {
      message += ` Backroom expansion${newBackroomExpansions.length > 1 ? "s" : ""} available to buy in the Layout tab.`;
    }
    if (hasUnimplementedShopRewardBetween(previousLevel, level)) {
      message += " Some later level rewards are not in the game yet.";
    }
    return message;
  }

  showClosingSequence() {
    if (typeof document === "undefined") return;
    this.closingOverlay?.remove();
    const overlay = document.createElement("div");
    overlay.className = "shift-closing-overlay";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");

    const panel = document.createElement("div");
    panel.className = "shift-closing-panel";
    const title = document.createElement("div");
    title.className = "shift-closing-title";
    title.textContent = "SHOP CLOSED";
    const summary = document.createElement("div");
    summary.className = "shift-closing-summary";
    summary.textContent = `Customers served: ${this.customersServed} · Turned away: ${this.shop.gameState.reputation.customersTurnedAway}`;
    const hint = document.createElement("div");
    hint.className = "shift-closing-hint";
    hint.textContent = "Select END DAY to start the next day. Today's receipt is in Finances.";

    panel.append(title, summary, hint);
    overlay.append(panel);
    overlay.addEventListener("animationend", (event) => {
      if (event.target !== overlay) return;
      overlay.remove();
      if (this.closingOverlay === overlay) this.closingOverlay = null;
    }, { once: true });
    document.getElementById("game-container").append(overlay);
    this.closingOverlay = overlay;
  }

  /**
   * Sinks a sold cart and adds it to today's receipt, one line per item.
   * @param {import("../logic/Customer.js").Customer} customer
   */
  recordSale(customer) {
    const cart = customer.cart.map((entry) => ({ ...entry }));
    const sold = new Map();
    for (const { itemId, price } of cart) {
      const line = sold.get(itemId) ?? { amount: 0, quantity: 0 };
      line.amount = sumMoney([line.amount, price]);
      line.quantity += 1;
      sold.set(itemId, line);
    }
    for (const [itemId, { amount, quantity }] of sold) {
      const result = sinkItems(customer, itemId, quantity, {
        sinkId: `sale-${customer.id}`,
        sinkLocation: { kind: "sales", customerId: customer.id },
        eventBus: this.shop.eventBus,
        sourceName: "customer-cart",
        sinkName: "sales",
      });
      if (result.moved !== quantity) {
        throw new Error(`Could not sink the sold ${itemId} from customer ${customer.id}.`);
      }
      this.shop.gameState.economy.add(amount, {
        category: "sales",
        label: database.getItem(itemId).name,
        quantity,
      });
    }
  }

  canEndDay() {
    const shop = this.shop;
    return shop.gameState.calendar.awaitingEndDay && !this.starting &&
      !shop.fixturePlacement.active && shop.canSaveOffShift();
  }

  // Closes today's receipt, moves the calendar on, and changes market prices (bible Steps 43
  // and 52). Prices only move here, so repricing between shifts is stress-free.
  endDay() {
    if (!this.canEndDay()) return false;
    const shop = this.shop;
    shop.gameState.endDay();
    const { day } = shop.gameState.calendar;
    if (this.loanOffer().available) {
      shop.showGameMessage(
        `Day ${day} begins. You have nothing left to sell and can't afford a supply order. Open Finances to take an emergency loan.`,
        "#f59e0b",
      );
      return true;
    }
    shop.showGameMessage(`Day ${day} begins. Market prices have changed.`, "#10b981");
    return true;
  }

  /**
   * The loan is only offered when the shop is stuck: nothing left to sell anywhere and not
   * enough money for the cheapest one-crate supply order.
   */
  loanOffer() {
    const shop = this.shop;
    const ownsSellableStock = shop.getInventoryItems()
      .some(({ offShelves, stock, inCustomerCarts }) => offShelves + stock + inCustomerCarts > 0);
    const crateCosts = shop.supply.restockableItems().map(({ cost }) => cost);
    return getEmergencyLoanOffer({
      credits: shop.gameState.economy.credits,
      hasLoan: !!shop.gameState.economy.emergencyLoan,
      shiftRunning: this.running,
      ownsSellableStock,
      cheapestOrderCost: crateCosts.length ? Math.min(...crateCosts) + DELIVERY_FEE : null,
    });
  }

  takeLoan() {
    const offer = this.loanOffer();
    if (!offer.available) return false;
    this.shop.gameState.economy.takeLoan(offer.amount, offer.repayTotal);
    this.shop.showGameMessage(
      `Emergency loan received: ${formatMoneyAmount(offer.amount)}. You owe ${formatMoneyAmount(offer.repayTotal)}, paid back from your sales.`,
      "#f59e0b",
    );
    this.shop.requestAutosave();
    return true;
  }

  payOffLoan() {
    if (!this.shop.gameState.economy.payOffLoan()) return false;
    this.shop.showGameMessage("Emergency loan paid off.", "#10b981");
    this.shop.requestAutosave();
    return true;
  }

  // Today's running receipt, every finished day's receipt, and lifetime totals, for the
  // Finances tab.
  financesView() {
    const { economy, reputation, calendar } = this.shop.gameState;
    const shiftRunning = this.running;
    const receipts = economy.dayReceipts.map((receipt) =>
      summarizeReceipt(receipt, receipt.closingCredits, receipt.closingReputation));
    const salesOf = (day) => sumMoney(day.lines
      .filter((line) => line.category === "sales").map((line) => line.amount));
    const customersToday = economy.dayLedger.shift?.customersServed ??
      (shiftRunning ? this.customersServed : 0);
    return {
      day: calendar.day,
      shiftRunning,
      emergencyLoan: {
        offer: this.loanOffer(),
        balance: economy.emergencyLoan?.balance ?? 0,
        canPayOff: !!economy.emergencyLoan && economy.credits >= economy.emergencyLoan.balance,
      },
      pendingReputationChange: shiftRunning ? reputation.pending.global : null,
      awaitingEndDay: calendar.awaitingEndDay,
      canEndDay: this.canEndDay(),
      today: summarizeReceipt(economy.dayLedger.serialize(), economy.credits, reputation.global),
      receipts,
      lifetime: {
        daysCompleted: receipts.length,
        totalSales: sumMoney([...economy.dayReceipts.map(salesOf), salesOf(economy.dayLedger)]),
        customersServed: economy.dayReceipts.reduce(
          (sum, receipt) => sum + (receipt.shift?.customersServed ?? 0), customersToday),
      },
    };
  }

  destroy() {
    this.closingOverlay?.remove();
    this.closingOverlay = null;
  }
}
