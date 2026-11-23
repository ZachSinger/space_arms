import { database } from "../scenes/boot.js";
import { Crate, CRATE_STACK_SPACING } from "../logic/Crate.js";
import { CrateFooter } from "../logic/CrateFooter.js";
import { getFixtureType } from "../logic/FixtureLayout.js";
import { transferItems } from "../logic/InventoryTransfer.js";
import { PLAYER_CRATE_HOLD_OFFSET } from "../logic/Player.js";
import { CONTROL_MODES } from "../input/ControlMode.js";
import { PEOPLE_DEPTH_BASE } from "../world/Depth.js";
import { getItemCrateTint } from "../logic/CrateCategory.js";
import { TILE_SIZE } from "../logic/RoomLayout.js";
import {
  FLOOR_STACK_MAX, MAX_CARRIED_CRATES, isInFacingCone, isSquarelyInFront,
} from "../logic/CrateStack.js";
import { GAME_EVENTS } from "../core/Events.js";
import { controlLabel } from "../input/InputDevice.js";

export class CrateSystem {
  constructor(shop) {
    this.shop = shop;
    this.restockCrates = [];
    this.carriedCrate = null;
    this.carriedCrates = [];
    this.floorStacks = new Map();
    this.markedStackBase = null;
    this.markedFromTop = 0;
    // Paused shift time freezes every loose crate where it is.
    this.motionPaused = false;
    this.pickupMarker = null;
    this.crateFooter = null;
    if (shop.interactables) this.registerInteractions();
  }

  /** The green arrow and the bottom crate bar; both go away when the scene shuts down. */
  createViews() {
    const shop = this.shop;
    // Points down at the crate the pick-up button would take, or the stack the put-down button adds to.
    this.pickupMarker = shop.add.graphics().setDepth(20000).setVisible(false);
    this.pickupMarker.fillStyle(0x22c55e).lineStyle(1, 0x052e16)
      .fillTriangle(-5, -4, 5, -4, 0, 4).strokeTriangle(-5, -4, 5, -4, 0, 4);
    this.crateFooter = new CrateFooter();
    shop.events.once("shutdown", () => this.crateFooter.destroy());
  }

  setMotionPaused(paused) {
    if (paused === this.motionPaused) return;
    this.motionPaused = paused;
    for (const crate of this.restockCrates) crate.setPaused(paused);
  }

  registerInteractions() {
    this.shop.interactables.registerProvider("crate-controls", () => [{
      id: "crate-controls",
      kind: "crate-control",
      range: 0,
      distanceFrom: () => 0,
      getActions: () => Object.values(this.getActions()).filter(Boolean),
    }]);
  }

  createId() {
    return this.shop.gameState.crates.allocateId();
  }

  createItemCrate(itemId, quantity, x, y, { id = null } = {}) {
    const item = itemId ? database.getItem(itemId) : null;
    return new Crate(this.shop, itemId, quantity, x, y, {
      id,
      tint: getItemCrateTint(item?.tags),
    });
  }

  createRemoteOrderCrate({ orderId, requiredItems, x, y }) {
    const crate = new Crate(this.shop, null, 0, x, y, {
      id: this.createId(),
      kind: "remote-order",
      orderId,
      requiredItems,
    });
    this.restockCrates.push(crate);
    this.shop.gameState.crates.changed();
    return crate;
  }

  getCarriedCrates() {
    if (Array.isArray(this.carriedCrates)) return this.carriedCrates;
    return this.carriedCrate ? [this.carriedCrate] : [];
  }

  getStockableCrates() {
    return [...this.getCarriedCrates(), ...(this.shop.hovercartLab?.getStockableCrates() ?? [])];
  }

  addCarriedCrate(crate) {
    crate.setCarriedBy("player");
    const stack = this.getCarriedCrates();
    stack.push(crate);
    this.carriedCrates = stack;
    this.carriedCrate = crate;
    this.syncCarriedCrate();
  }

