import { addCharacterSprite } from "../logic/CustomerSprites.js";

export function createCustomerStore(scene) {
  return {
    add: scene.add,
    findPath: (...args) => scene.navigation.store.findPath(...args),
    getItem: (...args) => scene.getItem(...args),
    getStorePrice: (...args) => scene.getStorePrice(...args),
    showFloatingText: (...args) => scene.showFloatingText(...args),
    getRandomBrowseShelf: (...args) => scene.getRandomBrowseShelf(...args),
    refreshShelfStockDisplay: (...args) => scene.refreshShelfStockDisplay?.(...args),
    noteCustomerGaveUp: (...args) => scene.noteCustomerGaveUp?.(...args),
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
    syncFloorStacks: (...args) => scene.syncFloorStacks(...args),
    refreshShelfStockDisplay: (...args) => scene.refreshShelfStockDisplay(...args),
    showShopMessage: (...args) => scene.showShopMessage(...args),
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
    get crateMotionPaused() { return scene.crateMotionPaused; },
  };
}
