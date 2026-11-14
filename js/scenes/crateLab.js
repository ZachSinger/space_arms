// ==========================================
// FILE: crateLab.js
// ==========================================
// Dev harness for working on crates: an empty room with a few full and empty crates and a
// couple of pillars to push against. Crates use the shop's controls (pick up, stack, drop,
// throw, push). Opened from the title screen's DEV option. Nothing here touches the saved game.
import Phaser from "phaser";
import { TILE_SIZE } from "../logic/RoomLayout.js";
import { getItemCrateTint } from "../logic/CrateCategory.js";
import { Crate, CRATE_STACK_SPACING, INTERACT_RANGE } from "../logic/Crate.js";
import { FLOOR_STACK_MAX, HOLD_KEY_MS, MAX_CARRIED_CRATES, isInFacingCone } from "../logic/CrateStack.js";
import { solveCratePush } from "../logic/CratePushing.js";
import { separateOverlappingCrates } from "../logic/CrateSeparation.js";
import { controlLabel } from "../logic/InputDevice.js";
import { Player, PLAYER_CRATE_HOLD_OFFSET } from "../logic/Player.js";

const HEADER_HEIGHT = 100;
const FOOTER_HEIGHT = 96;
const FOOTER_NAME_WRAP = 380;
const HOLDING_CARD = Object.freeze({ width: 320, height: 56, nameWrap: 200 });
const TEXT_STYLE = { fontFamily: "monospace", fontSize: "14px", color: "#e2e8f0" };
const ROOM = Object.freeze({ columns: 14, rows: 10 });
const PLAYER_START = Object.freeze({ x: 7 * TILE_SIZE, y: 5.5 * TILE_SIZE });
// Floor squares for pillars, so pushing and throwing have something to hit.
const PILLARS = Object.freeze([{ gx: 3, gy: 7 }, { gx: 10, gy: 2 }]);
const FULL_CRATE_COUNT = 5;
const EMPTY_CRATE_COUNT = 3;
const FLOOR_STACK_SPACING = CRATE_STACK_SPACING;
const CRATE_FLOOR_DEPTH = 2;

export class CrateLabScene extends Phaser.Scene {
  constructor() {
    super("scene-crate-lab");
  }

  // Read by Player (with carriedCrates) to switch to the carrying pose and walking speed.
  get carriedCrate() {
    return this.carriedCrates.at(-1) ?? null;
  }

  create() {
    // Floor crates are named like the shop's, which Crate reads when finding a clear drop spot.
    this.restockCrates = [];
    this.carriedCrates = [];
    // Floor stacks: bottom crate (a normal floor crate) -> crates sitting on it, lowest first.
    this.floorStacks = new Map();
    // Which floor stack the green arrow is on, and how many crates down from the top it points.
    this.markedStackBase = null;
    this.markedFromTop = 0;
    this.keyPress = null;
    this.controlMode = { allows: () => true };
    this.lastEvent = `Walk to a crate and press ${controlLabel("crate", "keyboard")} to pick it up.`;

    this.cameras.main.setViewport(0, HEADER_HEIGHT, this.scale.width,
      this.scale.height - HEADER_HEIGHT - FOOTER_HEIGHT).setBackgroundColor("#1e1b4b");
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);

    this.items = (this.cache.json.get("items") ?? []).filter((item) => item.boxSize > 0);
    this.roomWidth = ROOM.columns * TILE_SIZE;
    this.roomHeight = ROOM.rows * TILE_SIZE;
    this.physics.world.setBounds(0, 0, this.roomWidth, this.roomHeight);
    this.crateBounds = new Phaser.Geom.Rectangle(0, 0, this.roomWidth, this.roomHeight);
    this.solids = this.physics.add.staticGroup();
    this.crateGroup = this.physics.add.group();
    this.physics.add.collider(this.crateGroup, this.crateGroup, (spriteA, spriteB) => {
      for (const sprite of [spriteA, spriteB]) {
        this.restockCrates.find((crate) => crate.sprite === sprite)?.refreshDrag();
      }
    });
    this.physics.add.collider(this.crateGroup, this.solids);

    this.drawFloor();
    this.placePillars();
    this.layOutCrates();

