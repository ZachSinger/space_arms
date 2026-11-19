import { CONTROL_MODES } from "../input/ControlMode.js";
import { controlLabel } from "../input/InputDevice.js";

export class InteractionSystem {
  constructor(shop) {
    this.shop = shop;
  }

  handleInteract() {
    const shop = this.shop;
    if (!shop.controlMode.allows("interact")) return;
    if (shop.checkoutSystem.operatingRegister) {
      const action = shop.getRegisterInteractionAction();
      if (action?.perform) action.perform();
      else shop.checkoutSystem.endRegisterSession();
      return;
    }

    const action = shop.interactables.findTarget("interact", shop.getInteractionOrigin());
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
      const nearby = shop.getNearbyFixture();
      if (nearby) throw new Error(`Fixture "${nearby.id}" has no interaction action.`);
      shop.showGameMessage(shop.isNearTrashcan()
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
      const action = shop.getRegisterInteractionAction();
      lines.push(action?.hint ?? `${controlLabel("interact")}: Leave the register`);
    } else if (mode === CONTROL_MODES.WALKING || mode === CONTROL_MODES.CARRYING) {
      const portalAction = shop.getPortalInteractionAction();
      if (portalAction) {
        lines.push(portalAction.hint);
      } else if (mode === CONTROL_MODES.WALKING && !shop.heldTrash && !shop.findTrashInFront()) {
        const interactable = shop.interactables.findTarget("interact", shop.getInteractionOrigin());
        if (interactable?.hint && interactable.kind !== "trash" && interactable.kind !== "trashcan") {
          lines.push(...interactable.hint.split("\n"));
        }
      }

      const stack = shop.markedFloorStack();
      const nearTrashcan = shop.isNearTrashcan();
      const availableActions = shop.interactables.getActions(
        shop.player,
        shop.input,
        shop.getInteractionOrigin(),
      );
      const cleaningActions = availableActions.filter((action) => action.kind === "trash" || action.kind === "trashcan");
      const crateActions = availableActions.filter((action) => action.kind === "crate-control");
      for (const action of cleaningActions) lines.push(action.hint);
      for (const action of crateActions) {
        if (action.hint) lines.push(...action.hint.split("\n"));
      }
      if (stack?.crates.length > 1) lines.push(`${controlLabel("nextCrate")}: Move the arrow one crate down`);
      const trashcanTakesE = nearTrashcan && shop.heldEmptyCrates().length > 0;
      if (!trashcanTakesE && shop.carriedCrate?.kind === "item") {
        const nearby = shop.getNearbyFixture();
        if (nearby) {
          const action = shop.interactables.findTarget("interact", shop.getInteractionOrigin(), nearby);
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
