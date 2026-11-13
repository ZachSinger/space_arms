// ==========================================
// FILE: shelfLab.js
// ==========================================
// Dev harness for prototyping hands-on shelf stocking. Opened from the title screen's DEV
// option. The player walks a small room with a Budget Shelf, crates of every box size, and a
// trash bin. Crates use the shop's controls (pick up, stack, drop, throw). Pressing the
// interact key at the shelf opens an up-close view where items are stocked or pulled one at a
// time from the carried crates, while pretend customers take items off. Nothing here touches
// the saved game.
import Phaser from "phaser";
import { TILE_SIZE } from "../logic/RoomLayout.js";
import { getFixtureType, getShelfDisplayGrid } from "../logic/FixtureLayout.js";
import { getFixtureTexture } from "../logic/FixtureTexture.js";
import { ITEM_CRATE_TINTS, getItemCrateCategory } from "../logic/CrateCategory.js";
import { Crate, INTERACT_RANGE } from "../logic/Crate.js";
import { MAX_CARRIED_CRATES } from "../logic/CrateStack.js";
import { solveCratePush } from "../logic/CratePushing.js";
import { separateOverlappingCrates } from "../logic/CrateSeparation.js";
import { controlLabel } from "../logic/InputDevice.js";
import { Player, PLAYER_CRATE_HOLD_OFFSET } from "../logic/Player.js";
import { Market } from "../logic/Market.js";
import { formatMoney } from "../logic/Money.js";
import boxSizeDraft from "../../documentation/ShelfBoxSizeDraft.csv?raw";
import {
  BOX_SIZES, canStock, canUnstock, createCrate, createSlots, getCrateItemLimit, stockOne, takeOne,
  unstockOne,
} from "../logic/ShelfSlotStocking.js";

const SHELF_TYPE = "shelf_budget_2x4";
// Where each item space sits on the shelf's front-view art, in source-image pixels: one row
// per shelf level (top of its opening down to its board), one column per section.
const SLOT_ART = Object.freeze({
  width: 384,
  height: 192,
  rows: [[48, 88], [92, 132], [136, 172]],
  columns: [[28, 106], [114, 192], [200, 278], [286, 364]],
});
// Board tops support single rows and the raised back row, in source-image pixels.
const BOARD_TOPS = [80, 124, 164];
// Each size uses the agreed packing pattern, measured in shelf-art pixels.
const BOX_LAYOUTS = Object.freeze({
  1: { across: 5, depth: 2, stackedRows: 2, width: 13, height: 16 },
  2: { across: 5, depth: 2, stackedRows: 1, width: 13, height: 34 },
  3: { across: 3, depth: 2, stackedRows: 1, width: 23, height: 34 },
  4: { across: 5, depth: 1, stackedRows: 1, width: 14, height: 36 },
  6: { across: 3, depth: 1, stackedRows: 1, width: 24, height: 36 },
  8: { across: 2, depth: 1, stackedRows: 1, width: 34, height: 36 },
  10: { across: 2, depth: 1, stackedRows: 1, width: 37, height: 36 },
  14: { across: 1, depth: 1, stackedRows: 1, width: 56, height: 36 },
  20: { across: 1, depth: 1, stackedRows: 1, width: 76, height: 38 },
});
// The back row of a space sits a little higher, in shadow, so it peeks out from behind the
// front row.
const BACK_LAYER = Object.freeze({ shiftX: 0, shiftY: 2, tint: 0x8a8a9a });
const CATEGORIES = Object.keys(ITEM_CRATE_TINTS);
const MOVE_INTERVAL_MS = 180;
const CUSTOMER_INTERVAL_MS = 2500;
const MARGIN = TILE_SIZE / 2;
// Space under the up-close shelf for the item card, in px.
const CARD_ROOM = 40;
const HEADER_HEIGHT = 100;
const TEXT_STYLE = { fontFamily: "monospace", fontSize: "14px", color: "#e2e8f0" };
const CARD_PADDING = 3;

// The test room, in floor squares. The shelf stands against the top wall, facing down.
const ROOM = Object.freeze({ columns: 12, rows: 8 });
const SHELF_CELL = Object.freeze({ gx: 5, gy: 1 });
const TRASH = Object.freeze({ x: 10.5 * TILE_SIZE, y: 1.5 * TILE_SIZE, width: 36, height: 44 });
const PLAYER_START = Object.freeze({ x: 6 * TILE_SIZE, y: 3.5 * TILE_SIZE });
// One full crate per box size along one row, and a few empty crates below them.
const FULL_CRATE_ROW_Y = 4.5 * TILE_SIZE;
const EMPTY_CRATE_ROW_Y = 6.5 * TILE_SIZE;
const EMPTY_CRATE_COUNT = 3;

