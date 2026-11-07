// ==========================================
// FILE: Customer.js
// ==========================================
// One shopper: picks a faction buy list, walks to the shelves holding those items, buys at
// acceptable prices, then queues for player-driven checkout (or leaves angry).
// See also: CustomerBuyLists.js (what they want), Pathfinder.js (how they route).

import { pickRandomCustomerCharacter } from "./CustomerSprites.js";
import { createCustomerBuyList } from "./CustomerBuyLists.js";
import { transferItems } from "./InventoryTransfer.js";
import { BASE_PATIENCE_MS, getPatienceMs, planShelfRoute, rollCustomerTraits } from "./CustomerTraits.js";

const SPEED = 120; // px/s
// Bible Step 52: each customer accepts up to this random markup over the market price.
export const MIN_PRICE_TOLERANCE = 1.0;
export const MAX_PRICE_TOLERANCE = 1.3;
// Safety nets (ms) so an unreachable destination can never block the shift from ending.
// Seeking is deliberately far longer than any legitimate walk across the map.
const LEAVING_TIMEOUT_MS = 6000;
const SEEKING_TIMEOUT_MS = 15000;

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

// Fixed display size (px) for every facing, since each facing's source crop differs in size;
// keeps a character from visibly resizing as it turns.
export const SPRITE_DISPLAY_WIDTH = 46;
export const SPRITE_DISPLAY_HEIGHT = 48;

/**
 * One customer's sprite, shopping state machine, and patience bubble.
 * Created by the scene's spawner; destroys itself on reaching the exit.
 */
export class Customer {
  constructor({
    scene,
    getShoppingPlan,
    registerPoint,
    exitPoint,
    onReserveShelfSlot,
    onReserveQueueSlot,
    onReserveExitSlot,
    playerState,
    spawnBounds,
    factionId,
    onJoinQueue,
    onLeaveAngry,
    onMissingPrimary,
    onComplete,
  }) {
    this.scene = scene;
    this.registerPoint = registerPoint;
    this.exitPoint = exitPoint || { x: registerPoint.x, y: registerPoint.y };
    // Each claims a distinct waypoint near a shared destination so converging customers
    // don't all aim at the same pixel and jam into each other.
    this.onReserveShelfSlot = onReserveShelfSlot;
    this.onReserveQueueSlot = onReserveQueueSlot;
    this.onReserveExitSlot = onReserveExitSlot;
    this.reservedTarget = null;
    this.playerState = playerState;
    this.onJoinQueue = onJoinQueue;
    this.onLeaveAngry = onLeaveAngry;
    this.onMissingPrimary = onMissingPrimary;
    this.onComplete = onComplete;

    this.state = "SEEK_SHELF";
    this.cart = []; // [{ itemId, price }]
    this.priceTolerance = Phaser.Math.FloatBetween(MIN_PRICE_TOLERANCE, MAX_PRICE_TOLERANCE);
    this.queueTarget = null; // set by the scene once this customer has a spot in line
    this.patienceRemainingMs = null; // only ticks once queued
    this.patienceBubble = null;
    this.patienceLevel = -1;

    this.path = [];
    this.destination = null;
    this.onArriveAtDestination = null;
    this.isDestroyed = false;

    // World (not viewport) px: the camera may show only part of a larger room (RoomLayout.js).
    const bounds = spawnBounds || { xMin: 40, xMax: 120, yMin: 80, yMax: scene.scale.height - 80 };
    const spawnX = Phaser.Math.Between(bounds.xMin, bounds.xMax);
    const spawnY = Phaser.Math.Between(bounds.yMin, bounds.yMax);

    const character = pickRandomCustomerCharacter(factionId);
    this.facingTextures = character.facingTextures;
    this.factionId = character.factionId;
    this.traits = rollCustomerTraits(this.factionId);
    this.maxPatienceMs = getPatienceMs(this.traits);
    this.shoppingPlan = getShoppingPlan
      ? getShoppingPlan(this.factionId)
      : createCustomerBuyList(this.factionId, [], () => null);
    this.shelfStops = this.shoppingPlan.shelfStops || [];
    this.shelfStopIndex = 0;
    this.phaseItemIds = [];
    this.primaryBought = new Set();
    this.primaryMissing = new Set();
    this.bonusBought = new Set();
    this.bonusAttempted = new Set();
    this.purchasedFirearms = new Set();
    this.currentFacing = "down";
    this.sprite = scene.add
      .image(spawnX, spawnY, this.facingTextures.down)
      .setDisplaySize(SPRITE_DISPLAY_WIDTH, SPRITE_DISPLAY_HEIGHT)
      .setDepth(2);
    scene.physics.add.existing(this.sprite);

    this.visitNextShelf("primary");
  }

