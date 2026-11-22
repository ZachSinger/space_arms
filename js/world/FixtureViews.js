// ==========================================
// FILE: FixtureViews.js
// ==========================================
// What a fixture looks like on the map: its solid, clickable picture and, for shelves, the
// stock shown on them, the "needs stocking" highlight, and the facing light. Views follow the
// fixture models in the shop's saved state (state/slices/Shop.js); they hold no data of their own.
import { database } from "../scenes/boot.js";
import { ShelfFixture } from "../logic/ShelfFixture.js";
import { ShelfAttentionHighlight } from "../logic/ShelfAttentionHighlight.js";
import { ShelfFacingLight } from "../logic/ShelfFacingLight.js";
import { ShelfItemDisplay } from "../logic/ShelfItemDisplay.js";
import { getFixtureTexture, hasFacingTextures } from "../logic/FixtureTexture.js";
import {
  fixtureArtInset, fixtureBounds, fixtureFootprint, fixtureRotation, fixtureSolidBounds, getFixtureType,
} from "../logic/FixtureLayout.js";
import { FIXTURE_LIGHT_DEPTH_OFFSET, FIXTURE_STOCK_DEPTH_OFFSET, fixtureDepth } from "./Depth.js";
import { TILE_SIZE } from "../logic/RoomLayout.js";
import { isWorldMouseBinding } from "../input/KeyBindings.js";

export class FixtureViews {
  /** @param {object} shop - the game scene, with obstacleGroup and registerGroup made */
  constructor(shop) {
    this.shop = shop;
    /** @type {Set<object>} fixtures that have views on the map */
    this.shown = new Set();
  }

  /**
   * Draws a fixture model on the map.
   * @param {object} fixture
   * @returns {object} the same fixture
   */
  show(fixture) {
    const spec = getFixtureType(fixture.type);
    if (spec.kind === "register") this.drawRegister(fixture);
    else this.drawFixture(fixture, getFixtureTexture(spec));
    this.orient(fixture);
    if (fixture instanceof ShelfFixture) {
      fixture.stockDisplay = new ShelfAttentionHighlight(this.shop, fixture);
      if (spec.artLayout === "budget") fixture.facingLight = new ShelfFacingLight(this.shop, fixture);
      fixture.stockItemsDisplay = new ShelfItemDisplay(this.shop, fixture, (itemId) => database.getItem(itemId));
      fixture.stockDisplay.sync();
      this.layerDisplays(fixture);
    }
    this.shown.add(fixture);
    return fixture;
  }

  /** @param {object} fixture */
  hide(fixture) {
    fixture.stockDisplay?.destroy();
    fixture.facingLight?.destroy();
    fixture.stockItemsDisplay?.destroy();
    fixture.sprite?.destroy();
    this.shown.delete(fixture);
  }

  // Every view, including those of fixtures a just-loaded save replaced.
  clear() {
    for (const fixture of [...this.shown]) this.hide(fixture);
  }

  /**
   * Turns the sprite to the fixture's rotation and fits its body box to the turned
   * footprint. Phaser's own refit ignores rotation, so the box is set by hand.
   * @param {object} fixture
   */
  orient(fixture) {
    const { sprite, x, y } = fixture;
    const rotation = fixtureRotation(fixture);
    const spec = getFixtureType(fixture.type);
    // Art drawn for each facing is swapped in upright; other art is spun to face its way.
    const facingArt = hasFacingTextures(spec);
    if (facingArt) {
      sprite.setTexture(getFixtureTexture(spec, rotation));
      this.sizeFacingArt(sprite, spec, rotation);
    }
    sprite.setPosition(x, y).setAngle(facingArt ? 0 : rotation * 90);
    const footprint = fixtureFootprint(fixture);
    const inset = fixtureArtInset(fixture);
    // Upright shelves are solid only around their feet; see fixtureSolidBounds.
    const local = { ...fixture, gx: 0, gy: 0 };
    const clipTop = (fixtureSolidBounds(local).top - fixtureBounds(local).top) * TILE_SIZE;
    const width = (footprint.w - inset.left - inset.right) * TILE_SIZE;
    const height = (footprint.h - inset.top - inset.bottom) * TILE_SIZE - clipTop;
    const centerX = x + (inset.left - inset.right) * TILE_SIZE / 2;
    const centerY = y + (inset.top - inset.bottom) * TILE_SIZE / 2 + clipTop / 2;
    const body = sprite.body;
    body.world.staticTree.remove(body);
    body.position.set(centerX - width / 2, centerY - height / 2);
    body.width = width;
    body.height = height;
    body.halfWidth = width / 2;
    body.halfHeight = height / 2;
    body.center.set(centerX, centerY);
    body.world.staticTree.insert(body);
    sprite.setDepth(fixtureDepth(fixtureBounds(fixture).bottom * TILE_SIZE));
    this.layerDisplays(fixture);
  }

