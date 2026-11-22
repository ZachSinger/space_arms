// ==========================================
// FILE: Customer.js
// ==========================================
// One shopper: picks a faction buy list, walks to the shelves holding those items, buys at
// acceptable prices, then queues for player-driven checkout (or leaves angry).
// See also: CustomerBuyLists.js (what they want), Navigation.js (how they route).

import {
  CHARACTER_ART_WIDTH,
  CHARACTER_HEAD_HEIGHT,
  pickRandomCustomerCharacter,
  showCharacterFacing,
} from "./CustomerSprites.js";
import { CUSTOMER_COLLISION_HEIGHT, CUSTOMER_COLLISION_WIDTH } from "./CharacterDimensions.js";
import {
  BARGAIN_PRICE_RATIO, CUSTOMER_FACTION_IDS, createCustomerBuyList, MIN_BARGAIN_PRICE_RATIO,
} from "./CustomerBuyLists.js";
import { GAME_EVENTS } from "../core/Events.js";
import { transferItems } from "./InventoryTransfer.js";
import { sumMoney } from "./Money.js";
import { BASE_PATIENCE_MS, getPatienceMs, planShelfRoute, rollCustomerTraits } from "./CustomerTraits.js";
import { fixtureFacing } from "./FixtureLayout.js";
import { Mover } from "../world/Mover.js";
import { gameRandom } from "../core/Random.js";

const SPEED = 100; // px/s
// Giving way to another customer's crate push: step aside, then wait, then try again.
const CRATE_YIELD_STEP_MS = 400;
const CRATE_YIELD_WAIT_MS = 600;
const CRATE_YIELD_STEP_SPEED = 0.6; // share of walking speed
// Customer price reactions vary slightly inside shared ranges.
export const MIN_PRICE_TOLERANCE = 1.1;
export const MAX_PRICE_TOLERANCE = 1.2;
export const MIN_PRICE_DISGUST_TOLERANCE = 1.5;
export const MAX_PRICE_DISGUST_TOLERANCE = 1.7;
// Safety nets (ms) so an unreachable destination can never block the shift from ending.
// The seeking and leaving limits count only time spent stuck: any real step forward resets
// them, so a long walk across a big shop never trips them. The walking limit caps the whole
// trip in case a customer keeps moving without ever arriving.
const LEAVING_TIMEOUT_MS = 6000;
const SEEKING_TIMEOUT_MS = 15000;
const MAX_WALK_MS = 60000;
const PROGRESS_DISTANCE = 24; // px from the last checkpoint that counts as a step forward
const CUSTOMER_REACTION_MS = 1800;
const CUSTOMER_REACTION_FADE_MS = 300;
const QUEUE_JOIN_POSITION_BONUS_MS = 10000;
const QUEUE_ADVANCE_BONUS_MS = 5000;
// How long a customer stands looking at a shelf before taking anything from it.
const BROWSE_SHELF_MS = Object.freeze([1500, 3500]);
// Chance to look around another stocked shelf before heading to the next planned shelf.
const WANDER_CHANCE = 0.3;
const WANDER_LOOK_MS = Object.freeze([1000, 2500]);
const LOOK_AROUND_FACINGS = Object.freeze(["left", "right", "up", "down"]);
const FACING_TOWARD_FIXTURE = Object.freeze({ down: "up", up: "down", left: "right", right: "left" });
let nextCustomerId = 1;

function getCustomerItemNames(store, itemIds) {
  return itemIds.map((itemId) => {
    const item = store.getItem(itemId);
    if (!item?.name) throw new Error(`Unknown customer item: ${itemId}`);
    return item.name;
  });
}

// Bible Steps 53/12/51: how long a typical queued customer waits (ms, paused with the game).
// Traits such as Impatient change it per customer (CustomerTraits.js).
export const PATIENCE_MS = BASE_PATIENCE_MS;
// Bubble escalation: [minimum remaining fraction, glyph, fill color].
const PATIENCE_LEVELS = [
  [0.6, "...", 0x22c55e],
  [0.3, "!", 0xf59e0b],
  [0, "!!", 0xef4444],
];

/**
 * @param {number} fraction - remaining patience, 0..1
 * @returns {number} index into PATIENCE_LEVELS
 */
export function getPatienceLevel(fraction) {
  return PATIENCE_LEVELS.findIndex(([minimum]) => fraction > minimum || minimum === 0);
}

// px, a customer's feet: their collision box, centered on their position. The walking art is
// drawn larger, above it (CustomerSprites.js).
export const SPRITE_DISPLAY_WIDTH = CUSTOMER_COLLISION_WIDTH;
export const SPRITE_DISPLAY_HEIGHT = CUSTOMER_COLLISION_HEIGHT;

/**
 * One customer's sprite, shopping state machine, and patience bubble.
 * Created by the customer-flow system; destroys itself on reaching the exit.
 */
