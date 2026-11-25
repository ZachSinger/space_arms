// ==========================================
// FILE: Partner.js
// ==========================================
// The co-op friend's shopkeeper in the host's shop: the red mechanic, walked by the controls
// the friend's game sends over. What the partner does with their hands is in PartnerActions.js.
import { PARTNER_LOOK, Player } from "../logic/Player.js";

const NAME_TAG_OFFSET_Y = 44;
// The friend's game repeats its controls every second; past this, they've gone quiet
// (game in the background), so the partner stops instead of walking on forever.
const INPUT_STALE_MS = 1600;

export class Partner extends Player {
  /**
   * @param {object} scene - the game scene
   * @param {number} x
   * @param {number} y
   * @param {string} name - shown above the partner's head
   */
  constructor(scene, x, y, name) {
    super(scene, x, y, PARTNER_LOOK);
    this.remoteInput = { x: 0, y: 0, dash: false };
    this.nameTag = scene.add.text(x, y, name, {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#fecaca",
      backgroundColor: "#0f172acc",
      padding: { x: 4, y: 1 },
    }).setOrigin(0.5, 1).setDepth(9000);
  }

  /** @param {{ x?: number, y?: number, dash?: boolean }} input */
  setRemoteInput(input) {
    const clamp = (value) => Math.max(-1, Math.min(1, Number(value) || 0));
    this.remoteInput = { x: clamp(input.x), y: clamp(input.y), dash: Boolean(input.dash) };
    this.inputAt = performance.now();
  }

  update(delta) {
    if (performance.now() - (this.inputAt ?? 0) > INPUT_STALE_MS) this.remoteInput = { x: 0, y: 0, dash: false };
    const { x, y, dash } = this.remoteInput;
    this.move(x, y, dash, delta);
  }

  stand() {
    this.sprite.body.setVelocity(0, 0);
    this.forceFacing(this.currentFacing);
  }

  // Runs after physics each frame so the tag never trails the partner. It rides above any
  // crates they're carrying.
  placeNameTag() {
    let top = this.sprite.y - NAME_TAG_OFFSET_Y;
    const highest = this.carriedCrates().at(-1)?.sprite;
    if (highest?.getBounds) top = Math.min(top, highest.getBounds().top - 2);
    this.nameTag.setPosition(Math.round(this.sprite.x), Math.round(top));
  }

  // While the shop is acting for the partner (see PartnerActions.withPartner), the shop's own
  // carried crates are the partner's; otherwise they're kept in the partner's hands object.
  carriedCrates() {
    if (this.scene.player === this) return super.carriedCrates();
    return this.carry?.carriedCrates ?? [];
  }

  isCarrying() {
    return this.carriedCrates().length > 0;
  }

  destroy() {
    this.nameTag.destroy();
    this.sprite.destroy();
  }
}