  removeCarriedCrate(crate) {
    const stack = this.getCarriedCrates();
    const index = stack.indexOf(crate);
    if (index < 0) return false;
    stack.splice(index, 1);
    this.carriedCrates = stack;
    if (this.carriedCrate === crate) this.carriedCrate = stack.at(-1) ?? null;
    this.syncCarriedCrate();
    return true;
  }

  getFloorCrates() {
    return [...this.restockCrates, ...[...this.floorStacks.values()].flat()];
  }

  findCrateInFront({ moving = false } = {}) {
    const shop = this.shop;
    const { center } = shop.player.sprite.body;
    let best = null;
    let bestDistance = TILE_SIZE / 2;
    for (const crate of this.restockCrates) {
      if (crate.inTerminal || crate.remoteOrderShipping) continue;
      if (crate.canPickUp() === moving) continue;
      if (!isInFacingCone(center, crate.sprite, shop.player.currentFacing)) continue;
      if (!moving && !isSquarelyInFront(shop.player.sprite.body, crate.getFloorBounds(),
        shop.player.currentFacing)) continue;
      const { left, right, top, bottom } = crate.sprite.getBounds();
      const dx = Math.max(left - center.x, 0, center.x - right);
      const dy = Math.max(top - center.y, 0, center.y - bottom);
      const distance = Math.hypot(dx, dy);
      if (distance <= bestDistance) {
        best = crate;
        bestDistance = distance;
      }
    }
    return best;
  }

  markedFloorStack() {
    const base = this.findCrateInFront();
    if (!base) {
      this.markedStackBase = null;
      return null;
    }
    const crates = [base, ...(this.floorStacks.get(base) ?? [])];
    if (base !== this.markedStackBase) {
      this.markedStackBase = base;
      this.markedFromTop = 0;
    }
    this.markedFromTop = Math.min(this.markedFromTop, crates.length - 1);
    return { base, crates, marked: crates[crates.length - 1 - this.markedFromTop] };
  }

  markNextCrateDown() {
    const shop = this.shop;
    if (!shop.controlMode.allows("crate") || shop.checkoutSystem.operatingRegister) return;
    const stack = this.markedFloorStack();
    if (!stack || stack.crates.length < 2) return;
    this.markedFromTop = (this.markedFromTop + 1) % stack.crates.length;
  }

