// Whole-save check: runs after upgradeShopSave and before anything is applied, so the game
// only ever applies a complete, valid save in the current format.
import { getFixtureType, getShelfDisplayGrid, getShelfSlotCapacity, isFixturePosition, isValidFixtureRotation } from "../logic/FixtureLayout.js";
import employeeRoster from "../../data/Employees.json" with { type: "json" };
import { EMPLOYEE_JOB_IDS } from "../logic/EmployeeJobs.js";
import { MAX_EMPLOYEE_SKILL_LEVEL } from "../logic/EmployeeTraining.js";
import { TILE_SIZE, ZONES, getAuthoredGridSize } from "../logic/RoomLayout.js";
import { MIN_BASE_RATIO, MAX_BASE_RATIO } from "../logic/Market.js";
import { THROW_ACCELERATION_MS } from "../logic/Crate.js";
import { FLOOR_STACK_MAX, MAX_CARRIED_CRATES } from "../logic/CrateStack.js";
import { isValidLedgerData } from "../logic/DayLedger.js";
import { isMoney, roundMoney } from "../logic/Money.js";
import { REMOTE_ORDER_TUNING } from "../logic/RemoteOrders.js";
import { isKnownShopLevel } from "../logic/ShopProgression.js";
import { SHELF_PAINTS, isPaintableFixture } from "../logic/ShelfPaint.js";
import { CUSTOMER_FACTION_IDS } from "../logic/CustomerBuyLists.js";
import { isValidTrashList } from "../modules/cleaning/Litter.js";
import { DIRT_KINDS } from "../modules/cleaning/CleaningArt.js";
import { isValidHovercartSave } from "../modules/hovercart/HovercartRules.js";
import { buildProblems, hasEnoughPower } from "../logic/RobotParts.js";
import { getRobotPart, ROBOT_PART_CATALOG, ROBOT_PARTS } from "../logic/RobotServiceCatalog.js";
import { integer, isRecord, requireSave } from "./saveHelpers.js";
import { SHOP_LAYOUT_VERSION } from "./migrations/index.js";


/**
 * Checks a fully upgraded shop save, throwing a readable error on the first invalid field.
 * Returns the save unchanged.
 * @param {object} data - output of upgradeShopSave
 * @param {object} database - item and license lookup
 * @returns {object}
 */
