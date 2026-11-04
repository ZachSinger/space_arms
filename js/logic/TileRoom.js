// ==========================================
// FILE: TileRoom.js
// ==========================================
// Renders the authored RoomLayout as floor/wall tiles and handles store expansion.
// Locked zones render nothing until unlocked; unlocking builds their tiles and tears
// down boundary walls that are no longer needed.
import { TILE_SIZE, ZONES, zoneAt } from "./RoomLayout.js";

export class TileRoom {
  constructor(scene) {
    this.scene = scene;
    this.zones = ZONES.map((zone) => ({ ...zone }));
    this.wallCells = new Map(); // `${gx},${gy}` -> { image }
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
   * @param {object} zone
   * @param {number} gx
   * @param {number} gy
   */
  needsWallAt(zone, gx, gy) {
    return this.edgesOf(zone, gx, gy).some((edge) => {
      const neighbor = this.neighborZone(gx, gy, edge);
      if (!neighbor) return true;
      return neighbor.id !== zone.id && neighbor.locked;
    });
  }

  /**
   * True if the cell is in an unlocked zone and isn't a wall (fixtures are checked elsewhere).
   * @param {number} gx
   * @param {number} gy
   */
  isWalkable(gx, gy) {
    const zone = zoneAt(gx, gy, this.zones);
    if (!zone || zone.locked) return false;
    return !this.wallCells.has(`${gx},${gy}`);
  }

  build() {
    for (const zone of this.zones) {
      if (zone.locked) continue;
      this.buildZone(zone);
    }
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
          this.addWall(gx, gy, zone.wallTile);
        }
      }
    }
  }

  /**
   * Place a solid wall over a cell. Also used to divide two unlocked zones (e.g. the
   * Storeroom from the Sales Floor), which needsWallAt() never seals on its own.
   * @param {number} gx
   * @param {number} gy
   * @param {string} wallTileKey
   * @param {boolean} [permanent] - survives the wall teardown in unlockZone()
   */
  addWall(gx, gy, wallTileKey, permanent = false) {
    const previous = this.wallCells.get(`${gx},${gy}`);
    if (previous) this.wallGroup.remove(previous.image, true, true);
    const image = this.scene.add
      .image(this.worldX(gx), this.worldY(gy), wallTileKey)
      .setDisplaySize(TILE_SIZE, TILE_SIZE)
      .setDepth(1);
    this.wallGroup.add(image);
    this.wallCells.set(`${gx},${gy}`, { image, permanent });
  }

  openDoorway(gx, gy, doorTileKey) {
    const key = `${gx},${gy}`;
    const existingWall = this.wallCells.get(key);
    if (existingWall) {
      this.wallGroup.remove(existingWall.image, true, true);
      this.wallCells.delete(key);
    }

    this.scene.add
      .image(this.worldX(gx), this.worldY(gy), doorTileKey)
      .setDisplaySize(TILE_SIZE, TILE_SIZE)
      .setDepth(1);
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
        this.wallGroup.remove(entry.image, true, true);
        this.wallCells.delete(key);
      }
    }

    return this.getCameraBounds();
  }

  // Pixel bounding box across every currently-unlocked zone, for camera.setBounds().
  getCameraBounds() {
    const unlocked = this.zones.filter((zone) => !zone.locked);
    const minX = Math.min(...unlocked.map((z) => z.gridX)) * TILE_SIZE;
    const minY = Math.min(...unlocked.map((z) => z.gridY)) * TILE_SIZE;
    const maxX = Math.max(...unlocked.map((z) => z.gridX + z.gridW)) * TILE_SIZE;
    const maxY = Math.max(...unlocked.map((z) => z.gridY + z.gridH)) * TILE_SIZE;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
}
