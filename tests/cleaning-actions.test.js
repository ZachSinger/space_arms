import assert from "node:assert/strict";
import { test } from "node:test";
import { CleaningSystem } from "../js/modules/cleaning/CleaningSystem.js";
import { AREA } from "../js/world/Areas.js";
import { InteractableRegistry } from "../js/interaction/InteractableRegistry.js";

function harness({ carried = [], heldTrash = null, trashcan = null, area = AREA.SHOP } = {}) {
  const player = { currentFacing: "up", sprite: { x: 1168, y: 206 } };
  const calls = [];
  const shop = {
    areas: { playerArea: area },
    player,
    fixtures: { ofKind: (kind) => kind === "trash" && trashcan ? [trashcan] : [] },
    getNearbyTrashcan: () => shop.areas.playerArea === AREA.SHOP ? trashcan : null,
    getCarriedCrates: () => carried,
    heldEmptyCrates: () => carried.filter((crate) => crate.quantity === 0),
    takeEmptyCrateFromTrashcan: () => calls.push("take"),
    returnEmptyCratesToTrashcan: () => calls.push("return"),
  };
  const cleaning = Object.assign(Object.create(CleaningSystem.prototype), { shop, heldTrash });
  cleaning.findTrashInFront = () => null;
  cleaning.pickUpTrash = (piece) => calls.push(piece);
  cleaning.throwAwayHeldTrash = () => calls.push("throw");
  return { cleaning, calls };
}

const nearbyTrashcan = { id: "trash_can_01", type: "trash_can", gx: 18, gy: 2, rotation: 0 };

test("loose trash action shares its hint and pickup behavior", () => {
  const { cleaning, calls } = harness();
  const piece = { id: "trash_1" };
  cleaning.findTrashInFront = () => piece;

  const [action] = cleaning.getActions();
  assert.equal(action.kind, "trash");
  assert.equal(action.target, piece);
  assert.match(action.hint, /Pick up the trash$/);
  action.perform();
  assert.deepEqual(calls, [piece]);
});

test("held trash offers disposal only while facing a nearby trashcan", () => {
  const { cleaning, calls } = harness({
    heldTrash: { id: "trash_held" },
    trashcan: nearbyTrashcan,
  });

  const [action] = cleaning.getActions();
  assert.match(action.hint, /Throw the trash in the trashcan$/);
  action.perform();
  assert.deepEqual(calls, ["throw"]);

  cleaning.shop.areas.playerArea = AREA.BACKROOM;
  assert.deepEqual(cleaning.getActions(), []);
});

test("destroying cleaning unregisters its interactions", () => {
  const interactables = new InteractableRegistry();
  const cleaning = new CleaningSystem({ interactables, textures: { exists: () => true } });
  assert.equal(interactables.providers.has("cleaning"), true);
  cleaning.destroy();
  assert.equal(interactables.providers.has("cleaning"), false);
});