    // Points down at the crate Space would pick up or stack.
    this.pickupMarker = this.addWorld(this.add.graphics().setDepth(20000).setVisible(false));
    this.pickupMarker.fillStyle(0x22c55e).lineStyle(1, 0x052e16)
      .fillTriangle(-5, -4, 5, -4, 0, 4).strokeTriangle(-5, -4, 5, -4, 0, 4);
    this.player = new Player(this, PLAYER_START.x, PLAYER_START.y);
    this.player.sprite.body.setCollideWorldBounds(true);
    this.addWorld(this.player.sprite);
    this.physics.add.collider(this.player.sprite, this.solids);

    this.header = this.addUi(this.add.rectangle(0, 0, this.scale.width, HEADER_HEIGHT, 0x0f172a, 0.92).setOrigin(0));
    this.addUi(this.add.text(16, 6,
      `CRATE LAB  WASD: walk.  ${controlLabel("crate", "keyboard")}: pick up.  Q: put down.  Tap: one crate.  Hold: a stack.  Ctrl: next crate down.  Esc: menu.`,
      TEXT_STYLE));
    this.statusText = this.addUi(this.add.text(16, 26, "", { ...TEXT_STYLE, color: "#facc15" }));
    this.promptText = this.addUi(this.add.text(16, 46, "", { ...TEXT_STYLE, color: "#86efac" }));
    let x = 16;
    for (const [label, onClick] of [
      ["[ FRESH CRATES ]", () => this.resetCrates()],
      ["[ MENU ]", () => this.scene.start("scene-title")],
    ]) {
      x += this.addButton(x, 72, label, onClick).width + 14;
    }
    this.createFooter();

