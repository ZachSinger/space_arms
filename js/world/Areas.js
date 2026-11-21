// ==========================================
// FILE: Areas.js
// ==========================================
// The shop's separate areas (the sales floor and the backroom), which one the player is in,
// and the doors between them. A door is one side of a portal pair: pressing E in front of it
// moves the player to the floor just inside its partner, in the other area. New areas (a
// shooting range downstairs, say) register their bounds and portal pairs.
import { AnimatedDoor, BACKROOM_DOOR_SPRITE } from "../logic/SlidingDoor.js";
import {
  TILE_SIZE, getBackroomDoorCell, getBackroomExitCell, getBackroomLink, isBackroomRow,
} from "../logic/RoomLayout.js";
import { controlLabel } from "../input/InputDevice.js";

// The ids match TileRoom.getCameraBounds' area names.
export const AREA = Object.freeze({ SHOP: "shop", BACKROOM: "backroom" });

// How far (in pixels) the player may stand from a backroom door, and off to its side, and still use it.
const DOOR_GAP = 24;
const DOOR_SIDE_REACH = 20;

/** The area a grid row belongs to, built or not. */
export function areaAtRow(gridY) {
  return isBackroomRow(gridY) ? AREA.BACKROOM : AREA.SHOP;
}

/** The area a world point belongs to (only its height matters). */
export function areaAt(worldY) {
  return areaAtRow(Math.floor(worldY / TILE_SIZE));
}

/**
 * @typedef {object} Portal
 * @property {string} area - the area the door stands in
 * @property {string} to - the area it leads to
 * @property {{ x: number, y: number }} door - the door's tile center
 * @property {{ x: number, y: number }} front - the floor tile just inside it, where arrivals land
 * @property {AnimatedDoor} [animation]
 * @property {{ x: number, y: number, width: number, height: number }} [standingBounds]
 * @property {string} [hint]
 * @property {string} [arrivalFacing]
 * @property {Portal} [partner]
 */

export class Areas {
  /** @param {object} shop - the game scene, with its room already built */
  constructor(shop) {
    this.shop = shop;
    this.playerArea = AREA.SHOP;
    this.revision = 0;
    this.definitions = new Map([
      [AREA.SHOP, { title: "SALES FLOOR", getBounds: () => shop.room.getCameraBounds() }],
      [AREA.BACKROOM, { title: "BACKROOM", getBounds: () => shop.room.getCameraBounds(AREA.BACKROOM) }],
    ]);
    const room = shop.room;
    // The Sales Floor's door to the backroom, and the backroom's exit back out. Both are solid.
    room.addBackroomDoors();
    const link = getBackroomLink();
    const at = ({ gx, gy }) => ({ x: room.worldX(gx), y: room.worldY(gy) });
    // The glass doors slide open while the player stands in front of them, on the bottom
    // edge of the back wall where the floor starts.
    const portal = (area, to, cell, front) => {
      const door = at(cell);
      return {
        area, to, door, front: at(front),
        animation: new AnimatedDoor(shop, { x: door.x, y: door.y + TILE_SIZE / 2, sprite: BACKROOM_DOOR_SPRITE }),
      };
    };
    /** @type {Portal[]} */
    this.portals = [
      portal(AREA.SHOP, AREA.BACKROOM, getBackroomDoorCell(), link.shop),
      portal(AREA.BACKROOM, AREA.SHOP, getBackroomExitCell(), link.backroom),
    ];
    this.registerInteractions();
  }

  /** Register a module-owned room, including its floor checks for shared navigation. */
  registerArea(id, { title, getBounds, isWalkable, walkabilityKey }) {
    if (typeof id !== "string" || !id || this.definitions.has(id)) {
      throw new Error(`Invalid or duplicate area "${id}".`);
    }
    if (typeof title !== "string" || !title.trim() ||
      [getBounds, isWalkable, walkabilityKey].some((method) => typeof method !== "function")) {
      throw new TypeError("An area requires a title, bounds, floor checks, and a walkability key.");
    }
    if (typeof walkabilityKey() !== "string") throw new TypeError("An area's walkability key must be a string.");
    const definition = { title, getBounds, isWalkable, walkabilityKey };
    const bounds = getBounds();
    this.validateBounds(bounds);
    for (const [otherId] of this.definitions) {
      const other = this.boundsFor(otherId);
      if (bounds.x < other.x + other.width && bounds.x + bounds.width > other.x &&
        bounds.y < other.y + other.height && bounds.y + bounds.height > other.y) {
        throw new Error(`Area "${id}" overlaps area "${otherId}".`);
      }
    }
    this.definitions.set(id, definition);
    this.revision += 1;
    return () => {
      if (this.definitions.get(id) !== definition) return;
      if (this.playerArea === id || this.portals.some((portal) => portal.area === id || portal.to === id)) {
        throw new Error(`Leave area "${id}" and remove its portals before unregistering it.`);
      }
      this.definitions.delete(id);
      this.revision += 1;
    };
  }

