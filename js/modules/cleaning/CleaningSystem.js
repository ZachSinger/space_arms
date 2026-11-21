// ==========================================
// FILE: CleaningSystem.js
// ==========================================
// Store cleanliness and loose trash. The state slice keeps saved trash locations; TrashField
// draws and moves those pieces in the Phaser world.
import { fixtureFootprint } from "../../logic/FixtureLayout.js";
import { TILE_SIZE, EXPANSION_ORDER } from "../../logic/RoomLayout.js";
import { AREA } from "../../world/Areas.js";
import { controlLabel } from "../../input/InputDevice.js";
import {
  CLEANING_TUNING, createCustomerCleaningProfile, getCleanlinessMax, getCleanlinessScore,
  judgeCleanliness,
} from "./Litter.js";
import { randomTrashKind, TrashField } from "./TrashField.js";

const PLAYER_FACING_STEPS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});

export class CleaningSystem {
  constructor(shop) {
    this.id = "cleaning";
    this.shop = shop;
    this.trash = new TrashField(shop, (x, y) => this.isOpenTrashSpot(x, y));
    this.heldTrash = null;
    // Employee -> the piece of trash they're carrying to a trashcan.
    /** @type {Map<object, object>} */
    this.staffHeldTrash = new Map();
    if (shop.interactables) {
      this.unregisterInteractions = shop.interactables.registerProvider("cleaning", () => [{
        id: "cleaning",
        kind: "cleaning",
        getActions: () => this.getActions(),
      }]);
    }
  }

  isOpenTrashSpot(x, y) {
    const shop = this.shop;
    const gx = Math.floor(x / TILE_SIZE);
    const gy = Math.floor(y / TILE_SIZE);
    const zone = shop.room.zones.find((candidate) =>
      gx >= candidate.gridX && gx < candidate.gridX + candidate.gridW &&
      gy >= candidate.gridY && gy < candidate.gridY + candidate.gridH);
    if (!zone?.salesFloor || zone.locked || !shop.room.isWalkable(gx, gy)) return false;
    const margin = 8;
    return !shop.fixtures.all().some((fixture) => {
      const { w, h } = fixtureFootprint(fixture);
      return x >= fixture.gx * TILE_SIZE - margin && x <= (fixture.gx + w) * TILE_SIZE + margin &&
        y >= fixture.gy * TILE_SIZE - margin && y <= (fixture.gy + h) * TILE_SIZE + margin;
    });
  }

  dropTrash(x, y) {
    if (!this.isOpenTrashSpot(x, y)) return false;
    this.trash.add(randomTrashKind(), x, y);
    this.syncSavedTrash();
    return true;
  }

  getActions() {
    const shop = this.shop;
    const carriedCrates = shop.crateSystem.getCarriedCrates();
    const trashcan = shop.fixtureSystem.getNearbyTrashcan();

    if (this.heldTrash) {
      return trashcan ? [{
        action: "interact",
        id: `trashcan:${trashcan.id}`,
        kind: "trashcan",
        target: trashcan,
        priority: 5,
        range: 0,
        distanceFrom: () => 0,
        hint: `${controlLabel("interact")}: Throw the trash in the trashcan`,
        perform: () => this.throwAwayHeldTrash(),
      }] : [];
    }

    if (carriedCrates.length === 0) {
      const piece = this.findTrashInFront();
      if (piece) {
        return [{
          action: "interact",
          id: `trash:${piece.id}`,
          kind: "trash",
          target: piece,
          priority: 6,
          range: 0,
          distanceFrom: () => 0,
          hint: `${controlLabel("interact")}: Pick up the trash`,
          perform: () => this.pickUpTrash(piece),
        }];
      }
    }

    return [];
  }

  findTrashInFront() {
    const shop = this.shop;
    if (shop.areas.playerArea === AREA.BACKROOM || shop.checkoutSystem.operatingRegister) return null;
    const step = PLAYER_FACING_STEPS[shop.player.currentFacing];
    if (!step) return null;
    const { center } = shop.player.sprite.body;
    return this.trash.findNear({
      x: center.x + step.x * CLEANING_TUNING.trashPickupAheadPx,
      y: center.y + step.y * CLEANING_TUNING.trashPickupAheadPx,
    }, CLEANING_TUNING.trashPickupReachPx);
  }

  pickUpTrash(piece) {
    if (!this.trash.take(piece)) return false;
    // The player wins any race: an employee walking to this piece gives up and picks another.
    piece.claimedBy = null;
    this.heldTrash = piece;
    this.syncHeldTrash();
    this.syncSavedTrash();
    return true;
  }

