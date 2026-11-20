import test from "node:test";
import assert from "node:assert/strict";
import { AREA, Areas } from "../js/world/Areas.js";
import { CameraRig } from "../js/world/CameraRig.js";
import { InteractableRegistry } from "../js/interaction/InteractableRegistry.js";
import { Navigation } from "../js/world/Navigation.js";

function harness() {
  const scene = {
    room: { isWalkable: () => true, navigationWalkabilityKey: () => "shop-floor" },
    interactables: new InteractableRegistry(),
    player: {
      sprite: { x: 120, y: 120 },
      currentFacing: "left",
      teleportTo(x, y) { this.sprite = { x, y }; },
      forceFacing(facing) { this.currentFacing = facing; },
    },
    crateSystem: { syncCarriedCrate() { scene.synced = true; } },
    cameraRig: { refresh() {} },
  };
  const areas = Object.assign(Object.create(Areas.prototype), {
    shop: scene,
    playerArea: AREA.SHOP,
    revision: 0,
    portals: [],
    definitions: new Map([
      [AREA.SHOP, { title: "SALES FLOOR", getBounds: () => ({ x: 0, y: 0, width: 256, height: 256 }) }],
      [AREA.BACKROOM, { title: "BACKROOM", getBounds: () => ({ x: 0, y: 6400, width: 256, height: 256 }) }],
    ]),
  });
  scene.areas = areas;
  areas.registerInteractions();
  return { scene, areas };
}

function registerRange(areas) {
  return areas.registerArea("range", {
    title: "SHOOTING RANGE",
    getBounds: () => ({ x: 1024, y: 0, width: 256, height: 256 }),
    isWalkable: () => true,
    walkabilityKey: () => "range-floor",
  });
}

function connectRange(areas) {
  return areas.registerPortalPair({
    area: AREA.SHOP,
    hint: "Go down to the shooting range",
    door: { x: 128, y: 128 },
    front: { x: 128, y: 128 },
    standingBounds: { x: 112, y: 112, width: 32, height: 32 },
    arrivalFacing: "left",
  }, {
    area: "range",
    hint: "Go up to the shop",
    door: { x: 1152, y: 128 },
    front: { x: 1152, y: 128 },
    standingBounds: { x: 1136, y: 112, width: 32, height: 32 },
    arrivalFacing: "right",
  });
}

test("module stairs use the advertised action only while standing on their footprint", () => {
  const { scene, areas } = harness();
  registerRange(areas);
  connectRange(areas);
  assert.equal(areas.areaAt(1152, 128), "range", "areas use both coordinates, not just their row");
  assert.equal(areas.areaAt(128, 128), AREA.SHOP);
  const target = scene.interactables.findTarget("interact", scene.player.sprite, null, scene.player, {});
  assert.match(target.hint, /Go down to the shooting range/);
  target.perform();
  assert.equal(areas.playerArea, "range");
  assert.deepEqual(scene.player.sprite, { x: 1152, y: 128 });
  assert.equal(scene.player.currentFacing, "right");
  assert.equal(scene.synced, true);
  assert.equal(areas.nearbyPortal(), areas.portals[1]);
  scene.player.sprite.x = 1168;
  assert.equal(areas.nearbyPortal(), null, "standing beside the stairs is not enough");
});

test("routes between module rooms can cross the shop and disappear when the module is removed", () => {
  const { areas } = harness();
  const removeArea = registerRange(areas);
  const removeRange = connectRange(areas);
  const shop = { x: 64, y: 64 };
  const backroom = { x: 64, y: 6464 };
  areas.registerPortalPair(
    { area: AREA.SHOP, door: shop, front: shop, hint: "Go into the backroom" },
    { area: AREA.BACKROOM, door: backroom, front: backroom, hint: "Go back out to the shop" },
  );
  assert.deepEqual(areas.crossings(1152, 128, 64, 6464), [
    { near: { x: 1152, y: 128 }, far: { x: 128, y: 128 } },
    { near: shop, far: backroom },
  ]);
  assert.throws(removeArea, /remove its portals/);
  removeRange();
  removeRange();
  assert.equal(areas.crossings(1152, 128, 64, 6464), null, "a disconnected room is unreachable");
  removeArea();
  const removeReplacement = registerRange(areas);
  removeArea();
  assert.equal(areas.titleFor("range"), "SHOOTING RANGE", "stale cleanup cannot remove a new registration");
  removeReplacement();
});

