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

  getActions(player, input, origin = null) {
    const available = [];
    for (const getCandidates of this.providers.values()) {
      for (const candidate of getCandidates()) {
        if (candidate.isAvailable && !candidate.isAvailable()) continue;
        if (!candidate.getActions && !Array.isArray(candidate.actions)) {
          throw new TypeError(`Interactable "${candidate.id}" must define getActions().`);
        }
        const actions = candidate.getActions
          ? candidate.getActions(player, input)
          : candidate.actions.map((action) => ({
            action,
            hint: candidate.hint,
            perform: candidate.perform,
          }));
        if (!Array.isArray(actions)) {
          throw new TypeError(`Interactable "${candidate.id}" must return an action list.`);
        }

        for (const action of actions) {
          if (!action || typeof action.action !== "string") {
            throw new TypeError(`Interactable "${candidate.id}" returned an invalid action.`);
          }
          const distanceFrom = action.distanceFrom ?? candidate.distanceFrom;
          const range = action.range ?? candidate.range;
          let distance = 0;
          if (origin) {
            if (typeof distanceFrom !== "function" || !Number.isFinite(range)) {
              throw new TypeError(`Interactable "${candidate.id}" action "${action.action}" needs a range.`);
            }
            distance = distanceFrom(origin);
            if (!Number.isFinite(distance) || distance > range) continue;
          }
          available.push({
            ...candidate,
            ...action,
            id: action.id ?? candidate.id,
            target: action.target ?? candidate.target,
            distance,
            priority: action.priority ?? candidate.priority ?? 0,
          });
        }
      }
    }
    return available;
  }

  findTarget(action, origin, target = null, player = null, input = null, kind = null) {
    let best = null;
    for (const candidate of this.getActions(player, input, origin)) {
      if (candidate.action !== action) continue;
      if (target && candidate.target !== target) continue;
      if (kind && candidate.kind !== kind) continue;
      if (!best || candidate.priority > best.priority ||
        (candidate.priority === best.priority && candidate.distance <= best.distance)) {
        best = candidate;
      }
    }
    return best;
  }
}