  throwAwayHeldTrash() {
    if (!this.heldTrash) return false;
    this.heldTrash.sprite.destroy();
    this.heldTrash = null;
    this.shop.messages.show("Trash thrown away. The store is cleaner.", "#10b981");
    return true;
  }

  dropHeldTrash() {
    const piece = this.heldTrash;
    if (!piece) return false;
    const { center, bottom } = this.shop.player.sprite.body;
    const step = PLAYER_FACING_STEPS[this.shop.player.currentFacing] ?? { x: 0, y: 0 };
    const spots = [
      {
        x: center.x + step.x * CLEANING_TUNING.trashPickupAheadPx,
        y: bottom + step.y * CLEANING_TUNING.trashPickupAheadPx,
      },
      { x: center.x, y: bottom },
    ];
    const spot = spots.find(({ x, y }) => this.isOpenTrashSpot(x, y));
    if (!spot) {
      this.shop.messages.show(this.shop.areas.playerArea === AREA.BACKROOM
        ? "Trash can only be dropped out on the shop floor."
        : "No room to drop the trash here.", "#94a3b8");
      return false;
    }
    this.heldTrash = null;
    this.trash.place(piece, spot.x, spot.y);
    this.syncSavedTrash();
    return true;
  }

  syncHeldTrash() {
    const sprite = this.heldTrash?.sprite;
    if (!sprite) return;
    const player = this.shop.player.sprite;
    const facing = this.shop.player.currentFacing;
    const side = { left: -14, right: 14, down: 12, up: -12 }[facing] ?? 12;
    sprite.setPosition(player.x + side, player.y - 4);
    sprite.setDepth(player.depth + (facing === "up" ? -0.5 : 0.5));
  }

  // ---- Employees who clean (js/logic/Employee.js reaches these through its store interface,
  // so staff code never imports this module and simply finds no cleaning work without it.)

  /**
   * Floor trash an employee may go for: every piece no other employee is already after.
   * @param {object} holder - the employee
   */
  staffTrashTargets(holder) {
    return this.trash.pieces.filter((piece) => !piece.claimedBy || piece.claimedBy === holder);
  }

  /**
   * Where an employee can stand to pick up a piece: on it, or one step away on any side.
   * @param {{ x: number, y: number }} piece
   */
  trashStandSpots(piece) {
    const ahead = CLEANING_TUNING.trashPickupAheadPx;
    return [{ x: piece.x, y: piece.y }, ...Object.values(PLAYER_FACING_STEPS).map((step) => ({
      x: piece.x - step.x * ahead,
      y: piece.y - step.y * ahead,
    }))];
  }

  isTrashOnFloor(piece) {
    return this.trash.pieces.includes(piece);
  }

  // Reserves a floor piece for one employee so nobody else heads for it. Drops any older claim.
  claimTrashForStaff(holder, piece) {
    if (!this.isTrashOnFloor(piece) || (piece.claimedBy && piece.claimedBy !== holder)) return false;
    this.releaseStaffClaims(holder);
    piece.claimedBy = holder;
    return true;
  }

  isClaimedBy(piece, holder) {
    return this.isTrashOnFloor(piece) && piece.claimedBy === holder;
  }

  releaseStaffClaims(holder) {
    for (const piece of this.trash.pieces) if (piece.claimedBy === holder) piece.claimedBy = null;
  }

  pickUpTrashForStaff(holder, piece) {
    if (this.staffHeldTrash.has(holder) || !this.isClaimedBy(piece, holder) || !this.trash.take(piece)) return false;
    piece.claimedBy = null;
    this.staffHeldTrash.set(holder, piece);
    this.syncStaffHeldTrash();
    this.syncSavedTrash();
    return true;
  }

  isStaffHoldingTrash(holder) {
    return this.staffHeldTrash.has(holder);
  }

  throwAwayStaffTrash(holder) {
    const piece = this.staffHeldTrash.get(holder);
    if (!piece) return false;
    this.staffHeldTrash.delete(holder);
    piece.sprite.destroy();
    return true;
  }

  /**
   * Puts an employee's carried trash back on the floor at their feet (or, with no open floor
   * there, where they picked it up) and drops their claims. Safe to call when they hold nothing.
   * @param {object} holder - the employee
   */
  dropStaffTrash(holder) {
    this.releaseStaffClaims(holder);
    const piece = this.staffHeldTrash.get(holder);
    if (!piece) return false;
    this.staffHeldTrash.delete(holder);
    const sprite = holder.sprite;
    const feet = sprite && { x: sprite.body?.center?.x ?? sprite.x, y: sprite.body?.bottom ?? sprite.y };
    const spot = feet && Number.isFinite(feet.x) && Number.isFinite(feet.y) && this.isOpenTrashSpot(feet.x, feet.y)
      ? feet
      : { x: piece.x, y: piece.y };
    this.trash.place(piece, spot.x, spot.y);
    this.trash.moveOffBlockedSpots();
    this.syncSavedTrash();
    return true;
  }