    this.fitRoom();
    // Space picks up and Q puts down. Each waits on release to tell a tap (one crate) from a
    // hold (a stack); a hold fires as soon as the key has been down long enough.
    for (const [keyName, which] of [["SPACE", "pickUp"], ["Q", "putDown"]]) {
      this.input.keyboard.on(`keydown-${keyName}`, (event) => {
        event.preventDefault();
        if (event.repeat || this.keyPress) return;
        const action = this.crateActions()[which];
        // Actions with no hold (like throwing) happen right away.
        if (action && !action.hold) action.tap();
        else if (action) this.keyPress = { which, startedAt: this.time.now, fired: false };
      });
      this.input.keyboard.on(`keyup-${keyName}`, () => {
        if (this.keyPress?.which !== which) return;
        if (!this.keyPress.fired) this.crateActions()[which]?.tap();
        this.keyPress = null;
      });
    }
    this.input.keyboard.on("keydown-CTRL", (event) => {
      event.preventDefault();
      this.markNextCrateDown();
    });
    this.input.keyboard.on("keydown-ESC", () => this.scene.start("scene-title"));
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
    this.syncFloorStacks();
    if (this.keyPress && !this.keyPress.fired && this.time.now - this.keyPress.startedAt >= HOLD_KEY_MS) {
      this.keyPress.fired = true;
      this.crateActions()[this.keyPress.which]?.hold();
    }
    this.updatePickupMarker();
    const prompt = this.cratePrompt();
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
    this.addWorld(floor);
  }

  placePillars() {
    for (const { gx, gy } of PILLARS) {
      const pillar = this.add.rectangle(
        (gx + 0.5) * TILE_SIZE, (gy + 0.5) * TILE_SIZE, TILE_SIZE, TILE_SIZE, 0x1f2937,
      ).setStrokeStyle(2, 0x94a3b8).setDepth(2);
      this.solids.add(pillar);
      this.addWorld(pillar);
    }
  }

  // A row of full crates of different items, and a few empty crates below them.
  layOutCrates() {
    const items = Phaser.Utils.Array.Shuffle([...this.items]).slice(0, FULL_CRATE_COUNT);
    items.forEach((item, index) => {
      this.spawnCrate(item, 6, (2.5 + index * 2) * TILE_SIZE, 3.5 * TILE_SIZE);
    });
    for (let index = 0; index < EMPTY_CRATE_COUNT; index += 1) {
      this.spawnCrate(null, 0, (5.5 + index * 2) * TILE_SIZE, 7.5 * TILE_SIZE);
    }
  }

  spawnCrate(item, quantity, x, y) {
    const crate = new Crate(this, item?.id ?? null, quantity, x, y, { tint: getItemCrateTint(item?.tags) });
    this.addWorld(crate.sprite);
    this.restockCrates.push(crate);
  }

  resetCrates() {
    const stacked = [...this.floorStacks.values()].flat();
    for (const crate of [...this.restockCrates, ...this.carriedCrates, ...stacked]) crate.destroy();
    this.restockCrates = [];
    this.carriedCrates = [];
    this.floorStacks.clear();
    this.markedStackBase = null;
    this.layOutCrates();
    this.lastEvent = "Laid out a fresh set of crates.";
    this.refresh();
  }

  // --- Crates ---

  // What Space (pick up) and Q (put down) do right now; each has a tap (one crate) and a hold
  // (a stack). Missing entries mean the key does nothing here.
  crateActions() {
    const stack = this.markedFloorStack();
    const holding = this.carriedCrates.length;
    const actions = {};
    if (stack) {
      const lifted = stack.crates.length - stack.crates.indexOf(stack.marked);
      const tooMany = (count) => () => this.say(
        `You can only carry ${MAX_CARRIED_CRATES} crates at once. You're holding ${holding}, so you can't pick up ${count === 1 ? "another one" : `${count} more`}.`);
      actions.pickUp = {
        tap: holding + 1 <= MAX_CARRIED_CRATES ? () => this.pickUpFromStack(stack, false) : tooMany(1),
        hold: holding + lifted <= MAX_CARRIED_CRATES ? () => this.pickUpFromStack(stack, true) : tooMany(lifted),
        lifted,
      };
    }
    if (holding > 0) {
      if (stack) {
        const room = FLOOR_STACK_MAX - stack.crates.length;
        const full = () => this.say(`You can't stack any higher. Stacks can only be ${FLOOR_STACK_MAX} crates high.`);
        actions.putDown = room > 0
          ? { tap: () => this.setCratesOnStack(stack, 1), hold: () => this.setCratesOnStack(stack, Math.min(room, holding)), onStack: true }
          : { tap: full, hold: full, full: true };
      } else {
        actions.putDown = { tap: () => this.dropTopCrate(), hold: () => this.dropWholeStack() };
        // With no green arrow, Space throws your top crate while you're walking.
        actions.pickUp = { tap: () => this.throwTopCrate(), throws: true };
      }
    }
    return actions;
  }

  // The hint line under the header for the current crate actions.
  cratePrompt() {
    const key = controlLabel("crate", "keyboard");
    const { pickUp, putDown } = this.crateActions();
    const holding = this.carriedCrates.length;
    const parts = [];
    if (pickUp?.throws) {
      parts.push(`${key} while walking: Throw your top crate`);
    } else if (pickUp) {
      const room = MAX_CARRIED_CRATES - holding;
      if (room === 0) parts.push(`Your hands are full (${MAX_CARRIED_CRATES} crates max)`);
      else parts.push(`Tap ${key}: Pick up ${this.describeCrate(this.markedFloorStack().marked)}`);
      if (pickUp.lifted > 1 && pickUp.lifted <= room) parts.push(`Hold ${key}: Pick up ${pickUp.lifted} crates (this one and the ones above it)`);
    }
    if (putDown?.full) parts.push(`This stack is already ${FLOOR_STACK_MAX} crates high`);
    else if (putDown?.onStack) {
      parts.push("Tap Q: Set your top crate on this stack");
      if (holding > 1) parts.push("Hold Q: Set as many of your crates on this stack as fit");
    } else if (putDown) {
      parts.push("Tap Q: Put your top crate down");
      if (holding > 1) parts.push(`Hold Q: Set all ${holding} crates down as a stack`);
    }
    if (this.markedFloorStack()?.crates.length > 1) parts.push("Ctrl: Next crate down");
    return parts.join("   ");
  }

  say(message) {
    this.lastEvent = message;
    this.refresh();
  }

  // The floor stack in reach (bottom crate first) and the crate its green arrow points at.
  // The arrow starts on the top crate whenever the player reaches a different stack.
  markedFloorStack() {
    const base = this.nearestFloorCrate();
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

  // Ctrl: move the green arrow one crate down the stack, looping back to the top after the bottom.
  markNextCrateDown() {
    const stack = this.markedFloorStack();
    if (!stack || stack.crates.length < 2) return;
    this.markedFromTop = (this.markedFromTop + 1) % stack.crates.length;
  }

  updatePickupMarker() {
    const stack = this.markedFloorStack();
    const canAct = Boolean(stack);
    this.pickupMarker.setVisible(Boolean(canAct));
    if (canAct) {
      const bounds = stack.marked.sprite.getBounds();
      // Points down at the top crate; for crates lower in a stack, points in from the left side.
      if (this.markedFromTop === 0) this.pickupMarker.setAngle(0).setPosition(bounds.centerX, bounds.top - 7);
      else this.pickupMarker.setAngle(-90).setPosition(bounds.left - 7, bounds.centerY);
    }
    this.renderFooter(stack?.marked ?? null);
    this.renderHoldingCards();
  }

  // Crates sitting on a floor crate are drawn on top of it and move with it when it's pushed.
  // Floor crates are drawn over the player while he stands behind them (his feet above their
  // bottom edge); crates sitting on a floor crate are drawn on top of it and move with it.
  syncFloorStacks() {
    const feet = this.player.sprite.body.bottom;
    for (const crate of this.restockCrates) {
      if (crate.launch) continue;
      const behind = feet < crate.sprite.body.bottom;
      crate.sprite.setDepth(behind ? this.player.sprite.depth + 1 : CRATE_FLOOR_DEPTH);
    }
    for (const [base, above] of this.floorStacks) {
      above.forEach((crate, index) =>
        crate.followCarrier(base.sprite, index, FLOOR_STACK_SPACING, FLOOR_STACK_SPACING));
    }
  }

  // Adds the marked crate to the top of what you're carrying, and with withAbove every crate
  // above it too. Without withAbove the stack closes the gap.
  pickUpFromStack({ base, crates, marked }, withAbove) {
    const index = crates.indexOf(marked);
    const lifted = withAbove ? crates.slice(index) : [marked];
    const above = this.floorStacks.get(base) ?? [];
    if (marked === base) {
      const { x, y } = base.sprite;
      if (!base.pickUp(this.player.sprite)) return;
      this.restockCrates = this.restockCrates.filter((crate) => crate !== base);
      this.floorStacks.delete(base);
      // The next crate up settles onto the floor in the bottom crate's place.
      const [newBase, ...rest] = withAbove ? [] : above;
      if (newBase) {
        newBase.drop(x, y, 0, 0, false);
        this.restockCrates.push(newBase);
        if (rest.length) this.floorStacks.set(newBase, rest);
      }
    } else {
      const remaining = above.filter((crate) => !lifted.includes(crate));
      if (remaining.length) this.floorStacks.set(base, remaining);
      else this.floorStacks.delete(base);
    }
    this.carriedCrates.push(...lifted);
    this.markedStackBase = null;
    this.syncCarriedCrates();
    this.syncFloorStacks();
    this.say(lifted.length > 1
      ? `Picked up ${lifted.length} crates from the stack.`
      : `Picked up ${this.describeCrate(marked)}${crates.length > 1 ? " from the stack" : ""}.`);
  }

  // Moves `count` crates from the top of your stack onto the floor stack, keeping their order;
  // the rest stay in your hands.
  setCratesOnStack({ base }, count) {
    const placed = this.carriedCrates.slice(-count);
    this.carriedCrates = this.carriedCrates.slice(0, -count);
    this.floorStacks.set(base, [...(this.floorStacks.get(base) ?? []), ...placed]);
    this.markedStackBase = null;
    this.syncCarriedCrates();
    this.syncFloorStacks();
    const kept = this.carriedCrates.length;
    this.say(`Set ${count === 1 ? "1 crate" : `${count} crates`} on the stack${kept ? `; still holding ${kept}` : ""}.`);
  }

  // One small card per carried crate, stacked at the right just above the bottom bar.
  // The top card is the top crate, matching the stack over the player's head.
  createHoldingCards() {
    const bold = { fontFamily: "monospace", fontStyle: "bold" };
    this.holdingCards = [];
    for (let index = 0; index < MAX_CARRIED_CRATES; index += 1) {
      const back = this.add.rectangle(0, 0, HOLDING_CARD.width, HOLDING_CARD.height, 0x0f172a)
        .setOrigin(0).setStrokeStyle(1, 0x334155);
      const image = this.add.image(0, 0, "__DEFAULT").setOrigin(0.5).setVisible(false);
      const name = this.add.text(0, 0, "", {
        ...bold, fontSize: "15px", color: "#10b981", align: "center", wordWrap: { width: HOLDING_CARD.nameWrap },
      }).setOrigin(0.5);
      const count = this.add.text(0, 0, "", { ...bold, fontSize: "22px", color: "#e2e8f0" }).setOrigin(1, 0.5);
      const card = this.addUi(this.add.container(0, 0, [back, image, name, count]).setVisible(false));
      this.holdingCards.push({ card, image, name, count });
    }
    this.holdingCardsKey = null;
  }

  renderHoldingCards() {
    const topFirst = [...this.carriedCrates].reverse();
    const shown = topFirst.map((crate) => ({ ...this.crateLabelText(crate), imageKey: this.itemImageKey(crate) }));
    const key = JSON.stringify(shown);
    if (key === this.holdingCardsKey) return;
    this.holdingCardsKey = key;
    const { width: cardWidth, height: cardHeight } = HOLDING_CARD;
    this.holdingCards.forEach((entry, index) => {
      const info = shown[index];
      entry.card.setVisible(Boolean(info));
      if (!info) return;
      entry.name.setText(info.name);
      entry.count.setText(info.count);
      entry.image.setVisible(Boolean(info.imageKey));
      if (info.imageKey) {
        entry.image.setTexture(info.imageKey);
        entry.image.setScale((cardHeight - 12) / Math.max(entry.image.frame.width, entry.image.frame.height));
      }
      const pictureRoom = 56;
      entry.image.setPosition(pictureRoom / 2 + 4, cardHeight / 2);
      entry.count.setPosition(cardWidth - 10, cardHeight / 2);
      const nameLeft = pictureRoom;
      const nameRight = cardWidth - 14 - entry.count.width;
      entry.name.setPosition((nameLeft + nameRight) / 2, cardHeight / 2);
    });
    this.layOutHoldingCards();
  }

  layOutHoldingCards() {
    const footerTop = this.scale.height - FOOTER_HEIGHT;
    const shownCount = this.holdingCards.filter((entry) => entry.card.visible).length;
    this.holdingCards.forEach((entry, index) => {
      entry.card.setPosition(this.scale.width - HOLDING_CARD.width,
        footerTop - (shownCount - index) * HOLDING_CARD.height);
    });
  }

  // Bottom bar, styled like the shop's top bar: says what's in the crate the player can reach.
  createFooter() {
    const y = this.scale.height - FOOTER_HEIGHT;
    this.footer = this.addUi(this.add.rectangle(0, y, this.scale.width, FOOTER_HEIGHT, 0x0f172a).setOrigin(0));
    this.footerEdge = this.addUi(this.add.rectangle(0, y, this.scale.width, 2, 0x38bdf8).setOrigin(0));
    const bold = { fontFamily: "monospace", fontStyle: "bold" };
    this.footerLabel = this.addUi(this.add.text(16, 0, "CRATE", { ...bold, fontSize: "16px", color: "#e2e8f0" })
      .setOrigin(0, 0.5));
    this.footerName = this.addUi(this.add.text(0, 0, "", {
      ...bold, fontSize: "24px", color: "#10b981", align: "center", wordWrap: { width: FOOTER_NAME_WRAP },
    }).setOrigin(0.5));
    this.footerCount = this.addUi(this.add.text(0, 0, "", { ...bold, fontSize: "40px", color: "#e2e8f0" })
      .setOrigin(0, 0.5));
    this.footerImage = this.addUi(this.add.image(0, 0, "__DEFAULT").setOrigin(0, 0.5).setVisible(false));
    this.footerImageKey = null;
    this.requestedImages = new Set();
    this.layOutFooter();
    this.createHoldingCards();
  }

  renderFooter(crate) {
    const { name, count } = crate ? this.crateLabelText(crate) : { name: "", count: "" };
    const shown = name || "Walk up to a crate to see what's inside.";
    const imageKey = this.itemImageKey(crate);
    if (this.footerName.text === shown && this.footerCount.text === count
      && this.footerImageKey === imageKey) return;
    this.footerName.setText(shown).setColor(name ? "#10b981" : "#64748b");
    this.footerCount.setText(count);
    this.footerImageKey = imageKey;
    if (imageKey) this.footerImage.setTexture(imageKey);
    this.footerImage.setVisible(Boolean(imageKey));
    this.layOutFooter();
  }

  // Texture key for the crate's item picture, or null if there's none or it's still loading.
  // Pictures load the first time the player walks up to a crate of that item.
  itemImageKey(crate) {
    if (!crate || crate.quantity === 0) return null;
    const item = this.items.find((candidate) => candidate.id === crate.itemId);
    if (!item?.image) return null;
    const key = `crate-lab-item-${item.id}`;
    if (this.textures.exists(key)) return key;
    if (!this.requestedImages.has(key)) {
      this.requestedImages.add(key);
      this.load.image(key, item.image);
      this.load.start();
    }
    return null;
  }

  layOutFooter() {
    const centerY = this.scale.height - FOOTER_HEIGHT / 2 + 1;
    this.footerLabel.setY(centerY);
    // Picture, name, and count sit side by side, centered across the bar.
    const image = this.footerImage.visible ? this.footerImage : null;
    if (image) {
      const size = FOOTER_HEIGHT - 24;
      image.setScale(size / Math.max(image.frame.width, image.frame.height));
    }
    const imageWidth = image ? image.displayWidth + 20 : 0;
    const gap = this.footerCount.text ? 24 : 0;
    const total = imageWidth + this.footerName.width + gap + (this.footerCount.text ? this.footerCount.width : 0);
    const left = this.scale.width / 2 - total / 2;
    this.footerImage.setPosition(left, centerY);
    this.footerName.setPosition(left + imageWidth + this.footerName.width / 2, centerY);
    this.footerCount.setPosition(left + imageWidth + this.footerName.width + gap, centerY);
  }

  crateLabelText(crate) {
    if (crate.quantity === 0) return { name: "Empty crate", count: "" };
    const name = this.items.find((item) => item.id === crate.itemId)?.name ?? "Unnamed item";
    return { name, count: `x${crate.quantity}` };
  }

  // The closest crate on the floor within reach of the player's feet, counting only crates in
  // front of him (within a wide cone around the way he's facing).
  nearestFloorCrate() {
    const { center } = this.player.sprite.body;
    let best = null;
    let bestDistance = INTERACT_RANGE;
    for (const crate of this.restockCrates) {
      if (!crate.canPickUp()) continue;
      if (!isInFacingCone(center, crate.sprite, this.player.currentFacing)) continue;
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

  describeCrate(crate) {
    if (crate.quantity === 0) return "an empty crate";
    const name = this.items.find((item) => item.id === crate.itemId)?.name ?? "unnamed item";
    return `a crate of ${crate.quantity} ${name}`;
  }

  describeCarried() {
    if (this.carriedCrates.length === 0) return "nothing";
    return [...this.carriedCrates].reverse().map((crate) => this.describeCrate(crate)).join(", ");
  }

  syncCarriedCrates() {
    this.player.updateCarryPose?.();
    this.carriedCrates.forEach((crate, index) =>
      crate.followCarrier(this.player.sprite, index, PLAYER_CRATE_HOLD_OFFSET, FLOOR_STACK_SPACING));
  }

  // Tap Q: your top crate goes on the floor in front of you. Space uses throwing to throw it
  // the way you're walking instead.
  dropTopCrate(throwing = false) {
    const crate = this.carriedCrates[this.carriedCrates.length - 1];
    const { x: velocityX, y: velocityY } = this.player.sprite.body.velocity;
    const position = throwing
      ? crate.findThrowPosition(this.player.sprite, velocityX, velocityY)
      : crate.findDropPosition(this.player.sprite.x, this.player.sprite.y, this.player.sprite,
        [], undefined, this.player.currentFacing);
    if (!position) {
      this.say(throwing ? "There's no room to throw the crate." : "There's no room to put the crate down.");
      return;
    }
    if (throwing) crate.startThrow(this.player.sprite, velocityX, velocityY);
    else crate.drop(position.x, position.y, 0, 0, false);
    this.carriedCrates.pop();
    this.restockCrates.push(crate);
    this.syncCarriedCrates();
    this.say(`${throwing ? "Threw" : "Put down"} ${this.describeCrate(crate)}.`);
  }

  // Space with no green arrow: throws your top crate the way you're walking.
  throwTopCrate() {
    const { x: velocityX, y: velocityY } = this.player.sprite.body.velocity;
    if (velocityX === 0 && velocityY === 0) {
      this.say(`To throw a crate, walk and press ${controlLabel("crate", "keyboard")}.`);
      return;
    }
    this.dropTopCrate(true);
  }

  // Hold: everything you're carrying goes on the floor in front of you as one stack.
  dropWholeStack() {
    const [bottom, ...rest] = this.carriedCrates;
    const position = bottom.findDropPosition(this.player.sprite.x, this.player.sprite.y,
      this.player.sprite, [], undefined, this.player.currentFacing);
    if (!position) {
      this.say("There's no room to set the stack down.");
      return;
    }
    bottom.drop(position.x, position.y, 0, 0, false);
    this.restockCrates.push(bottom);
    if (rest.length) this.floorStacks.set(bottom, rest);
    this.carriedCrates = [];
    this.syncCarriedCrates();
    this.syncFloorStacks();
    this.say(rest.length ? `Set all ${rest.length + 1} crates down as a stack.` : `Put down ${this.describeCrate(bottom)}.`);
  }

  // Loose crates get pushed when the player walks into them, as in the shop. A floor stack is
  // as heavy as its height, and whatever you're carrying adds to the load; a full-height stack
  // won't budge while you're carrying anything.
  updateCratePushing(delta) {
    const body = this.player.sprite.body;
    const rectOf = (b) => ({ left: b.x, top: b.y, width: b.width, height: b.height });
    const holding = this.carriedCrates.length;
    const crates = this.restockCrates
      .filter((crate) => crate.isPushed || crate.isStationary() || crate.isSliding())
      .map((crate) => {
        const height = 1 + (this.floorStacks.get(crate)?.length ?? 0);
        return {
          key: crate, rect: rectOf(crate.sprite.body), weight: height,
          locked: holding > 0 && height >= FLOOR_STACK_MAX,
        };
      });
    const { playerVelocity, crateVelocities } = solveCratePush({
      player: rectOf(body),
      velocity: body.velocity,
      dt: Math.min(delta, 50) / 1000,
      crates,
      isBlocked: (rect) => this.isCrateSpaceBlocked(rect),
      carriedWeight: holding,
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

  // --- Cameras and header ---

  addWorld(object) {
    this.uiCamera.ignore(object);
    return object;
  }

  addUi(object) {
    this.cameras.main.ignore(object);
    return object.setDepth(10);
  }

  addButton(x, y, label, onClick) {
    const button = this.add.text(x, y, label, { ...TEXT_STYLE, color: "#38bdf8" })
      .setInteractive({ useHandCursor: true });
    button.on("pointerdown", () => onClick());
    return this.addUi(button);
  }

  refresh() {
    this.statusText.setText(`Holding ${this.describeCarried()}. ${this.lastEvent}`);
  }

  // Zooms the room to fill the space under the header.
  fitRoom() {
    const camera = this.cameras.main;
    const zoom = Math.min(camera.width / (this.roomWidth + TILE_SIZE), camera.height / (this.roomHeight + TILE_SIZE));
    camera.setZoom(zoom).centerOn(this.roomWidth / 2, this.roomHeight / 2);
  }

  handleResize(gameSize) {
    this.cameras.main.setViewport(0, HEADER_HEIGHT, gameSize.width,
      gameSize.height - HEADER_HEIGHT - FOOTER_HEIGHT);
    this.uiCamera.setSize(gameSize.width, gameSize.height);
    this.header.setSize(gameSize.width, HEADER_HEIGHT);
    const footerTop = gameSize.height - FOOTER_HEIGHT;
    this.footer.setPosition(0, footerTop).setSize(gameSize.width, FOOTER_HEIGHT);
    this.footerEdge.setPosition(0, footerTop).setSize(gameSize.width, 2);
    this.layOutFooter();
    this.layOutHoldingCards();
    this.fitRoom();
  }
}
