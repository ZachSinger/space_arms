import { CleaningSystem } from "./cleaning/CleaningSystem.js";

const MODULE_FACTORIES = Object.freeze({
  cleaning: (scene) => new CleaningSystem(scene),
});

// Remove a module ID here to disable it for the whole game.
export const ENABLED_GAME_MODULES = Object.freeze(["cleaning"]);

export class ModuleHost {
  /**
   * @param {object} scene
   * @param {string[]} [enabledModuleIds]
   */
  constructor(scene, enabledModuleIds = ENABLED_GAME_MODULES) {
    this.instances = new Map();
    const seen = new Set();
    for (const id of enabledModuleIds) {
      if (seen.has(id)) throw new Error(`Game module "${id}" is enabled more than once.`);
      seen.add(id);
      const create = MODULE_FACTORIES[id];
      if (!create) throw new Error(`No game module is registered as "${id}".`);
      const instance = create(scene);
      if (instance.id !== id) throw new Error(`Game module "${id}" has a mismatched ID.`);
      this.instances.set(id, instance);
    }
  }

  /** @param {string} id */
  get(id) {
    return this.instances.get(id) ?? null;
  }

  /** @param {number} time @param {number} delta */
  update(time, delta) {
    for (const module of this.instances.values()) module.update?.(time, delta);
  }

  destroy() {
    for (const module of [...this.instances.values()].reverse()) module.destroy?.();
    this.instances.clear();
  }
}