  getActions() {
    const shop = this.shop;
    const say = (message, color = "#94a3b8") => () => shop.messages.show(message, color);
    const holding = this.getCarriedCrates().length;
    const top = this.carriedCrate;
    if (shop.checkoutSystem.operatingRegister) {
      return this.addActionHints({
        pickUp: { tap: say("Leave the register to pick up a crate") },
        putDown: holding ? { tap: say("Leave the register to put down a crate") } : undefined,
      }, null, holding);
    }
    if (shop.heldTrash) {
      const reason = "You can't pick up crates while holding trash";
      return this.addActionHints({
        pickUp: { tap: say(reason, "#f59e0b"), blocked: true },
        putDown: { tap: () => shop.cleaningSystem?.dropHeldTrash() ?? false, trash: true },
      }, null, holding);
    }

    const hovercartActions = shop.hovercartLab?.getCrateActions();
    if (hovercartActions) {
      const actions = this.addActionHints(hovercartActions, null, holding);
      for (const action of Object.values(actions)) {
        if (action?.hintOverride) action.hint = action.hintOverride;
        if (action) action.target = shop.hovercartLab.cart;
      }
      return actions;
    }

    const actions = {};
    const stack = this.markedFloorStack();
    const carryingRemoteOrder = this.getCarriedCrates().some((crate) => crate.kind === "remote-order");
    if (stack) {
      const lifted = stack.crates.length - stack.crates.indexOf(stack.marked);
      if (stack.marked.kind === "fixture" && holding > 0) {
        actions.pickUp = { tap: say("Put your crates down before picking up a fixture crate"), blocked: true };
      } else if (top?.kind === "fixture") {
        actions.pickUp = { tap: say("Put the fixture crate down before picking up another crate"), blocked: true };
      } else if (stack.marked.kind === "remote-order" && carryingRemoteOrder) {
        actions.pickUp = { tap: say("Put your delivery crate down before picking up another delivery crate"), blocked: true };
      } else if (this.combinableUnits(stack.marked) > 0) {
        actions.pickUp = {
          tap: () => this.combineIntoCarried(stack.marked),
          hold: () => this.combineIntoCarried(stack.marked),
          combines: this.combinableUnits(stack.marked),
        };
      } else {
        const tooMany = (count) => say(`You can only carry ${MAX_CARRIED_CRATES} crates. You're holding ` +
          `${holding}, so you can't pick up ${count === 1 ? "another one" : `${count} more`}.`, "#f59e0b");
        actions.pickUp = {
          tap: holding + 1 <= MAX_CARRIED_CRATES
            ? () => this.pickUpFromStack(stack, false)
            : tooMany(1),
          hold: holding + lifted <= MAX_CARRIED_CRATES
            ? () => this.pickUpFromStack(stack, true)
            : tooMany(lifted),
          lifted,
        };
      }
    } else if (holding === 0) {
      actions.pickUp = {
        tap: this.findCrateInFront({ moving: true })
          ? say("Wait for crate to stop", "#f59e0b")
          : say("No crate nearby"),
      };
    }

    if (holding === 0) {
      // Nothing to put down.
    } else if (carryingRemoteOrder) {
      actions.putDown = {
        tap: () => this.dropTopCrate(),
        hold: say("Put down the remote order crate separately.", "#f59e0b"),
        separatesRemoteOrder: true,
      };
    } else if (stack && top.kind !== "fixture") {
      const room = FLOOR_STACK_MAX - stack.crates.length;
      let reason = null;
      if (stack.base.kind === "fixture") reason = "Crates can't be stacked on a fixture crate";
      else if (stack.base.kind === "remote-order" || stack.marked.kind === "remote-order") {
        reason = "Remote order crates can't be stacked";
      }
      else if (stack.base.lockedToPad) reason = "Crates can't be stacked on the Loading Pad";
      else if (room <= 0) reason = `You can't stack any higher. Stacks can only be ${FLOOR_STACK_MAX} crates high.`;
      actions.putDown = reason
        ? { tap: say(reason, "#f59e0b"), hold: say(reason, "#f59e0b"), blocked: true, full: room <= 0, reason }
        : {
          tap: () => this.setCratesOnStack(stack, 1),
          hold: () => this.setCratesOnStack(stack, Math.min(room, holding)),
          onStack: true,
        };
    } else {
      actions.putDown = { tap: () => this.dropTopCrate(), hold: () => this.dropWholeStack() };
    }
    return this.addActionHints(actions, stack, holding);
  }