export class Customer {
  constructor({
    id = null,
    store,
    getShoppingPlan,
    getStoreConditions,
    registerPoint,
    exitPoint,
    onReserveShelfSlot,
    onReserveQueueSlot,
    onReserveExitSlot,
    gameState,
    spawnBounds,
    factionId,
    onJoinQueue,
    onLeaveAngry,
    onMissingPrimary,
    onComplete,
  }) {
    if (!store || typeof store.findPath !== "function") {
      throw new Error("Customer requires a store interface with findPath.");
    }
    this.id = id ?? `customer-${nextCustomerId++}`;
    this.location = { kind: "customer-cart", customerId: this.id };
    this.store = store;
    this.registerPoint = registerPoint;
    this.exitPoint = exitPoint || { x: registerPoint.x, y: registerPoint.y };
    // Each claims a distinct waypoint near a shared destination so converging customers
    // don't all aim at the same pixel and jam into each other.
    this.onReserveShelfSlot = onReserveShelfSlot;
    this.onReserveQueueSlot = onReserveQueueSlot;
    this.onReserveExitSlot = onReserveExitSlot;
    this.reservedTarget = null;
    this.gameState = gameState;
    this.onJoinQueue = onJoinQueue;
    this.onLeaveAngry = onLeaveAngry;
    this.onMissingPrimary = onMissingPrimary;
    this.onComplete = onComplete;

    this.state = "SEEK_SHELF";
    this.cart = []; // [{ itemId, price }]
    this.bargainTolerance = gameRandom.float(MIN_BARGAIN_PRICE_RATIO, BARGAIN_PRICE_RATIO);
    this.priceTolerance = gameRandom.float(MIN_PRICE_TOLERANCE, MAX_PRICE_TOLERANCE);
    this.priceDisgustTolerance = gameRandom.float(
      MIN_PRICE_DISGUST_TOLERANCE, MAX_PRICE_DISGUST_TOLERANCE,
    );
    this.boughtBargainItem = false;
    this.queueTarget = null; // set by the scene once this customer has a spot in line
    this.queuePosition = null;
    this.patienceRemainingMs = null; // only ticks once queued
    this.patienceBubble = null;
    this.patienceLevel = -1;
    this.reactionBubble = null;
    this.reactionRemainingMs = 0;
    this.reactionEventsShown = new Set();

    this.path = [];
    this.destination = null;
    this.onArriveAtDestination = null;
    this.onPathUnavailable = null;
    this.isDestroyed = false;
    this.waitingAtDoor = false;
    // Customers built without a constructor (tests) shop instantly instead of pausing.
    this.browseShelfMs = BROWSE_SHELF_MS;
    this.wanderChance = WANDER_CHANCE;
    this.browseRemainingMs = 0;
    this.browseLookTimerMs = 0;
    this.browseFacing = null;
    this.onBrowseDone = null;

    // World (not viewport) px: the camera may show only part of a larger room (RoomLayout.js).
    const bounds = spawnBounds || { xMin: 40, xMax: 120, yMin: 80, yMax: store.scale.height - 80 };
    const spawnX = gameRandom.int(bounds.xMin, bounds.xMax);
    const spawnY = gameRandom.int(bounds.yMin, bounds.yMax);

    const character = pickRandomCustomerCharacter(factionId);
    this.factionId = character.factionId;
    this.traits = rollCustomerTraits(this.factionId, gameRandom, getStoreConditions?.());
    this.maxPatienceMs = getPatienceMs(this.traits);
    this.cleaning = store.cleaning ?? null;
    const cleaningProfile = this.cleaning ? this.cleaning.createCustomerProfile(this.factionId) : null;
    if (this.cleaning && (!cleaningProfile?.tolerance || !Number.isFinite(cleaningProfile.judgeAfterMs))) {
      throw new Error("Cleaning must provide a customer tolerance and judgment time.");
    }
    this.cleanlinessTolerance = cleaningProfile?.tolerance ?? null;
    this.cleanlinessJudgeMs = cleaningProfile?.judgeAfterMs ?? null;
    this.cleanlinessJudged = false;
    this.cleanlinessTimerMs = 0;
    this.trashDropAtWalkMs = cleaningProfile?.trashDropAtWalkMs ?? null;
    this.trashWalkMs = 0;
    this.shoppingPlan = getShoppingPlan
      ? getShoppingPlan(this.factionId, this.traits, this.bargainTolerance)
      : createCustomerBuyList(this.factionId, [], () => null);
    this.shelfStops = this.shoppingPlan.shelfStops || [];
    this.shelfStopIndex = 0;
    this.phaseItemIds = [];
    this.primaryBought = new Set();
    this.primaryMissing = new Set();
    this.priceRejectedItemIds = new Set();
    this.priceReactionKinds = new Set();
    this.bonusBought = new Set();
    this.bonusAttempted = new Set();
    this.purchasedFirearms = new Set();
    this.currentFacing = "down";
    this.sprite = store.createCustomerSprite(
      spawnX, spawnY, character.textureKey, SPRITE_DISPLAY_WIDTH, SPRITE_DISPLAY_HEIGHT,
    ).setDepth(2);
    this.mover = this.createMover();

    this.visitNextShelf("primary");
  }

  // --- Frame update ---

