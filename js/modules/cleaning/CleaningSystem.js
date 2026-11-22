// ==========================================
// FILE: CleaningSystem.js
// ==========================================
// Store cleanliness, trash, and dirt. The state slice saves their locations and mopping
// progress; the fields draw and relocate them in the Phaser world.
import { fixtureBounds, fixtureFootprint } from "../../logic/FixtureLayout.js";
import { TILE_SIZE, EXPANSION_ORDER } from "../../logic/RoomLayout.js";
import { AREA } from "../../world/Areas.js";
import { controlLabel } from "../../input/InputDevice.js";
import {
  CLEANING_TUNING, createCustomerCleaningProfile, getCleanlinessMax, getCleanlinessScore,
  judgeCleanliness,
} from "./Litter.js";
import { randomTrashKind, TrashField } from "./TrashField.js";
import { DirtField, randomDirtKind } from "./DirtField.js";
import { MopAnimation } from "./MopAnimation.js";

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
    this.dirt = new DirtField(shop, (x, y) => this.isOpenTrashSpot(x, y));
    this.heldTrash = null;
    this.heldMop = null;
    this.mopAnimation = null;
    this.mopBar = null;
    // Employee -> the piece of trash they're carrying to a trashcan.
    /** @type {Map<object, object>} */
    this.staffHeldTrash = new Map();
    // Employee -> { bucket, animation, clockMs } for the mop they took.
    /** @type {Map<object, { bucket: object, animation: MopAnimation, clockMs: number }>} */
    this.staffMops = new Map();
    this.createMopAnimation = (actor) => new MopAnimation(shop, actor);
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

  dropDirt(x, y) {
    if (!this.isOpenTrashSpot(x, y)) return false;
    this.dirt.add(randomDirtKind(), x, y);
    this.syncSavedDirt();
    return true;
  }

  getNearbyMopBucket() {
    const shop = this.shop;
    if (shop.areas.playerArea !== AREA.SHOP || shop.checkoutSystem.operatingRegister) return null;
    return shop.fixtures.ofKind("mop").find((fixture) => {
      if (!shop.interactionSystem.isPlayerFacingFixture(fixture)) return false;
      const bounds = fixtureBounds(fixture);
      const rect = Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, value * TILE_SIZE]));
      return shop.interactionSystem.feetReachTo(shop.interactionSystem.getInteractionOrigin(), rect) <= 12;
    }) ?? null;
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

    const bucket = this.getNearbyMopBucket();
    if (this.heldMop) {
      if (bucket === this.heldMop) return [{
        action: "interact", kind: "mop-bucket", target: bucket, priority: 7, range: 0,
        distanceFrom: () => 0,
        hint: `${controlLabel("interact")}: Put the mop back in its bucket`,
        perform: () => this.putAwayMop(),
      }];
      const dirt = this.findDirtInFront();
      return dirt ? [{
        action: "interact", kind: "dirt", target: dirt, priority: 6, range: 0,
        distanceFrom: () => 0,
        hint: `Press ${controlLabel("interact")} repeatedly to mop this dirt`,
        perform: () => this.mopDirt(dirt),
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
      if (bucket) return [{
        action: "interact", kind: "mop-bucket", target: bucket, priority: 5, range: 0,
        distanceFrom: () => 0,
        hint: this.isMopWithStaff(bucket)
          ? "An employee is using this bucket's mop"
          : `${controlLabel("interact")}: Take the mop from the bucket`,
        perform: () => this.takeMop(bucket),
      }];
    }

    return [];
  }

  findTrashInFront() {
    return this.findMessInFront(this.trash);
  }

  findDirtInFront() {
    return this.findMessInFront(this.dirt);
  }

  findMessInFront(field) {
    const shop = this.shop;
    if (shop.areas.playerArea === AREA.BACKROOM || shop.checkoutSystem.operatingRegister) return null;
    const step = PLAYER_FACING_STEPS[shop.player.currentFacing];
    if (!step) return null;
    const { center } = shop.player.sprite.body;
    return field.findNear({
      x: center.x + step.x * CLEANING_TUNING.trashPickupAheadPx,
      y: center.y + step.y * CLEANING_TUNING.trashPickupAheadPx,
    }, CLEANING_TUNING.trashPickupReachPx);
  }

  takeMop(bucket) {
    if (this.heldMop || this.heldTrash || this.shop.crateSystem.getCarriedCrates().length > 0) {
      this.shop.messages.show("Empty your hands before taking the mop.", "#f59e0b");
      return false;
    }
    if (this.getNearbyMopBucket() !== bucket) {
      this.shop.messages.show("Face the mop bucket and move closer to take its mop.", "#94a3b8");
      return false;
    }
    if (this.isMopWithStaff(bucket)) {
      this.shop.messages.show("An employee is using this bucket's mop. They put it back when they're done.", "#94a3b8");
      return false;
    }
    // The player wins any race: an employee walking to this bucket picks another one.
    bucket.mopClaimedBy = null;
    this.mopAnimation = this.createMopAnimation(this.shop.player);
    this.heldMop = bucket;
    return true;
  }

  putAwayMop() {
    if (!this.heldMop) return false;
    this.mopAnimation?.destroy();
    this.mopAnimation = null;
    this.heldMop = null;
    this.mopBar?.setVisible(false);
    return true;
  }

  mopDirt(mark) {
    const shop = this.shop;
    if (!this.heldMop || this.findDirtInFront() !== mark) {
      shop.messages.show("Take the mop, then face the dirt and move closer.", "#94a3b8");
      return false;
    }
    if (shop.player.sprite.body.velocity.x || shop.player.sprite.body.velocity.y) {
      shop.messages.show("Stand still while mopping the dirt.", "#94a3b8");
      return false;
    }
    this.mopAnimation.press(shop.worldElapsedMs);
    mark.progress = Math.min(1, mark.progress + 1 / CLEANING_TUNING.mopPressesPerSpot);
    if (mark.progress >= 1 - Number.EPSILON) {
      this.dirt.take(mark);
      mark.sprite.destroy();
      shop.messages.show("Dirt cleaned. The store is cleaner.", "#10b981");
    }
    this.syncSavedDirt();
    return true;
  }

  pickUpTrash(piece) {
    if (this.heldMop) {
      this.shop.messages.show("Put the mop back before picking up trash.", "#f59e0b");
      return false;
    }
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

  // ---- Employees who mop. Each bucket has one mop: the player, or one employee, uses it.

  isMopWithStaff(bucket) {
    return [...this.staffMops.values()].some((mop) => mop.bucket === bucket);
  }

  isMopFree(bucket, holder) {
    if (this.heldMop === bucket) return false;
    for (const [other, mop] of this.staffMops) if (other !== holder && mop.bucket === bucket) return false;
    return !bucket.mopClaimedBy || bucket.mopClaimedBy === holder;
  }

  staffMopBuckets(holder) {
    return this.shop.fixtures.ofKind("mop").filter((bucket) => this.isMopFree(bucket, holder));
  }

  staffDirtTargets(holder) {
    return this.dirt.pieces.filter((mark) => !mark.claimedBy || mark.claimedBy === holder);
  }

  // Reserves a bucket's mop and a dirt mark (either may be null) for one employee.
  claimMoppingForStaff(holder, { bucket = null, mark = null }) {
    if (bucket && !this.isMopFree(bucket, holder)) return false;
    if (mark && (!this.dirt.pieces.includes(mark) || (mark.claimedBy && mark.claimedBy !== holder))) return false;
    this.releaseStaffMoppingClaims(holder);
    if (bucket) bucket.mopClaimedBy = holder;
    if (mark) mark.claimedBy = holder;
    return true;
  }

  isDirtClaimedBy(mark, holder) {
    return this.dirt.pieces.includes(mark) && mark.claimedBy === holder;
  }

  releaseStaffMoppingClaims(holder) {
    for (const mark of this.dirt.pieces) if (mark.claimedBy === holder) mark.claimedBy = null;
    for (const bucket of this.shop.fixtures.ofKind("mop")) {
      if (bucket.mopClaimedBy === holder) bucket.mopClaimedBy = null;
    }
  }

  isStaffHoldingMop(holder) {
    return this.staffMops.has(holder);
  }

  staffMopBucket(holder) {
    return this.staffMops.get(holder)?.bucket ?? null;
  }

  takeMopForStaff(holder, bucket) {
    if (this.staffMops.has(holder) || !this.shop.fixtures.ofKind("mop").includes(bucket) ||
      !this.isMopFree(bucket, holder)) return false;
    bucket.mopClaimedBy = null;
    this.staffMops.set(holder, { bucket, animation: this.createMopAnimation(holder), clockMs: 0 });
    return true;
  }

  // One stroke of an employee's mop. Returns whether the mark is now clean.
  mopDirtForStaff(holder, mark) {
    const mop = this.staffMops.get(holder);
    if (!mop || !this.isDirtClaimedBy(mark, holder)) return false;
    mop.animation.press(mop.clockMs);
    mark.progress = Math.min(1, mark.progress + 1 / CLEANING_TUNING.mopPressesPerSpot);
    const clean = mark.progress >= 1 - Number.EPSILON;
    if (clean) {
      this.dirt.take(mark);
      mark.sprite.destroy();
    }
    this.syncSavedDirt();
    return clean;
  }

  // Draws an employee's mop; while scrubbing, their arms sweep it back and forth.
  updateStaffMop(holder, delta, scrubbing) {
    const mop = this.staffMops.get(holder);
    if (!mop) return;
    mop.clockMs += delta;
    mop.animation.update(delta, scrubbing);
  }

  // The mop goes back in its bucket (wherever the employee is) and their claims are dropped.
  returnStaffMop(holder) {
    this.releaseStaffMoppingClaims(holder);
    const mop = this.staffMops.get(holder);
    if (!mop) return false;
    this.staffMops.delete(holder);
    mop.animation.destroy();
    return true;
  }

  clearStaffMops() {
    for (const holder of [...this.staffMops.keys()]) this.returnStaffMop(holder);
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
    const dirtCount = this.dirt.count;
    return { score: getCleanlinessScore(max, trashCount, dirtCount), max, trashCount, dirtCount };
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

  syncSavedDirt() {
    this.shop.gameState.trash.setDirt(this.dirt.serialize());
  }

  load(list, dirt = []) {
    this.putAwayMop();
    this.heldTrash?.sprite.destroy();
    this.heldTrash = null;
    this.clearStaffHeldTrash();
    this.clearStaffMops();
    this.trash.load(list);
    this.dirt.load(dirt);
    this.syncSavedTrash();
    this.syncSavedDirt();
  }

  moveOffBlockedSpots() {
    this.trash.moveOffBlockedSpots();
    this.dirt.moveOffBlockedSpots();
    this.syncSavedTrash();
    this.syncSavedDirt();
  }

  update(time, delta) {
    this.updateHighlight(time);
    this.syncStaffHeldTrash();
    if (!this.heldMop) return;
    const shop = this.shop;
    const moving = Boolean(shop.player.sprite.body.velocity.x || shop.player.sprite.body.velocity.y);
    if (moving) {
      this.mopAnimation.motion.active = false;
    }
    const canScrub = shop.controlMode.allows("interact") && !moving &&
      (!shop.shiftClock.started || !shop.shiftClock.isPaused);
    this.mopAnimation.update(canScrub ? delta : 0, canScrub);
    const mark = canScrub ? this.findDirtInFront() : null;
    if (!mark) {
      this.mopBar?.setVisible(false);
      return;
    }
    this.mopBar ??= shop.add.graphics().setDepth(9999);
    const player = shop.player.sprite;
    const scale = shop.cameraRig.popupScale(player.x, player.y);
    const x = player.x - 24 * scale;
    const y = player.y - player.displayHeight * player.originY - 12 * scale;
    const g = this.mopBar.clear().setVisible(true);
    g.fillStyle(0x080d1a).fillRoundedRect(x, y, 48 * scale, 8 * scale, 2 * scale);
    g.lineStyle(scale, 0x93a6c4).strokeRoundedRect(x, y, 48 * scale, 8 * scale, 2 * scale);
    g.fillStyle(0x22364c).fillRect(x + 2 * scale, y + 2 * scale, 44 * scale, 4 * scale);
    g.fillStyle(0x38bdf8).fillRect(x + 2 * scale, y + 2 * scale, 44 * scale * mark.progress, 4 * scale);
  }

  updateHighlight(time) {
    const shop = this.shop;
    const show = Boolean(shop.controls?.highlightTrashKey?.isDown) && shop.controlMode.allows("crate") &&
      shop.areas.playerArea !== AREA.BACKROOM;
    this.trash.renderHighlight(show, time);
    this.dirt.renderHighlight(show, time);
  }

  destroy() {
    this.unregisterInteractions?.();
    this.putAwayMop();
    this.mopBar?.destroy();
    this.heldTrash?.sprite.destroy();
    this.heldTrash = null;
    this.clearStaffHeldTrash();
    this.clearStaffMops();
    this.trash.destroy();
    this.dirt.destroy();
  }
}
