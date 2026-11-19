import { database } from "../scenes/boot.js";
import { Crate } from "../logic/Crate.js";
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
    if (shop.interactables) this.registerInteractions();
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

  getCarriedCrates() {
    if (Array.isArray(this.carriedCrates)) return this.carriedCrates;
    return this.carriedCrate ? [this.carriedCrate] : [];
  }

  getStockableCrates() {
    return this.getCarriedCrates();
  }

  addCarriedCrate(crate) {
    crate.setCarriedBy("player");
    const stack = this.getCarriedCrates();
    stack.push(crate);
    this.carriedCrates = stack;
    this.carriedCrate = crate;
    this.shop.syncCarriedCrate();
  }

  removeCarriedCrate(crate) {
    const stack = this.getCarriedCrates();
    const index = stack.indexOf(crate);
    if (index < 0) return false;
    stack.splice(index, 1);
    this.carriedCrates = stack;
    if (this.carriedCrate === crate) this.carriedCrate = stack.at(-1) ?? null;
    this.shop.syncCarriedCrate();
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
    const say = (message, color = "#94a3b8") => () => shop.showGameMessage(message, color);
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
        putDown: { tap: () => shop.dropHeldTrash(), trash: true },
      }, null, holding);
    }

    const actions = {};
    const stack = this.markedFloorStack();
    if (stack) {
      const lifted = stack.crates.length - stack.crates.indexOf(stack.marked);
      if (stack.marked.kind === "fixture" && holding > 0) {
        actions.pickUp = { tap: say("Put your crates down before picking up a fixture crate"), blocked: true };
      } else if (top?.kind === "fixture") {
        actions.pickUp = { tap: say("Put the fixture crate down before picking up another crate"), blocked: true };
      } else if (shop.combinableUnits(stack.marked) > 0) {
        actions.pickUp = {
          tap: () => shop.combineIntoCarried(stack.marked),
          hold: () => shop.combineIntoCarried(stack.marked),
          combines: shop.combinableUnits(stack.marked),
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
    } else if (holding === 1) {
      actions.pickUp = { tap: () => shop.throwTopCrate(), throws: true };
    } else if (holding > 1) {
      actions.pickUp = { tap: say("You can only throw a crate when you're holding just one.", "#94a3b8") };
    } else {
      actions.pickUp = {
        tap: shop.findCrateInFront({ moving: true })
          ? say("Wait for crate to stop", "#f59e0b")
          : say("No crate nearby"),
      };
    }

    if (holding === 0) {
      // Nothing to put down.
    } else if (stack && top.kind !== "fixture") {
      const room = FLOOR_STACK_MAX - stack.crates.length;
      let reason = null;
      if (stack.base.kind === "fixture") reason = "Crates can't be stacked on a fixture crate";
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
      actions.putDown = { tap: () => shop.dropTopCrate(), hold: () => shop.dropWholeStack() };
    }
    return this.addActionHints(actions, stack, holding);
  }

  addActionHints(actions, stack, holding) {
    const shop = this.shop;
    const pickKey = controlLabel("crate");
    const putKey = controlLabel("putDown");
    const handsFull = `Your hands are full (${MAX_CARRIED_CRATES} crates max)`;
    const pickUp = actions.pickUp;
    const putDown = actions.putDown;
    const pickUpHints = [];
    const putDownHints = [];

    if (pickUp?.throws) {
      const { x, y } = shop.player.sprite.body.velocity;
      if (x !== 0 || y !== 0) pickUpHints.push(`${pickKey}: Throw your crate`);
    } else if (stack && pickUp?.combines) {
      const name = database.getItem(stack.marked.itemId)?.name ?? "items";
      pickUpHints.push(pickUp.combines === stack.marked.quantity
        ? `${pickKey}: Move all ${pickUp.combines} ${name} from this crate into yours`
        : `${pickKey}: Move ${pickUp.combines} of the ${stack.marked.quantity} ${name} from this crate into yours (that's all that fits)`);
    } else if (stack && pickUp && !pickUp.blocked) {
      pickUpHints.push(holding >= MAX_CARRIED_CRATES
        ? handsFull
        : `Tap ${pickKey}: Pick up ${shop.describeCrate(stack.marked)}`);
      if (pickUp.lifted > 1 && holding + pickUp.lifted <= MAX_CARRIED_CRATES) {
        pickUpHints.push(`Hold ${pickKey}: Pick up ${pickUp.lifted} crates (this one and the ones above it)`);
      }
    }

    if (putDown?.trash) {
      putDownHints.push(`${putKey}: Drop the trash on the floor`);
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
      pickUp.target = stack?.marked ?? (pickUp.throws ? this.carriedCrate : null);
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
    const above = this.floorStacks.get(base) ?? [];
    if (marked === base) {
      const { x, y } = base.sprite;
      if (!base.pickUp(shop.player.sprite)) {
        shop.showGameMessage("Wait for crate to stop", "#f59e0b");
        return false;
      }
      this.restockCrates = this.restockCrates.filter((crate) => crate !== base);
      this.floorStacks.delete(base);
      const [newBase, ...rest] = withAbove ? [] : above;
      if (newBase) {
        newBase.drop(x, y, 0, 0, shop.crateMotionPaused);
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
    shop.syncFloorStacks();
    shop.gameState.crates.changed();
    for (const crate of lifted) this.emitCratePickedUp(crate);
    return true;
  }

  setCratesOnStack({ base }, count) {
    const shop = this.shop;
    const stack = this.getCarriedCrates();
    const placed = stack.slice(-count);
    this.carriedCrates = stack.slice(0, -count);
    this.carriedCrate = this.carriedCrates.at(-1) ?? null;
    for (const crate of placed) crate.setStackedOn(base.id);
    this.floorStacks.set(base, [...(this.floorStacks.get(base) ?? []), ...placed]);
    this.markedStackBase = null;
    shop.syncCarriedCrate();
    shop.syncFloorStacks();
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
      shop.showGameMessage(throwing ? "No room to throw crate" : "No room to drop crate", "#94a3b8");
      return false;
    }
    if (throwing) crate.startThrow(shop.player.sprite, velocityX, velocityY);
    else crate.drop(position.x, position.y, 0, 0, shop.crateMotionPaused);
    this.restockCrates.push(crate);
    this.removeCarriedCrate(crate);
    shop.syncFloorStacks();
    shop.gameState.crates.changed();
    this.emitCrateDropped(crate, position, throwing);
    return true;
  }

  dropWholeStack() {
    const shop = this.shop;
    const [bottom, ...rest] = this.getCarriedCrates();
    if (!bottom) return false;
    const position = bottom.findDropPosition(shop.player.sprite.x, shop.player.sprite.y,
      shop.player.sprite, [], undefined, shop.player.currentFacing);
    if (!position) {
      shop.showGameMessage("No room to set the stack down", "#94a3b8");
      return false;
    }
    bottom.drop(position.x, position.y, 0, 0, shop.crateMotionPaused);
    this.restockCrates.push(bottom);
    if (rest.length) {
      for (const crate of rest) crate.setStackedOn(bottom.id);
      this.floorStacks.set(bottom, rest);
    }
    this.carriedCrates = [];
    this.carriedCrate = null;
    shop.syncCarriedCrate();
    shop.syncFloorStacks();
    shop.gameState.crates.changed();
    for (const crate of [bottom, ...rest]) this.emitCrateDropped(crate, position, false);
    return true;
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
    shop.syncFloorStacks();
    const carriedEntries = Array.isArray(data.carriedCrates)
      ? data.carriedCrates
      : data.carriedCrate ? [data.carriedCrate] : [];
    this.carriedCrates = carriedEntries.map((entry) => {
      const crate = entry.kind === "fixture"
        ? new Crate(shop, entry.itemId, entry.quantity, shop.player.sprite.x, shop.player.sprite.y,
          { id: entry.id, kind: "fixture", typeId: entry.typeId })
        : this.createItemCrate(entry.itemId, entry.quantity, shop.player.sprite.x, shop.player.sprite.y,
          { id: entry.id });
      crate.pickUp(shop.player.sprite, { holderId: "player" });
      return crate;
    });
    this.carriedCrate = this.carriedCrates.at(-1) ?? null;
    shop.syncCarriedCrate();
  }
}
