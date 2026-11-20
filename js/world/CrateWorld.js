import {
  CRATE_TUNING, findCratePushRival, solveCratePush,
} from "../logic/CratePushing.js";
import { separateOverlappingCrates } from "../logic/CrateSeparation.js";
import { getAuthoredGridSize, TILE_SIZE, LOADING_PAD_WIDTH, LOADING_PAD_HEIGHT } from "../logic/RoomLayout.js";

export class CrateWorld {
  constructor(shop, {
    width = getAuthoredGridSize().gridW * TILE_SIZE,
    height = getAuthoredGridSize().gridH * TILE_SIZE,
    colliders = [],
    padRect = null,
    customerGroup = null,
    onCustomerHit = null,
  } = {}) {
    this.shop = shop;
    shop.crateBounds = new Phaser.Geom.Rectangle(0, 0, width, height);
    shop.crateGroup = shop.physics.add.group();
    shop.physics.add.collider(shop.crateGroup, shop.crateGroup, (spriteA, spriteB) => {
      for (const sprite of [spriteA, spriteB]) {
        shop.restockCrates.find((crate) => crate.sprite === sprite)?.refreshDrag();
      }
    });
    for (const collider of colliders) shop.physics.add.collider(shop.crateGroup, collider);
    if (padRect) {
      const padBarrier = shop.add.zone(
        padRect.centerX,
        padRect.centerY,
        LOADING_PAD_WIDTH,
        LOADING_PAD_HEIGHT,
      );
      shop.physics.add.existing(padBarrier, true);
      shop.physics.add.collider(shop.crateGroup, padBarrier, null, (crateSprite) =>
        !shop.restockCrates.find((crate) => crate.sprite === crateSprite)?.lockedToPad);
    }
    if (customerGroup && onCustomerHit) {
      shop.physics.add.overlap(shop.crateGroup, customerGroup, (crateSprite, customerSprite) => {
        const crate = shop.restockCrates.find((candidate) => candidate.sprite === crateSprite);
        const customer = shop.customers.find((candidate) => candidate.sprite === customerSprite);
        if (crate && customer && crate.tryHitCustomer(customer)) {
          onCustomerHit(customer, crate);
        }
      });
    }
  }

  update(delta) {
    const shop = this.shop;
    for (const crate of shop.restockCrates) crate.updateThrow(delta);
    this.separateStuckCrates();
  }

  updateCratePushing(delta) {
    const shop = this.shop;
    const body = shop.player.sprite.body;
    const rectOf = (b) => ({ left: b.x, top: b.y, width: b.width, height: b.height });
    const holding = shop.crateSystem?.getCarriedCrates().length ?? shop.carriedCrates?.length ?? 0;
    const crates = shop.restockCrates
      .filter((crate) => crate.lockedToPad || crate.isPushed || crate.isStationary() || crate.isSliding())
      .map((crate) => ({
        key: crate,
        rect: rectOf(crate.sprite.body),
        weight: 1 + (shop.floorStacks.get(crate)?.length ?? 0),
        locked: crate.lockedToPad,
      }));
    const { playerVelocity, crateVelocities } = solveCratePush({
      player: rectOf(body),
      velocity: body.velocity,
      dt: Math.min(delta, CRATE_TUNING.physicsFrameDeltaCapMs) / 1000,
      crates,
      isBlocked: (rect) => this.isCrateSpaceBlocked(rect),
      carriedWeight: holding,
    });
    body.setVelocity(playerVelocity.x, playerVelocity.y);
    for (const crate of shop.restockCrates) {
      const velocity = crateVelocities.get(crate);
      if (velocity && (velocity.x || velocity.y)) crate.push(velocity);
      else if (crate.isPushed) crate.stopPush();
    }
  }