  /**
   * @param {number} [delta] - ms since last frame
   */
  update(delta = 0) {
    if (this.isDestroyed) return; // guards against being updated the same frame it self-destructed
    if (this.waitingAtDoor) return;

    if (this.path === null) {
      this.getMover().handlePathUnavailable();
      return;
    }

    if (this.cleaning && this.cleanlinessTolerance && this.cleanlinessJudgeMs != null &&
      !this.cleanlinessJudged && this.state !== "LEAVING") {
      this.cleanlinessTimerMs += delta;
      if (this.cleanlinessTimerMs >= this.cleanlinessJudgeMs && this.judgeStoreCleanliness() === "walk-out") return;
    }

    switch (this.state) {
      case "SEEK_SHELF":
      case "SEEK_REGISTER":
        this.updateTrashDrop(delta);
        if (this.state === "SEEK_SHELF" && this.fixture && !this.fixture.findAvailableSlot()) {
          this.sprite.body.setVelocity(0, 0);
          this.onArriveAtDestination();
          break;
        }
        this.seekingTimer += delta;
        if (this.madeWalkingProgress(delta)) this.seekingTimer = 0;
        if (this.seekingTimer > SEEKING_TIMEOUT_MS || this.walkingMs > MAX_WALK_MS) {
          this.store.debugInfo?.recordCustomer("customer-seeking-timeout", this);
          this.store.noteCustomerGaveUp?.(this, this.walkingMs > MAX_WALK_MS
            ? "walked a full minute without arriving" : "stood stuck for 15 seconds");
          console.warn(
            `Customer gave up seeking a destination (state=${this.state}); abandoning and leaving.`,
          );
          this.enterLeaving();
          break;
        }
        this.walk(delta);
        this.updateFacing();
        break;
      case "BROWSING":
        this.updateBrowsing(delta);
        break;
      case "QUEUEING":
        this.walk(delta);
        // A line of people should face the counter, not their last walking direction.
        this.updateFacing("up");
        this.updatePatience(delta);
        break;
      case "LEAVING":
        this.updateTrashDrop(delta);
        this.leavingTimer += delta;
        if (this.madeWalkingProgress(delta)) this.leavingTimer = 0;
        if (this.leavingTimer > LEAVING_TIMEOUT_MS || this.walkingMs > MAX_WALK_MS) {
          this.store.debugInfo?.recordCustomer("customer-exit-timeout", this);
          this.store.noteCustomerGaveUp?.(this, "vanished after getting stuck on the way out");
          this.destroy(); // safety net -- see LEAVING_TIMEOUT_MS
          break;
        }
        this.walk(delta);
        if (!this.isDestroyed) this.updateFacing(); // arrival may have just destroyed this
        break;
    }
    if (!this.isDestroyed) this.updateReaction(delta);
  }

  // --- Shopping ---

  /** @param {string} itemId */
  getPriceReaction(itemId) {
    const marketPrice = this.store.gameState.market.getPrice(itemId);
    const storePrice = this.store.getStorePrice(itemId);
    if (storePrice >= marketPrice * this.priceDisgustTolerance) return "disgusted";
    if (storePrice > marketPrice * this.priceTolerance) return "skipped";
    if (storePrice <= marketPrice * this.bargainTolerance) return "bargain";
    return "acceptable";
  }

  /** @param {"bargain" | "skipped" | "disgusted"} reaction */
  recordPriceReaction(reaction) {
    if (!this.priceReactionKinds) this.priceReactionKinds = new Set();
    if (this.priceReactionKinds.has(reaction)) return;
    this.priceReactionKinds.add(reaction);
    this.store.eventBus?.emit(GAME_EVENTS.CUSTOMER_PRICE_REACTION, {
      customer: this,
      reaction,
    });
  }

  getRemainingUnitsFor(itemId) {
    const wanted = this.shoppingPlan.itemQuantities?.[itemId] ?? 1;
    const pickedUp = this.cart.filter((entry) => entry.itemId === itemId).length;
    return Math.max(0, wanted - pickedUp);
  }

  getAvailableUnitsFor(itemId) {
    return this.cart.filter((entry) => entry.itemId === itemId).length;
  }

  getLocation() {
    return this.location;
  }

  getContainerId() {
    return this.id;
  }

  canPut() {
    return true;
  }

  canTake(itemId) {
    return this.getAvailableUnitsFor(itemId) > 0;
  }

  add(itemId, quantity) {
    if (!this.canPut(itemId)) return 0;
    const accepted = Math.min(quantity, this.getRemainingUnitsFor(itemId));
    for (let index = 0; index < accepted; index += 1) {
      this.cart.push({ itemId, price: this.store.getStorePrice(itemId) });
    }
    return accepted;
  }

  remove(itemId, quantity) {
    let removed = 0;
    for (let index = this.cart.length - 1; index >= 0 && removed < quantity; index -= 1) {
      if (this.cart[index].itemId !== itemId) continue;
      this.cart.splice(index, 1);
      removed += 1;
    }
    return removed;
  }

  /**
   * Start a shopping pass over every shelf holding this phase's wanted items.
   * @param {"primary" | "bonus"} phase
   */
  visitNextShelf(phase) {
    this.shoppingPhase = phase;
    const itemIds = phase === "primary"
      ? this.shoppingPlan.primaryItemIds
      : this.getBonusItemIds().filter((itemId) => !this.bonusAttempted.has(itemId));
    if (itemIds.length === 0) {
      this.finishShoppingPhase();
      return;
    }
    this.phaseItemIds = itemIds;
    this.shelfStops = this.shoppingPlan.shelfStops.filter(({ fixture }) =>
      fixture.placements.some((placement) => itemIds.includes(placement.itemId)),
    );
    if (phase === "primary") {
      this.shelfStops = planShelfRoute(
        this.shelfStops,
        this.shoppingPlan.allShelfStops || this.shelfStops,
        this.traits || [],
      );
    }
    this.shelfStopIndex = 0;
    this.visitNextShelfStop();
  }

