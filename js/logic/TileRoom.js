// ==========================================
// FILE: TileRoom.js
// ==========================================
// Renders the authored RoomLayout as floor/wall tiles and handles store expansion.
// Locked zones render nothing until unlocked; unlocking builds their tiles and tears
// down boundary walls that are no longer needed.
import {
  SHOP_BACK_WALL_HEIGHT, TILE_SIZE, ZONES, getBackroomDoorCell, getBackroomExitCell,
  getBackroomBounds, getBackroomInteriorBounds, getStoreDoorCell, zoneAt,
} from "./RoomLayout.js";
import { SHOP_TILES, shopWallStack } from "./ShopTiles.js";
import { BACKROOM_TILES, backroomFloorArt, backroomWallStack } from "./BackroomTiles.js";

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
    if (zone.backroom) {
      const bounds = getBackroomInteriorBounds(this.zones);
      return this.worldX(gx) < bounds.left || this.worldX(gx) >= bounds.right ||
        this.worldY(gy) < bounds.top || this.worldY(gy) >= bounds.bottom;
    }
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
    if (zone?.backroom) {
      const bounds = getBackroomBounds(this.zones);
      if (this.worldX(gx) >= bounds.x + bounds.width || this.worldY(gy) >= bounds.y + bounds.height) return false;
    }
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
   * True if the cell is unlocked floor that no room wall covers (doors count as walls).
   * Unlike isWalkable, this works while walls are still being built.
   */
  isFloor(gx, gy) {
    const zone = zoneAt(gx, gy, this.zones);
    return Boolean(zone && !zone.locked && !this.needsWallAt(zone, gx, gy));
  }

  /**
   * The art for a wall at this cell, bottom layer first: TileSetB's walls on the sales
   * floor, BackroomA's in the backroom.
   * @returns {string[]}
   */
  wallArtAt(gx, gy) {
    const zone = zoneAt(gx, gy, this.zones);
    const isOpen = (x, y) => this.isOpen(x, y);
    if (zone?.salesFloor) return shopWallStack(gx, gy, isOpen, getStoreDoorCell().gx);
    return backroomWallStack(gx, gy, isOpen);
  }

  // The doormat lies on the floor square just inside the front door; backroom floor is
  // edged where it meets a wall.
  floorArtAt(zone, gx, gy) {
    if (zone.backroom) return backroomFloorArt(gx, gy, (x, y) => this.isFloor(x, y));
    const door = getStoreDoorCell();
    return zone.salesFloor && gx === door.gx && gy === door.gy + 1 ? SHOP_TILES.doormat : zone.floorTile;
  }

  build() {
    for (const zone of this.zones) {
      if (zone.locked || zone.backroom) continue;
      this.buildZone(zone);
    }
    this.buildBackroom();
    this.refreshWallArt();
  }

  buildBackroom() {
    for (const [key] of [...this.wallCells]) {
      if (Number(key.split(",")[1]) >= getBackroomBounds(this.zones).y / TILE_SIZE) this.removeWall(key);
    }
    for (const [key, image] of [...this.floorCells]) {
      if (Number(key.split(",")[1]) < getBackroomBounds(this.zones).y / TILE_SIZE) continue;
      image.destroy();
      this.floorCells.delete(key);
    }
    const room = getBackroomBounds(this.zones);
    const floor = getBackroomInteriorBounds(this.zones);
    const rightColumn = Math.floor(floor.right / TILE_SIZE);
    for (let y = room.y; y < room.y + room.height; y += TILE_SIZE) {
      const gy = y / TILE_SIZE;
      const endRow = y === room.y || y === floor.bottom;
      this.addWall(0, gy, BACKROOM_TILES.border, false, false, {
        x: room.x, y, width: TILE_SIZE, height: TILE_SIZE,
      });
      const wallLeft = endRow ? rightColumn * TILE_SIZE : floor.right;
      this.addWall(rightColumn, gy, BACKROOM_TILES.border, false, false, {
        x: wallLeft, y, width: room.x + room.width - wallLeft, height: TILE_SIZE,
      });
      for (let x = floor.left; x < floor.right; x += TILE_SIZE) {
        const gx = x / TILE_SIZE;
        const width = Math.min(TILE_SIZE, floor.right - x);
        if (endRow) {
          const art = y === room.y ? BACKROOM_TILES.wall : BACKROOM_TILES.border;
          if (width === TILE_SIZE) {
            this.addWall(gx, gy, art);
          } else {
            this.wallCells.get(`${rightColumn},${gy}`).layers.push(
              this.scene.add.image(x + width / 2, y + TILE_SIZE / 2, art)
                .setDisplaySize(width, TILE_SIZE).setDepth(1),
            );
          }
          continue;
        }
        const atLeft = x === floor.left;
        const atRight = x + width === floor.right;
        const atBottom = y + TILE_SIZE === floor.bottom;
        const art = atBottom
          ? atLeft ? BACKROOM_TILES.floorBottomLeft : atRight ? BACKROOM_TILES.floorBottomRight : BACKROOM_TILES.floorBottom
          : atLeft ? BACKROOM_TILES.floorLeft : atRight ? BACKROOM_TILES.floorRight : BACKROOM_TILES.floor;
        const sourceWidth = width * 96 / TILE_SIZE;
        const cropX = atRight ? 96 - sourceWidth : 0;
        const image = this.scene.add.image(x - cropX * TILE_SIZE / 96, y, art)
          .setOrigin(0, 0).setDisplaySize(TILE_SIZE, TILE_SIZE)
          .setCrop(cropX, 0, sourceWidth, 96).setDepth(0);
        this.floorCells.set(`${gx},${gy}`, image);
      }
    }
    if (this.backroomDoorsAdded) {
      const exit = getBackroomExitCell();
      this.addWall(exit.gx, exit.gy, BACKROOM_TILES.wall, true, true);
    }
  }

  buildZone(zone) {
    for (let gy = zone.gridY; gy < zone.gridY + zone.gridH; gy++) {
      for (let gx = zone.gridX; gx < zone.gridX + zone.gridW; gx++) {
        const image = this.scene.add
          .image(this.worldX(gx), this.worldY(gy), this.floorArtAt(zone, gx, gy))
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
  drawStack(gx, gy, keys, bounds = null) {
    return keys.map((key) => this.scene.add
      .image(bounds ? bounds.x + bounds.width / 2 : this.worldX(gx),
        bounds ? bounds.y + bounds.height / 2 : this.worldY(gy), key)
      .setDisplaySize(bounds?.width ?? TILE_SIZE, bounds?.height ?? TILE_SIZE)
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
  addWall(gx, gy, art, permanent = false, door = false, bounds = null) {
    const key = `${gx},${gy}`;
    this.removeWall(key);
    // The bottom layer is the solid body; the rest is decoration on top of it.
    const [image, ...layers] = this.drawStack(gx, gy, [art].flat(), bounds);
    this.wallGroup.add(image);
    this.wallCells.set(key, { image, layers, permanent, door });
  }

  // Redraws every wall that isn't a door, since a wall's art depends on which side faces
  // out of the shop, and that changes as zones unlock. Backroom floor edges follow the walls.
  refreshWallArt() {
    for (const [key, { permanent, door }] of [...this.wallCells]) {
      if (door) continue;
      const [gx, gy] = key.split(",").map(Number);
      if (zoneAt(gx, gy, this.zones)?.backroom) continue;
      this.addWall(gx, gy, this.wallArtAt(gx, gy), permanent, door);
    }
  }

  // The backroom door and exit stay solid: pressing E in front of one moves the player
  // through to the other. The wall's face is drawn on both, and the scene stands an
  // animated glass door on each.
  addBackroomDoors() {
    this.backroomDoorsAdded = true;
    const door = getBackroomDoorCell();
    this.addWall(door.gx, door.gy, SHOP_TILES.backWall, true, true);
    const exit = getBackroomExitCell();
    this.addWall(exit.gx, exit.gy, BACKROOM_TILES.wall, true, true);
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
    if (zone.backroom) {
      this.buildBackroom();
      return this.getCameraBounds();
    }
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
    if (area === "backroom") return getBackroomBounds(this.zones);
    const inBackroom = area === "backroom";
    const unlocked = this.zones.filter((zone) => !zone.locked && Boolean(zone.backroom) === inBackroom);
    const minX = Math.min(...unlocked.map((z) => z.gridX)) * TILE_SIZE;
    const minY = Math.min(...unlocked.map((z) => z.gridY)) * TILE_SIZE - (inBackroom ? 0 : TILE_SIZE);
    const maxX = Math.max(...unlocked.map((z) => z.gridX + z.gridW)) * TILE_SIZE;
    const maxY = Math.max(...unlocked.map((z) => z.gridY + z.gridH)) * TILE_SIZE;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
}
