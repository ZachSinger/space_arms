export class InteractableRegistry {
  constructor() {
    this.providers = new Map();
  }

  registerProvider(id, getCandidates) {
    if (this.providers.has(id)) throw new Error(`Duplicate interactable provider: ${id}`);
    if (typeof getCandidates !== "function") {
      throw new TypeError("Interactable providers must return candidates.");
    }

    this.providers.set(id, getCandidates);
    return () => {
      if (this.providers.get(id) === getCandidates) this.providers.delete(id);
    };
  }

  findTarget(action, origin, target = null) {
    let best = null;
    for (const getCandidates of this.providers.values()) {
      for (const candidate of getCandidates()) {
        if (!candidate.actions.includes(action)) continue;
        if (target && candidate.target !== target) continue;
        if (candidate.isAvailable && !candidate.isAvailable()) continue;

        const distance = candidate.distanceFrom(origin);
        if (!Number.isFinite(distance) || distance > candidate.range) continue;
        if (!best || candidate.priority > best.priority ||
          (candidate.priority === best.priority && distance <= best.distance)) {
          best = { ...candidate, distance };
        }
      }
    }

    return best;
  }
}
