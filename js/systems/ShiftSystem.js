// ==========================================
// FILE: ShiftSystem.js
// ==========================================
// The shift and the day: starting a shift (wages, staff on the floor),
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
import { HOVERCART_LEVEL } from "../modules/hovercart/HovercartRules.js";
import { ROBOT_PART_CATALOG, ROBOT_SERVICE_LEVEL } from "../logic/RobotServiceCatalog.js";
import { ShiftReceiptWindow } from "../logic/ShiftReceiptWindow.js";

const PRICE_REACTION_TYPES = Object.freeze(["bargain", "skipped", "disgusted"]);

function emptyPriceReactionCounts() {
  return { bargain: 0, skipped: 0, disgusted: 0 };
}

function emptyPriceReactionCustomers() {
  return Object.fromEntries(PRICE_REACTION_TYPES.map((type) => [type, new Set()]));
}

export class ShiftSystem {
  constructor(shop) {
    this.shop = shop;
    this.starting = false;
    // Guards end() from firing more than once per shift.
    this.ended = false;
    this.customersServed = 0;
    this.priceReactionCounts = emptyPriceReactionCounts();
    this.priceReactionCustomers = emptyPriceReactionCustomers();
    this.creditsAtStart = shop.gameState.economy.credits;
    this.reputationAtStart = shop.gameState.reputation.global;
  }

  // Every completed sale goes on today's receipt and counts toward the shift's summary.
  listen(eventBus) {
    eventBus.on(GAME_EVENTS.CUSTOMER_PRICE_REACTION, ({ customer, reaction }) => {
      const customers = this.priceReactionCustomers[reaction];
      if (!customers) throw new Error(`Unknown customer price reaction: ${reaction}.`);
      if (customers.has(customer)) return;
      customers.add(customer);
      this.priceReactionCounts[reaction] += 1;
    });
    eventBus.on(GAME_EVENTS.CUSTOMER_SALE_COMPLETED, ({ customer }) => {
      this.recordSale(customer);
      this.shop.gameState.reputation.gain(1, customer.factionId, { customer });
      if (customer.boughtBargainItem) {
        this.shop.gameState.reputation.gain(1, null, { customer });
      }
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

  // Opens the store and pays staff for the shift.
  async start() {
    const shop = this.shop;
    const { gameState } = shop;
    if (this.starting || shop.saves.loadFailed || !shop.saves.canSaveOffShift()) return;
    if (gameState.calendar.awaitingEndDay) {
      shop.messages.show("End the day first: click END DAY at the top.");
      return;
    }
    if (shop.fixturePlacement.active) {
      shop.messages.show("Finish or cancel fixture placement before starting the shift.");
      return;
    }
    this.starting = true;
    shop.shelfStockingWindow?.uiWindow.close();
    shop.managerTablet.uiWindow.close();
    shop.player.sprite.body.stop();
    shop.customerFlow.prepareSchedule();
    shop.customerFlow.clearTemporaryClosure();
    shop.hud.renderStoreStatus(false);
    const wages = shop.staffSystem.payWages();
    if (wages > 0) {
      shop.messages.show(`Employee wages paid: ${wages}.`, "#f59e0b");
    }
    this.resetStartingTotals();
    shop.shiftClock.startNewShift();
    this.ended = false;
    this.starting = false;
    shop.staffSystem.spawnWorking();
    this.customersServed = 0;
    this.priceReactionCounts = emptyPriceReactionCounts();
    this.priceReactionCustomers = emptyPriceReactionCustomers();
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
    shop.staffSystem.clear();
    this.ended = true;
    shop.shiftClock.started = false;
    shop.shiftClock.isPaused = true;
    shop.shiftClock.notifyListeners();
    shop.customerFlow.clearTemporaryClosure();
    shop.hud.renderStoreStatus(false);
    gameState.finishShift({
      customersServed: this.customersServed,
      customersTurnedAway: gameState.reputation.customersTurnedAway,
      priceReactions: { ...this.priceReactionCounts },
    });
    shop.eventBus.emit(GAME_EVENTS.SHIFT_ENDED, {
      served: this.customersServed,
      turnedAway: gameState.reputation.customersTurnedAway,
      reputation: gameState.reputation.global,
      factionReputation: gameState.reputation.factions,
    });
    const levelMessage = this.levelUpMessage(previousLevel);
    this.showClosingSequence();
    if (levelMessage) shop.messages.show(levelMessage, "#10b981");
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
    if (reachedNow(HOVERCART_LEVEL) && !this.shop.gameModules?.get("hovercart")?.owned) {
      message += " The hovercart is available to buy in the Layout tab.";
    }
    if (reachedNow(ROBOT_SERVICE_LEVEL)) {
      message += " Robot Service is available in the manager's tablet.";
    } else if (ROBOT_PART_CATALOG.some(({ level: partLevel }) => reachedNow(partLevel))) {
      message += " New robot parts are available in Robot Service.";
    }
    if (hasUnimplementedShopRewardBetween(previousLevel, level)) {
      message += " Some later level rewards are not in the game yet.";
    }
    return message;
  }

  showClosingSequence() {
    if (typeof document === "undefined") return;
    this.receiptWindow ??= new ShiftReceiptWindow(this.shop);
    this.receiptWindow.open();
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
      !shop.fixturePlacement.active && shop.saves.canSaveOffShift();
  }

  // Closes today's receipt, moves the calendar on, and changes market prices (bible Steps 43
  // and 52). Prices only move here, so repricing between shifts is stress-free.
  endDay() {
    if (!this.canEndDay()) return false;
    const shop = this.shop;
    shop.gameModules.endDay();
    shop.gameState.endDay();
    const { day } = shop.gameState.calendar;
    if (this.loanOffer().available) {
      shop.messages.show(
        `Day ${day} begins. You have nothing left to sell and can't afford a supply order. Open Finances to take an emergency loan.`,
        "#f59e0b",
      );
      return true;
    }
    shop.messages.show(`Day ${day} begins. Market prices have changed.`, "#10b981");
    return true;
  }

  /**
   * The loan is only offered when the shop is stuck: nothing left to sell anywhere and not
   * enough money for the cheapest one-crate supply order.
   */
  loanOffer() {
    const shop = this.shop;
    const ownsSellableStock = shop.catalogSystem.getInventoryItems()
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
    this.shop.messages.show(
      `Emergency loan received: ${formatMoneyAmount(offer.amount)}. You owe ${formatMoneyAmount(offer.repayTotal)}, paid back from your sales.`,
      "#f59e0b",
    );
    return true;
  }

  payOffLoan() {
    if (!this.shop.gameState.economy.payOffLoan()) return false;
    this.shop.messages.show("Emergency loan paid off.", "#10b981");
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
    this.receiptWindow?.destroy();
  }
}