  visitNextShelfStop(allowWander = true) {
    while (this.shelfStopIndex < this.shelfStops.length &&
      !this.shelfStops[this.shelfStopIndex].fixture.findAvailableSlot()) {
      this.shelfStopIndex += 1;
    }
    if (this.shelfStopIndex >= this.shelfStops.length) {
      if (this.shoppingPhase === "bonus") {
        for (const itemId of this.phaseItemIds) this.bonusAttempted.add(itemId);
      }
      this.finishShoppingPhase();
      return;
    }
    const { fixture, standPoint } = this.shelfStops[this.shelfStopIndex];
    if (allowWander && this.shoppingPhase === "primary" &&
      this.maybeWander(() => this.visitNextShelfStop(false), fixture)) {
      return;
    }
    this.fixture = fixture;
    const target = this.onReserveShelfSlot
      ? this.onReserveShelfSlot(fixture, this)
      : standPoint;
    this.shelfStopIndex += 1;
    this.setDestination(target.x, target.y, () => {
      if (!fixture.findAvailableSlot()) {
        this.visitNextShelfStop();
        return;
      }
      const facing = this.browseShelfMs ? FACING_TOWARD_FIXTURE[fixtureFacing(fixture)] : null;
      this.browse(this.browseShelfMs, facing || null, () => this.shopAtCurrentShelf());
    }, () => {
      const unreachableItemIds = this.phaseItemIds.filter((itemId) =>
        fixture.placements.some((placement) =>
          placement.itemId === itemId && placement.quantity > 0,
        ),
      );
      if (unreachableItemIds.length > 0) {
        this.store.showFloatingText(
          this.sprite.x,
          this.sprite.y - 50,
          `Can't reach:\n${getCustomerItemNames(this.store, unreachableItemIds).join(", ")}`,
          "#f59e0b",
        );
      }
      this.visitNextShelfStop();
    });
  }

  /**
   * Sometimes looks around another stocked shelf before going on.
   * @param {() => void} then
   * @param {object} nextShelf
   * @returns {boolean} true if the customer is wandering and will call `then` afterward
   */
  maybeWander(then, nextShelf) {
    if (!this.wanderChance || gameRandom() >= this.wanderChance) return false;
    const fixture = this.store.getRandomBrowseShelf(nextShelf);
    if (!fixture) return false;
    this.fixture = fixture;
    const spot = this.onReserveShelfSlot
      ? this.onReserveShelfSlot(fixture, this)
      : fixture.standPoint;
    this.wanderChance /= 2; // fewer detours the longer they shop
    this.setDestination(spot.x, spot.y, () => {
      if (!fixture.findAvailableSlot()) {
        then();
        return;
      }
      this.browse(WANDER_LOOK_MS, null, then);
    }, then);
    return true;
  }

  /**
   * Stand still for a moment, either facing a shelf or glancing around, then continue.
   * @param {readonly [number, number] | null} durationRange - ms; none means continue now
   * @param {"up" | "down" | "left" | "right" | null} facing - null glances around
   * @param {() => void} onDone
   */
  browse(durationRange, facing, onDone) {
    if (!durationRange) {
      onDone();
      return;
    }
    const [min, max] = durationRange;
    this.state = "BROWSING";
    this.browseRemainingMs = min + gameRandom() * (max - min);
    this.browseFacing = facing;
    this.browseLookTimerMs = 0;
    this.onBrowseDone = onDone;
    this.sprite.body?.setVelocity(0, 0);
  }

  updateBrowsing(delta) {
    this.sprite.body?.setVelocity(0, 0);
    if (this.browseFacing) {
      this.updateFacing(this.browseFacing);
    } else {
      this.browseLookTimerMs -= delta;
      if (this.browseLookTimerMs <= 0) {
        this.browseLookTimerMs = 600 + gameRandom() * 600;
        const options = LOOK_AROUND_FACINGS.filter((facing) => facing !== this.currentFacing);
        this.updateFacing(gameRandom.pick(options));
      }
    }
    this.browseRemainingMs -= delta;
    if (this.browseRemainingMs > 0 && this.fixture.findAvailableSlot()) return;
    const onDone = this.onBrowseDone;
    this.onBrowseDone = null;
    this.state = "SEEK_SHELF";
    onDone?.();
  }