  // --- Frame update ---

  /**
   * @param {number} [delta] - ms since last frame
   */
  update(delta = 0) {
    if (this.isDestroyed) return; // guards against being updated the same frame it self-destructed

    switch (this.state) {
      case "SEEK_SHELF":
      case "SEEK_REGISTER":
        this.seekingTimer += delta;
        if (this.seekingTimer > SEEKING_TIMEOUT_MS) {
          this.scene.debugInfo?.recordCustomer("customer-seeking-timeout", this);
          console.warn(
            `Customer gave up seeking a destination (state=${this.state}); abandoning and leaving.`,
          );
          this.enterLeaving();
          break;
        }
        this.followPath();
        this.updateFacing();
        break;
      case "QUEUEING":
        this.followPath();
        // A line of people should face the counter, not their last walking direction.
        this.updateFacing("up");
        this.updatePatience(delta);
        break;
      case "LEAVING":
        this.leavingTimer += delta;
        if (this.leavingTimer > LEAVING_TIMEOUT_MS) {
          this.scene.debugInfo?.recordCustomer("customer-exit-timeout", this);
          this.destroy(); // safety net -- see LEAVING_TIMEOUT_MS
          break;
        }
        this.followPath();
        if (!this.isDestroyed) this.updateFacing(); // arrival may have just destroyed this
        break;
    }
  }

  // --- Shopping ---

  /**
   * True if the store price is within this customer's tolerance over the market price.
   * @param {string} itemId
   */
  acceptsPrice(itemId) {
    const marketPrice = this.scene.market.getPrice(itemId);
    return this.scene.getStorePrice(itemId) <= marketPrice * this.priceTolerance;
  }

  getRemainingUnitsFor(itemId) {
    return this.cart.some((entry) => entry.itemId === itemId) ? 0 : 1;
  }

