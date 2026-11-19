// ==========================================
// FILE: Areas.js
// ==========================================
// The shop's separate areas (the sales floor and the backroom), which one the player is in,
// and the doors between them. A door is one side of a portal pair: pressing E in front of it
// moves the player to the floor just inside its partner, in the other area. New areas (a
// shooting range downstairs, say) add their own portal pair here.
import { AnimatedDoor, BACKROOM_DOOR_SPRITE } from "../logic/SlidingDoor.js";
import {
  TILE_SIZE, getBackroomDoorCell, getBackroomExitCell, getBackroomLink, isBackroomRow,
} from "../logic/RoomLayout.js";

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
 * @property {AnimatedDoor} animation
 */

export class Areas {
  /** @param {object} shop - the game scene, with its room already built */
  constructor(shop) {
    this.shop = shop;
    this.playerArea = AREA.SHOP;
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
  }

  /** The door in `from` that leads to `to`. */
  portalBetween(from, to) {
    return this.portals.find((portal) => portal.area === from && portal.to === to) ?? null;
  }

  /** Where someone coming into an area through its door lands. */
  arrivalIn(area) {
    return this.portals.find((portal) => portal.area === area)?.front ?? null;
  }

  /**
   * For a walk between two points in different areas: the floor spot by the door on the
   * starting side, and the matching spot on the far side. Null when both are in one area.
   */
  crossing(fromY, toY) {
    const from = areaAt(fromY);
    const to = areaAt(toY);
    if (from === to) return null;
    const near = this.portalBetween(from, to);
    const far = this.portalBetween(to, from);
    return near && far ? { near: near.front, far: far.front } : null;
  }

  /**
   * The door the player is standing in front of, in the area he's in, or null. E goes
   * through it.
   * @returns {Portal | null}
   */
  nearbyPortal() {
    const shop = this.shop;
    if (!shop.player?.sprite) return null;
    if (shop.player.currentFacing !== "up") return null;
    const { x, y } = shop.player.sprite;
    for (const portal of this.portals) {
      if (portal.area !== this.playerArea) continue;
      const { door } = portal;
      // Pressed against the door the player stands half a tile below its center.
      const below = y - door.y;
      if (Math.abs(x - door.x) >= DOOR_SIDE_REACH || below <= 0 || below > TILE_SIZE / 2 + DOOR_GAP) continue;
      // A fixture beside the door wins when the player is standing nearer to it.
      const target = shop.interactables?.findTarget("interact", shop.getInteractionOrigin());
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
    this.playerArea = portal.to;
    const arrival = this.portalBetween(portal.to, portal.area).front;
    shop.player.teleportTo(arrival.x, arrival.y);
    shop.player.forceFacing("down");
    shop.syncCarriedCrate();
    shop.cameraRig.refresh();
    shop.debugInfo?.record(portal.to === AREA.BACKROOM ? "entered-backroom" : "left-backroom", {});
  }

  // Each door opens while the player stands in front of it.
  update(delta) {
    const near = this.nearbyPortal();
    for (const portal of this.portals) portal.animation.update(delta, portal === near);
  }

  destroy() {
    for (const portal of this.portals) portal.animation.destroy();
  }
}