  // Fill each wanted quantity from this shelf before trying the next shelf.
  shopAtCurrentShelf() {
    // Nobody takes an item before deciding whether the store is clean enough.
    if (this.judgeStoreCleanliness() === "walk-out") return;
    for (const itemId of this.phaseItemIds) {
      if (this.shoppingPhase === "bonus") this.bonusAttempted.add(itemId);
      const placements = this.fixture.placements.filter((placement) =>
        placement.itemId === itemId && placement.quantity > 0,
      );
      if (placements.length === 0) continue;
      if (this.getRemainingUnitsFor(itemId) === 0) continue;
      // Mercenaries can buy multiples, but not a different firearm of the same type.
      if (this.shoppingPhase === "bonus" && this.factionId === "mercenaries" &&
        !this.cart.some((entry) => entry.itemId === itemId) &&
        this.purchasedFirearms.has(this.store.getItem(itemId)?.tags.find((tag) =>
          ["Pistol", "Rifle", "Heavy"].includes(tag),
        ))) continue;

      const priceReaction = this.getPriceReaction(itemId);
      if (priceReaction === "disgusted") {
        this.priceRejectedItemIds.add(itemId);
        this.recordPriceReaction("disgusted");
        this.reportPriceIssues();
        this.leaveAngry({ factionReputationPenalty: false });
        return;
      }
      if (priceReaction === "skipped") {
        this.showReaction("price-too-high", "disappointed");
        this.recordPriceReaction("skipped");
        this.priceRejectedItemIds.add(itemId);
        continue;
      }

      let moved = 0;
      for (const placement of placements) {
        const remaining = this.getRemainingUnitsFor(itemId);
        if (remaining === 0) break;
        const transfer = transferItems(this.fixture, this, itemId, remaining, {
          sourceEntry: placement,
          eventBus: this.store.eventBus,
          sourceName: "shelf",
          destinationName: "customer-cart",
        });
        moved += transfer.moved;
      }
      if (moved === 0) continue;
      this.store.refreshShelfStockDisplay?.(this.fixture);
      if (priceReaction === "bargain") {
        this.boughtBargainItem = true;
        this.showReaction("good-deal", "happy");
        this.recordPriceReaction("bargain");
      }
      if (this.shoppingPhase === "primary") this.primaryBought.add(itemId);
      else this.bonusBought.add(itemId);

      const item = this.store.getItem(itemId);
      if (this.factionId === "mercenaries" && item?.tags.includes("Firearm")) {
        const weaponType = item.tags.find((tag) => ["Pistol", "Rifle", "Heavy"].includes(tag));
        if (weaponType) this.purchasedFirearms.add(weaponType);
      }
    }
    this.visitNextShelfStop();
  }

  // Optional items plus ammo matching any firearm already in the cart, minus what's bought.
  getBonusItemIds() {
    const ids = [...this.shoppingPlan.bonusItemIds];
    for (const { itemId: firearmId } of this.cart) {
      if (!this.store.getItem(firearmId)?.tags.includes("Firearm")) continue;
      ids.push(...(this.shoppingPlan.matchingAmmoIdsByFirearm?.[firearmId] || []));
    }
    return [...new Set(ids)].filter((id) =>
      this.getRemainingUnitsFor(id) > 0,
    );
  }

  // Advances primary -> bonus -> queue, or leaves if there's nothing worth buying.
  finishShoppingPhase() {
    if (this.shoppingPhase === "primary") {
      if (this.shoppingPlan.primaryItemIds.length === 0) {
        if (this.factionId && !CUSTOMER_FACTION_IDS.includes(this.factionId)) {
          throw new Error(`Unknown customer faction: ${this.factionId}`);
        }
        this.enterLeaving();
        return;
      }

      // Only penalize wanted items that are out of stock store-wide, not merely overpriced.
      this.primaryMissing = new Set(
        this.shoppingPlan.primaryItemIds.filter((itemId) =>
          !this.primaryBought.has(itemId) &&
          !this.shoppingPlan.shelfStops.some(({ fixture }) =>
            fixture.placements.some((placement) =>
              placement.itemId === itemId && placement.quantity > 0,
            ),
          ),
        ),
      );
      if (this.primaryMissing.size > 0) this.reportMissingPrimary();
      if (this.primaryBought.size === 0 && this.priceRejectedItemIds.size === 0) {
        this.reportPriceIssues();
        this.enterLeaving();
        return;
      }
      this.visitNextShelf("bonus");
      return;
    }

    const additionalBonusIds = this.getBonusItemIds().filter((itemId) =>
      !this.bonusAttempted.has(itemId),
    );
    // Firearms bought this pass can unlock matching ammo; take one more pass for it.
    if (additionalBonusIds.length > 0) {
      this.phaseItemIds = additionalBonusIds;
      this.shelfStops = this.shoppingPlan.shelfStops.filter(({ fixture }) =>
        fixture.placements.some((placement) => additionalBonusIds.includes(placement.itemId)),
      );
      this.shelfStopIndex = 0;
      this.visitNextShelfStop();
      return;
    }

    this.reportPriceIssues();
    if (this.cart.length === 0) {
      this.enterLeaving();
      return;
    }
    this.gameState.shop.changed();
    this.reservedTarget = this.onReserveQueueSlot
      ? this.onReserveQueueSlot(this)
      : this.registerPoint;
    this.setDestination(
      this.reservedTarget.x,
      this.reservedTarget.y,
      () => this.joinQueue(),
      () => {
        this.store.showFloatingText(
          this.sprite.x,
          this.sprite.y - 110,
          "Can't reach the checkout!",
          "#f59e0b",
        );
        this.leaveAngry();
      },
    );
    this.state = "SEEK_REGISTER";
  }

