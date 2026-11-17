import { SettingsPanel } from "./SettingsPanel.js";

const sceneControllers = new WeakMap();

export function installSceneTextSize(scene, Phaser) {
  if (sceneControllers.has(scene)) return;

  const controller = new GameTextSizeController([scene], {
    initialScale: SettingsPanel.getTextSizeScale(SettingsPanel.getSavedTextSize()),
    sceneAddedEvent: Phaser.Scenes.Events.ADDED_TO_SCENE,
    sceneStartEvent: Phaser.Scenes.Events.START,
    sceneShutdownEvent: Phaser.Scenes.Events.SHUTDOWN,
    gameObjectDestroyedEvent: Phaser.GameObjects.Events.DESTROY,
  });
  sceneControllers.set(scene, controller);
  scene.sys.events.once(Phaser.Scenes.Events.DESTROY, () => controller.destroy());
}

export class GameTextSizeController {
  constructor(scenes, {
    initialScale,
    sceneAddedEvent,
    sceneStartEvent,
    sceneShutdownEvent,
    gameObjectDestroyedEvent,
  }) {
    this.scale = initialScale;
    this.sceneAddedEvent = sceneAddedEvent;
    this.sceneStartEvent = sceneStartEvent;
    this.sceneShutdownEvent = sceneShutdownEvent;
    this.gameObjectDestroyedEvent = gameObjectDestroyedEvent;
    this.baseFontSizes = new WeakMap();
    this.sceneTexts = new Map();
    this.sceneHandlers = new Map();
    this.eventTarget = window;

    this.handleTextSizeChange = (event) => this.setScale(event.detail.scale);
    this.eventTarget.addEventListener("text-size-changed", this.handleTextSizeChange);

    for (const scene of scenes) this.bindScene(scene);
  }

  bindScene(scene) {
    const events = scene.sys.events;
    const texts = new Set();
    const handleAdded = (gameObject) => this.registerText(gameObject, texts);
    const handleStart = () => this.registerExistingTexts(scene, texts);
    const handleShutdown = () => texts.clear();

    this.sceneTexts.set(scene, texts);
    this.sceneHandlers.set(scene, {
      events,
      handleAdded,
      handleStart,
      handleShutdown,
    });
    events.on(this.sceneAddedEvent, handleAdded);
    events.on(this.sceneStartEvent, handleStart);
    events.on(this.sceneShutdownEvent, handleShutdown);
    handleStart();
  }

  registerExistingTexts(scene, texts) {
    const registerTree = (gameObject) => {
      this.registerText(gameObject, texts);
      for (const child of gameObject.list ?? []) registerTree(child);
    };

    for (const gameObject of scene.sys.displayList.list) registerTree(gameObject);
  }

  registerText(gameObject, texts) {
    if (typeof gameObject?.setFontSize !== "function" || !gameObject.style) return;

    let baseFontSize = this.baseFontSizes.get(gameObject);
    if (baseFontSize === undefined) {
      const value = gameObject.style.fontSize;
      baseFontSize = typeof value === "number" ? value : Number.parseFloat(value);
      if (!Number.isFinite(baseFontSize) || baseFontSize <= 0) return;
      this.baseFontSizes.set(gameObject, baseFontSize);
      gameObject.once(this.gameObjectDestroyedEvent, () => texts.delete(gameObject));
    }

    texts.add(gameObject);
    gameObject.setFontSize(baseFontSize * this.scale);
  }

  setScale(scale) {
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new TypeError("Text size scale must be a positive number.");
    }

    this.scale = scale;
    for (const texts of this.sceneTexts.values()) {
      for (const text of texts) this.registerText(text, texts);
    }
  }

  destroy() {
    this.eventTarget.removeEventListener("text-size-changed", this.handleTextSizeChange);
    for (const {
      events,
      handleAdded,
      handleStart,
      handleShutdown,
    } of this.sceneHandlers.values()) {
      events.off(this.sceneAddedEvent, handleAdded);
      events.off(this.sceneStartEvent, handleStart);
      events.off(this.sceneShutdownEvent, handleShutdown);
    }
    this.sceneHandlers.clear();
    this.sceneTexts.clear();
  }
}
