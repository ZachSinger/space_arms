import { DialogueWindow } from "../logic/DialogueWindow.js";
import { WindowManager } from "../logic/WindowManager.js";
import { UIWindow } from "../logic/UIWindow.js";
import { InventoryRenderer } from "../logic/InventoryRenderer.js";
import { PlayerState } from "../logic/PlayerState.js";
import { HUDController } from "../logic/HUDController.js";
import { Fixture } from "../logic/ShopInventory.js";
import { Customer } from "../logic/Customer.js";
import { CheckoutWindow } from "../logic/CheckoutWindow.js";
import { database } from "./boot.js"; // the exported DatabaseManager singleton

const GRID_CELL_SIZE = 48; // px per Fixture gridDimensions unit; placeholder scale until real fixture art lands
const CUSTOMER_SPAWN_DELAY_MS = 4000;

export class GameScene extends Phaser.Scene {
  constructor() {
    super("scene-game");
  }

  preload() {}

  create() {
    this.playerState = new PlayerState();
    this.hud = new HUDController(this.playerState);

    this.dialogue = new DialogueWindow({
      onComplete: () => console.log("Dialogue finished"),
    });

    this.dialogue.show(
      "Welcome, dealer. A cargo shuttle will arrive shortly. Review its manifest before accepting delivery.",
    );

    this.windowManager = new WindowManager();
    this.inventoryWindow = new UIWindow(
      {
        id: "inventory-window",
        title: "INVENTORY DATABASE",
        contentHTML: InventoryRenderer.generateHTML(database),
        width: "40vw",
        height: "60vh",
        x: 60,
        y: 60,
      },
      this.windowManager,
    );
    this.disableInventoryNavigation = InventoryRenderer.enableListNavigation(
      this.inventoryWindow.element,
    );

    this.input.keyboard.on("keydown-I", () =>
      this.inventoryWindow.openWindow(),
    );

    // --- Vertical slice: one hand-seeded shelf, one customer loop, one register ---
    // Placeholder rectangles stand in for real fixture/register/customer art until it lands.
    this.fixture = new Fixture({
      id: "fixture_demo_01",
      displayType: "universal",
      x: 0,
      y: 0,
      gridDimensions: { w: 2, h: 1 },
      slots: [{ itemId: "wpn_rif_01", quantity: 3, x: 0, y: 0 }],
    });
    this.registerPoint = { x: 0, y: 0 };
    this.fixtureGraphics = this.drawFixture(this.fixture);
    this.registerGraphics = this.drawRegister();

    this.checkoutWindow = new CheckoutWindow(this.windowManager);
    this.registerQueue = [];
    this.activeCheckoutCustomer = null;

    const { width, height } = this.scale;
    this.layout(width, height);
    this.handleResize = (gameSize) => this.layout(gameSize.width, gameSize.height);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);

    this.customers = [];
    this.spawnTimer = this.time.addEvent({
      delay: CUSTOMER_SPAWN_DELAY_MS,
      loop: true,
      callback: () => this.spawnCustomer(),
    });
    this.spawnCustomer(); // first customer immediately so the loop is visible right away

    this.events.once("shutdown", () => {
      this.dialogue.destroy();
      this.disableInventoryNavigation();
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.spawnTimer.remove();
    });
  }

  drawFixture(fixture) {
    const width = fixture.gridDimensions.w * GRID_CELL_SIZE;
    const height = fixture.gridDimensions.h * GRID_CELL_SIZE;
    const rect = this.add
      .rectangle(0, 0, width, height, 0x334155)
      .setStrokeStyle(2, 0x38bdf8);
    const label = this.add
      .text(0, 0, "SHELF", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#94a3b8",
      })
      .setOrigin(0.5);
    return { rect, label };
  }

  drawRegister() {
    const rect = this.add
      .rectangle(0, 0, 64, 48, 0x1e293b)
      .setStrokeStyle(2, 0x10b981);
    const label = this.add
      .text(0, 0, "REGISTER", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#10b981",
      })
      .setOrigin(0.5);
    return { rect, label };
  }

  layout(width, height) {
    this.fixture.x = width * 0.25;
    this.fixture.y = height * 0.4;
    this.fixtureGraphics.rect.setPosition(this.fixture.x, this.fixture.y);
    this.fixtureGraphics.label.setPosition(this.fixture.x, this.fixture.y);

    this.registerPoint.x = width * 0.75;
    this.registerPoint.y = height * 0.65;
    this.registerGraphics.rect.setPosition(
      this.registerPoint.x,
      this.registerPoint.y,
    );
    this.registerGraphics.label.setPosition(
      this.registerPoint.x,
      this.registerPoint.y,
    );
  }

  spawnCustomer() {
    const slot = this.fixture.findAvailableSlot();
    if (!slot) return; // out of stock; skip spawn (basic version of bible Step 16)

    const customer = new Customer({
      scene: this,
      fixture: this.fixture,
      registerPoint: this.registerPoint,
      playerState: this.playerState,
      onArriveAtRegister: (arrivingCustomer) =>
        this.handleArrivalAtRegister(arrivingCustomer),
      onComplete: (completedCustomer) => {
        this.customers = this.customers.filter(
          (candidate) => candidate !== completedCustomer,
        );
      },
    });
    this.customers.push(customer);
  }

  // Only one customer's cart is shown in the checkout window at a time; everyone else
  // waits in a simple FIFO queue at the register (a basic version of bible Step 53).
  handleArrivalAtRegister(customer) {
    if (this.activeCheckoutCustomer) {
      this.registerQueue.push(customer);
      return;
    }

    this.startCheckout(customer);
  }

  startCheckout(customer) {
    this.activeCheckoutCustomer = customer;
    this.checkoutWindow.openForCustomer(customer.cart, () => {
      customer.completeSale();
      this.activeCheckoutCustomer = null;

      const nextCustomer = this.registerQueue.shift();
      if (nextCustomer) this.startCheckout(nextCustomer);
    });
  }

  update() {
    this.customers.forEach((customer) => customer.update());
  }
}
