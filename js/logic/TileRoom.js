// ==========================================
// FILE: TileRoom.js
// ==========================================
// Renders the authored RoomLayout as floor/wall tiles and handles store expansion.
// Locked zones render nothing until unlocked; unlocking builds their tiles and tears
// down boundary walls that are no longer needed.
import {
  BACKROOM_DOOR_TILE, SHOP_BACK_WALL_HEIGHT, TILE_SIZE, ZONES, getBackroomDoorCell, getBackroomExitCell, zoneAt,
} from "./RoomLayout.js";
import { BACKROOM_PASSAGE_LOWER, BACKROOM_PASSAGE_UPPER, shopWallStack } from "./ShopTiles.js";

export class TileRoom {
  constructor(scene) {
    this.scene = scene;
    this.zones = ZONES.map((zone) => ({ ...zone }));
    this.wallCells = new Map(); // `${gx},${gy}` -> { image (solid), layers (art on top), permanent, door }
    this.floorCells = new Map(); // `${gx},${gy}` -> image
    // One static group so walls built later by unlockZone() join existing colliders.
    this.wallGroup = scene.physics.add.staticGroup();
    this.build();
  }

  worldX(gridX) {
    return gridX * TILE_SIZE + TILE_SIZE / 2;
  }

  worldY(gridY) {
    return gridY * TILE_SIZE + TILE_SIZE / 2;
  }

  edgesOf(zone, gx, gy) {
    const edges = [];
    if (gy === zone.gridY) edges.push("north");
    if (gy === zone.gridY + zone.gridH - 1) edges.push("south");
    if (gx === zone.gridX) edges.push("west");
    if (gx === zone.gridX + zone.gridW - 1) edges.push("east");
    return edges;
  }

  neighborZone(gx, gy, edge) {
    const offsets = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
    const [dx, dy] = offsets[edge];
    return zoneAt(gx + dx, gy + dy, this.zones);
  }

  /**
   * A perimeter cell needs a wall if any outward edge faces the map edge or a locked zone.
   * Along the top of the map, sales-floor walls are two tiles tall.
   * @param {object} zone
   * @param {number} gx
   * @param {number} gy
   */
  needsWallAt(zone, gx, gy) {
    if (zone.salesFloor && gy === zone.gridY + SHOP_BACK_WALL_HEIGHT - 1 && !zoneAt(gx, zone.gridY - 1, this.zones)) {
      return true;
    }
    return this.edgesOf(zone, gx, gy).some((edge) => {
      const neighbor = this.neighborZone(gx, gy, edge);
      if (!neighbor) return true;
      return neighbor.id !== zone.id && neighbor.locked;
    });
  }

  isOpen(gx, gy) {
    const zone = zoneAt(gx, gy, this.zones);
    return Boolean(zone && !zone.locked);
  }

  /**
   * True if the cell is in an unlocked zone and isn't a wall (fixtures are checked elsewhere).
   * @param {number} gx
   * @param {number} gy
   */
  isWalkable(gx, gy) {
    return this.isOpen(gx, gy) && !this.wallCells.has(`${gx},${gy}`);
  }

  /**
   * The art for a wall at this cell, bottom layer first: ShopA's walls on the sales floor,
   * the zone's single wall tile elsewhere.
   * @returns {string[]}
   */
  wallArtAt(gx, gy) {
    const zone = zoneAt(gx, gy, this.zones);
    if (zone?.salesFloor) return shopWallStack(gx, gy, (x, y) => this.isOpen(x, y));
    return [zone.wallTile];
  }

  build() {
    for (const zone of this.zones) {
      if (zone.locked) continue;
      this.buildZone(zone);
    }
    this.refreshWallArt();
  }

  buildZone(zone) {
    for (let gy = zone.gridY; gy < zone.gridY + zone.gridH; gy++) {
      for (let gx = zone.gridX; gx < zone.gridX + zone.gridW; gx++) {
        const image = this.scene.add
          .image(this.worldX(gx), this.worldY(gy), zone.floorTile)
          .setDisplaySize(TILE_SIZE, TILE_SIZE)
          .setDepth(0);
        this.floorCells.set(`${gx},${gy}`, image);

        if (this.needsWallAt(zone, gx, gy)) {
          this.addWall(gx, gy, this.wallArtAt(gx, gy));
        }
      }
    }
  }