// Item ids grouped by crate category, then by their draft box size.
function buildItemPool(items) {
  const sizes = new Map();
  for (const line of boxSizeDraft.split(/\r?\n/).slice(1)) {
    const cells = line.split('","').map((cell) => cell.replace(/"/g, ""));
    if (cells.length >= 4) sizes.set(cells[0], Number(cells[3]));
  }
  const pool = {};
  for (const item of items) {
    const category = getItemCrateCategory(item.tags);
    const size = sizes.get(item.id);
    if (!category || !BOX_SIZES.includes(size)) continue;
    pool[category] ??= {};
    (pool[category][size] ??= []).push(item.id);
  }
  return pool;
}

export class ShelfLabScene extends Phaser.Scene {
  constructor() {
    super("scene-shelf-lab");
  }

  // Read by Player (with carriedCrates) to switch to the carrying pose and walking speed.
  get carriedCrate() {
    return this.carriedCrates.at(-1) ?? null;
  }

  create() {
    this.input.mouse?.disableContextMenu();
    this.showSlots = true;
    this.worldObjects = [];
    this.uiObjects = [];
    this.roomObjects = [];
    this.closeUpObjects = [];
    this.cardSlot = null;
    this.popupOpen = false;
    // Floor crates are named like the shop's, which Crate reads when finding a clear drop spot.
    this.restockCrates = [];
    this.carriedCrates = [];
    this.controlMode = { allows: () => !this.popupOpen };

    // Drawn in this order: the room, the up-close shelf over it, then the header.
    const viewHeight = this.scale.height - HEADER_HEIGHT;
    this.cameras.main.setViewport(0, HEADER_HEIGHT, this.scale.width, viewHeight)
      .setBackgroundColor("#1e1b4b");
    this.popupCamera = this.cameras.add(0, HEADER_HEIGHT, this.scale.width, viewHeight)
      .setBackgroundColor("rgba(2, 6, 23, 0.82)").setVisible(false);
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);

    const items = this.cache.json.get("items") ?? [];
    this.itemsById = new Map(items.map((item) => [item.id, item]));
    this.market = new Market(items);
    this.itemPool = buildItemPool(items);

    this.roomWidth = ROOM.columns * TILE_SIZE;
    this.roomHeight = ROOM.rows * TILE_SIZE;
    this.physics.world.setBounds(0, 0, this.roomWidth, this.roomHeight);
    this.solids = this.physics.add.staticGroup();
    this.crateBounds = new Phaser.Geom.Rectangle(0, 0, this.roomWidth, this.roomHeight);
    this.crateGroup = this.physics.add.group();
    this.physics.add.collider(this.crateGroup, this.crateGroup, (spriteA, spriteB) => {
      for (const sprite of [spriteA, spriteB]) {
        this.restockCrates.find((crate) => crate.sprite === sprite)?.refreshDrag();
      }
    });
    this.physics.add.collider(this.crateGroup, this.solids);
    this.drawFloor();
    this.placeShelf();
    this.placeTrash();
    this.slotGrid = this.addCloseUp(this.add.graphics().setDepth(3));
    this.createItemCard();

    const slotCount = SLOT_ART.rows.length * SLOT_ART.columns.length;
    this.slots = createSlots(slotCount);
    this.slotBoxes = Array.from({ length: slotCount }, () => []);
    this.layOutCrates();

    this.player = new Player(this, PLAYER_START.x, PLAYER_START.y);
    this.player.sprite.body.setCollideWorldBounds(true);
    this.addRoom(this.player.sprite);
    this.physics.add.collider(this.player.sprite, this.solids);

    this.customersOn = false;
    this.customerTimer = 0;
    this.hold = null;
    this.lastEvent = `Walk to a crate and press ${controlLabel("crate", "keyboard")} to pick it up.`;

    this.header = this.addUi(this.add.rectangle(0, 0, this.scale.width, HEADER_HEIGHT, 0x0f172a, 0.92).setOrigin(0));
    this.helpText = this.addUi(this.add.text(16, 6, "", TEXT_STYLE));
    this.statusText = this.addUi(this.add.text(16, 26, "", { ...TEXT_STYLE, color: "#facc15" }));
    this.promptText = this.addUi(this.add.text(16, 46, "", { ...TEXT_STYLE, color: "#86efac" }));
    let x = 16;
    for (const [label, onClick] of [
      ["[ FRESH CRATES ]", () => this.resetCrates()],
      ["[ SLOT GRID ]", () => this.toggleSlots()],
      ["[ CUSTOMER TAKES ONE ]", () => this.customerTakes()],
      ["[ CUSTOMERS ON/OFF ]", () => this.toggleCustomers()],
      ["[ MENU ]", () => this.scene.start("scene-title")],
    ]) {
      x += this.addButton(x, 72, label, onClick).width + 14;
    }

    this.fitRoom();
    this.fitCloseUp();

    this.input.keyboard.on("keydown-E", () => this.interact());
    this.input.keyboard.on("keydown-SPACE", (event) => {
      event.preventDefault();
      if (!event.repeat && this.controlMode.allows("crate")) this.crateAction()?.run?.();
    });
    this.input.keyboard.on("keydown-G", () => this.toggleSlots());
    this.input.keyboard.on("keydown-F", () => this.fitCloseUp());
    this.input.keyboard.on("keydown-ESC", () => {
      if (this.popupOpen) this.closeShelf();
      else this.scene.start("scene-title");
    });
    this.input.on("wheel", (_pointer, _objects, _dx, dy) => {
      if (!this.popupOpen) return;
      const camera = this.popupCamera;
      camera.setZoom(Phaser.Math.Clamp(camera.zoom * (dy > 0 ? 0.9 : 1.1), 0.5, 12));
    });
    this.input.on("pointerdown", (pointer) => this.startHold(pointer));
    this.input.on("pointerup", () => { this.hold = null; });
    this.input.on("pointermove", (pointer) => {
      if (!pointer.isDown || !this.popupOpen) return;
      if (this.hold) {
        this.hold.slot = this.slotAt(pointer);
        return;
      }
      const camera = this.popupCamera;
      camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
      camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once("shutdown", () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
    this.refresh();
  }

  update(_time, delta) {
    for (const crate of this.restockCrates) crate.updateThrow(delta);
    this.separateStuckCrates();
    this.player.update(delta);
    this.updateCratePushing(delta);
    this.syncCarriedCrates();
    if (this.hold && this.hold.slot !== null) {
      this.hold.timer -= delta;
      if (this.hold.timer <= 0) {
        this.hold.timer = MOVE_INTERVAL_MS;
        this.moveOne(this.hold.slot, this.hold.pulling);
      }
    }
    if (this.customersOn) {
      this.customerTimer -= delta;
      if (this.customerTimer <= 0) {
        this.customerTimer = CUSTOMER_INTERVAL_MS;
        this.customerTakes();
      }
    }
    const prompt = this.popupOpen ? "" : [this.crateAction()?.label, this.currentAction()?.label]
      .filter(Boolean).join("   |   ");
    if (this.promptText.text !== prompt) this.promptText.setText(prompt);
  }

  // --- Room ---

  drawFloor() {
    const floor = this.add.graphics().setDepth(0);
    floor.fillStyle(0x334155).fillRect(0, 0, this.roomWidth, this.roomHeight);
    floor.lineStyle(1, 0x475569, 0.6);
    for (let column = 1; column < ROOM.columns; column += 1) {
      floor.lineBetween(column * TILE_SIZE, 0, column * TILE_SIZE, this.roomHeight);
    }
    for (let row = 1; row < ROOM.rows; row += 1) {
      floor.lineBetween(0, row * TILE_SIZE, this.roomWidth, row * TILE_SIZE);
    }
    floor.lineStyle(4, 0x0f172a).strokeRect(0, 0, this.roomWidth, this.roomHeight);
    this.addRoom(floor);
  }

  // The shelf against the top wall. Its boxes are drawn on it in the room and up close.
  placeShelf() {
    const spec = getFixtureType(SHELF_TYPE);
    const width = spec.w * TILE_SIZE;
    const height = spec.h * TILE_SIZE;
    const x = (SHELF_CELL.gx + spec.w / 2) * TILE_SIZE;
    const y = (SHELF_CELL.gy + spec.h / 2) * TILE_SIZE;
    this.shelf = { spec, x, y, width, height, displayGrid: getShelfDisplayGrid(spec) };
    const sprite = this.add.image(x, y, getFixtureTexture(spec)).setDisplaySize(width, height).setDepth(2);
    this.textures.get(sprite.texture.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.shelf.sprite = sprite;
    this.solids.add(sprite);
    this.addWorld(sprite);
  }

  placeTrash() {
    const bin = this.add.rectangle(TRASH.x, TRASH.y, TRASH.width, TRASH.height, 0x1f2937)
      .setStrokeStyle(2, 0x94a3b8).setDepth(2);
    this.solids.add(bin);
    this.addRoom(bin);
    this.addRoom(this.add.rectangle(TRASH.x, TRASH.y - TRASH.height / 2 + 4, TRASH.width + 6, 8, 0x475569)
      .setDepth(2.1));
    this.addRoom(this.add.text(TRASH.x, TRASH.y + 4, "TRASH", { ...TEXT_STYLE, fontSize: "9px" })
      .setOrigin(0.5).setDepth(2.2));
    this.trash = bin;
  }

  // A full crate of each box size, then a few empty crates.
  layOutCrates() {
    BOX_SIZES.forEach((size, index) => {
      this.spawnCrate(this.fillCrate(CATEGORIES[index % CATEGORIES.length], size),
        (1.5 + index) * TILE_SIZE, FULL_CRATE_ROW_Y);
    });
    for (let index = 0; index < EMPTY_CRATE_COUNT; index += 1) {
      this.spawnCrate(createCrate(), (1.5 + index) * TILE_SIZE, EMPTY_CRATE_ROW_Y);
    }
  }

  // A real shop crate (so it can be pushed, stacked, and thrown) carrying the lab's
  // stocking contents in `lab`.
  spawnCrate(contents, x, y) {
    const crate = new Crate(this, contents.itemId, contents.count, x, y);
    crate.lab = contents;
    this.addRoom(crate.sprite);
    this.tintCrate(crate);
    this.restockCrates.push(crate);
  }

  tintCrate(crate) {
    const tint = ITEM_CRATE_TINTS[crate.lab.category];
    if (tint === undefined) crate.sprite.clearTint();
    else crate.sprite.setTint(tint);
  }

  resetCrates() {
    for (const crate of [...this.restockCrates, ...this.carriedCrates]) crate.destroy();
    this.restockCrates = [];
    this.carriedCrates = [];
    this.player.updateCarryPose?.();
    this.layOutCrates();
    this.lastEvent = "Laid out a fresh set of crates.";
    this.refresh();
  }

  // A full test crate of one real item with the given box size. Uses the requested category
  // when it has an item that size, otherwise the next category that does.
  fillCrate(category, size) {
    const start = Math.max(0, CATEGORIES.indexOf(category));
    const ordered = [...CATEGORIES.slice(start), ...CATEGORIES.slice(0, start)];
    const chosen = ordered.find((name) => this.itemPool[name]?.[size]?.length) ?? category;
    const choices = this.itemPool[chosen]?.[size] ?? [];
    const itemId = choices.length > 0 ? choices[Math.floor(Math.random() * choices.length)] : null;
    return createCrate(chosen, getCrateItemLimit(size), size, itemId);
  }

  // What the interact key does right now: use the shelf or the trash.
  currentAction() {
    const key = controlLabel("interact", "keyboard");
    const target = this.nearestTarget(["shelf", "trash"]);
    const top = this.carriedCrate;
    if (target?.kind === "shelf") {
      return { label: `${key}: ${top ? "Stock the shelf" : "Look at the shelf"}`, run: () => this.openShelf() };
    }
    if (target?.kind === "trash" && top) {
      return top.lab.count > 0
        ? { label: "Only empty crates can go in the trash", run: null }
        : { label: `${key}: Throw the empty crate on top in the trash`, run: () => this.trashTop() };
    }
    return null;
  }

  // What the crate key does right now, matching the shop: pick up, stack, set down, or throw.
  crateAction() {
    const key = controlLabel("crate", "keyboard");
    const floorCrate = this.nearestTarget(["crate"])?.crate ?? null;
    const stackSize = this.carriedCrates.length;
    if (floorCrate && stackSize < MAX_CARRIED_CRATES) {
      const verb = stackSize > 0 ? "Stack" : "Pick up";
      return { label: `${key}: ${verb} ${this.describeCrate(floorCrate)}`, run: () => this.pickUp(floorCrate) };
    }
    if (stackSize === 0) return null;
    if (floorCrate) {
      return {
        label: `You can only carry ${MAX_CARRIED_CRATES} crates`,
        run: () => {
          this.lastEvent = `You can only carry ${MAX_CARRIED_CRATES} crates.`;
          this.refresh();
        },
      };
    }
    return {
      label: `${key}: ${stackSize > 1 ? "Set the stack down" : "Put the crate down (throw it while walking)"}`,
      run: () => this.dropCarried(),
    };
  }

  interact() {
    if (this.popupOpen) {
      this.closeShelf();
      return;
    }
    this.currentAction()?.run?.();
  }

  // The closest target of the given kinds within reach of the player's feet.
  nearestTarget(kinds) {
    const { center } = this.player.sprite.body;
    const targets = [
      { kind: "shelf", bounds: this.shelf.sprite.getBounds() },
      { kind: "trash", bounds: this.trash.getBounds() },
      ...this.restockCrates.filter((crate) => crate.canPickUp())
        .map((crate) => ({ kind: "crate", crate, bounds: crate.sprite.getBounds() })),
    ].filter((target) => kinds.includes(target.kind));
    let best = null;
    let bestDistance = INTERACT_RANGE;
    for (const target of targets) {
      const { left, right, top, bottom } = target.bounds;
      const dx = Math.max(left - center.x, 0, center.x - right);
      const dy = Math.max(top - center.y, 0, center.y - bottom);
      const distance = Math.hypot(dx, dy);
      if (distance <= bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    return best;
  }

  describeCrate(crate) {
    const { count, itemId } = crate.lab;
    return count > 0 ? `a crate of ${count} ${this.itemName(itemId)}` : "an empty crate";
  }

  describeCarried() {
    if (this.carriedCrates.length === 0) return "nothing";
    return [...this.carriedCrates].reverse().map((crate) => this.describeCrate(crate)).join(", ");
  }

  syncCarriedCrates() {
    this.player.updateCarryPose?.();
    this.carriedCrates.forEach((crate, index) =>
      crate.followCarrier(this.player.sprite, index, PLAYER_CRATE_HOLD_OFFSET));
  }

  pickUp(crate) {
    if (!crate.pickUp(this.player.sprite)) return;
    this.restockCrates = this.restockCrates.filter((candidate) => candidate !== crate);
    this.carriedCrates.push(crate);
    this.syncCarriedCrates();
    this.lastEvent = `${this.carriedCrates.length > 1 ? "Stacked" : "Picked up"} ${this.describeCrate(crate)}.`;
    this.refresh();
  }

  // Like the shop: one crate is thrown if the player is walking, otherwise set down; a stack
  // is always set down.
  dropCarried() {
    const stack = this.carriedCrates;
    if (stack.length === 1) {
      const crate = stack[0];
      const { x: velocityX, y: velocityY } = this.player.sprite.body.velocity;
      const throwing = velocityX !== 0 || velocityY !== 0;
      const position = throwing
        ? crate.findThrowPosition(this.player.sprite, velocityX, velocityY)
        : crate.findDropPosition(this.player.sprite.x, this.player.sprite.y, this.player.sprite);
      if (!position) {
        this.lastEvent = throwing ? "There's no room to throw the crate." : "There's no room to put the crate down.";
        this.refresh();
        return;
      }
      if (throwing) crate.startThrow(this.player.sprite, velocityX, velocityY);
      else crate.drop(position.x, position.y, 0, 0, false);
      this.lastEvent = `${throwing ? "Threw" : "Put down"} ${this.describeCrate(crate)}.`;
    } else {
      const reserved = [];
      const drops = [];
      for (const crate of stack) {
        const position = crate.findDropPosition(
          this.player.sprite.x, this.player.sprite.y, this.player.sprite, reserved, INTERACT_RANGE,
        );
        if (!position) {
          this.lastEvent = "There's no room to set the stack down.";
          this.refresh();
          return;
        }
        drops.push({ crate, position });
        const bounds = crate.sprite.getBounds();
        reserved.push({
          left: position.x - bounds.width / 2, right: position.x + bounds.width / 2,
          top: position.y - bounds.height / 2, bottom: position.y + bounds.height / 2,
        });
      }
      for (const { crate, position } of drops) crate.drop(position.x, position.y, 0, 0, false);
      this.lastEvent = "Set the stack down.";
    }
    this.restockCrates.push(...stack);
    this.carriedCrates = [];
    this.syncCarriedCrates();
    this.refresh();
  }

  trashTop() {
    const crate = this.carriedCrates.pop();
    crate.destroy();
    this.syncCarriedCrates();
    this.lastEvent = "Threw the empty crate in the trash.";
    this.refresh();
  }

  // Loose crates get pushed when the player walks into them, as in the shop.
  updateCratePushing(delta) {
    const body = this.player.sprite.body;
    const rectOf = (b) => ({ left: b.x, top: b.y, width: b.width, height: b.height });
    const crates = this.restockCrates
      .filter((crate) => crate.isPushed || crate.isStationary() || crate.isSliding())
      .map((crate) => ({ key: crate, rect: rectOf(crate.sprite.body), locked: false }));
    const { playerVelocity, crateVelocities } = solveCratePush({
      player: rectOf(body),
      velocity: body.velocity,
      dt: Math.min(delta, 50) / 1000,
      crates,
      isBlocked: (rect) => this.isCrateSpaceBlocked(rect),
    });
    body.setVelocity(playerVelocity.x, playerVelocity.y);
    for (const crate of this.restockCrates) {
      const velocity = crateVelocities.get(crate);
      if (velocity && (velocity.x || velocity.y)) crate.push(velocity);
      else if (crate.isPushed) crate.stopPush();
    }
  }

  // Pull apart crates that a fast throw pushed into each other.
  separateStuckCrates() {
    const crates = this.restockCrates
      .filter((crate) => crate.sprite.body?.enable)
      .map((crate) => {
        const b = crate.sprite.body;
        return { key: crate, rect: { left: b.x, top: b.y, width: b.width, height: b.height }, locked: false };
      });
    const offsets = separateOverlappingCrates(crates, (_crate, rect) => this.isCrateSpaceBlocked(rect));
    for (const [crate, offset] of offsets) crate.nudge(offset.x, offset.y);
  }

  isCrateSpaceBlocked({ left, top, width, height }) {
    if (left < 0 || top < 0 || left + width > this.roomWidth || top + height > this.roomHeight) return true;
    return this.physics.overlapRect(left, top, width, height, false, true).some((b) => b.enable);
  }

  // --- Up-close shelf ---

  openShelf() {
    this.popupOpen = true;
    this.popupCamera.setVisible(true);
    this.fitCloseUp();
    this.refresh();
  }

  closeShelf() {
    this.popupOpen = false;
    this.hold = null;
    this.popupCamera.setVisible(false);
    this.refresh();
  }

  // Pressing on a space starts moving items (one right away, then one per tick while held).
  // Pressing anywhere else drags the up-close view.
  startHold(pointer) {
    if (!this.popupOpen || pointer.y < HEADER_HEIGHT) return;
    const slot = this.slotAt(pointer);
    if (slot === null) return;
    this.cardSlot = slot;
    this.hold = { slot, pulling: pointer.rightButtonDown(), timer: MOVE_INTERVAL_MS };
    this.moveOne(slot, this.hold.pulling);
    this.refresh();
  }

  moveOne(index, pulling) {
    if (this.carriedCrates.length === 0) {
      this.lastEvent = "You need to be holding a crate to stock or pull items.";
      this.refresh();
      return;
    }
    const slot = this.slots[index];
    // With a stack, use the highest crate that fits this space.
    const fits = pulling ? canUnstock : canStock;
    const carried = [...this.carriedCrates].reverse().find((candidate) => fits(slot, candidate.lab));
    if (!carried) return;
    const crate = carried.lab;
    if (pulling) {
      unstockOne(slot, crate);
      this.lastEvent = `Pulled 1 ${this.itemName(crate.itemId)} into your crate.`;
    } else {
      const name = this.itemName(crate.itemId);
      stockOne(slot, crate);
      this.lastEvent = `Put 1 ${name} on the shelf.`;
    }
    carried.quantity = crate.count;
    this.tintCrate(carried);
    this.drawSlot(index);
    this.refresh();
  }

  customerTakes() {
    const stocked = this.slots.map((slot, index) => (slot.count > 0 ? index : -1)).filter((index) => index >= 0);
    if (stocked.length === 0) {
      this.lastEvent = "A customer found the shelf empty.";
    } else {
      const index = stocked[Math.floor(Math.random() * stocked.length)];
      const name = this.itemName(this.slots[index].itemId);
      takeOne(this.slots[index]);
      this.drawSlot(index);
      this.lastEvent = `A customer took 1 ${name}.`;
    }
    this.refresh();
  }

  itemName(itemId) {
    return this.itemsById.get(itemId)?.name ?? "unnamed item";
  }

  toggleCustomers() {
    this.customersOn = !this.customersOn;
    this.customerTimer = CUSTOMER_INTERVAL_MS;
    this.refresh();
  }

  // Index of the shelf space under the pointer in the up-close view, or null.
  slotAt(pointer) {
    const world = this.popupCamera.getWorldPoint(pointer.x, pointer.y);
    const artX = (world.x - this.shelf.x + this.shelf.width / 2) * (SLOT_ART.width / this.shelf.width);
    const artY = (world.y - this.shelf.y + this.shelf.height / 2) * (SLOT_ART.height / this.shelf.height);
    const row = SLOT_ART.rows.findIndex(([top, bottom]) => artY >= top && artY <= bottom);
    const column = SLOT_ART.columns.findIndex(([left, right]) => artX >= left && artX <= right);
    return row < 0 || column < 0 ? null : row * SLOT_ART.columns.length + column;
  }

  // Card centered under the shelf in the up-close view showing the clicked space's item,
  // price and quantity.
  createItemCard() {
    const width = this.shelf.width * 0.8;
    const background = this.add.rectangle(this.shelf.x, this.shelf.y + this.shelf.height / 2 + 4, width, 0, 0x0f172a, 0.95)
      .setOrigin(0.5, 0).setStrokeStyle(1, 0x38bdf8);
    const text = this.add.text(this.shelf.x, 0, "", {
      ...TEXT_STYLE, fontSize: "6px", align: "center", lineSpacing: 1,
      wordWrap: { width: width - CARD_PADDING * 2 },
    }).setOrigin(0.5, 0).setResolution(6);
    this.itemCard = { background, text };
    for (const part of [background, text]) this.addCloseUp(part.setDepth(5).setVisible(false));
  }

  updateItemCard() {
    const slot = this.cardSlot === null ? null : this.slots[this.cardSlot];
    const visible = Boolean(slot && slot.count > 0);
    const { background, text } = this.itemCard;
    background.setVisible(visible);
    text.setVisible(visible);
    if (!visible) return;
    text.setText([
      this.itemName(slot.itemId),
      `Price: ${formatMoney(this.market.getPrice(slot.itemId)).replace(/ credits$/, "")}`,
      `Quantity: ${slot.count}`,
    ]);
    background.setSize(background.width, text.height + CARD_PADDING * 2);
    text.setY(background.y + CARD_PADDING);
  }

  // Draws boxes using the slot's packing layout. The back fills first, then the front.
  drawSlot(index) {
    for (const box of this.slotBoxes[index]) box.destroy();
    this.slotBoxes[index] = [];
    const slot = this.slots[index];
    if (slot.count === 0) return;
    const layout = BOX_LAYOUTS[slot.size];
    if (!layout) return;
    const column = index % SLOT_ART.columns.length;
    const row = Math.floor(index / SLOT_ART.columns.length);
    const scaleX = this.shelf.width / SLOT_ART.width;
    const scaleY = this.shelf.height / SLOT_ART.height;
    const shelfLeft = this.shelf.x - this.shelf.width / 2;
    const shelfTop = this.shelf.y - this.shelf.height / 2;
    const [left, right] = SLOT_ART.columns[column];
    const gap = (right - left - layout.width * layout.across
      - (layout.depth > 1 ? BACK_LAYER.shiftX : 0)) / (layout.across + 1);
    const itemsPerLayer = layout.across * layout.stackedRows;
    const stackStep = layout.height * 0.68;
    const frontBottom = layout.depth > 1 ? SLOT_ART.rows[row][1] : BOARD_TOPS[row];
    for (let item = 0; item < slot.count; item += 1) {
      const layer = Math.floor(item / itemsPerLayer);
      const inLayer = item % itemsPerLayer;
      const level = Math.floor(inLayer / layout.across);
      const isBack = layer === 0 && layout.depth > 1;
      const x = left + gap + (inLayer % layout.across) * (layout.width + gap)
        + (isBack ? BACK_LAYER.shiftX : 0);
      const bottom = (isBack ? BOARD_TOPS[row] - BACK_LAYER.shiftY : frontBottom)
        - level * stackStep;
      const box = this.add.image(
        shelfLeft + x * scaleX,
        shelfTop + bottom * scaleY,
        `shelf_box_${slot.category}`,
      ).setOrigin(0, 1).setDisplaySize(layout.width * scaleX, layout.height * scaleY)
        .setDepth(2.5 + layer * 0.1 + level * 0.01);
      if (isBack) box.setTint(BACK_LAYER.tint);
      this.slotBoxes[index].push(this.addWorld(box));
    }
  }

  // --- Cameras and header ---

  // Seen by the room and up-close cameras.
  addWorld(object) {
    this.worldObjects.push(object);
    this.uiCamera.ignore(object);
    return object;
  }

  // Seen only in the room, so the player and crates don't loom over the up-close shelf.
  addRoom(object) {
    this.roomObjects.push(object);
    this.popupCamera.ignore(object);
    return this.addWorld(object);
  }

  // Seen only in the up-close view.
  addCloseUp(object) {
    this.closeUpObjects.push(object);
    this.cameras.main.ignore(object);
    return this.addWorld(object);
  }

  addUi(object) {
    this.uiObjects.push(object);
    this.cameras.main.ignore(object);
    this.popupCamera.ignore(object);
    return object.setDepth(10);
  }

  addButton(x, y, label, onClick) {
    const button = this.add.text(x, y, label, { ...TEXT_STYLE, color: "#38bdf8" })
      .setInteractive({ useHandCursor: true });
    button.on("pointerdown", (pointer, _x, _y, event) => {
      event.stopPropagation();
      onClick();
    });
    return this.addUi(button);
  }

  toggleSlots() {
    this.showSlots = !this.showSlots;
    this.refresh();
  }

  refresh() {
    this.drawSlotGrid();
    this.updateItemCard();
    const interactKey = controlLabel("interact", "keyboard");
    this.helpText.setText(this.popupOpen
      ? `SHELF LAB  -  Left-hold a space to stock it from your crates. Right-hold to pull items back into a crate. ${interactKey} or Esc to step away.`
      : `SHELF LAB  -  WASD or arrows to walk. ${controlLabel("crate", "keyboard")} picks up, stacks, puts down, or throws crates. ${interactKey} uses the shelf or trash.`);
    this.statusText.setText(`Holding ${this.describeCarried()}. Customers: ${this.customersOn ? "shopping" : "away"}. ${this.lastEvent}`);
  }

  // The shelf's item spaces, outlined where they sit on the shelf art.
  drawSlotGrid() {
    this.slotGrid.clear().setVisible(this.showSlots);
    if (!this.showSlots) return;
    this.slotGrid.lineStyle(0.5, 0x22d3ee, 0.8);
    const scaleX = this.shelf.width / SLOT_ART.width;
    const scaleY = this.shelf.height / SLOT_ART.height;
    const left = this.shelf.x - this.shelf.width / 2;
    const top = this.shelf.y - this.shelf.height / 2;
    for (const [rowTop, rowBottom] of SLOT_ART.rows) {
      for (const [columnLeft, columnRight] of SLOT_ART.columns) {
        this.slotGrid.strokeRect(
          left + columnLeft * scaleX, top + rowTop * scaleY,
          (columnRight - columnLeft) * scaleX, (rowBottom - rowTop) * scaleY,
        );
      }
    }
  }

  // Zoom the room camera so the whole room fits below the header.
  fitRoom() {
    const camera = this.cameras.main;
    const zoom = Math.min(camera.width / (this.roomWidth + MARGIN * 2), camera.height / (this.roomHeight + MARGIN * 2));
    camera.setZoom(zoom).centerOn(this.roomWidth / 2, this.roomHeight / 2);
  }

  // Zoom the up-close camera so the shelf and its item card fill the space below the header.
  fitCloseUp() {
    const camera = this.popupCamera;
    const contentWidth = this.shelf.width + MARGIN;
    const contentHeight = this.shelf.height + CARD_ROOM + MARGIN / 2;
    const zoom = Math.min(camera.width / contentWidth, camera.height / contentHeight);
    camera.setZoom(zoom).centerOn(this.shelf.x, this.shelf.y + CARD_ROOM / 2);
  }

  handleResize(gameSize) {
    const viewHeight = gameSize.height - HEADER_HEIGHT;
    this.cameras.main.setSize(gameSize.width, viewHeight);
    this.popupCamera.setSize(gameSize.width, viewHeight);
    this.uiCamera.setSize(gameSize.width, gameSize.height);
    this.header.setSize(gameSize.width, HEADER_HEIGHT);
    this.fitRoom();
    this.fitCloseUp();
  }
}