  addActionHints(actions, stack, holding) {
    const pickKey = controlLabel("crate");
    const putKey = controlLabel("putDown");
    const handsFull = `Your hands are full (${MAX_CARRIED_CRATES} crates max)`;
    const pickUp = actions.pickUp;
    const putDown = actions.putDown;
    const pickUpHints = [];
    const putDownHints = [];

    if (stack && pickUp?.combines) {
      const name = database.getItem(stack.marked.itemId)?.name ?? "items";
      pickUpHints.push(pickUp.combines === stack.marked.quantity
        ? `${pickKey}: Move all ${pickUp.combines} ${name} from this crate into yours`
        : `${pickKey}: Move ${pickUp.combines} of the ${stack.marked.quantity} ${name} from this crate into yours (that's all that fits)`);
    } else if (stack && pickUp && !pickUp.blocked) {
      pickUpHints.push(holding >= MAX_CARRIED_CRATES
        ? handsFull
        : `Tap ${pickKey}: Pick up ${this.describeCrate(stack.marked)}`);
      if (pickUp.lifted > 1 && holding + pickUp.lifted <= MAX_CARRIED_CRATES) {
        pickUpHints.push(`Hold ${pickKey}: Pick up ${pickUp.lifted} crates (this one and the ones above it)`);
      }
    }

    if (putDown?.trash) {
      putDownHints.push(`${putKey}: Drop the trash on the floor`);
    } else if (putDown?.separatesRemoteOrder) {
      putDownHints.push(`Tap ${putKey}: Put your top crate down`);
      if (holding > 1) putDownHints.push(`Hold ${putKey}: Put down the remote order crate separately`);
    } else if (putDown?.blocked) {
      putDownHints.push(putDown.reason);
    } else if (putDown?.onStack) {
      putDownHints.push(`Tap ${putKey}: Set your top crate on this stack`);
      if (holding > 1) putDownHints.push(`Hold ${putKey}: Set as many of your crates on this stack as fit`);
    } else if (putDown) {
      putDownHints.push(`Tap ${putKey}: Put your top crate down`);
      if (holding > 1) putDownHints.push(`Hold ${putKey}: Set all ${holding} crates down as a stack`);
    }

    if (pickUp) {
      pickUp.id = "crate-control:pickUp";
      pickUp.action = "pickUp";
      pickUp.kind = "crate-control";
      pickUp.target = stack?.marked ?? null;
      pickUp.perform = pickUp.tap;
      pickUp.hint = pickUpHints.join("\n");
    }
    if (putDown) {
      putDown.id = "crate-control:putDown";
      putDown.action = "putDown";
      putDown.kind = "crate-control";
      putDown.target = stack?.base ?? this.carriedCrate;
      putDown.perform = putDown.tap;
      putDown.hint = putDownHints.join("\n");
    }
    return actions;
  }

  emitCratePickedUp(crate) {
    this.shop.eventBus.emit(GAME_EVENTS.CRATE_PICKED_UP, {
      kind: crate.kind, itemId: crate.itemId, typeId: crate.typeId, quantity: crate.quantity,
    });
  }

  emitCrateDropped(crate, { x, y }, thrown) {
    this.shop.eventBus.emit(GAME_EVENTS.CRATE_DROPPED, {
      kind: crate.kind, itemId: crate.itemId, typeId: crate.typeId, quantity: crate.quantity, thrown, x, y,
    });
  }

  pickUpFromStack({ base, crates, marked }, withAbove) {
    const shop = this.shop;
    const lifted = withAbove ? crates.slice(crates.indexOf(marked)) : [marked];
    if (lifted.some((crate) => crate.kind === "remote-order") &&
      this.getCarriedCrates().some((crate) => crate.kind === "remote-order")) {
      shop.messages.show("Put your delivery crate down before picking up another delivery crate", "#f59e0b");
      return false;
    }
    const above = this.floorStacks.get(base) ?? [];
    if (marked === base) {
      const { x, y } = base.sprite;
      if (!base.pickUp(shop.player.sprite)) {
        shop.messages.show("Wait for crate to stop", "#f59e0b");
        return false;
      }
      this.restockCrates = this.restockCrates.filter((crate) => crate !== base);
      this.floorStacks.delete(base);
      const [newBase, ...rest] = withAbove ? [] : above;
      if (newBase) {
        newBase.drop(x, y, 0, 0, this.motionPaused);
        this.restockCrates.push(newBase);
        for (const crate of rest) crate.setStackedOn(newBase.id);
        if (rest.length) this.floorStacks.set(newBase, rest);
      }
    } else {
      const remaining = above.filter((crate) => !lifted.includes(crate));
      if (remaining.length) this.floorStacks.set(base, remaining);
      else this.floorStacks.delete(base);
    }
    for (const crate of lifted) this.addCarriedCrate(crate);
    this.markedStackBase = null;
    this.syncFloorStacks();
    shop.gameState.crates.changed();
    for (const crate of lifted) this.emitCratePickedUp(crate);
    return true;
  }