  // Draws a stack of tile images over a cell, bottom layer first.
  drawStack(gx, gy, keys) {
    return keys.map((key) => this.scene.add
      .image(this.worldX(gx), this.worldY(gy), key)
      .setDisplaySize(TILE_SIZE, TILE_SIZE)
      .setDepth(1));
  }

  removeWall(key) {
    const entry = this.wallCells.get(key);
    if (!entry) return;
    this.wallGroup.remove(entry.image, true, true);
    for (const image of entry.layers) image.destroy();
    this.wallCells.delete(key);
  }

  /**
   * Place a solid wall over a cell.
   * @param {number} gx
   * @param {number} gy
   * @param {string | string[]} art - texture key(s), bottom layer first
   * @param {boolean} [permanent] - survives the wall teardown in unlockZone()
   * @param {boolean} [door] - door art, kept when the walls around it are redrawn
   */
  addWall(gx, gy, art, permanent = false, door = false) {
    const key = `${gx},${gy}`;
    this.removeWall(key);
    // The bottom layer is the solid body; the rest is decoration on top of it.
    const [image, ...layers] = this.drawStack(gx, gy, [art].flat());
    this.wallGroup.add(image);
    this.wallCells.set(key, { image, layers, permanent, door });
  }

  // Redraws every wall that isn't a door, since a wall's art depends on which side faces
  // out of the shop, and that changes as zones unlock.
  refreshWallArt() {
    for (const [key, { permanent, door }] of [...this.wallCells]) {
      if (door) continue;
      const [gx, gy] = key.split(",").map(Number);
      this.addWall(gx, gy, this.wallArtAt(gx, gy), permanent, door);
    }
  }

  // The backroom door and exit stay solid: walking into one moves the player through to
  // the other (see GameScene.updateBackroomDoors). On the shop side the door is ShopA's
  // open gap in the back wall; the backroom side has door art.
  addBackroomDoors() {
    const door = getBackroomDoorCell();
    this.addWall(door.gx, door.gy - 1, BACKROOM_PASSAGE_UPPER, true, true);
    this.addWall(door.gx, door.gy, BACKROOM_PASSAGE_LOWER, true, true);
    const exit = getBackroomExitCell();
    this.addWall(exit.gx, exit.gy, BACKROOM_DOOR_TILE, true, true);
  }

  /**
   * Make a wall cell walkable, optionally drawing art there that isn't solid.
   * @param {number} gx
   * @param {number} gy
   * @param {string | string[] | null} [art] - texture key(s), bottom layer first
   */
  openDoorway(gx, gy, art = null) {
    this.removeWall(`${gx},${gy}`);
    if (art) this.drawStack(gx, gy, [art].flat());
  }

  /**
   * Build a locked zone's tiles and tear down neighboring walls it no longer needs.
   * @param {string} zoneId
   * @returns {{ x: number, y: number, width: number, height: number }} new camera bounds
   */
  unlockZone(zoneId) {
    const zone = this.zones.find((z) => z.id === zoneId);
    if (!zone || !zone.locked) return this.getCameraBounds();

    zone.locked = false;
    this.buildZone(zone);

    for (const [key, entry] of [...this.wallCells.entries()]) {
      const [gx, gy] = key.split(",").map(Number);
      const cellZone = zoneAt(gx, gy, this.zones);
      if (!entry.permanent && cellZone && !cellZone.locked && !this.needsWallAt(cellZone, gx, gy)) {
        this.removeWall(key);
      }
    }
    this.refreshWallArt();

    return this.getCameraBounds();
  }

  // Pixel bounding box across every unlocked zone of one area: "shop" (the sales floor the
  // main camera shows) or "backroom" (shown in its own window). The shop's box includes one
  // empty tile row above the map so the top wall isn't flush with the screen edge. No zone
  // exists there, so it can never be built on or expanded into.
  getCameraBounds(area = "shop") {
    const inBackroom = area === "backroom";
    const unlocked = this.zones.filter((zone) => !zone.locked && Boolean(zone.backroom) === inBackroom);
    const minX = Math.min(...unlocked.map((z) => z.gridX)) * TILE_SIZE;
    const minY = Math.min(...unlocked.map((z) => z.gridY)) * TILE_SIZE - (inBackroom ? 0 : TILE_SIZE);
    const maxX = Math.max(...unlocked.map((z) => z.gridX + z.gridW)) * TILE_SIZE;
    const maxY = Math.max(...unlocked.map((z) => z.gridY + z.gridH)) * TILE_SIZE;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
}
