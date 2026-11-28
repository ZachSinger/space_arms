// ==========================================
// FILE: SaveManager.js
// ==========================================
// Separate named shops in one atomic save library. Writes through the Electron desktop API
// when present, otherwise browser localStorage.
// See also: preload.cjs (desktopApi.saveGame / loadGame).
export const SAVE_VERSION = 1;
export const SAVE_LIBRARY_VERSION = 2;
export const SAVE_STORAGE_KEY = "space-arms-saves-v2";
const storages = new WeakMap();
const pendingWrites = new WeakMap();

export function validateSaveName(name) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 40) {
    throw new Error("Enter a save name between 1 and 40 characters.");
  }
  return name.trim();
}

function validateLibrary(raw) {
  if (raw === null) return { version: SAVE_LIBRARY_VERSION, slots: [] };
  if (!raw || typeof raw !== "object" || raw.version !== SAVE_LIBRARY_VERSION || !Array.isArray(raw.slots)) {
    throw new Error("The save library is invalid or uses an unsupported version.");
  }
  const ids = new Set();
  for (const slot of raw.slots) {
    if (!slot || typeof slot.slotId !== "string" || !slot.slotId || ids.has(slot.slotId)) {
      throw new Error("The save library contains an invalid or repeated save.");
    }
    ids.add(slot.slotId);
    validateSaveName(slot.name);
    for (const field of ["savedAt", "lastPlayedAt", "playTimeMs"]) {
      if (!Number.isSafeInteger(slot[field]) || slot[field] < 0) {
        throw new Error(`The save "${slot.name}" has invalid ${field}.`);
      }
      if (field !== "playTimeMs" && !Number.isFinite(new Date(slot[field]).getTime())) {
        throw new Error(`The save "${slot.name}" has an invalid date.`);
      }
    }
    if (slot.version !== SAVE_VERSION || !slot.data || typeof slot.data !== "object" ||
      Array.isArray(slot.data) || !slot.data.shop || typeof slot.real !== "boolean") {
      throw new Error(`The save "${slot.name}" is incomplete.`);
    }
  }
  return raw;
}

function nextSaveName(slots) {
  let number = 1;
  while (slots.some((slot) => slot.name === `Shop ${number}`)) number += 1;
  return `Shop ${number}`;
}

// Each read-modify-write finishes before another manager changes the shared library.
function changeLibrary(storage, change) {
  const pending = pendingWrites.get(storage) ?? Promise.resolve();
  const operation = pending.then(async () => {
    const library = validateLibrary(structuredClone(await storage.read()));
    const result = change(library);
    const saved = await storage.write(library);
    if (saved !== true) throw new Error("The save could not be written.");
    return result;
  });
  pendingWrites.set(storage, operation.then(() => undefined, () => undefined));
  return operation;
}

/**
 * @param {Window} environment - injectable for tests
 * @returns {{ read: () => any, write: (payload: object) => boolean | Promise<boolean> }}
 */
export function createSaveStorage(environment = window) {
  if (storages.has(environment)) return storages.get(environment);
  let storage;
  if (environment.desktopApi) {
    storage = {
      read: () => environment.desktopApi.loadGame(),
      write: (payload) => environment.desktopApi.saveGame(payload),
    };
  } else {
    storage = {
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
  storages.set(environment, storage);
  return storage;
}

/**
 * Saves and restores a set of named subsystems. Each must implement serialize() -> plain
 * object and applySave(data), which mutates itself in place.
 */
export class SaveManager {
  constructor(subsystems = {}, storage = createSaveStorage(), { slotId = null, name = null, real = false } = {}) {
    this.subsystems = subsystems;
    this.storage = storage;
    this.slotId = slotId;
    this.name = name;
    this.real = real;
  }

  async save({ slotId, name, playTimeMs } = {}) {
    const data = {};
    for (const [key, subsystem] of Object.entries(this.subsystems)) {
      data[key] = subsystem.serialize();
    }
    const saved = await changeLibrary(this.storage, (library) => {
      const selectedId = slotId === undefined ? this.slotId : slotId;
      const id = selectedId ?? crypto.randomUUID();
      const index = library.slots.findIndex((slot) => slot.slotId === id);
      if (selectedId !== null && index === -1) throw new Error("That save no longer exists.");
      const previous = library.slots[index];
      const slot = {
        version: SAVE_VERSION,
        slotId: id,
        name: validateSaveName(name ?? previous?.name ?? (this.slotId === null ? this.name : null) ?? nextSaveName(library.slots)),
        savedAt: Date.now(),
        lastPlayedAt: Date.now(),
        playTimeMs: Math.round(playTimeMs ?? previous?.playTimeMs ?? 0),
        real: this.real,
        data: structuredClone(data),
      };
      if (index === -1) library.slots.push(slot);
      else library.slots[index] = slot;
      validateLibrary(library);
      return slot;
    });
    this.slotId = saved.slotId;
    this.name = saved.name;
    return true;
  }

  async library() {
    await pendingWrites.get(this.storage);
    return validateLibrary(await this.storage.read());
  }

  async list() {
    const library = await this.library();
    return library.slots
      .map(({ data, ...metadata }) => metadata)
      .sort((first, second) => second.lastPlayedAt - first.lastPlayedAt);
  }

  // An unspecified save selects the most recently played shop.
  async read(slotId = this.slotId) {
    const library = await this.library();
    if (slotId === null) {
      return [...library.slots].sort((first, second) => second.lastPlayedAt - first.lastPlayedAt)[0] ?? null;
    }
    const slot = library.slots.find((entry) => entry.slotId === slotId);
    if (!slot) throw new Error("That save no longer exists.");
    return slot;
  }

  async touch(playTimeMs) {
    if (this.slotId === null) return;
    await changeLibrary(this.storage, (library) => {
      const slot = library.slots.find((entry) => entry.slotId === this.slotId);
      if (!slot) throw new Error("That save no longer exists.");
      slot.lastPlayedAt = Date.now();
      slot.playTimeMs = Math.max(slot.playTimeMs, Math.round(playTimeMs));
      validateLibrary(library);
    });
  }

  async rename(slotId, name) {
    const normalized = validateSaveName(name);
    await changeLibrary(this.storage, (library) => {
      const slot = library.slots.find((entry) => entry.slotId === slotId);
      if (!slot) throw new Error("That save no longer exists.");
      slot.name = normalized;
    });
    if (this.slotId === slotId) this.name = normalized;
  }

  async delete(slotId) {
    if (this.slotId === slotId) throw new Error("You cannot delete the shop you are playing. Return to the title screen first.");
    await changeLibrary(this.storage, (library) => {
      const index = library.slots.findIndex((entry) => entry.slotId === slotId);
      if (index === -1) throw new Error("That save no longer exists.");
      library.slots.splice(index, 1);
    });
  }

  // Apply the stored save to every subsystem. False if there is no save.
  async load() {
    const payload = await this.read();
    if (payload === null) return false;
    for (const [key, subsystem] of Object.entries(this.subsystems)) {
      const slice = payload.data[key];
      if (!slice) throw new Error(`The save is missing ${key}.`);
      subsystem.applySave(slice);
    }
    this.slotId = payload.slotId;
    this.name = payload.name;
    this.real = payload.real;
    return true;
  }
}