  setCratesOnStack({ base }, count) {
    const shop = this.shop;
    const stack = this.getCarriedCrates();
    const placed = stack.slice(-count);
    if (base.kind === "remote-order" ||
      this.getCarriedCrates().some((crate) => crate.kind === "remote-order")) {
      shop.messages.show("Remote order crates can't be stacked.", "#f59e0b");
      return false;
    }
    this.carriedCrates = stack.slice(0, -count);
    this.carriedCrate = this.carriedCrates.at(-1) ?? null;
    for (const crate of placed) crate.setStackedOn(base.id);
    this.floorStacks.set(base, [...(this.floorStacks.get(base) ?? []), ...placed]);
    this.markedStackBase = null;
    this.syncCarriedCrate();
    this.syncFloorStacks();
    shop.gameState.crates.changed();
    for (const crate of placed) this.emitCrateDropped(crate, base.sprite, false);
    return true;
  }

  dropTopCrate(throwing = false) {
    const shop = this.shop;
    const crate = this.carriedCrate;
    if (!crate) return false;
    const { x, y } = shop.player.sprite;
    const { x: velocityX, y: velocityY } = shop.player.sprite.body.velocity;
    const position = throwing
      ? crate.findThrowPosition(shop.player.sprite, velocityX, velocityY)
      : crate.findDropPosition(x, y, shop.player.sprite, [], undefined, shop.player.currentFacing);
    if (!position) {
      shop.messages.show(throwing ? "No room to throw crate" : "No room to drop crate", "#94a3b8");
      return false;
    }
    if (throwing) crate.startThrow(shop.player.sprite, velocityX, velocityY);
    else crate.drop(position.x, position.y, 0, 0, this.motionPaused);
    this.restockCrates.push(crate);
    this.removeCarriedCrate(crate);
    this.syncFloorStacks();
    shop.gameState.crates.changed();
    this.emitCrateDropped(crate, position, throwing);
    return true;
  }

  dropWholeStack() {
    const shop = this.shop;
    if (this.getCarriedCrates().some((crate) => crate.kind === "remote-order")) {
      shop.messages.show("Put down the remote order crate separately.", "#f59e0b");
      return false;
    }
    const [bottom, ...rest] = this.getCarriedCrates();
    if (!bottom) return false;
    const position = bottom.findDropPosition(shop.player.sprite.x, shop.player.sprite.y,
      shop.player.sprite, [], undefined, shop.player.currentFacing);
    if (!position) {
      shop.messages.show("No room to set the stack down", "#94a3b8");
      return false;
    }
    bottom.drop(position.x, position.y, 0, 0, this.motionPaused);
    this.restockCrates.push(bottom);
    if (rest.length) {
      for (const crate of rest) crate.setStackedOn(bottom.id);
      this.floorStacks.set(bottom, rest);
    }
    this.carriedCrates = [];
    this.carriedCrate = null;
    this.syncCarriedCrate();
    this.syncFloorStacks();
    shop.gameState.crates.changed();
    for (const crate of [bottom, ...rest]) this.emitCrateDropped(crate, position, false);
    return true;
  }

  // Held crates ride over his head; held trash sits at his hand on the side he faces.
  syncCarriedCrate() {
    const shop = this.shop;
    shop.player.updateCarryPose?.();
    this.getCarriedCrates().forEach((crate, index) =>
      crate.followCarrier?.(shop.player.sprite, index, PLAYER_CRATE_HOLD_OFFSET));
    shop.cleaningSystem?.syncHeldTrash();
  }

