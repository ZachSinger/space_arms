// ==========================================
// FILE: CoopHost.js
// ==========================================
// The host's side of co-op, owned by the game scene. When a friend joins, their red partner
// appears next to the player and walks with the controls their game sends. Every update, the
// shop picture and the top bar's money and clock go back to the friend's game.
import { Partner } from "./Partner.js";
import { MIRROR_INTERVAL_MS, MirrorWriter, describeTexture } from "./DisplayMirror.js";

// Phaser's event names, written out so this file doesn't load Phaser itself (shop tests run without it).
const GAME_POST_RENDER = "postrender";
const SCENE_POST_UPDATE = "postupdate";
const PARTNER_SPAWN_OFFSET_X = 48;
const HUD_INTERVAL_MS = 250;
// Even when nothing moves, the friend hears from the host this often, so the link stays alive.
const KEEP_ALIVE_MS = 1000;
// How close the partner must stand below a door (and how far off to its side) to use it;
// a little more forgiving than the player's reach, since the friend sees the shop slightly late.
const PARTNER_DOOR_REACH = 48;
const PARTNER_DOOR_SIDE_REACH = 24;

export class CoopHost {
  /** @param {any} shop - the game scene */
  constructor(shop) {
    this.shop = shop;
    this.api = globalThis.window?.desktopApi?.coop ?? null;
    this.partner = null;
    this.status = null;
    this.writer = new MirrorWriter();
    this.lastSentAt = 0;
    this.lastHudAt = 0;
    this.lastHud = "";
    if (!this.api) return;
    this.unsubscribe = [
      this.api.onStatus((status) => this.handleStatus(status)),
      this.api.onMessage((text) => this.handleMessage(text)),
    ];
    void this.api.status().then((status) => this.handleStatus(status));
    shop.game.events.on(GAME_POST_RENDER, this.sendUpdate, this);
    shop.events.on(SCENE_POST_UPDATE, this.placeNameTag, this);
    shop.events.once("shutdown", () => this.destroy());
  }

  get friendConnected() {
    return Boolean(this.status?.role === "host" && this.status.connected);
  }

  handleStatus(status) {
    if (this.destroyed) return;
    this.status = status;
    if (this.friendConnected && !this.partner) this.addPartner(status.peerName ?? "Friend");
    else if (!this.friendConnected && this.partner) this.removePartner();
    this.shop.pauseMenu?.refreshCoop?.();
  }

  addPartner(name) {
    const { shop } = this;
    const { x, y } = shop.player.sprite;
    this.partner = new Partner(shop, x + PARTNER_SPAWN_OFFSET_X, y, name);
    shop.physics.add.collider(this.partner.sprite, shop.room.wallGroup);
    shop.physics.add.collider(this.partner.sprite, shop.obstacleGroup);
    shop.physics.add.collider(this.partner.sprite, shop.registerGroup);
    // Doors slide open while the partner stands at them, as they do for the player.
    this.stopHoldingDoors = shop.areas?.addDoorUser((portal) => portal === this.partnerDoor());
    this.writer.reset();
    shop.messages.show(`${name} joined your shop.`);
  }

  removePartner() {
    const name = this.partner.nameTag.text;
    this.stopHoldingDoors?.();
    this.partner.destroy();
    this.partner = null;
    this.shop.messages.show(`${name} left your shop.`);
  }

  handleMessage(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.t === "input") this.partner?.setRemoteInput(message);
    else if (message.t === "use") this.usePartnerDoor();
    else if (message.t === "sync") {
      this.writer.reset();
      this.lastHud = "";
      this.lastHudAt = 0;
    } else if (message.t === "texture?" && typeof message.key === "string") {
      const texture = describeTexture(this.shop.textures, message.key);
      if (texture) this.send({ t: "texture", ...texture });
    }
  }

  /**
   * Called from the game scene's update.
   * @param {number} delta - ms
   * @param {boolean} frozen - the shop's clock is stopped, so nobody moves
   */
  update(delta, frozen) {
    this.frozen = frozen;
    if (!this.partner) return;
    if (frozen) this.partner.stand();
    else this.partner.update(delta);
  }

  /** The door the partner is standing at, in whichever area they're in, or null. */
  partnerDoor() {
    const areas = this.shop.areas;
    const sprite = this.partner?.sprite;
    if (!areas || !sprite) return null;
    const { x, y } = sprite;
    const area = areas.areaAt(x, y);
    return areas.portals.find((portal) => {
      if (portal.area !== area) return false;
      const bounds = portal.standingBounds;
      if (bounds) return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
      const below = y - portal.door.y;
      return Math.abs(x - portal.door.x) < PARTNER_DOOR_SIDE_REACH && below > 0 && below <= PARTNER_DOOR_REACH;
    }) ?? null;
  }

  // The friend pressed their use key: at a door, the partner goes through it.
  usePartnerDoor() {
    if (this.frozen) return;
    const portal = this.partnerDoor();
    if (!portal) return;
    const far = portal.partner ?? this.shop.areas.portalBetween(portal.to, portal.area);
    if (!far) return;
    this.partner.teleportTo(far.front.x, far.front.y);
    this.partner.forceFacing(far.arrivalFacing ?? "down");
  }

  placeNameTag() {
    this.partner?.placeNameTag();
  }

  send(message) {
    this.api.send(JSON.stringify(message));
  }

  // After each drawn frame (even while paused), at most every MIRROR_INTERVAL_MS.
  sendUpdate() {
    if (!this.friendConnected) return;
    const now = performance.now();
    if (now - this.lastSentAt < MIRROR_INTERVAL_MS) return;
    const snapshot = this.writer.snapshot(this.shop.children.list);
    const message = { t: "snap", ...(snapshot ?? {}), f: this.writer.idOf(this.partner?.sprite) };
    if (now - this.lastHudAt >= HUD_INTERVAL_MS) {
      this.lastHudAt = now;
      const hud = this.readHud();
      if (JSON.stringify(hud) !== this.lastHud) {
        this.lastHud = JSON.stringify(hud);
        message.hud = hud;
      }
    }
    if (!snapshot && !message.hud && now - this.lastSentAt < KEEP_ALIVE_MS) return;
    this.lastSentAt = now;
    message.bg = this.shop.cameras.main.backgroundColor.rgba;
    // The outline of the room the partner is in, so the friend's camera can zoom and stop at
    // its edges like the host's.
    const bounds = this.partnerRoomBounds();
    if (bounds) message.sb = [bounds.x, bounds.y, bounds.width, bounds.height];
    this.send(message);
  }

  partnerRoomBounds() {
    const { areas, room } = this.shop;
    const sprite = this.partner?.sprite;
    if (areas && sprite) return areas.boundsFor(areas.areaAt(sprite.x, sprite.y));
    return room?.getCameraBounds?.() ?? null;
  }

  // The friend's top bar shows the same money and clock as the host's.
  readHud() {
    const text = (id) => document.getElementById(id)?.textContent?.trim() ?? "";
    return { money: text("hud-credits"), time: text("hud-shift-time"), host: this.status?.localName ?? "" };
  }

  destroy() {
    this.destroyed = true;
    // Leaving the shop closes it to the friend too, instead of leaving them on a frozen picture.
    if (this.status?.role === "host") void this.api.leave();
    this.unsubscribe?.forEach((unsubscribe) => unsubscribe());
    this.shop.game.events.off(GAME_POST_RENDER, this.sendUpdate, this);
    this.shop.events.off(SCENE_POST_UPDATE, this.placeNameTag, this);
    this.partner = null;
  }
}
