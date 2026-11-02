import { database } from "../scenes/boot.js"; // the exported DatabaseManager singleton

const SPEED = 120; // px/sec; placeholder movement until real pathfinding (bible Step 10) lands

// Minimal placeholder customer: no art, no real pathfinding, no patience/queueing yet.
// Walks to a fixture, grabs one item (snapshotting its price per bible Step 6), walks to
// the register, then waits for the scene to resolve a player-driven checkout (Customer owns
// the sale logic; the scene only owns when/whether the checkout window is currently visible).
export class Customer {
  constructor({ scene, fixture, registerPoint, playerState, onArriveAtRegister, onComplete }) {
    this.scene = scene;
    this.fixture = fixture;
    this.registerPoint = registerPoint;
    this.playerState = playerState;
    this.onArriveAtRegister = onArriveAtRegister;
    this.onComplete = onComplete;

    this.state = "SEEK_SHELF";
    this.cart = []; // [{ itemId, price }]

    const spawnX = Phaser.Math.Between(40, 120);
    const spawnY = Phaser.Math.Between(80, scene.scale.height - 80);

    this.sprite = scene.add.rectangle(spawnX, spawnY, 20, 20, 0xfacc15);
    scene.physics.add.existing(this.sprite);
  }

  update() {
    switch (this.state) {
      case "SEEK_SHELF":
        this.moveToward(this.fixture.x, this.fixture.y, () => this.grabItem());
        break;
      case "SEEK_REGISTER":
        this.moveToward(this.registerPoint.x, this.registerPoint.y, () =>
          this.arriveAtRegister(),
        );
        break;
      case "AT_REGISTER":
        break; // holding position; waiting on the scene to open/queue the checkout window
      case "LEAVING":
        this.moveToward(-40, this.sprite.y, () => this.destroy());
        break;
    }
  }

  grabItem() {
    const slot = this.fixture.findAvailableSlot();
    const itemId = this.fixture.takeItem(slot);

    if (!itemId) {
      // Another customer already in transit beat them to the last unit; leave empty-handed
      // rather than queueing for a checkout with nothing to sell.
      this.state = "LEAVING";
      return;
    }

    const item = database.getItem(itemId);
    this.cart.push({ itemId, price: item.baseCost });
    this.state = "SEEK_REGISTER";
  }

  arriveAtRegister() {
    this.state = "AT_REGISTER";
    this.onArriveAtRegister(this);
  }

  // Called by the scene once the player has scanned every item and clicked Complete Sale.
  completeSale() {
    const total = this.cart.reduce((sum, entry) => sum + entry.price, 0);
    this.playerState.addCredits(total);
    this.playerState.addReputation(1);
    this.state = "LEAVING";
  }

  moveToward(targetX, targetY, onArrive) {
    const distance = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, targetX, targetY);

    if (distance < 6) {
      this.sprite.body.setVelocity(0, 0);
      onArrive();
      return;
    }

    const angle = Phaser.Math.Angle.Between(this.sprite.x, this.sprite.y, targetX, targetY);
    this.sprite.body.setVelocity(Math.cos(angle) * SPEED, Math.sin(angle) * SPEED);
  }

  destroy() {
    this.sprite.destroy();
    this.onComplete(this);
  }
}