  reportPriceIssues() {
    if (this.priceRejectedItemIds.size === 0) return;
    const names = getCustomerItemNames(this.store, [...this.priceRejectedItemIds]);
    const offset = this.primaryMissing.size > 0 ? 100 : 40;
    this.store.showFloatingText(
      this.sprite.x,
      this.sprite.y - offset,
      `Too expensive:\n${names.join("\n")}`,
      "#f59e0b",
    );
    this.priceRejectedItemIds.clear();
  }

  // The scene applies reputation and feedback when this customer misses primary stock.
  reportMissingPrimary() {
    this.showReaction("primary-item-out-of-stock", "disappointed");
    const itemIds = [...this.primaryMissing];
    this.onMissingPrimary?.(this, itemIds, getCustomerItemNames(this.store, itemIds));
  }

  // --- Queue and patience ---

  joinQueue() {
    this.state = "QUEUEING";
    this.queueTarget = { x: this.registerPoint.x, y: this.registerPoint.y };
    this.onJoinQueue(this);
  }

  /**
   * @param {number} position - zero-based position in this register's line
   */
  setQueuePosition(position) {
    const previousPosition = this.queuePosition;
    if (previousPosition == null) {
      this.patienceRemainingMs = (this.maxPatienceMs ?? PATIENCE_MS) +
        position * QUEUE_JOIN_POSITION_BONUS_MS;
    } else if (position === 0 && previousPosition !== 0) {
      this.patienceRemainingMs = this.maxPatienceMs ?? PATIENCE_MS;
    } else if (position > 0 && position < previousPosition) {
      this.patienceRemainingMs += QUEUE_ADVANCE_BONUS_MS;
    }
    this.queuePosition = position;
  }

  /**
   * Drains behind the front of the line, except while the store is temporarily closed.
   * @param {number} delta - ms
   */
  updatePatience(delta) {
    if (this.patienceRemainingMs == null) return;
    if (this.queuePosition !== 0 && !this.store.customerFlow.temporarilyClosed) {
      this.patienceRemainingMs = Math.max(0, this.patienceRemainingMs - delta);
    }
    if (this.queuePosition !== 0 && this.patienceRemainingMs <= 0) {
      this.leaveAngry();
      return;
    }
    this.drawPatienceBubble();
  }

  drawPatienceBubble() {
    const x = this.sprite.x;
    const y = this.sprite.y - CHARACTER_HEAD_HEIGHT - 14;
    if (!this.patienceBubble) {
      const background = this.store.add.circle(0, 0, 12, 0xffffff).setStrokeStyle(2, 0x000000);
      const glyph = this.store.add
        .text(0, -1, "", {
          fontFamily: '"Courier New", monospace',
          fontSize: "14px",
          fontStyle: "bold",
          color: "#000000",
        })
        .setOrigin(0.5);
      this.patienceBubble = this.store.add.container(x, y, [background, glyph]).setDepth(9000);
    }
    this.patienceBubble.setPosition(x, y);
    this.patienceBubble.setScale?.(this.store.cameraRig?.popupScale() ?? 1);

    // Only restyle when the level changes.
    const level = getPatienceLevel(this.patienceRemainingMs / (this.maxPatienceMs ?? PATIENCE_MS));
    if (level === this.patienceLevel) return;
    this.patienceLevel = level;
    const [, text, color] = PATIENCE_LEVELS[level];
    const [background, glyph] = this.patienceBubble.list;
    background.setFillStyle(color);
    glyph.setText(text);
  }

  clearPatience() {
    this.queuePosition = null;
    this.patienceRemainingMs = null;
    this.patienceLevel = -1;
    this.patienceBubble?.destroy();
    this.patienceBubble = null;
  }

  showReaction(event, mood) {
    if (this.reactionEventsShown.has(event) || this.reactionBubble) return false;
    const colors = {
      happy: 0x86efac,
      disappointed: 0xfcd34d,
      angry: 0xfca5a5,
    };
    const color = colors[mood];
    if (color === undefined) throw new RangeError(`Unknown customer reaction: ${mood}`);

    const graphics = this.store.add.graphics().setDepth(9001);
    graphics.fillStyle(color, 1);
    graphics.fillCircle(0, 0, 10);
    graphics.lineStyle(1.5, 0x1f2937, 1);
    graphics.strokeCircle(0, 0, 10);
    graphics.fillStyle(0x1f2937, 1);
    graphics.fillCircle(-3, -2, 1.2);
    graphics.fillCircle(3, -2, 1.2);
    graphics.beginPath();
    if (mood === "happy") {
      graphics.moveTo(-4, 1);
      graphics.lineTo(0, 4);
      graphics.lineTo(4, 1);
    } else {
      if (mood === "angry") {
        graphics.moveTo(-5, -5);
        graphics.lineTo(-1, -3);
        graphics.moveTo(5, -5);
        graphics.lineTo(1, -3);
      }
      graphics.moveTo(-4, 4);
      graphics.lineTo(0, 1);
      graphics.lineTo(4, 4);
    }
    graphics.strokePath();

    this.reactionEventsShown.add(event);
    this.reactionBubble = graphics;
    this.reactionRemainingMs = CUSTOMER_REACTION_MS;
    this.positionReaction();
    return true;
  }

