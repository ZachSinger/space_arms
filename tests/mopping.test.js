import assert from "node:assert/strict";
import { test } from "node:test";
import { CleaningSystem } from "../js/modules/cleaning/CleaningSystem.js";
import { CLEANING_TUNING } from "../js/modules/cleaning/Litter.js";
import { randomDirtKind } from "../js/modules/cleaning/DirtField.js";
import { MopMotion, mopPose } from "../js/modules/cleaning/MopAnimation.js";
import { Trash } from "../js/state/slices/Trash.js";
import { AREA } from "../js/world/Areas.js";

function harness() {
  const sprite = {
    setScale() { return this; },
    setDepth() { return this; },
    setPosition() { return this; },
    destroy() { this.destroyed = true; },
  };
  const presses = [];
  const messages = [];
  const shop = {
    textures: { exists: () => true },
    add: { image: () => ({ ...sprite }) },
    areas: { playerArea: AREA.SHOP },
    room: {
      zones: [{ gridX: 0, gridY: 0, gridW: 8, gridH: 8, salesFloor: true }],
      isWalkable: () => true,
    },
    fixtures: { all: () => [], ofKind: () => [] },
    crateSystem: { getCarriedCrates: () => [] },
    shiftClock: { started: false },
    controlMode: { allows: () => true },
    fixtureSystem: { getNearbyTrashcan: () => null },
    checkoutSystem: { operatingRegister: false },
    player: {
      currentFacing: "down",
      sprite: { x: 160, y: 160, body: {
        center: { x: 160, y: 160 }, bottom: 172, velocity: { x: 0, y: 0 },
      } },
    },
    gameState: { trash: new Trash(), reputation: { shopLevel: 1 } },
    worldElapsedMs: 0,
    messages: { show: (text) => messages.push(text) },
  };
  const cleaning = new CleaningSystem(shop);
  const mops = [];
  cleaning.createMopAnimation = () => {
    const mop = {
      motion: { active: false },
      press(time) { presses.push(time); this.motion.active = true; },
      update() {},
      destroy() { this.destroyed = true; },
    };
    mops.push(mop);
    return mop;
  };
  return { shop, cleaning, presses, messages, mops };
}

test("each dirt mark picks one of all three styles without changing saved styles", () => {
  assert.deepEqual([0, 0.34, 0.67, 1].map((roll) => randomDirtKind(() => roll)),
    ["smudge", "footprints", "scuff", "scuff"]);
  const { cleaning, shop } = harness();
  for (const kind of ["smudge", "footprints", "scuff"]) cleaning.dirt.add(kind, 96, 96, 0.25);
  cleaning.syncSavedDirt();
  const saved = shop.gameState.trash.toSave();
  cleaning.dirt.load(saved.dirt);
  assert.deepEqual(cleaning.dirt.serialize(), saved.dirt);
});

test("mopping reaches dirt in every facing, saves partial work, and restores two cleanliness points", () => {
  const steps = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  for (const [facing, [x, y]] of Object.entries(steps)) {
    const { shop, cleaning, presses } = harness();
    shop.player.currentFacing = facing;
    const mark = cleaning.dirt.add("scuff", 160 + x * 22, 160 + y * 22);
    assert.equal(cleaning.findDirtInFront(), mark, facing);
    assert.equal(cleaning.getCleanliness().score, 18);
    assert.equal(cleaning.mopDirt(mark), true);
    assert.equal(shop.gameState.trash.dirt[0].progress, 1 / CLEANING_TUNING.mopPressesPerSpot);
    for (let index = 1; index < CLEANING_TUNING.mopPressesPerSpot; index += 1) {
      shop.worldElapsedMs += 100;
      assert.equal(cleaning.mopDirt(mark), true);
    }
    assert.equal(cleaning.dirt.count, 0);
    assert.equal(mark.sprite.destroyed, true);
    assert.equal(cleaning.getCleanliness().score, 20);
    assert.equal(presses.length, CLEANING_TUNING.mopPressesPerSpot);
    assert.deepEqual(shop.gameState.trash.dirt, []);
  }
});

