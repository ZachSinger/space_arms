import assert from "node:assert/strict";
import { startGame } from "./harness.mjs";

const h = await startGame({ port: 5397 });
try {
  await h.newGame();
  const bucketId = await h.game((scene) => {
    const system = scene.fixtureSystem;
    if (!system.buy("mop_bucket")) throw new Error("Could not buy the mop bucket.");
    const crate = scene.restockCrates.find((entry) => entry.typeId === "mop_bucket");
    if (!crate) throw new Error("Mop bucket was not delivered.");
    scene.restockCrates = scene.restockCrates.filter((entry) => entry !== crate);
    scene.crateSystem.addCarriedCrate(crate);
    const cell = system.findNearestCell("mop_bucket", { gx: 19, gy: 3 });
    if (!cell) throw new Error("No space to place the mop bucket.");
    if (!system.placeFromCrate(crate, cell.gx, cell.gy)) throw new Error("Bucket placement failed.");
    return scene.fixtures.ofKind("mop")[0].id;
  });

  const faceBucket = () => h.game(async (scene) => {
    const { fixtureBounds } = await import("/js/logic/FixtureLayout.js");
    const bucket = scene.fixtures.ofKind("mop")[0];
    scene.player.teleportTo(bucket.x, fixtureBounds(bucket).bottom * 64 + 6);
    scene.player.forceFacing("up");
  });
  await faceBucket();
  await h.page.keyboard.press("e");
  assert.equal(await h.game((scene) => scene.cleaningSystem.heldMop?.id), bucketId);

  const blocked = await h.game((scene) => {
    const cleaning = scene.cleaningSystem;
    const bucket = cleaning.heldMop;
    const trash = cleaning.trash.add("can", 980, 280);
    const pickedUp = cleaning.pickUpTrash(trash);
    cleaning.trash.take(trash);
    trash.sprite.destroy();
    const crateBlocked = scene.crateSystem.getActions().pickUp.blocked;
    const move = scene.fixtureSystem.moveAreaBlockReason(bucket);
    const crate = scene.fixtureSystem.crateBlockReason(bucket);
    const sell = scene.fixtureSystem.saleBlockReason(bucket);
    scene.checkoutSystem.beginRegisterSession(scene.fixtures.ofKind("register")[0]);
    return { pickedUp, crateBlocked, move, crate, sell, register: scene.checkoutSystem.operatingRegister };
  });
  assert.equal(blocked.pickedUp, false);
  assert.equal(blocked.crateBlocked, true);
  assert.equal(blocked.register, false);
  for (const reason of [blocked.move, blocked.crate, blocked.sell]) assert.match(reason, /Put the mop back/);

  for (const [index, facing] of ["up", "down", "left", "right"].entries()) {
    const before = await h.game((scene, { facing, index }) => {
      const steps = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
      scene.player.teleportTo(980, 280);
      scene.player.forceFacing(facing);
      const [x, y] = steps[facing];
      const center = scene.player.sprite.body.center;
      const mark = scene.cleaningSystem.dirt.add(["smudge", "footprints", "scuff"][index % 3],
        center.x + x * 22, center.y + y * 22);
      if (scene.cleaningSystem.findDirtInFront() !== mark) throw new Error(`Unreachable dirt facing ${facing}.`);
      return scene.cleaningSystem.getCleanliness().score;
    }, { facing, index });
    await h.page.keyboard.down("e");
    await h.wait(1000);
    await h.page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown",
      { key: "e", code: "KeyE", repeat: true, bubbles: true })));
    await h.wait(30);
    assert.equal(await h.game((scene) => scene.cleaningSystem.dirt.pieces[0].progress), 1 / 8);
    await h.page.keyboard.up("e");
    await h.page.keyboard.press("e");
    await h.wait(600);
    await h.page.keyboard.press("e");
    const slow = await h.game((scene) => scene.cleaningSystem.mopAnimation.motion.duration);
    await h.wait(120);
    await h.page.keyboard.press("e");
    const fast = await h.game((scene) => scene.cleaningSystem.mopAnimation.motion.duration);
    assert.ok(fast < slow, `${facing}: faster pressing did not speed up mopping (${fast}/${slow}).`);
    await h.wait(30);
    const animated = await h.game((scene) => ({
      key: scene.player.sprite.texture.key,
      width: scene.player.sprite.displayWidth,
      height: scene.player.sprite.displayHeight,
      frame: scene.player.sprite.frame.name,
      facing: scene.player.currentFacing,
    }));
    assert.equal(animated.key, "player_mechanic_mopping");
    assert.equal(animated.width, 64);
    assert.equal(animated.height, 64);
    assert.equal(animated.facing, facing);
    const row = { down: 0, left: 1, right: 2, up: 3 }[facing];
    assert.ok(animated.frame >= row * 8 && animated.frame < (row + 1) * 8);
    if (index === 0) {
      const phase = await h.game((scene) => {
        scene.setGamePaused(true);
        return scene.cleaningSystem.mopAnimation.motion.phase;
      });
      await h.wait(200);
      assert.equal(await h.game((scene) => scene.cleaningSystem.mopAnimation.motion.phase), phase);
      await h.game((scene) => scene.setGamePaused(false));
      await h.page.keyboard.down("d");
      await h.wait(100);
      await h.page.keyboard.up("d");
      assert.equal(await h.game((scene) => scene.cleaningSystem.mopAnimation.motion.active), false);
      await h.game((scene) => {
        scene.player.teleportTo(980, 280);
        scene.player.forceFacing("up");
      });
    }
    for (let press = 4; press < 8; press += 1) {
      await h.wait(120);
      await h.page.keyboard.press("e");
    }
    assert.equal(await h.game((scene) => scene.cleaningSystem.dirt.count), 0);
    assert.equal(await h.game((scene) => scene.cleaningSystem.getCleanliness().score), before + 2);
    await h.wait(1000);
    assert.equal(await h.game((scene) => scene.cleaningSystem.mopAnimation.motion.active), false);
    console.log(`Mopping ${facing}: held key ignored; ${Math.round(slow)}ms slow / ${Math.round(fast)}ms fast sweep.`);
  }

  await faceBucket();
  await h.page.keyboard.press("e");
  assert.equal(await h.game((scene) => scene.cleaningSystem.heldMop), null);
  assert.equal(await h.game((scene) => scene.player.sprite.texture.key), "player_mechanic");
  await h.page.keyboard.press("e");
  assert.equal(await h.game((scene) => scene.cleaningSystem.heldMop?.id), bucketId);
  const saved = await h.game((scene) => {
    for (const [index, kind] of ["smudge", "footprints", "scuff"].entries()) {
      scene.cleaningSystem.dirt.add(kind, 980 + index * 40, 280, index / 8);
    }
    scene.cleaningSystem.syncSavedDirt();
    return scene.saves.serialize();
  });
  await h.loadSave(saved);
  const loaded = await h.game((scene) => ({
    dirt: scene.cleaningSystem.dirt.serialize(),
    heldMop: scene.cleaningSystem.heldMop,
    buckets: scene.fixtures.ofKind("mop").length,
  }));
  assert.deepEqual(loaded.dirt, saved.dirt);
  assert.equal(loaded.heldMop, null);
  assert.equal(loaded.buckets, 1);

  const uniforms = await h.game(async (scene) => {
    const { MopAnimation } = await import("/js/modules/cleaning/MopAnimation.js");
    const response = await fetch("/data/EmployeeCharacterManifest.json");
    if (!response.ok) throw new Error("Could not load employee artwork manifest.");
    const manifest = await response.json();
    for (const { key } of manifest) {
      const sprite = scene.add.sprite(980, 280, key, 1).setDisplaySize(64, 64).setOrigin(0.5, 50 / 64);
      const actor = { sprite, currentFacing: "down" };
      const animation = new MopAnimation(scene, actor);
      for (const facing of ["down", "left", "right", "up"]) {
        actor.currentFacing = facing;
        animation.press(0);
        animation.update(200);
        if (sprite.texture.key !== `${key}_mopping` || sprite.displayWidth !== 64) {
          throw new Error(`Invalid employee mopping artwork: ${key}/${facing}.`);
        }
      }
      animation.destroy();
      if (sprite.texture.key !== key) throw new Error(`Employee artwork was not restored: ${key}.`);
      sprite.destroy();
    }
    return manifest.length;
  });
  assert.equal(uniforms, 6);
  await h.game((scene) => {
    scene.debugTools.quickstart({ shelfCount: 2, itemCount: 8 });
    scene.shift.start();
  });
  await h.page.waitForFunction(() => window.__game.scene.getScene("scene-game").shiftClock.started);
  const dropped = await h.game((scene) => {
    scene.customerFlow.spawn();
    const customer = scene.customers.at(-1);
    customer.sprite.body.reset(980, 280);
    customer.trashDropAtWalkMs = null;
    customer.dirtDropAtWalkMs = 0;
    customer.trashWalkMs = 0;
    const before = scene.cleaningSystem.dirt.count;
    customer.updateTrashDrop(16);
    const after = scene.cleaningSystem.dirt.count;
    customer.updateTrashDrop(1000);
    return { before, after, again: scene.cleaningSystem.dirt.count, timer: customer.dirtDropAtWalkMs };
  });
  assert.equal(dropped.after, dropped.before + 1);
  assert.equal(dropped.again, dropped.after);
  assert.equal(dropped.timer, null);
  assert.deepEqual(h.errors(), []);
  console.log(`Bucket purchase/placement, return, carry restrictions, dirt saves, and all ${uniforms} employee uniforms passed.`);
} finally {
  await h.close();
}