  // Floor crates sort with people by their base: anyone whose feet are behind a crate's bottom
  // edge is drawn behind it. The player is also kept behind his own held crates' worth of
  // depth, so nothing he carries pokes through. Crates sitting on a floor crate are drawn on
  // top of it and move with it.
  syncFloorStacks() {
    const player = this.shop.player;
    const body = player?.sprite?.body;
    if (!body) return;
    const inFront = player.sprite.depth + 1 + MAX_CARRIED_CRATES;
    for (const crate of this.restockCrates ?? []) {
      // A crate just leaving the thrower's hands stays drawn over him until it clears him.
      if (crate.throwCarrier || !crate.sprite.body) continue;
      const bottom = crate.sprite.body.bottom;
      const byBase = PEOPLE_DEPTH_BASE + bottom - 0.5;
      crate.sprite.setDepth(body.bottom < bottom ? Math.max(byBase, inFront) : byBase);
    }
    for (const [base, above] of this.floorStacks ?? []) {
      above.forEach((crate, index) => {
        crate.followCarrier(base.sprite, index, CRATE_STACK_SPACING, CRATE_STACK_SPACING);
        // Just over the crate below, never past someone standing a pixel in front.
        crate.sprite.setDepth(base.sprite.depth + 0.01 * (index + 1));
      });
    }
  }

  // Held crates of the same item as `floorCrate` that still have room, top crate first.
  combineTargets(floorCrate) {
    if (floorCrate.kind !== "item" || floorCrate.quantity <= 0) return [];
    return [...this.getCarriedCrates()].reverse().filter((held) => held.kind === "item" &&
      held.quantity > 0 && held.itemId === floorCrate.itemId && held.getRemainingUnitsFor(held.itemId) > 0);
  }

  // How many items from `floorCrate` would fit into the same-item crates you're holding.
  combinableUnits(floorCrate) {
    const room = this.combineTargets(floorCrate)
      .reduce((total, held) => total + held.getRemainingUnitsFor(held.itemId), 0);
    return Math.min(room, Math.max(0, floorCrate.quantity));
  }

  // Moves as many items as fit from the floor crate into your crates; the floor crate stays put.
  combineIntoCarried(floorCrate) {
    const itemId = floorCrate.itemId;
    const name = database.getItem(itemId)?.name ?? "items";
    let moved = 0;
    for (const held of this.combineTargets(floorCrate)) {
      const result = transferItems(floorCrate, held, itemId, held.getRemainingUnitsFor(itemId), {
        eventBus: this.shop.eventBus,
        sourceName: "crate",
        destinationName: "crate",
      });
      moved += result.moved;
    }
    if (moved === 0) return 0;
    const left = floorCrate.quantity;
    this.shop.messages.show(left > 0
      ? `Moved ${moved} ${name} into your crate. ${left} didn't fit and stay in the crate on the floor.`
      : `Moved ${moved} ${name} into your crate. The crate on the floor is now empty.`, "#22c55e");
    return moved;
  }

  // "a crate of 6 Plasma Pistol", for hints.
  describeCrate(crate) {
    if (crate.kind === "fixture") return `the ${getFixtureType(crate.typeId).name} fixture crate`;
    if (crate.kind === "remote-order") return "the remote order crate";
    if (crate.quantity === 0) return "an empty crate";
    return `a crate of ${crate.quantity} ${database.getItem(crate.itemId)?.name ?? "unknown items"}`;
  }

  // Picture, name, and count for the bottom bar and the holding cards.
  describeCrateForFooter(crate) {
    if (crate.kind === "fixture") return { name: `${getFixtureType(crate.typeId).name} fixture`, count: "", image: null };
    if (crate.kind === "remote-order") return {
      name: "Remote order",
      count: `${crate.quantity} items`,
      image: null,
    };
    if (crate.quantity === 0) return { name: "Empty crate", count: "", image: null };
    const item = database.getItem(crate.itemId);
    return { name: item?.name ?? "Unknown item", count: `x${crate.quantity}`, image: item?.image ?? null };
  }