test("no bucket needed: facing dirt offers mopping, and the first press brings out the mop", () => {
  const { cleaning, mops } = harness();
  const mark = cleaning.dirt.add("smudge", 160, 182);
  const [action] = cleaning.getActions();
  assert.equal(action.kind, "dirt");
  assert.match(action.hint, /repeatedly to mop this dirt$/);
  assert.equal(cleaning.heldMop, false);
  action.perform();
  assert.equal(cleaning.heldMop, true);
  assert.equal(mops.length, 1);
  action.perform();
  assert.equal(mops.length, 1, "later presses keep the same mop");
  assert.equal(mark.progress, 2 / CLEANING_TUNING.mopPressesPerSpot);
});

test("the mop goes away when the player walks off or the last sweep on a clean mark ends", () => {
  const { shop, cleaning, mops } = harness();
  const mark = cleaning.dirt.add("smudge", 160, 182);
  cleaning.mopDirt(mark);
  shop.player.sprite.body.velocity.x = 160;
  cleaning.update(0, 16);
  assert.equal(cleaning.heldMop, false);
  assert.equal(mops[0].destroyed, true);
  assert.equal(mark.progress, 1 / CLEANING_TUNING.mopPressesPerSpot, "progress stays on the mark");

  shop.player.sprite.body.velocity.x = 0;
  while (cleaning.dirt.count > 0) cleaning.mopDirt(mark);
  cleaning.update(0, 16);
  assert.equal(cleaning.heldMop, true, "the last sweep still plays");
  mops[1].motion.active = false;
  cleaning.update(0, 16);
  assert.equal(cleaning.heldMop, false);
});

test("moving, full hands, and out-of-reach dirt cannot advance cleaning", () => {
  const { shop, cleaning, messages } = harness();
  const mark = cleaning.dirt.add("smudge", 160, 182);
  shop.player.sprite.body.velocity.x = 160;
  assert.equal(cleaning.mopDirt(mark), false);
  assert.equal(mark.progress, 0);
  assert.match(messages.at(-1), /Stand still/);
  shop.player.sprite.body.velocity.x = 0;
  shop.crateSystem.getCarriedCrates = () => [{ id: "crate" }];
  assert.equal(cleaning.mopDirt(mark), false);
  assert.deepEqual(cleaning.getActions(), []);
  shop.crateSystem.getCarriedCrates = () => [];
  shop.player.currentFacing = "up";
  assert.equal(cleaning.mopDirt(mark), false);
  assert.equal(mark.progress, 0);
  assert.equal(cleaning.heldMop, false);
});

test("fast presses produce faster alternating sweeps, and motion settles when presses stop", () => {
  const fast = new MopMotion();
  const slow = new MopMotion();
  for (const motion of [fast, slow]) {
    motion.press(0);
    motion.update(400);
    assert.equal(motion.phase, 1);
  }
  fast.press(100);
  slow.press(600);
  fast.update(50);
  slow.update(50);
  assert.equal(fast.duration, 100);
  assert.equal(slow.duration, 600);
  assert.ok(fast.phase < slow.phase);
  const phase = fast.phase;
  fast.update(0);
  assert.equal(fast.phase, phase, "a paused animation does not move");
  fast.update(400);
  assert.equal(fast.phase, 0);
  assert.equal(fast.active, false);
  fast.press(800);
  fast.update(700);
  assert.equal(fast.phase, 1);
  for (const facing of ["up", "down", "left", "right"]) {
    assert.notDeepEqual(mopPose(facing, 0).head, mopPose(facing, 1).head, facing);
    assert.notDeepEqual(mopPose(facing, 0).hands, mopPose(facing, 1).hands, facing);
    for (const phase of [0, 0.5, 1]) {
      const { head, handle, hands } = mopPose(facing, phase);
      for (const hand of hands) {
        const cross = (hand[0] - handle[0]) * (head[1] - handle[1]) -
          (hand[1] - handle[1]) * (head[0] - handle[0]);
        assert.ok(Math.abs(cross) < 1e-10, `${facing}: hands must grip the mop's handle`);
      }
    }
  }
});