  // A shelf's stock and facing light draw just over their own shelf, under any shelf in front.
  layerDisplays(fixture) {
    const depth = fixture.sprite.depth;
    fixture.stockItemsDisplay?.container?.setDepth(depth + FIXTURE_STOCK_DEPTH_OFFSET);
    fixture.facingLight?.graphics?.setDepth(depth + FIXTURE_LIGHT_DEPTH_OFFSET);
  }

  // Moves a shelf's stock display and highlight along with it.
  placeDisplays(fixture) {
    fixture.stockDisplay?.setPosition(fixture.x, fixture.y);
    fixture.stockDisplay?.setAngle(fixtureRotation(fixture) * 90);
    fixture.stockItemsDisplay?.setPosition(fixture.x, fixture.y);
    fixture.stockItemsDisplay?.setAngle(fixtureRotation(fixture) * 90);
  }

  sizeFacingArt(sprite, spec, rotation = 0) {
    const footprint = fixtureFootprint({ type: spec.id, rotation });
    sprite.setDisplaySize(footprint.w * TILE_SIZE, footprint.h * TILE_SIZE);
  }

  /**
   * Creates a solid, clickable fixture sprite.
   * @param {object} fixture
   * @param {string} textureKey
   */
  drawFixture(fixture, textureKey) {
    const scene = this.shop;
    const width = fixture.gridDimensions.w * TILE_SIZE;
    const height = fixture.gridDimensions.h * TILE_SIZE;
    const image = scene.add.image(fixture.x, fixture.y, textureKey).setDisplaySize(width, height);
    scene.obstacleGroup.add(image); // solid -- customers walk up to it, not through it
    fixture.sprite = image;
    image.setInteractive({ useHandCursor: true });
    image.on("pointerdown", (pointer) => {
      if (pointer.event?.target === scene.game.canvas && !isWorldMouseBinding(pointer.event)) {
        scene.fixtureSystem.tryOpenFixtureWindow(fixture);
      }
    });
  }

  /**
   * The register uses the same art-sized body box as other fixtures.
   * @param {object} fixture
   */
  drawRegister(fixture) {
    const scene = this.shop;
    const sprite = scene.add
      .image(fixture.x, fixture.y, getFixtureType(fixture.type).texture)
      .setDisplaySize(fixture.gridDimensions.w * TILE_SIZE, fixture.gridDimensions.h * TILE_SIZE)
      .setInteractive({ useHandCursor: true });
    sprite.on("pointerdown", (pointer) => {
      if (pointer.event?.target === scene.game.canvas && !isWorldMouseBinding(pointer.event)) {
        scene.checkoutSystem.openRegisterWindow();
      }
    });
    scene.registerGroup.add(sprite); // see registerGroup in create()
    fixture.sprite = sprite;
  }

  refreshStockDisplay(shelf) {
    shelf?.stockDisplay?.sync();
    shelf?.stockItemsDisplay?.sync();
  }

  refreshStockDisplays() {
    for (const shelf of this.shop.fixtures.shelves()) this.refreshStockDisplay(shelf);
  }
}