  pushCratesForCustomer(customer, delta, { canPush = true } = {}) {
    const shop = this.shop;
    const body = customer.sprite.body;
    if (!body) return;
    if (customer.crateSqueezeMs > 0) {
      customer.crateSqueezeMs -= delta;
      return;
    }
    const intended = { x: body.velocity.x, y: body.velocity.y };
    const intendedSpeed = Math.hypot(intended.x, intended.y);
    if (!intendedSpeed) {
      customer.crateStuckMs = 0;
      return;
    }
    const rectOf = (b) => ({ left: b.x, top: b.y, width: b.width, height: b.height });
    const center = body.center;
    const crates = shop.restockCrates
      .filter((crate) => !crate.lockedToPad && crate.sprite.body?.enable &&
        (crate.isPushed || crate.isStationary() || crate.isSliding()) &&
        Math.hypot(crate.sprite.x - center.x, crate.sprite.y - center.y) < CRATE_TUNING.customerPushReach)
      .map((crate) => ({
        key: crate,
        rect: rectOf(crate.sprite.body),
        weight: 1 + (shop.floorStacks.get(crate)?.length ?? 0),
        locked: false,
      }));
    if (!crates.length) {
      customer.crateStuckMs = 0;
      return;
    }
    const { playerVelocity, crateVelocities } = solveCratePush({
      player: rectOf(body),
      velocity: intended,
      dt: Math.min(delta, CRATE_TUNING.physicsFrameDeltaCapMs) / 1000,
      crates,
      isBlocked: (rect) => this.isCrateSpaceBlocked(rect),
      maxMoved: canPush ? Infinity : 0,
    });
    const moved = [...crateVelocities].filter(([, velocity]) => velocity.x || velocity.y);
    const distance = customer.remainingWalkDistance();
    const now = shop.time.now;
    const rival = findCratePushRival({
      customer,
      distance,
      now,
      crates: moved.map(([crate]) => crate),
      isActive: (other) => !other.isDestroyed && !other.crateYield,
    });
    if (rival) {
      const crate = moved.find(([candidate]) => candidate.customerPushClaim === rival)[0];
      customer.giveWayToCratePush(this.stepAsideFrom(customer, crate, rival.velocity));
      return;
    }
    body.setVelocity(playerVelocity.x, playerVelocity.y);
    for (const [crate, velocity] of moved) {
      crate.push(velocity);
      crate.customerPushClaim = { customer, distance, time: now, velocity };
    }
    const blocked = Math.hypot(playerVelocity.x, playerVelocity.y) < intendedSpeed * 0.3;
    customer.crateStuckMs = canPush && blocked ? (customer.crateStuckMs ?? 0) + delta : 0;
    if (customer.crateStuckMs > CRATE_TUNING.customerCrateStuckMs) {
      customer.crateStuckMs = 0;
      customer.crateSqueezeMs = CRATE_TUNING.customerCrateSqueezeMs;
      body.setVelocity(intended.x, intended.y);
    }
  }

  stepAsideFrom(customer, crate, crateVelocity) {
    const center = customer.sprite.body.center;
    const offset = { x: center.x - crate.sprite.x, y: center.y - crate.sprite.y };
    const speed = Math.hypot(crateVelocity?.x ?? 0, crateVelocity?.y ?? 0);
    let away = offset;
    if (speed) {
      const side = { x: -crateVelocity.y / speed, y: crateVelocity.x / speed };
      away = side.x * offset.x + side.y * offset.y >= 0 ? side : { x: -side.x, y: -side.y };
    }
    const length = Math.hypot(away.x, away.y);
    return length ? { x: away.x / length, y: away.y / length } : { x: 0, y: 0 };
  }

  separateStuckCrates() {
    const shop = this.shop;
    const crates = shop.restockCrates
      .filter((crate) => crate.sprite.body?.enable)
      .map((crate) => {
        const body = crate.sprite.body;
        return {
          key: crate,
          rect: { left: body.x, top: body.y, width: body.width, height: body.height },
          locked: crate.lockedToPad,
        };
      });
    const offsets = separateOverlappingCrates(crates, (_crate, rect) => this.isCrateSpaceBlocked(rect));
    for (const [crate, offset] of offsets) crate.nudge(offset.x, offset.y);
  }

  isCrateSpaceBlocked({ left, top, width, height }) {
    const bounds = this.shop.crateBounds;
    if (left < bounds.left || top < bounds.top || left + width > bounds.right || top + height > bounds.bottom) {
      return true;
    }
    return this.shop.physics.overlapRect(left, top, width, height, false, true).some((body) => body.enable);
  }
}
