// ==========================================
// FILE: TileRoom.js
// ==========================================
import { TILE_SIZE, ZONES, zoneAt } from "./RoomLayout.js";

// Renders the authored RoomLayout as a grid of floor/wall tile images, and owns
// the logic for "expanding" the store: locked zones render NOTHING at all
// (no floor, no walls -- they don't exist to the player yet) until unlocked,
// at which point their tiles are built on demand and any now-unnecessary
// boundary walls (on the zones around it) are torn down.
export class TileRoom {
  constructor(scene) {
    this.scene = scene;
    this.zones = ZONES; // mutable `locked` flags live directly on these objects
    this.wallCells = new Map(); // `${gx},${gy}` -> { image }
    this.floorCells = new Map(); // `${gx},${gy}` -> image
    // A static physics group (not loose per-image bodies) so that walls built later by
    // unlockZone() are automatically included in any collider already set up against
    // this group -- the scene only has to call physics.add.collider() once.
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
    return zoneAt(gx + dx, gy + dy);
  }

  // A perimeter cell needs a wall if any of its outward-facing edges hits the
  // edge of the whole authored map, or a neighboring zone that is locked (a
  // locked neighbor renders nothing, so its side must be sealed) or simply
  // doesn't exist yet in this.wallCells terms -- see buildZone().
  needsWallAt(zone, gx, gy) {
    return this.edgesOf(zone, gx, gy).some((edge) => {
      const neighbor = this.neighborZone(gx, gy, edge);
      if (!neighbor) return true;
      return neighbor.id !== zone.id && neighbor.locked;
    });
  }

  // Whether a customer/agent could ever stand at this grid cell -- used by the
  // pathfinder (see Pathfinder.js / GameScene.findPath). True only if the cell belongs to a
  // currently-unlocked zone and isn't one of this room's own wall tiles (fixture obstacles
  // like the shelf are a separate, scene-level concern -- see GameScene.isCellWalkable).
  isWalkable(gx, gy) {
    const zone = zoneAt(gx, gy);
    if (!zone || zone.locked) return false;
    return !this.wallCells.has(`${gx},${gy}`);
  }

  build() {
    for (const zone of this.zones) {
      if (zone.locked) continue; // locked zones render nothing until unlocked
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
          this.placeWall(zone, gx, gy);
        }
      }
    }
  }

  placeWall(zone, gx, gy) {
    const image = this.scene.add
      .image(this.worldX(gx), this.worldY(gy), zone.wallTile)
      .setDisplaySize(TILE_SIZE, TILE_SIZE)
      .setDepth(1);
    this.wallGroup.add(image); // staticGroup.add() creates the static body automatically
    this.wallCells.set(`${gx},${gy}`, { image });
  }

  // Carves a walkable doorway into an existing wall cell: removes its solid wall body and
  // swaps the visual for a door tile instead. Used for the shop's one real public
  // entrance/exit (see GameScene.storeDoor) -- customers (and the player) can now actually
  // walk through that specific cell, since isWalkable() just checks wallCells, and this
  // removes the cell from it exactly the same way unlockZone()'s wall-teardown does.
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

  // Opens a locked zone: builds its tiles for the first time, then re-checks
  // every neighboring zone's wall cells and tears down any that no longer
  // need to exist now that this zone actually renders. Returns the new
  // camera bounds to apply.
  unlockZone(zoneId) {
    const zone = this.zones.find((z) => z.id === zoneId);
    if (!zone || !zone.locked) return this.getCameraBounds();

    zone.locked = false;
    this.buildZone(zone);

    for (const [key, entry] of [...this.wallCells.entries()]) {
      const [gx, gy] = key.split(",").map(Number);
      const cellZone = zoneAt(gx, gy);
      if (cellZone && !cellZone.locked && !this.needsWallAt(cellZone, gx, gy)) {
        // remove(child, removeFromScene, destroyChild) -- keeps the group's internal
        // bookkeeping and the actual GameObject/body teardown consistent.
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

