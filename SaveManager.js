export const SAVE_VERSION = 1;
export const SAVE_STORAGE_KEY = "space-arms-save-v1";

export function createSaveStorage(environment = window) {
  if (environment.desktopApi) {
    return {
      read: () => environment.desktopApi.loadGame(),
      write: (payload) => environment.desktopApi.saveGame(payload),
    };
  }
  return {
    read: () => {
      const raw = environment.localStorage.getItem(SAVE_STORAGE_KEY);
      return raw === null ? null : JSON.parse(raw);
    },
    write: (payload) => {
      environment.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(payload));
      return true;
    },
  };
}

// Each subsystem must implement serialize() -> plain object, and applySave(data) to mutate itself in place.
export class SaveManager {
  constructor(subsystems = {}, storage = createSaveStorage()) {
    this.subsystems = subsystems;
    this.storage = storage;
  }

  async save() {
    const payload = { version: SAVE_VERSION, savedAt: Date.now(), data: {} };

    for (const [key, subsystem] of Object.entries(this.subsystems)) {
      payload.data[key] = subsystem.serialize();
    }

    const saved = await this.storage.write(payload);
    if (saved !== true) throw new Error("The save could not be written.");
    return true;
  }

  async read() {
    const payload = await this.storage.read();
    if (payload === null) return null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("The saved game is not a valid save file.");
    }
    if (payload.version !== SAVE_VERSION) {
      throw new Error(`Unsupported save version: ${payload.version}. Expected ${SAVE_VERSION}.`);
    }
    if (!payload.data || typeof payload.data !== "object" || !payload.data.shop) {
      throw new Error("The saved game is incomplete.");
    }
    return payload;
  }

  async load() {
    const payload = await this.read();
    if (payload === null) return false;
    for (const [key, subsystem] of Object.entries(this.subsystems)) {
      const slice = payload.data[key];
      if (!slice) throw new Error(`The save is missing ${key}.`);
      subsystem.applySave(slice);
    }

    return true;
  }
}