  // The green arrow over the marked crate, plus the bottom bar and holding cards.
  updateCrateMarker() {
    const shop = this.shop;
    const mode = shop.controlMode.getMode();
    const stack = mode === CONTROL_MODES.WALKING || mode === CONTROL_MODES.CARRYING
      ? this.markedFloorStack()
      : null;
    this.pickupMarker.setVisible(Boolean(stack));
    if (stack) {
      const bounds = stack.marked.sprite.getBounds();
      // Points down at the top crate; for crates lower in a stack, points in from the left side.
      if (this.markedFromTop === 0) this.pickupMarker.setAngle(0).setPosition(bounds.centerX, bounds.top - 7);
      else this.pickupMarker.setAngle(-90).setPosition(bounds.left - 7, bounds.centerY);
    }
    const stocking = shop.shelfStockingWindow?.getStockingCrate();
    const cart = shop.hovercartLab;
    const cartInReach = cart?.isInReach() ?? false;
    this.crateFooter.render({
      marked: stack ? this.describeCrateForFooter(stack.marked) : this.describeHoveredShelfForFooter(),
      carried: [...this.getCarriedCrates()].reverse().map((crate) => crate === stocking
        ? { ...this.describeCrateForFooter(crate), stockingNext: true }
        : this.describeCrateForFooter(crate)),
      ...(cart ? {
        cart: [...cart.cartCrates].reverse().map((crate) => ({
          ...this.describeCrateForFooter(crate),
          ...(crate === stocking ? { stockingNext: true } : {}),
          outOfReach: !cartInReach,
        })),
      } : {}),
    });
  }

  // While the shelf window is open, the bar shows the shelf space under the cursor.
  describeHoveredShelfForFooter() {
    const shelf = this.shop.shelfStockingWindow?.getHoveredShelf();
    if (!shelf) return null;
    if (shelf.empty) return { label: "SHELF", name: "Empty shelf space", count: "", image: null };
    const item = database.getItem(shelf.itemId);
    return { label: "SHELF", name: item?.name ?? "Unknown item",
      count: shelf.quantity > 0 ? `x${shelf.quantity}` : "SOLD OUT", image: item?.image ?? null };
  }

  heldEmptyCrates() {
    return this.getCarriedCrates().filter((crate) => crate.kind === "item" && crate.quantity === 0);
  }

  returnEmptyCratesToTrashcan() {
    const shop = this.shop;
    if (!shop.fixtureSystem.getNearbyTrashcan()) {
      shop.messages.show("Move closer to a trashcan.", "#94a3b8");
      return false;
    }
    const empties = this.heldEmptyCrates();
    if (empties.length === 0) {
      shop.messages.show("Only empty crates go in the trashcan.", "#94a3b8");
      return false;
    }
    for (const crate of empties) {
      this.removeCarriedCrate(crate);
      crate.destroy();
    }
    shop.gameState.crates.changed();
    shop.messages.show(empties.length === 1
      ? "Empty crate put in the trashcan."
      : `${empties.length} empty crates put in the trashcan.`, "#10b981");
    return true;
  }

  takeEmptyCrateFromTrashcan() {
    const shop = this.shop;
    if (this.getCarriedCrates().length > 0) {
      shop.messages.show("Put your crates down before taking an empty crate.", "#94a3b8");
      return false;
    }
    const crate = this.createItemCrate(null, 0, shop.player.sprite.x, shop.player.sprite.y);
    if (!crate.pickUp(shop.player.sprite)) {
      crate.destroy();
      throw new Error("A newly supplied empty crate could not be picked up.");
    }
    this.addCarriedCrate(crate);
    shop.gameState.crates.changed();
    shop.messages.show("Took a free empty crate.", "#10b981");
    return true;
  }

  removeRemoteOrderCrate(crate) {
    if (crate?.kind !== "remote-order") throw new TypeError("Expected a remote order crate.");
    if ((this.floorStacks.get(crate) ?? []).length) {
      throw new Error("A remote order crate cannot be removed while other crates are stacked on it.");
    }
    for (const [base, above] of this.floorStacks) {
      const remaining = above.filter((stacked) => stacked !== crate);
      if (remaining.length !== above.length) {
        if (remaining.length) this.floorStacks.set(base, remaining);
        else this.floorStacks.delete(base);
      }
    }
    this.restockCrates = this.restockCrates.filter((candidate) => candidate !== crate);
    this.removeCarriedCrate(crate);
    crate.destroy();
    this.shop.gameState.crates.changed();
  }