export function checkShopSave(data, database) {
  requireSave(isRecord(data), "missing shop state.");
  requireSave(data.layoutVersion === SHOP_LAYOUT_VERSION, "save was not upgraded before checking.");
  requireSave(Array.isArray(data.fixtures) && data.fixtures.length > 0, "missing fixture layout.");
  const items = database.getAllItems();
  const itemById = new Map(items.map((item) => [item.id, item]));
  const stockCapacity = (stock, capacity) => {
    requireSave(Array.isArray(stock), "missing inventory.");
    const ids = new Set();
    let used = 0;
    for (const entry of stock) {
      const item = itemById.get(entry?.itemId);
      requireSave(item && integer(entry.quantity, 1) && !ids.has(item.id), "invalid inventory entry.");
      ids.add(item.id);
      used += entry.quantity;
    }
    requireSave(used <= capacity, "inventory exceeds its capacity.");
  };
  const player = data.playerState;
  requireSave(isRecord(player), "missing player state.");
  requireSave(isMoney(player.credits) && integer(player.globalReputation) &&
    integer(player.customersTurnedAway, 0), "invalid credits or reputation.");
  if (player.shopLevel !== undefined) {
    requireSave(isKnownShopLevel(player.shopLevel), "invalid shop level.");
  }
  if (player.pendingReputation !== undefined) {
    const pending = player.pendingReputation;
    requireSave(isRecord(pending) && integer(pending.global) && isRecord(pending.factions) &&
      CUSTOMER_FACTION_IDS.every((id) => integer(pending.factions[id])),
    "invalid pending reputation.");
  }
  if (player.hiredEmployees !== undefined) {
    const employeeIds = new Set(employeeRoster.map((employee) => employee.id));
    requireSave(Array.isArray(player.hiredEmployees) &&
      new Set(player.hiredEmployees).size === player.hiredEmployees.length &&
      player.hiredEmployees.every((id) => employeeIds.has(id)), "invalid hired employees.");
  }
  if (player.offShiftEmployees !== undefined) {
    requireSave(Array.isArray(player.offShiftEmployees) &&
      new Set(player.offShiftEmployees).size === player.offShiftEmployees.length &&
      player.offShiftEmployees.every((id) => (player.hiredEmployees ?? []).includes(id)),
    "invalid off-shift employees.");
  }
  if (player.employeeJobPriorities !== undefined) {
    const hiredEmployees = player.hiredEmployees || [];
    requireSave(isRecord(player.employeeJobPriorities) &&
      Object.keys(player.employeeJobPriorities).length === hiredEmployees.length &&
      hiredEmployees.every((employeeId) => {
        const priorities = player.employeeJobPriorities[employeeId];
        return Array.isArray(priorities) && priorities.length === EMPLOYEE_JOB_IDS.length &&
          new Set(priorities).size === EMPLOYEE_JOB_IDS.length &&
          priorities.every((jobId) => EMPLOYEE_JOB_IDS.includes(jobId));
      }), "invalid employee job priorities.");
  }
  if (player.employeeSkills !== undefined) {
    requireSave(isRecord(player.employeeSkills) &&
      Object.entries(player.employeeSkills).every(([employeeId, levels]) =>
        employeeRoster.some(({ id }) => id === employeeId) && isRecord(levels) &&
        Object.keys(levels).length === EMPLOYEE_JOB_IDS.length &&
        EMPLOYEE_JOB_IDS.every((jobId) =>
          integer(levels[jobId], 1) && levels[jobId] <= MAX_EMPLOYEE_SKILL_LEVEL)),
    "invalid employee skills.");
  }
  if (player.employeeTraining !== undefined) {
    requireSave(isRecord(player.employeeTraining) &&
      Object.entries(player.employeeTraining).every(([employeeId, jobId]) =>
        (player.hiredEmployees ?? []).includes(employeeId) && EMPLOYEE_JOB_IDS.includes(jobId) &&
        (player.employeeSkills?.[employeeId]?.[jobId] ?? 1) < MAX_EMPLOYEE_SKILL_LEVEL),
    "invalid employee training.");
  }
  if (player.registerAssignments !== undefined) {
    const registerIds = data.fixtures
      .filter((fixture) => getFixtureType(fixture.type)?.kind === "register").map(({ id }) => id);
    const assigned = Object.values(isRecord(player.registerAssignments) ? player.registerAssignments : {});
    requireSave(isRecord(player.registerAssignments) &&
      Object.keys(player.registerAssignments).every((id) => registerIds.includes(id)) &&
      assigned.every((id) => (player.hiredEmployees ?? []).includes(id)) &&
      new Set(assigned).size === assigned.length,
    "invalid register assignments.");
  }
  if (player.hovercartAssignments !== undefined) {
    const chargerIds = data.fixtures
      .filter((fixture) => getFixtureType(fixture.type)?.kind === "charger").map(({ id }) => id);
    const assigned = Object.values(isRecord(player.hovercartAssignments) ? player.hovercartAssignments : {});
    requireSave(isRecord(player.hovercartAssignments) &&
      Object.keys(player.hovercartAssignments).every((id) => chargerIds.includes(id)) &&
      assigned.every((id) => (player.hiredEmployees ?? []).includes(id)) &&
      new Set(assigned).size === assigned.length,
    "invalid hovercart assignments.");
  }
  if (player.robotService !== undefined) {
    const robotService = player.robotService;
    requireSave(isRecord(robotService) && isRecord(robotService.ownedParts) &&
      Array.isArray(robotService.robots) && integer(robotService.nextRobotId, 1),
    "invalid Robot Service state.");
    const masterComputerLevel = robotService.masterComputerLevel ??
      Math.min(5, robotService.robots.length);
    requireSave(integer(masterComputerLevel, 0) && masterComputerLevel <= 5 &&
      robotService.robots.length <= masterComputerLevel,
    "robot count exceeds Master Computer capacity.");
    const catalogIds = new Set(ROBOT_PART_CATALOG.map(({ id }) => id));
    requireSave(Object.entries(robotService.ownedParts).every(([id, count]) =>
      catalogIds.has(id) && integer(count, 1)), "invalid owned robot parts.");
    const robotIds = new Set();
    for (const robot of robotService.robots) {
      requireSave(isRecord(robot) && typeof robot.id === "string" && /^robot-\d+$/.test(robot.id) &&
        !robotIds.has(robot.id) && typeof robot.name === "string" && robot.name.trim() &&
        (robot.battery === undefined || (Number.isFinite(robot.battery) && robot.battery >= 0 && robot.battery <= 1)) &&
        (robot.onShift === undefined || typeof robot.onShift === "boolean") &&
        Array.isArray(robot.boards) && robot.boards.every((fitted) =>
          isRecord(fitted) && typeof fitted.board === "string"), "invalid assembled robot.");
      robotIds.add(robot.id);
      const fittedIds = [robot.frame, robot.cell, ...robot.boards.map(({ board }) => board)];
      requireSave(fittedIds.every((id) => catalogIds.has(id) && getRobotPart(id)) &&
        robot.boards.every(({ board }) => ROBOT_PARTS.boards.find(({ id }) => id === board)?.kind !== "custom") &&
        robot.boards.some(({ board }) => ROBOT_PARTS.boards.find(({ id }) => id === board)?.kind === "prefab") &&
        buildProblems(robot, ROBOT_PARTS).length === 0 && hasEnoughPower(robot, ROBOT_PARTS),
      `invalid parts or power requirement for ${robot.name}.`);
    }
    requireSave(robotIds.size === robotService.robots.length &&
      robotService.robots.every(({ id }) => Number(id.slice("robot-".length)) < robotService.nextRobotId),
    "invalid robot sequence.");
  }
  requireSave(isRecord(player.factionReputation) &&
    CUSTOMER_FACTION_IDS.every((id) => integer(player.factionReputation[id])),
  "invalid faction reputation.");
  requireSave(Array.isArray(player.activeLicenses) &&
    new Set(player.activeLicenses).size === player.activeLicenses.length &&
    player.activeLicenses.every((id) => database.getLicense(id)), "unknown supplier license.");
  requireSave(isRecord(player.storePrices) && Object.entries(player.storePrices).every(
    ([id, price]) => itemById.has(id) && isMoney(price) && price >= 1,
  ), "invalid store price.");
  if (player.marketPricePinnedItems !== undefined) {
    requireSave(Array.isArray(player.marketPricePinnedItems) &&
      new Set(player.marketPricePinnedItems).size === player.marketPricePinnedItems.length &&
      player.marketPricePinnedItems.every((id) => itemById.has(id)),
    "invalid market price pins.");
  }
  // Optional so saves from before the Go-Backs bin existed still load.
  if (player.goBacks !== undefined) stockCapacity(player.goBacks, Infinity);
  const market = data.market;
  requireSave(isRecord(market) && integer(market.day, 1) &&
    isRecord(market.prices), "missing market state.");
  requireSave(Object.keys(market.prices).length === items.length, "incomplete market prices.");
  for (const item of items) {
    const price = market.prices[item.id];
    // Whole-credit saves can sit just outside today's cent-rounded bounds.
    requireSave(isMoney(price) && price >= 1 &&
      price >= Math.max(1, Math.min(Math.round(item.baseCost * MIN_BASE_RATIO), roundMoney(item.baseCost * MIN_BASE_RATIO))) &&
      price <= Math.max(1, Math.max(Math.round(item.baseCost * MAX_BASE_RATIO), roundMoney(item.baseCost * MAX_BASE_RATIO))),
    `invalid market price for ${item.id}.`);
  }
  for (const itemId of player.marketPricePinnedItems ?? []) {
    requireSave(player.storePrices[itemId] === market.prices[itemId],
      `pinned store price does not match the market price for ${itemId}.`);
  }
  // Receipts are optional so saves from before End Day existed still load.
  if (player.dayLedger !== undefined) {
    requireSave(isValidLedgerData(player.dayLedger) && player.dayLedger.day === market.day,
      "invalid daily receipt.");
  }
  if (player.lastDayReceipt !== undefined && player.lastDayReceipt !== null) {
    requireSave(isValidLedgerData(player.lastDayReceipt, { closed: true }) &&
      player.lastDayReceipt.day < market.day, "invalid previous day's receipt.");
  }
  if (player.dayReceipts !== undefined) {
    requireSave(Array.isArray(player.dayReceipts) &&
      player.dayReceipts.every((receipt) => isValidLedgerData(receipt, { closed: true })) &&
      player.dayReceipts.every((receipt, index) =>
        receipt.day < market.day && (index === 0 || receipt.day > player.dayReceipts[index - 1].day)),
    "invalid day receipt history.");
  }
  if (player.awaitingEndDay !== undefined) {
    requireSave(typeof player.awaitingEndDay === "boolean", "invalid end-of-day state.");
  }
  if (player.emergencyLoan !== undefined && player.emergencyLoan !== null) {
    const loan = player.emergencyLoan;
    requireSave(isRecord(loan) && isMoney(loan.balance) && loan.balance > 0 &&
      integer(loan.takenOnDay, 1) && loan.takenOnDay <= market.day, "invalid emergency loan.");
  }
  const droneDeliveries = player.droneDeliveries;
  requireSave(isRecord(droneDeliveries) && integer(droneDeliveries.nextOrderId, 1),
    "invalid remote delivery state.");
  const remoteOrderIds = new Set();
  const isRemoteOrder = (order) => isRecord(order) &&
    typeof order.id === "string" &&
    /^remote-order-[1-9]\d*$/.test(order.id) &&
    !remoteOrderIds.has(order.id) &&
    Number(order.id.slice("remote-order-".length)) < droneDeliveries.nextOrderId &&
    integer(order.receivedDay, 1) && order.receivedDay <= data.market?.day &&
    Array.isArray(order.items) &&
    order.items.length >= REMOTE_ORDER_TUNING.minProductTypes &&
    order.items.length <= REMOTE_ORDER_TUNING.maxProductTypes &&
    new Set(order.items.map((entry) => entry?.itemId)).size === order.items.length &&
    order.items.every((entry) => itemById.has(entry?.itemId) &&
      integer(entry.quantity, REMOTE_ORDER_TUNING.minUnitsPerProduct) &&
      entry.quantity <= REMOTE_ORDER_TUNING.maxUnitsPerProduct) &&
    isMoney(order.payout) && order.payout > 0 &&
    integer(order.reputation, 1) &&
    order.reputation === order.items.length * REMOTE_ORDER_TUNING.reputationPerProductType;
  const activeRemoteOrder = droneDeliveries.activeOrder;
  const otherRemoteOrders = droneDeliveries.otherOrders ?? [];
  requireSave(Array.isArray(otherRemoteOrders) && (activeRemoteOrder !== null || otherRemoteOrders.length === 0),
    "invalid accepted remote orders.");
  const acceptedRemoteOrders = activeRemoteOrder === null ? [] : [activeRemoteOrder, ...otherRemoteOrders];
  for (const order of acceptedRemoteOrders) {
    // Orders saved before offers existed have no acceptedDay and were due the day after arriving.
    const accepted = order?.acceptedDay;
    requireSave(isRemoteOrder(order) &&
      (accepted === undefined
        ? order.expiresOnDay === order.receivedDay + 1
        : integer(accepted, order.receivedDay) && accepted <= data.market.day &&
          order.expiresOnDay === accepted + REMOTE_ORDER_TUNING.fillShifts - 1) &&
      data.market.day <= order.expiresOnDay &&
      typeof order.crateId === "string" &&
      /^crate-[1-9]\d*$/.test(order.crateId),
    "invalid active remote order.");
    remoteOrderIds.add(order.id);
  }
  const remoteOffers = droneDeliveries.offers ?? [];
  requireSave(Array.isArray(remoteOffers), "invalid remote order offers.");
  for (const offer of remoteOffers) {
    requireSave(isRemoteOrder(offer) &&
      offer.offerEndsDay === offer.receivedDay + REMOTE_ORDER_TUNING.offerShifts - 1 &&
      data.market.day <= offer.offerEndsDay &&
      offer.crateId === undefined && offer.acceptedDay === undefined,
    "invalid remote order offer.");
    remoteOrderIds.add(offer.id);
  }
  // Optional: saves from before reviews existed have none.
  if (player.customerReviews !== undefined) {
    const { nextReviewId, reviews } = player.customerReviews ?? {};
    requireSave(isRecord(player.customerReviews) && integer(nextReviewId, 1) && Array.isArray(reviews) &&
      reviews.every((review, index) => isRecord(review) &&
        integer(review.id, 1) && review.id < nextReviewId &&
        (index === 0 || review.id > reviews[index - 1].id) &&
        integer(review.day, 1) && review.day <= data.market?.day &&
        (index === 0 || review.day >= reviews[index - 1].day) &&
        integer(review.stars, 1) && review.stars <= 5 &&
        (review.factionId === null || CUSTOMER_FACTION_IDS.includes(review.factionId)) &&
        typeof review.username === "string" && review.username.length > 0 && review.username.length <= 60 &&
        typeof review.text === "string" && review.text.length > 0 && review.text.length <= 1000),
    "invalid customer reviews.");
  }

  const fixtureIds = new Set();
  const placementIds = new Set();
  for (const entry of data.fixtures) {
    const spec = getFixtureType(entry?.type);
    requireSave(spec && typeof entry.id === "string" && !fixtureIds.has(entry.id) &&
      isFixturePosition(entry.gx) && entry.gx >= 0 && isFixturePosition(entry.gy) && entry.gy >= 0 &&
      isValidFixtureRotation(entry.rotation),
    "invalid fixture position.");
    fixtureIds.add(entry.id);
    requireSave(entry.paint === undefined || (isPaintableFixture(spec) && Object.hasOwn(SHELF_PAINTS, entry.paint)),
      "unknown shelf paint.");
    if (spec.kind === "shelf") {
      requireSave(entry.nextPlacementId === undefined || integer(entry.nextPlacementId, 1),
        "invalid shelf placement ID counter.");
      requireSave(entry.stockingVersion === undefined || entry.stockingVersion === 1,
        "unknown shelf stocking version.");
      const displayGrid = getShelfDisplayGrid(spec);
      requireSave(Array.isArray(entry.placements), "missing shelf contents.");
      const occupied = new Set();
      for (const placement of entry.placements) {
        if (placement?.id !== undefined) {
          requireSave(typeof placement.id === "string" && placement.id.length > 0 &&
            !placementIds.has(placement.id), "invalid or duplicate shelf placement ID.");
          placementIds.add(placement.id);
        }
        const item = itemById.get(placement?.itemId);
        requireSave(item && typeof placement.rotated === "boolean" &&
          integer(placement.gx, 0) && integer(placement.gy, 0) &&
          integer(placement.quantity, 0), "invalid shelf stack.");
        requireSave(placement.w === 1 && placement.h === 1 &&
          placement.gx < displayGrid.w && placement.gy < displayGrid.h &&
          placement.quantity <= getShelfSlotCapacity(item),
        "shelf stack does not fit.");
        const key = `${placement.gx},${placement.gy}`;
        requireSave(!occupied.has(key), "overlapping shelf stacks.");
        occupied.add(key);
      }
    }
  }
  requireSave(Array.isArray(data.unlockedZones) &&
    new Set(data.unlockedZones).size === data.unlockedZones.length &&
    data.unlockedZones.every((id) => ZONES.some((zone) => zone.id === id)) &&
    ZONES.filter((zone) => !zone.locked).every((zone) => data.unlockedZones.includes(zone.id)),
  "invalid unlocked rooms.");
  const seenCrateIds = new Set();
  const remoteOrderCrates = [];
  let maximumCrateId = 0;
  const validateCrateContents = (crate, { registerId = true } = {}) => {
    requireSave(isRecord(crate), "invalid crate contents.");
    requireSave(typeof crate.id === "string" && /^crate-[1-9]\d*$/.test(crate.id),
      "invalid crate id.");
    const crateId = Number(crate.id.slice("crate-".length));
    maximumCrateId = Math.max(maximumCrateId, crateId);
    if (registerId) {
      requireSave(!seenCrateIds.has(crate.id), "duplicate crate id.");
      seenCrateIds.add(crate.id);
    }
    const kind = crate.kind ?? "item";
    if (kind === "fixture") {
      requireSave(getFixtureType(crate.typeId), "unknown fixture crate.");
      return;
    }
    if (kind === "remote-order") {
      requireSave(typeof crate.orderId === "string" &&
        /^remote-order-[1-9]\d*$/.test(crate.orderId) &&
        Array.isArray(crate.requiredItems) &&
        crate.requiredItems.length >= REMOTE_ORDER_TUNING.minProductTypes &&
        crate.requiredItems.length <= REMOTE_ORDER_TUNING.maxProductTypes &&
        new Set(crate.requiredItems.map((entry) => entry?.itemId)).size === crate.requiredItems.length &&
        crate.requiredItems.every((entry) => itemById.has(entry?.itemId) &&
          integer(entry.quantity, REMOTE_ORDER_TUNING.minUnitsPerProduct) &&
          entry.quantity <= REMOTE_ORDER_TUNING.maxUnitsPerProduct) &&
        Array.isArray(crate.contents) &&
        new Set(crate.contents.map((entry) => entry?.itemId)).size === crate.contents.length &&
        crate.contents.every((entry) => {
          const requirement = crate.requiredItems.find((line) => line.itemId === entry?.itemId);
          return requirement && integer(entry.quantity, 1) && entry.quantity <= requirement.quantity;
        }) &&
        integer(crate.quantity, 0) &&
        crate.quantity === crate.contents.reduce((sum, entry) => sum + entry.quantity, 0) &&
        (crate.lidOpen === undefined || typeof crate.lidOpen === "boolean") &&
        (crate.inTerminal === undefined || typeof crate.inTerminal === "boolean"),
      "invalid remote order crate.");
      if (registerId) remoteOrderCrates.push(crate);
      return;
    }
    requireSave(kind === "item" && integer(crate.quantity, 0) &&
      (itemById.has(crate.itemId) || crate.quantity === 0 && crate.itemId === null),
    "invalid crate contents.");
  };
  const { gridW, gridH } = getAuthoredGridSize();
  requireSave(Array.isArray(data.crates), "missing crates.");
  for (const crate of data.crates) {
    validateCrateContents(crate);
    // Crates must sit at least 20 px inside the map edge.
    requireSave(Number.isFinite(crate.x) && Number.isFinite(crate.y) &&
      crate.x >= 20 && crate.x <= gridW * TILE_SIZE - 20 &&
      crate.y >= 20 && crate.y <= gridH * TILE_SIZE - 20 &&
      Number.isFinite(crate.velocityX) && Number.isFinite(crate.velocityY), "invalid crate position or motion.");
    if (crate.inTerminal === true) {
      requireSave(crate.kind === "remote-order" && crate.onPad !== true &&
        crate.velocityX === 0 && crate.velocityY === 0 && !crate.launch && !crate.flight,
      "invalid delivery crate in terminal.");
    }
    // Saves can capture a crate mid-throw; its remaining launch must still be plausible.
    if (crate.launch !== undefined) {
      const launch = crate.launch;
      requireSave(isRecord(launch) && Number.isFinite(launch.remainingMs) &&
        launch.remainingMs > 0 && launch.remainingMs <= THROW_ACCELERATION_MS &&
        Number.isFinite(launch.accelerationX) && Number.isFinite(launch.accelerationY) &&
        Number.isFinite(launch.maxSpeed) && launch.maxSpeed > 0 &&
        crate.onPad !== true, "invalid crate launch.");
    }
    if (crate.flight !== undefined) {
      const flight = crate.flight;
      requireSave(isRecord(flight) && Number.isFinite(flight.height) && flight.height > 0 &&
        Number.isFinite(flight.fallSpeed) && flight.fallSpeed >= 0 &&
        crate.onPad !== true, "invalid crate flight.");
    }
    // Item crates stacked on this one on the floor. Fixture crates never stack, and nothing
    // stacks on the Loading Pad or on a crate in flight.
    if (crate.stack !== undefined) {
      requireSave(Array.isArray(crate.stack) && crate.stack.length >= 1 &&
        crate.stack.length <= FLOOR_STACK_MAX - 1 && (crate.kind ?? "item") === "item" &&
        crate.onPad !== true && crate.launch === undefined && crate.flight === undefined, "invalid crate stack.");
      for (const stacked of crate.stack) {
        validateCrateContents(stacked);
        requireSave((stacked.kind ?? "item") === "item", "only item crates can be stacked.");
      }
    }
  }
  requireSave(data.carriedCrate === null || isRecord(data.carriedCrate), "invalid carried crate.");
  if (data.carriedCrate) validateCrateContents(data.carriedCrate, { registerId: false });
  if (data.carriedCrates !== undefined) {
    requireSave(Array.isArray(data.carriedCrates) && data.carriedCrates.length <= MAX_CARRIED_CRATES,
      "invalid carried crate stack.");
    data.carriedCrates.forEach(validateCrateContents);
    requireSave(data.carriedCrates.every((crate) => crate.inTerminal !== true), "a stored delivery crate cannot be carried.");
    requireSave((data.carriedCrates.length === 0) === (data.carriedCrate === null),
      "carried crate stack does not match the carried crate.");
    if (data.carriedCrates.length > 1) {
      const carriedOrders = data.carriedCrates.filter((crate) => crate.kind === "remote-order");
      requireSave(carriedOrders.length <= 1 &&
        data.carriedCrates.every((crate) => crate.kind === "item" || crate.kind === "remote-order"),
      "only stock and one remote order crate can be carried together.");
    }
    if (acceptedRemoteOrders.length === 0) {
      requireSave(remoteOrderCrates.length === 0, "orphaned remote order crate.");
    } else {
      requireSave(remoteOrderCrates.length === acceptedRemoteOrders.length && acceptedRemoteOrders.every((order) => {
        const orderCrate = remoteOrderCrates.find((crate) => crate.id === order.crateId && crate.orderId === order.id);
        return orderCrate && orderCrate.requiredItems.length === order.items.length &&
          order.items.every((item) => orderCrate.requiredItems.some((line) =>
            line.itemId === item.itemId && line.quantity === item.quantity));
      }),
      "active remote order does not match its crate.");
    }
    if (data.carriedCrates.length) {
      const top = data.carriedCrates.at(-1);
      const single = data.carriedCrate;
      requireSave((top.kind ?? "item") === (single.kind ?? "item") &&
        top.id === single.id && top.itemId === single.itemId && top.typeId === single.typeId &&
        top.quantity === single.quantity && top.orderId === single.orderId &&
        JSON.stringify(top.requiredItems ?? []) === JSON.stringify(single.requiredItems ?? []) &&
        JSON.stringify(top.contents ?? []) === JSON.stringify(single.contents ?? []),
      "carried crate stack does not match its top crate.");
    }
  }
  // Optional: linked cart cargo shares crate IDs with the rest of the saved inventory.
  if (data.hovercart !== undefined) {
    requireSave(isValidHovercartSave(data.hovercart), "invalid hovercart.");
    data.hovercart.crates.forEach(validateCrateContents);
    for (const cart of data.hovercart.carts ?? []) cart.crates.forEach(validateCrateContents);
  }
  requireSave(Number.isSafeInteger(data.nextCrateId) && data.nextCrateId > maximumCrateId,
    "invalid next crate id.");
  // Optional: saves from before trash existed have a clean floor.
  if (data.trash !== undefined) {
    requireSave(isValidTrashList(data.trash, { width: gridW * TILE_SIZE, height: gridH * TILE_SIZE }),
      "invalid trash on the floor.");
  }
  if (data.dirt !== undefined) {
    requireSave(Array.isArray(data.dirt) && data.dirt.every((mark) => isRecord(mark) &&
      DIRT_KINDS.includes(mark.kind) && Number.isFinite(mark.x) && mark.x >= 0 && mark.x <= gridW * TILE_SIZE &&
      Number.isFinite(mark.y) && mark.y >= 0 && mark.y <= gridH * TILE_SIZE &&
      Number.isFinite(mark.progress) && mark.progress >= 0 && mark.progress < 1),
    "invalid dirt on the floor.");
  }
  return data;
}