  // Carried trash rides beside the employee, like the player's.
  syncStaffHeldTrash() {
    for (const [holder, piece] of this.staffHeldTrash) {
      const sprite = holder.sprite;
      if (!sprite || !piece.sprite) continue;
      const side = { left: -14, right: 14, down: 12, up: -12 }[holder.currentFacing] ?? 12;
      piece.sprite.setPosition(sprite.x + side, sprite.y - 4);
      piece.sprite.setDepth((sprite.depth ?? 0) + (holder.currentFacing === "up" ? -0.5 : 0.5));
    }
  }

  clearStaffHeldTrash() {
    for (const piece of this.staffHeldTrash.values()) piece.sprite.destroy();
    this.staffHeldTrash.clear();
  }

  getCleanliness() {
    const shop = this.shop;
    const salesExpansions = EXPANSION_ORDER.filter((id) =>
      shop.room.zones.some((zone) => zone.id === id && !zone.locked)).length;
    const max = getCleanlinessMax({
      salesExpansions,
      shopLevel: shop.gameState.reputation.shopLevel,
    });
    const trashCount = this.trash.count + (this.heldTrash ? 1 : 0) + this.staffHeldTrash.size;
    return { score: getCleanlinessScore(max, trashCount), max, trashCount };
  }

  getCleanlinessPercent() {
    const { score, max } = this.getCleanliness();
    return (score / max) * 100;
  }

  createCustomerProfile(factionId) {
    return createCustomerCleaningProfile(factionId);
  }

  judgeCustomerCleanliness(percent, tolerance) {
    return judgeCleanliness(percent, tolerance);
  }

  reportCleanlinessVerdict(customer, verdict) {
    const walkOut = verdict === "walk-out";
    const penalty = walkOut ? CLEANING_TUNING.walkOutReputationLoss : CLEANING_TUNING.upsetReputationLoss;
    this.shop.gameState.reputation.lose(penalty);
    this.shop.messages.floatText(
      customer.sprite.x,
      customer.sprite.y - 50,
      `${walkOut ? "Too dirty! Leaving." : "This store is dirty."}\n-${penalty} store reputation\nat shift end`,
      walkOut ? "#ef4444" : "#f59e0b",
    );
    this.shop.debugInfo?.recordCustomer(
      walkOut ? "customer-left-dirty-store" : "customer-upset-dirty-store",
      customer,
    );
  }

  serializeTrash() {
    const trash = this.trash.serialize();
    if (this.heldTrash) {
      const spot = this.shop.areas.playerArea === AREA.BACKROOM
        ? this.shop.areas.arrivalIn(AREA.SHOP)
        : {
          x: this.shop.player.sprite.x,
          y: this.shop.player.sprite.body?.bottom ?? this.shop.player.sprite.y,
        };
      trash.push({ kind: this.heldTrash.kind, x: spot.x, y: spot.y });
    }
    // Trash an employee is carrying is saved back where they picked it up.
    for (const piece of this.staffHeldTrash.values()) trash.push({ kind: piece.kind, x: piece.x, y: piece.y });
    return trash;
  }

  syncSavedTrash() {
    this.shop.gameState.trash.setPieces(this.trash.serialize());
  }

  load(list) {
    this.heldTrash?.sprite.destroy();
    this.heldTrash = null;
    this.clearStaffHeldTrash();
    this.trash.load(list);
    this.syncSavedTrash();
  }

  moveOffBlockedSpots() {
    this.trash.moveOffBlockedSpots();
    this.syncSavedTrash();
  }

  update(time) {
    this.updateHighlight(time);
    this.syncStaffHeldTrash();
  }

  updateHighlight(time) {
    const shop = this.shop;
    const show = Boolean(shop.controls?.highlightTrashKey?.isDown) && shop.controlMode.allows("crate") &&
      shop.areas.playerArea !== AREA.BACKROOM;
    this.trash.renderHighlight(show, time);
  }

  destroy() {
    this.unregisterInteractions?.();
    this.heldTrash?.sprite.destroy();
    this.heldTrash = null;
    this.clearStaffHeldTrash();
    this.trash.destroy();
  }
}