  serialize() {
    const payload = (crate, withPosition = false) => {
      if (!crate.id) crate.id = this.createId();
      return withPosition ? crate.serialize() : crate.serializePayload();
    };
    return {
      crates: this.restockCrates.map((crate) => {
        const above = this.floorStacks.get(crate) ?? [];
        return above.length
          ? { ...payload(crate, true), stack: above.map((stacked) => payload(stacked)) }
          : payload(crate, true);
      }),
      carriedCrate: this.carriedCrate ? payload(this.carriedCrate) : null,
      carriedCrates: this.getCarriedCrates().map((crate) => payload(crate)),
    };
  }

  load(data) {
    const shop = this.shop;
    for (const crate of this.getFloorCrates()) crate.destroy();
    for (const crate of this.getCarriedCrates()) crate.destroy();
    if (this.carriedCrate && !this.getCarriedCrates().includes(this.carriedCrate)) this.carriedCrate.destroy();
    this.floorStacks = new Map();
    this.markedStackBase = null;
    this.restockCrates = data.crates.map((entry) => {
      const crate = entry.kind === "fixture"
        ? new Crate(shop, entry.itemId, entry.quantity, entry.x, entry.y,
          { id: entry.id, kind: "fixture", typeId: entry.typeId })
        : entry.kind === "remote-order"
          ? new Crate(shop, null, 0, entry.x, entry.y, {
            id: entry.id,
            kind: "remote-order",
            orderId: entry.orderId,
            requiredItems: entry.requiredItems,
            contents: entry.contents,
          })
        : this.createItemCrate(entry.itemId, entry.quantity, entry.x, entry.y, { id: entry.id });
      crate.applySave(entry);
      const onPad = entry.onPad ?? shop.supply.padRect.contains(entry.x, entry.y);
      if (onPad) crate.lockToPad();
      if (entry.stack?.length) {
        this.floorStacks.set(crate, entry.stack.map((stacked) => {
          const above = this.createItemCrate(stacked.itemId, stacked.quantity, entry.x, entry.y,
            { id: stacked.id });
          above.pickUp(crate.sprite, { stackedOnId: crate.id });
          return above;
        }));
      }
      return crate;
    });
    this.syncFloorStacks();
    const carriedEntries = Array.isArray(data.carriedCrates)
      ? data.carriedCrates
      : data.carriedCrate ? [data.carriedCrate] : [];
    this.carriedCrates = carriedEntries.map((entry) => {
      const crate = entry.kind === "fixture"
        ? new Crate(shop, entry.itemId, entry.quantity, shop.player.sprite.x, shop.player.sprite.y,
          { id: entry.id, kind: "fixture", typeId: entry.typeId })
        : entry.kind === "remote-order"
          ? new Crate(shop, null, 0, shop.player.sprite.x, shop.player.sprite.y, {
            id: entry.id,
            kind: "remote-order",
            orderId: entry.orderId,
            requiredItems: entry.requiredItems,
            contents: entry.contents,
          })
        : this.createItemCrate(entry.itemId, entry.quantity, shop.player.sprite.x, shop.player.sprite.y,
          { id: entry.id });
      if (crate.kind === "remote-order") {
        crate.remoteOrderLidOpen = entry.lidOpen ?? true;
        crate.setRemoteOrderAppearance(crate.isRemoteOrderComplete());
      }
      crate.pickUp(shop.player.sprite, { holderId: "player" });
      return crate;
    });
    this.carriedCrate = this.carriedCrates.at(-1) ?? null;
    this.syncCarriedCrate();
  }
}