  positionReaction() {
    if (!this.reactionBubble) return;
    this.reactionBubble.setPosition(
      this.sprite.x + CHARACTER_ART_WIDTH / 2,
      this.sprite.y - CHARACTER_HEAD_HEIGHT - 12,
    );
    this.reactionBubble.setScale?.(this.store.cameraRig?.popupScale() ?? 1);
  }

  updateReaction(delta) {
    if (!this.reactionBubble) return;
    this.reactionRemainingMs = Math.max(0, this.reactionRemainingMs - delta);
    this.positionReaction();
    this.reactionBubble.setAlpha(
      Math.min(1, this.reactionRemainingMs / CUSTOMER_REACTION_FADE_MS),
    );
    if (this.reactionRemainingMs === 0) {
      this.reactionBubble.destroy();
      this.reactionBubble = null;
    }
  }

  /**
   * Decides once how clean the store is. Upset customers keep shopping; disgusted ones leave.
   * @returns {"fine" | "upset" | "walk-out" | null} null if already decided
   */
  judgeStoreCleanliness() {
    if (this.cleanlinessJudged || !this.cleanlinessTolerance || !this.cleaning) return null;
    this.cleanlinessJudged = true;
    const percent = this.cleaning.getCleanlinessPercent();
    const verdict = this.cleaning.judgeCustomerCleanliness(percent, this.cleanlinessTolerance);
    if (verdict === "fine") return verdict;
    this.showReaction("cleanliness", verdict === "walk-out" ? "angry" : "disappointed");
    this.cleaning.reportCleanlinessVerdict(this, verdict);
    if (verdict === "walk-out") {
      this.clearPatience();
      this.enterLeaving();
    }
    return verdict;
  }

  // At most one piece of trash per customer, dropped partway through their walking.
  updateTrashDrop(delta) {
    if (this.trashDropAtWalkMs == null) return;
    this.trashWalkMs += delta;
    if (this.trashWalkMs < this.trashDropAtWalkMs) return;
    const body = this.sprite.body;
    if (this.cleaning.dropTrash(this.sprite.x, body?.bottom ?? this.sprite.y)) this.trashDropAtWalkMs = null;
    // Not a good spot (e.g. the doorway): try again a moment later.
    else this.trashDropAtWalkMs += 500;
  }

  // Bible Steps 12/51: abandons the cart for the scene to process, then leaves.
  leaveAngry({ reputationPenalty = true, factionReputationPenalty = true } = {}) {
    this.showReaction("left-angry", "angry");
    const cart = this.cart.map((entry) => ({ ...entry }));
    this.clearPatience();
    this.onLeaveAngry?.(this, cart, { reputationPenalty, factionReputationPenalty });
    this.enterLeaving();
  }

  /**
   * Called by the scene whenever the line shifts (someone joins, or everyone shuffles forward).
   * @param {number} x
   * @param {number} y
   */
  setQueueTarget(x, y) {
    this.queueTarget = { x, y };
    this.setDestination(x, y, () => {}, () => this.leaveAngry());
  }

  // Finish the customer's sale state and return proceeds for the scene's sale event.
  completeSale() {
    const total = sumMoney(this.cart.map((entry) => entry.price));
    this.clearPatience();
    this.enterLeaving();
    return total;
  }

  enterLeaving() {
    // Reserve before flipping state so this customer doesn't count itself among those leaving.
    const exitTarget = this.onReserveExitSlot ? this.onReserveExitSlot() : this.exitPoint;
    this.state = "LEAVING";
    this.leavingTimer = 0;
    this.setDestination(exitTarget.x, exitTarget.y, () => this.destroy(), () => {
      this.store.showFloatingText(
        this.sprite.x,
        this.sprite.y - 110,
        "Can't reach the exit!",
        "#ef4444",
      );
      this.destroy();
    });
  }

  // --- Movement ---

  createMover() {
    if (!this.store?.findPath) throw new Error("Customer requires a store route interface.");
    return new Mover(this, {
      findPath: (fromX, fromY, toX, toY) => this.store.findPath(fromX, fromY, toX, toY),
      canFindPath: () => Boolean(this.store.findPath),
      getSpeed: () => SPEED,
      replanIntervalMs: 200,
      collisionTolerance: 0.1,
      waypointArrivalDistance: 0.0001,
      destinationArrivalDistance: 6,
      onReroute: () => this.store.debugInfo?.recordCustomer("customer-collision-reroute", this),
      onRerouteUnavailable() {},
      onPortal: ({ x, y }) => this.sprite.body.reset(x, y),
      onPathUnavailable: () => this.handlePathUnavailable(),
    });
  }

  getMover() {
    if (!this.mover) this.mover = this.createMover();
    return this.mover;
  }

  handlePathUnavailable() {
    this.store.debugInfo?.recordCustomer("customer-path-unavailable", this);
    this.store.noteCustomerGaveUp?.(this, "found no way through");
    const onPathUnavailable = this.onPathUnavailable;
    this.path = [];
    this.onPathUnavailable = null;
    if (onPathUnavailable) {
      onPathUnavailable();
    } else if (this.state === "LEAVING") {
      this.destroy();
    } else {
      this.enterLeaving();
    }
  }

