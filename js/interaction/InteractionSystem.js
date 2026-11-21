import { CONTROL_MODES } from "../input/ControlMode.js";
import { controlLabel } from "../input/InputDevice.js";
import { fixtureFacing } from "../logic/FixtureLayout.js";
import { TILE_SIZE } from "../logic/RoomLayout.js";

export class InteractionSystem {
  constructor(shop) {
    this.shop = shop;
  }

  // Whether the player looks straight at the fixture's front (it faces back at them).
  isPlayerFacingFixture(fixture, player = this.shop.player) {
    const opposite = { down: "up", up: "down", left: "right", right: "left" };
    const facing = (player ?? this.shop.player)?.currentFacing;
    return Boolean(facing) && opposite[facing] === fixtureFacing(fixture);
  }

  // Where the player reaches from: his feet, which must be right up against what he uses.
  getInteractionOrigin() {
    const { x, y, body } = this.shop.player.sprite;
    const feet = body?.left !== undefined
      ? { left: body.left, right: body.right, top: body.top, bottom: body.bottom }
      : { left: x, right: x, top: y, bottom: y };
    return { x, y, feet, facing: this.shop.player.currentFacing };
  }

  /**
   * Gap (px) between the edge of the player's feet that faces `rect` and that rect, when he
   * faces it with his feet lined up with it (at least partly); Infinity otherwise.
   * @param {{ feet: object, facing: string }} origin - from getInteractionOrigin()
   * @param {{ left: number, right: number, top: number, bottom: number }} rect - px
   */
  feetReachTo({ feet, facing }, rect) {
    const acrossX = feet.right > rect.left && feet.left < rect.right;
    const acrossY = feet.bottom > rect.top && feet.top < rect.bottom;
    const gap = {
      up: acrossX ? feet.top - rect.bottom : NaN,
      down: acrossX ? rect.top - feet.bottom : NaN,
      left: acrossY ? feet.left - rect.right : NaN,
      right: acrossY ? rect.left - feet.right : NaN,
    }[facing];
    // A small negative gap is fine: his feet may tuck slightly under the art.
    return Number.isFinite(gap) && gap >= -TILE_SIZE / 2 ? Math.max(0, gap) : Infinity;
  }

  // The nearest reachable shelf, shared by crate delivery and fixture opening.
  getNearbyFixture() {
    return this.shop.interactables.findTarget("fixture", this.getInteractionOrigin())?.target ?? null;
  }

  getFixtureMoveAction() {
    return this.shop.interactables.findTarget(
      "moveFixture",
      this.getInteractionOrigin(),
      null,
      this.shop.player,
      this.shop.input,
      "fixture-move",
    );
  }

  getRegisterInteractionAction() {
    return this.shop.interactables.getActions(
      this.shop.player,
      this.shop.input,
      this.getInteractionOrigin(),
    ).find((action) => action.kind === "register" && action.action === "interact");
  }

  getPortalInteractionAction() {
    return this.shop.interactables.findTarget(
      "interact",
      this.getInteractionOrigin(),
      null,
      this.shop.player,
      this.shop.input,
      "portal",
    );
  }

  getCrateControlAction(which) {
    return this.shop.interactables.findTarget(
      which,
      this.getInteractionOrigin(),
      null,
      this.shop.player,
      this.shop.input,
      "crate-control",
    );
  }

  handleInteract() {
    const shop = this.shop;
    if (!shop.controlMode.allows("interact")) return;
    if (shop.checkoutSystem.operatingRegister) {
      const action = this.getRegisterInteractionAction();
      if (action?.perform) action.perform();
      else shop.checkoutSystem.endRegisterSession();
      return;
    }

    const action = shop.interactables.findTarget("interact", this.getInteractionOrigin());
    if (action?.perform) {
      action.perform();
      return;
    }
    if (shop.heldTrash) {
      shop.showGameMessage(`Face a trashcan and press ${controlLabel("interact")} to throw the trash away, ` +
        `or press ${controlLabel("putDown")} to drop it.`, "#94a3b8");
      return;
    }
    if (shop.carriedCrate?.kind === "fixture") {
      throw new Error("A carried fixture crate has no placement action.");
    }
    if (shop.carriedCrate?.kind === "item") {
      const nearby = this.getNearbyFixture();
      if (nearby) throw new Error(`Fixture "${nearby.id}" has no interaction action.`);
      shop.showGameMessage(shop.fixtureSystem.getNearbyTrashcan()
        ? "Only empty crates go in the trashcan."
        : "Too far from a shelf", "#94a3b8");
      return;
    }

    shop.showGameMessage("Nothing nearby to interact with", "#94a3b8");
  }

  updateHint() {
    const shop = this.shop;
    const lines = [];
    const mode = shop.controlMode.getMode();
    if (shop.checkoutWindow?.usesSpaceKey()) {
      lines.push(`${controlLabel("handOverChange")}: Hand over change`);
    } else if (mode === CONTROL_MODES.REGISTER) {
      const action = this.getRegisterInteractionAction();
      lines.push(action?.hint ?? `${controlLabel("interact")}: Leave the register`);
    } else if (mode === CONTROL_MODES.WALKING || mode === CONTROL_MODES.CARRYING) {
      const portalAction = this.getPortalInteractionAction();
      if (portalAction) {
        lines.push(portalAction.hint);
      } else if (mode === CONTROL_MODES.WALKING && !shop.heldTrash && !shop.cleaningSystem?.findTrashInFront()) {
        const interactable = shop.interactables.findTarget("interact", this.getInteractionOrigin());
        if (interactable?.hint && interactable.kind !== "trash" && interactable.kind !== "trashcan") {
          lines.push(...interactable.hint.split("\n"));
        }
      }

      const stack = shop.crateSystem.markedFloorStack();
      const nearTrashcan = Boolean(shop.fixtureSystem.getNearbyTrashcan());
      const availableActions = shop.interactables.getActions(
        shop.player,
        shop.input,
        this.getInteractionOrigin(),
      );
      const cleaningActions = availableActions.filter((action) => action.kind === "trash" || action.kind === "trashcan");
      const crateActions = availableActions.filter((action) => action.kind === "crate-control");
      for (const action of cleaningActions) lines.push(action.hint);
      for (const action of crateActions) {
        if (action.hint) lines.push(...action.hint.split("\n"));
      }
      if (stack?.crates.length > 1) lines.push(`${controlLabel("nextCrate")}: Move the arrow one crate down`);
      const trashcanTakesE = nearTrashcan && shop.crateSystem.heldEmptyCrates().length > 0;
      if (!trashcanTakesE && shop.carriedCrate?.kind === "item") {
        const nearby = this.getNearbyFixture();
        if (nearby) {
          const action = shop.interactables.findTarget("interact", this.getInteractionOrigin(), nearby);
          if (action) lines.push(action.hint);
        }
      } else if (shop.carriedCrate?.kind === "fixture") {
        const action = availableActions.find((candidate) => candidate.kind === "fixture-placement");
        if (action?.hint) lines.push(action.hint);
      }
      const moveAction = availableActions.find((action) => action.kind === "fixture-move");
      if (moveAction) lines.push(moveAction.hint);
    }
    shop.messages.setHint([...new Set(lines)].join("\n"));
  }
}
