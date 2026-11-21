import { addCharacterSprite } from "../logic/CustomerSprites.js";
import { database } from "../scenes/boot.js";

export function createCustomerStore(scene) {
  return {
    add: scene.add,
    findPath: (...args) => scene.navigation.store.findPath(...args),
    getItem: (itemId) => database.getItem(itemId),
    getStorePrice: (...args) => scene.catalogSystem.getStorePrice(...args),
    showFloatingText: (...args) => scene.messages.floatText(...args),
    getRandomBrowseShelf: (...args) => scene.customerFlow.getRandomBrowseShelf(...args),
    refreshShelfStockDisplay: (...args) => scene.fixtureViews?.refreshStockDisplay(...args),
    noteCustomerGaveUp: (...args) => scene.customerFlow?.noteGaveUp(...args),
    createCustomerSprite: (...args) => addCharacterSprite(scene, ...args),
    get cleaning() { return scene.cleaningSystem; },
    get scale() { return scene.scale; },
    get gameState() { return scene.gameState; },
    get eventBus() { return scene.eventBus; },
    get customerFlow() { return scene.customerFlow; },
    get checkoutSystem() { return scene.checkoutSystem; },
    get cameraRig() { return scene.cameraRig; },
    get crateWorld() { return scene.crateWorld; },
    get debugInfo() { return scene.debugInfo; },
  };
}

export function createEmployeeStore(scene) {
  return {
    findPath: (...args) => scene.navigation.store.findPath(...args),
    getBehindRegisterPoint: (register) => scene.checkoutSystem.behindRegisterPoint(register),
    syncFloorStacks: (...args) => scene.crateSystem.syncFloorStacks(...args),
    refreshShelfStockDisplay: (...args) => scene.fixtureViews.refreshStockDisplay(...args),
    showShopMessage: (message) => scene.messages.show(message),
    createEmployeeSprite(x, y, texture, width, height) {
      const sprite = addCharacterSprite(scene, x, y, texture, width, height).setDepth(3);
      scene.employeeGroup.add(sprite);
      return sprite;
    },
    removeEmployeeSprite(sprite) {
      scene.employeeGroup.remove(sprite, false);
    },
    get gameState() { return scene.gameState; },
    get areas() { return scene.areas; },
    get fixtures() { return scene.fixtures; },
    get checkoutSystem() { return scene.checkoutSystem; },
    get employees() { return scene.employees; },
    get restockCrates() { return scene.restockCrates; },
    set restockCrates(value) { scene.restockCrates = value; },
    get floorStacks() { return scene.floorStacks; },
    get eventBus() { return scene.eventBus; },
    get player() { return scene.player; },
    // Optional cleaning module (null when disabled): the "clean" job then has no work.
    get cleaning() { return scene.cleaningSystem ?? null; },
    get crateMotionPaused() { return scene.crateSystem.motionPaused; },
  };
}