  /**
   * Path to a new target via the scene's pathfinder.
   * @param {number} targetX
   * @param {number} targetY
   * @param {() => void} onArrive
   * @param {() => void} [onPathUnavailable]
   */
  setDestination(targetX, targetY, onArrive, onPathUnavailable) {
    this.getMover().setDestination(targetX, targetY, onArrive, onPathUnavailable);
  }

  /**
   * Adds to the trip's walking time and reports whether the customer has moved far enough
   * from their last checkpoint to count as a step forward (which moves the checkpoint).
   * @param {number} delta - ms
   */
  madeWalkingProgress(delta) {
    this.walkingMs = (this.walkingMs ?? 0) + delta;
    const { x, y } = this.sprite.body?.center ?? this.sprite;
    const checkpoint = this.progressCheckpoint;
    if (checkpoint && Math.hypot(x - checkpoint.x, y - checkpoint.y) < PROGRESS_DISTANCE) return false;
    this.progressCheckpoint = { x, y };
    return checkpoint !== null && checkpoint !== undefined;
  }

  /**
   * One step along the path, shoving any crates in the way. While giving way to another
   * customer's push, steps aside and then waits instead.
   * @param {number} delta - ms
   */
  walk(delta) {
    if (this.crateYield) {
      const yieldInfo = this.crateYield;
      yieldInfo.msLeft -= delta;
      if (yieldInfo.msLeft <= 0) {
        this.crateYield = null;
        this.repathAfterYield();
      } else {
        const stepping = yieldInfo.msLeft > CRATE_YIELD_WAIT_MS;
        const speed = stepping ? SPEED * CRATE_YIELD_STEP_SPEED : 0;
        this.sprite.body.setVelocity(yieldInfo.away.x * speed, yieldInfo.away.y * speed);
        this.store.crateWorld?.pushCratesForCustomer?.(this, delta, { canPush: false });
        return;
      }
    }
    this.followPath(delta);
    if (!this.isDestroyed) this.store.crateWorld?.pushCratesForCustomer?.(this, delta);
  }

  /**
   * Someone further from their destination is pushing the same crates: stop pushing, step
   * out of the way, and try again a moment later.
   * @param {{x: number, y: number}} away - unit direction to step aside
   */
  giveWayToCratePush(away) {
    this.crateYield = { msLeft: CRATE_YIELD_STEP_MS + CRATE_YIELD_WAIT_MS, away };
    this.sprite.body.setVelocity(0, 0);
  }

  repathAfterYield() {
    this.getMover().repathAfterYield();
  }

  // px still to walk: along the remaining waypoints, then on to the destination.
  remainingWalkDistance() {
    return this.getMover().remainingWalkDistance();
  }

  // Walks the path waypoint by waypoint, then directly to the exact destination (which may
  // not sit on a grid-cell center) before firing the arrival callback.
  followPath(delta = 1000 / 60) {
    this.getMover().followPath(delta);
  }

  /**
   * @param {number} targetX
   * @param {number} targetY
   * @param {() => void} onArrive
   * @param {number} delta - ms until the next movement step
   * @param {number} arrivalDistance - px; corners use a tighter tolerance than destinations
   */
  moveToward(targetX, targetY, onArrive, delta = 1000 / 60, arrivalDistance = 6) {
    this.getMover().moveToward(targetX, targetY, onArrive, delta, arrivalDistance);
  }

  /**
   * Walk toward the forced facing, or the one matching current velocity; stand still when not
   * moving. An idle customer keeps its last facing instead of flickering back to a default.
   * @param {"up" | "down" | "left" | "right"} [forcedFacing]
   */
  updateFacing(forcedFacing) {
    const { x: vx, y: vy } = this.sprite.body.velocity;
    const moving = Math.abs(vx) >= 1 || Math.abs(vy) >= 1;
    let facing = forcedFacing;
    if (!facing) {
      facing = !moving
        ? this.currentFacing
        : Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? "left" : "right") : vy < 0 ? "up" : "down";
    }
    this.currentFacing = facing;
    showCharacterFacing(this.sprite, facing, moving);
  }

  // New arrivals wait unseen in the doorway until the front door has opened, so they never
  // appear through a closed door or get pushed out of its solid frame.
  waitOutsideDoor() {
    this.waitingAtDoor = true;
    this.sprite.setVisible(false);
    this.sprite.body.enable = false;
  }

  enterThroughDoor() {
    if (this.isDestroyed || !this.waitingAtDoor) return;
    this.waitingAtDoor = false;
    this.sprite.body.enable = true;
    this.sprite.body.reset(this.sprite.x, this.sprite.y);
    this.sprite.setVisible(true);
  }

  // Holds the standing pose, e.g. while the game is paused.
  standStill() {
    if (this.isDestroyed) return;
    this.sprite.body.setVelocity(0, 0);
    showCharacterFacing(this.sprite, this.currentFacing, false);
  }

  destroy() {
    this.isDestroyed = true;
    this.clearPatience();
    this.reactionBubble?.destroy();
    this.reactionBubble = null;
    this.sprite.destroy();
    this.onComplete(this);
  }
}
