const SAVE_VERSION = 1;

// Each subsystem must implement serialize() -> plain object, and applySave(data) to mutate itself in place.
export class SaveManager {
  constructor(subsystems) {
    this.subsystems = subsystems;
  }

  async save() {
    const payload = { version: SAVE_VERSION, savedAt: Date.now(), data: {} };

    for (const [key, subsystem] of Object.entries(this.subsystems)) {
      payload.data[key] = subsystem.serialize();
    }

    return window.desktopApi.saveGame(payload);
  }

  async load() {
    const payload = await window.desktopApi.loadGame();
    if (!payload) return false;

    if (payload.version !== SAVE_VERSION) {
      // hook point for future migrations between schema versions
      console.warn(
        `Save version mismatch: file is v${payload.version}, expected v${SAVE_VERSION}`,
      );
    }

    for (const [key, subsystem] of Object.entries(this.subsystems)) {
      const slice = payload.data[key];
      if (slice) subsystem.applySave(slice);
    }

    return true;
  }
}