  validateBounds(bounds) {
    if (!bounds || !["x", "y", "width", "height"].every((key) => Number.isFinite(bounds[key])) ||
      bounds.width <= 0 || bounds.height <= 0) {
      throw new TypeError("Area bounds must have finite coordinates and positive dimensions.");
    }
  }

  boundsFor(id) {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown area "${id}".`);
    const bounds = definition.getBounds();
    this.validateBounds(bounds);
    return bounds;
  }

  titleFor(id) {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown area "${id}".`);
    return definition.title;
  }

  areaAt(worldX, worldY) {
    for (const [id] of this.definitions) {
      if (id === AREA.SHOP || id === AREA.BACKROOM) continue;
      const bounds = this.boundsFor(id);
      if (worldX >= bounds.x && worldX < bounds.x + bounds.width &&
        worldY >= bounds.y && worldY < bounds.y + bounds.height) return id;
    }
    return areaAt(worldY);
  }

  isWalkable(gx, gy) {
    const area = this.areaAt((gx + 0.5) * TILE_SIZE, (gy + 0.5) * TILE_SIZE);
    const definition = this.definitions.get(area);
    if (!definition.isWalkable) return this.shop.room.isWalkable(gx, gy);
    const walkable = definition.isWalkable(gx, gy);
    if (typeof walkable !== "boolean") throw new TypeError(`Area "${area}" floor checks must return a boolean.`);
    return walkable;
  }

  navigationWalkabilityKey() {
    const room = this.shop.room;
    if (typeof room.navigationWalkabilityKey !== "function") return null;
    const roomKey = room.navigationWalkabilityKey();
    if (typeof roomKey !== "string") throw new TypeError("The room's navigation walkability key must be a string.");
    const keys = [roomKey, this.revision];
    for (const [id, definition] of this.definitions) {
      if (!definition.walkabilityKey) continue;
      const key = definition.walkabilityKey();
      if (typeof key !== "string") throw new TypeError(`Area "${id}" walkability key must be a string.`);
      const bounds = this.boundsFor(id);
      keys.push([id, key, bounds.x, bounds.y, bounds.width, bounds.height]);
    }
    return JSON.stringify(keys);
  }

  /** Endpoints supply their own hints; stairs use standingBounds instead of facing a door. */
  registerPortalPair(first, second) {
    for (const endpoint of [first, second]) {
      if (!this.definitions.has(endpoint.area) ||
        typeof endpoint.hint !== "string" || !endpoint.hint.trim() ||
        ![endpoint.door?.x, endpoint.door?.y, endpoint.front?.x, endpoint.front?.y].every(Number.isFinite)) {
        throw new TypeError("Portal endpoints require a registered area, hint, door, and arrival point.");
      }
      if (endpoint.standingBounds) this.validateBounds(endpoint.standingBounds);
      if (endpoint.arrivalFacing && !["up", "down", "left", "right"].includes(endpoint.arrivalFacing)) {
        throw new TypeError("A portal's arrival facing must be up, down, left, or right.");
      }
    }
    if (first.area === second.area) throw new Error("A portal pair must connect different areas.");
    const near = { ...first, to: second.area };
    const far = { ...second, to: first.area };
    near.partner = far;
    far.partner = near;
    this.portals.push(near, far);
    let removed = false;
    return () => {
      if (removed || !this.portals.includes(near)) return;
      removed = true;
      this.portals = this.portals.filter((portal) => portal !== near && portal !== far);
      near.animation?.destroy();
      far.animation?.destroy();
    };
  }

  registerInteractions() {
    const shop = this.shop;
    this.unregisterInteractions = shop.interactables.registerProvider("portals", () => {
      const portal = this.nearbyPortal();
      if (!portal) return [];
      return [{
        id: `door:${portal.area}:${this.portals.indexOf(portal)}`,
        kind: "portal",
        target: portal,
        priority: 10,
        range: 0,
        distanceFrom: () => 0,
        getActions: () => [{
          action: "interact",
          hint: `${controlLabel("interact")}: ${portal.hint ?? (
            portal.to === AREA.SHOP ? "Go back out to the shop" : "Go into the backroom"
          )}`,
          perform: () => this.goThrough(portal),
        }],
      }];
    });
  }

  /** The door in `from` that leads to `to`. */
  portalBetween(from, to) {
    return this.portals.find((portal) => portal.area === from && portal.to === to) ?? null;
  }

  /** Where someone coming into an area through its door lands. */
  arrivalIn(area) {
    return this.portals.find((portal) => portal.area === area)?.front ?? null;
  }

  /** Portal legs between rooms, including trips through an intermediate room. */
  crossings(fromX, fromY, toX, toY) {
    const from = this.areaAt(fromX, fromY);
    const to = this.areaAt(toX, toY);
    const queue = [{ area: from, legs: [] }];
    const visited = new Set([from]);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (current.area === to) return current.legs;
      for (const portal of this.portals) {
        if (portal.area !== current.area || visited.has(portal.to)) continue;
        const partner = portal.partner ?? this.portalBetween(portal.to, portal.area);
        if (!partner) throw new Error(`Portal from "${portal.area}" to "${portal.to}" has no partner.`);
        visited.add(portal.to);
        queue.push({
          area: portal.to,
          legs: [...current.legs, { near: portal.front, far: partner.front }],
        });
      }
    }
    return null;
  }

  /**
   * The door the player is standing in front of, in the area he's in, or null. E goes
   * through it.
   * @returns {Portal | null}
   */
  nearbyPortal(player = this.shop.player) {
    const shop = this.shop;
    if (!player?.sprite) return null;
    const { x, y } = player.sprite;
    for (const portal of this.portals) {
      if (portal.area !== this.playerArea) continue;
      if (portal.standingBounds) {
        const bounds = portal.standingBounds;
        if (x >= bounds.x && x < bounds.x + bounds.width &&
          y >= bounds.y && y < bounds.y + bounds.height) return portal;
        continue;
      }
      if (player.currentFacing !== "up") continue;
      const { door } = portal;
      // Pressed against the door the player stands half a tile below its center.
      const below = y - door.y;
      if (Math.abs(x - door.x) >= DOOR_SIDE_REACH || below <= 0 || below > TILE_SIZE / 2 + DOOR_GAP) continue;
      // A fixture beside the door wins when the player is standing nearer to it.
      const target = shop.interactables?.findTarget(
        "interact",
        shop.interactionSystem.getInteractionOrigin(),
        null,
        player,
        shop.input,
        "fixture",
        { excludeProviders: ["portals", "fixture-move"] },
      );
      if (target?.kind === "fixture" && Math.abs(x - target.target.x) < Math.abs(x - door.x)) return null;
      return portal;
    }
    return null;
  }

  /**
   * Moves the player (and anything they carry) through a door, arriving on the floor just
   * inside its partner, facing away from it.
   * @param {Portal} portal
   */
  goThrough(portal) {
    const shop = this.shop;
    const partner = portal.partner ?? this.portalBetween(portal.to, portal.area);
    if (!partner) throw new Error(`Portal from "${portal.area}" to "${portal.to}" has no partner.`);
    this.playerArea = portal.to;
    const arrival = partner.front;
    shop.player.teleportTo(arrival.x, arrival.y);
    shop.player.forceFacing(partner.arrivalFacing ?? "down");
    shop.crateSystem.syncCarriedCrate();
    shop.cameraRig.refresh();
    shop.debugInfo?.record(portal.to === AREA.BACKROOM ? "entered-backroom" :
      portal.area === AREA.BACKROOM ? "left-backroom" : "changed-area", { from: portal.area, to: portal.to });
  }

  // Each door opens while the player stands in front of it.
  update(delta) {
    const near = this.nearbyPortal();
    for (const portal of this.portals) portal.animation?.update(delta, portal === near);
  }

  destroy() {
    this.unregisterInteractions?.();
    const portals = this.portals;
    this.portals = [];
    for (const portal of portals) portal.animation?.destroy();
  }
}
