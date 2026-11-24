// =============================================================================
// FILE: GoBacksBadge.js
// =============================================================================
// A "!" that floats over the player while abandoned items wait in the Go-Backs bin.
// =============================================================================

export class GoBacksBadge {
  constructor(shop) {
    this.shop = shop;
    this.text = shop.add.text(0, 0, "!", {
      fontFamily: "Courier New, monospace",
      fontSize: "20px",
      fontStyle: "bold",
      color: "#fbbf24",
      stroke: "#111827",
      strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(9000).setVisible(false);
  }

  refresh() {
    const count = this.shop.gameState.goBacks.stock.reduce((sum, entry) => sum + entry.quantity, 0);
    this.text.setVisible(count > 0);
    this.position();
  }

  position() {
    const player = this.shop.player;
    if (!this.text.visible || !player?.sprite) return;
    const bounds = player.sprite.getBounds();
    this.text.setScale(this.shop.cameraRig.popupScale()).setPosition(bounds.centerX, bounds.top - 2);
  }
}