  add(itemId, quantity) {
    const accepted = Math.min(quantity, this.getRemainingUnitsFor(itemId));
    if (accepted > 0) {
      this.cart.push({ itemId, price: this.scene.getStorePrice(itemId) });
    }
    return accepted;
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

  visitNextShelfStop() {
    if (this.shelfStopIndex >= this.shelfStops.length) {
      this.finishShoppingPhase();
      return;
    }
    const { fixture, standPoint } = this.shelfStops[this.shelfStopIndex];
    this.fixture = fixture;
    const target = this.onReserveShelfSlot
      ? this.onReserveShelfSlot(fixture, this)
      : standPoint;
    this.shelfStopIndex += 1;
    this.setDestination(target.x, target.y, () => this.shopAtCurrentShelf());
  }

  // Buys one of each wanted item stocked here at an acceptable price, then moves on.
  shopAtCurrentShelf() {
    for (const itemId of this.phaseItemIds) {
      if (this.shoppingPhase === "bonus") this.bonusAttempted.add(itemId);
      const placements = this.fixture.placements.filter((placement) =>
        placement.itemId === itemId && placement.quantity > 0,
      );
      if (placements.length === 0) continue;
      if (this.cart.some((entry) => entry.itemId === itemId)) continue;
      // Mercenaries won't buy a second firearm of a type they already picked up.
      if (this.shoppingPhase === "bonus" && this.factionId === "mercenaries" &&
        this.purchasedFirearms.has(this.scene.getItem(itemId)?.tags.find((tag) =>
          ["Pistol", "Rifle", "Heavy"].includes(tag),
        ))) continue;

      const placement = placements.find((candidate) => this.acceptsPrice(itemId));
      if (!placement) {
        this.scene.showFloatingText(
          this.sprite.x,
          this.sprite.y - 40,
          "Too expensive!",
          "#f59e0b",
        );
        continue;
      }

      const transfer = transferItems(this.fixture, this, itemId, 1, {
        sourceEntry: placement,
        eventBus: this.scene.eventBus,
        sourceName: "shelf",
        destinationName: "customer-cart",
      });
      if (transfer.moved === 0) continue;
      this.scene.refreshShelfStockDisplay?.(this.fixture);
      if (this.shoppingPhase === "primary") this.primaryBought.add(itemId);
      else this.bonusBought.add(itemId);

      const item = this.scene.getItem(itemId);
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
      if (!this.scene.getItem(firearmId)?.tags.includes("Firearm")) continue;
      ids.push(...(this.shoppingPlan.matchingAmmoIdsByFirearm?.[firearmId] || []));
    }
    return [...new Set(ids)].filter((id) =>
      !this.cart.some((entry) => entry.itemId === id),
    );
  }

  // Advances primary -> bonus -> queue, or leaves if there's nothing worth buying.
  finishShoppingPhase() {
    if (this.shoppingPhase === "primary") {
      if (this.shoppingPlan.primaryItemIds.length === 0) {
        if (this.factionId) {
          const hints = {
            scavengers: "Looking for surplus gear!",
            mercenaries: "Looking for weapons, ammo, or armor!",
            explorers: "Looking for tools or survival gear!",
          };
          this.scene.showFloatingText(
            this.sprite.x,
            this.sprite.y - 40,
            hints[this.factionId],
            "#38bdf8",
          );
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
      if (this.primaryBought.size === 0) {
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

    if (this.cart.length === 0) {
      this.enterLeaving();
      return;
    }
    this.playerState.notifyListeners();
    this.reservedTarget = this.onReserveQueueSlot
      ? this.onReserveQueueSlot()
      : this.registerPoint;
    this.setDestination(this.reservedTarget.x, this.reservedTarget.y, () => this.joinQueue());
    this.state = "SEEK_REGISTER";
  }

  // The scene applies reputation and feedback when this customer misses primary stock.
  reportMissingPrimary() {
    this.onMissingPrimary?.(this, [...this.primaryMissing]);
  }

  // --- Queue and patience ---

  joinQueue() {
    this.state = "QUEUEING";
    this.queueTarget = { x: this.registerPoint.x, y: this.registerPoint.y };
    this.resetPatience();
    this.onJoinQueue(this);
  }

  resetPatience() {
    this.patienceRemainingMs = this.maxPatienceMs ?? PATIENCE_MS;
  }

  /**
   * Drains while waiting in line, except while the player is actively ringing them up.
   * @param {number} delta - ms
   */
  updatePatience(delta) {
    if (this.patienceRemainingMs == null) return;
    if (!this.scene.isServingCustomer?.(this)) {
      this.patienceRemainingMs = Math.max(0, this.patienceRemainingMs - delta);
    }
    if (this.patienceRemainingMs <= 0) {
      this.leaveAngry();
      return;
    }
    this.drawPatienceBubble();
  }

  drawPatienceBubble() {
    const x = this.sprite.x;
    const y = this.sprite.y - SPRITE_DISPLAY_HEIGHT / 2 - 14;
    if (!this.patienceBubble) {
      const background = this.scene.add.circle(0, 0, 12, 0xffffff).setStrokeStyle(2, 0x000000);
      const glyph = this.scene.add
        .text(0, -1, "", {
          fontFamily: '"Courier New", monospace',
          fontSize: "14px",
          fontStyle: "bold",
          color: "#000000",
        })
        .setOrigin(0.5);
      this.patienceBubble = this.scene.add.container(x, y, [background, glyph]).setDepth(9000);
    }
    this.patienceBubble.setPosition(x, y);

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
    this.patienceRemainingMs = null;
    this.patienceLevel = -1;
    this.patienceBubble?.destroy();
    this.patienceBubble = null;
  }

  // Bible Steps 12/51: abandons the cart for the scene to process, then leaves.
  leaveAngry() {
    const cart = this.cart;
    this.cart = [];
    this.clearPatience();
    this.onLeaveAngry?.(this, cart);
    this.enterLeaving();
  }

  /**
   * Called by the scene whenever the line shifts (someone joins, or everyone shuffles forward).
   * @param {number} x
   * @param {number} y
   */
  setQueueTarget(x, y) {
    this.queueTarget = { x, y };
    this.setDestination(x, y, () => {});
  }

  // Finish the customer's sale state and return proceeds for the scene's sale event.
  completeSale() {
    const total = this.cart.reduce((sum, entry) => sum + entry.price, 0);
    this.clearPatience();
    this.enterLeaving();
    return total;
  }

  enterLeaving() {
    // Reserve before flipping state so this customer doesn't count itself among those leaving.
    const exitTarget = this.onReserveExitSlot ? this.onReserveExitSlot() : this.exitPoint;
    this.state = "LEAVING";
    this.leavingTimer = 0;
    this.setDestination(exitTarget.x, exitTarget.y, () => this.destroy());
  }

  // --- Movement ---

  /**
   * Path to a new target via the scene's pathfinder; with no path found, walks straight there.
   * @param {number} targetX
   * @param {number} targetY
   * @param {() => void} onArrive
   */
  setDestination(targetX, targetY, onArrive) {
    this.destination = { x: targetX, y: targetY };
    this.onArriveAtDestination = onArrive;
    this.seekingTimer = 0;

    const path = this.scene.findPath?.(this.sprite.x, this.sprite.y, targetX, targetY);
    this.path = path || [];
  }

  // Walks the path waypoint by waypoint, then directly to the exact destination (which may
  // not sit on a grid-cell center) before firing the arrival callback.
  followPath() {
    if (this.path.length > 0) {
      const waypoint = this.path[0];
      this.moveToward(waypoint.x, waypoint.y, () => this.path.shift());
      return;
    }

    this.moveToward(this.destination.x, this.destination.y, () => this.onArriveAtDestination());
  }

  /**
   * @param {number} targetX
   * @param {number} targetY
   * @param {() => void} onArrive - fired once within 6 px
   */
  moveToward(targetX, targetY, onArrive) {
    const distance = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, targetX, targetY);

    if (distance < 6) {
      this.sprite.body.setVelocity(0, 0);
      onArrive();
      return;
    }

    const angle = Phaser.Math.Angle.Between(this.sprite.x, this.sprite.y, targetX, targetY);
    this.sprite.body.setVelocity(Math.cos(angle) * SPEED, Math.sin(angle) * SPEED);
  }

  /**
   * Swap texture to the forced facing, or the one matching current velocity. An idle
   * customer keeps its last facing instead of flickering back to a default.
   * @param {"up" | "down" | "left" | "right"} [forcedFacing]
   */
  updateFacing(forcedFacing) {
    let facing = forcedFacing;

    if (!facing) {
      const { x: vx, y: vy } = this.sprite.body.velocity;
      if (Math.abs(vx) < 1 && Math.abs(vy) < 1) return;
      facing =
        Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? "left" : "right") : vy < 0 ? "up" : "down";
    }

    if (facing === this.currentFacing) return;
    this.currentFacing = facing;
    // Each facing's crop has a different native size; re-force the display size.
    this.sprite
      .setTexture(this.facingTextures[facing])
      .setDisplaySize(SPRITE_DISPLAY_WIDTH, SPRITE_DISPLAY_HEIGHT);
  }

  destroy() {
    this.isDestroyed = true;
    this.clearPatience();
    this.sprite.destroy();
    this.onComplete(this);
  }
}
