// Decisions are denied when any registered rule says no. Rules must be explicit booleans so a
// missing or broken policy cannot quietly turn into permission.
export class DecisionRules {
  constructor() {
    this.rules = new Map();
  }

  /**
   * @param {string} decision
   * @param {(context: object) => boolean} rule
   * @returns {() => void} unregister function
   */
  register(decision, rule) {
    if (typeof decision !== "string" || !decision.trim()) {
      throw new TypeError("A decision rule requires a non-empty decision name.");
    }
    if (typeof rule !== "function") throw new TypeError("A decision rule must be a function.");

    let rules = this.rules.get(decision);
    if (!rules) {
      rules = new Set();
      this.rules.set(decision, rules);
    }
    const entry = { rule };
    rules.add(entry);

    return () => {
      rules.delete(entry);
      if (rules.size === 0 && this.rules.get(decision) === rules) this.rules.delete(decision);
    };
  }

  /**
   * @param {string} decision
   * @param {object} context
   */
  permits(decision, context) {
    if (typeof decision !== "string" || !decision.trim()) {
      throw new TypeError("A decision check requires a non-empty decision name.");
    }
    for (const { rule } of [...(this.rules.get(decision) ?? [])]) {
      const permitted = rule(context);
      if (typeof permitted !== "boolean") {
        throw new TypeError(`The "${decision}" rule must return a boolean.`);
      }
      if (!permitted) return false;
    }
    return true;
  }
}