test("several entrances between the same rooms retain their own matching exits", () => {
  const { scene, areas } = harness();
  registerRange(areas);
  connectRange(areas);
  areas.registerPortalPair(
    { area: AREA.SHOP, door: { x: 200, y: 100 }, front: { x: 200, y: 132 }, hint: "Enter range" },
    { area: "range", door: { x: 1200, y: 100 }, front: { x: 1200, y: 132 }, hint: "Leave range" },
  );
  areas.goThrough(areas.portals[2]);
  assert.deepEqual(scene.player.sprite, { x: 1200, y: 132 });
});

test("scene shutdown releases portal interactions and animations without double cleanup", () => {
  const { scene, areas } = harness();
  registerRange(areas);
  const removePortals = connectRange(areas);
  let destroyed = 0;
  for (const portal of areas.portals) portal.animation = { destroy() { destroyed += 1; } };
  areas.destroy();
  removePortals();
  areas.destroy();
  assert.equal(destroyed, 2);
  assert.equal(scene.interactables.providers.has("portals"), false);
  assert.deepEqual(areas.portals, []);
});

test("module floors participate in navigation and invalidate cached cells when changed or replaced", () => {
  const { areas, scene } = harness();
  let open = true;
  let revision = 0;
  const removeArea = areas.registerArea("range", {
    title: "SHOOTING RANGE",
    getBounds: () => ({ x: 1024, y: 0, width: 256, height: 256 }),
    isWalkable: () => open,
    walkabilityKey: () => String(revision),
  });
  const navigation = new Navigation({
    room: { ...scene.room, wallGroup: { getChildren: () => [] } },
    areas,
    obstacleGroup: { getChildren: () => [] },
    fixtures: { registers: () => [] },
    getStoreDoorBlocker: () => null,
    getRegisterFacing: () => "down",
    registerFrontOverlap: 10,
    defaultBodySize: { width: 22, height: 20 },
  });
  assert.deepEqual(navigation.findPath(1088, 128, 1216, 128), []);
  open = false;
  revision += 1;
  assert.equal(navigation.findPath(1088, 128, 1216, 128), null);
  removeArea();
  registerRange(areas);
  assert.deepEqual(navigation.findPath(1088, 128, 1216, 128), [],
    "replacing a module floor cannot reuse its predecessor's cached blocked cells");
});

test("invalid module areas and portals fail without leaving partial registrations", () => {
  const { areas } = harness();
  assert.throws(() => areas.registerArea("bad", {
    title: "BAD", getBounds: () => ({ x: 1024, y: 0, width: 0, height: 10 }),
    isWalkable: () => true, walkabilityKey: () => "",
  }), /positive dimensions/);
  assert.throws(() => areas.registerArea("overlap", {
    title: "OVERLAP", getBounds: () => ({ x: 128, y: 128, width: 256, height: 256 }),
    isWalkable: () => true, walkabilityKey: () => "",
  }), /overlaps/);
  registerRange(areas);
  assert.throws(() => connectRange({
    registerPortalPair: (first, second) => areas.registerPortalPair(first, { ...second, area: "missing" }),
  }), /registered area/);
  assert.equal(areas.portals.length, 0);
  assert.throws(() => areas.boundsFor("missing"), /Unknown area/);
});

test("the framed camera uses the active module room bounds, title, and point selection", () => {
  const { scene, areas } = harness();
  registerRange(areas);
  areas.playerArea = "range";
  const camera = {
    visible: false,
    setVisible(value) { this.visible = value; return this; },
    setViewport(...args) { this.viewport = args; return this; },
    setZoom(value) { this.zoom = value; return this; },
    setBounds(...args) { this.bounds = args; return this; },
    centerOn(...args) { this.center = args; return this; },
  };
  const title = {};
  const frame = {
    style: {},
    classList: { toggle(_name, hidden) { frame.hidden = hidden; } },
    querySelector: () => title,
  };
  scene.scale = { width: 1600, height: 900 };
  scene.cameras = { main: {} };
  const rig = Object.assign(Object.create(CameraRig.prototype), {
    shop: scene, backroomCamera: camera, backroomFrame: frame,
  });
  rig.refreshBackroomWindow();
  assert.deepEqual(camera.bounds, [1024, 0, 256, 256]);
  assert.equal(title.textContent, "SHOOTING RANGE");
  assert.equal(rig.cameraFor("range"), camera);
  assert.equal(rig.cameraAt(1152, 128), camera);
  assert.equal(rig.cameraAt(128, 128), scene.cameras.main);
  areas.playerArea = AREA.SHOP;
  rig.refreshBackroomWindow();
  assert.equal(camera.visible, false);
  assert.equal(frame.hidden, true);
});
