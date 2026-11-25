// ==========================================
// FILE: RobotGambits.js
// ==========================================
// Store robots run a program: an ordered list of rules, each "if <condition>, do <action>".
// Like gambits in Final Fantasy XII, the robot does the first rule whose condition is true
// and whose action is possible right now; if none fit, it waits. The game (and the robot lab
// tool, `npm run robots`) describe the store to this file as a plain "world" snapshot:
//   { registers: [{ id, line, staffedBy }], shelves: [{ id, fill }], padCrates, backroomCrates,
//     backroomCapacity, messes, stations: [{ id, usedBy }] }
// where `fill` runs from 0 (empty) to 1 (full) and `staffedBy`/`usedBy` are robot ids or null.

// A condition is built from three pieces: something to measure, a comparison and a number, like
// "My charge" "is below" 20 (%). The lab saves the list in data/RobotPrograms.json (parts.conditions);
// CONDITIONS below is the starting list, used when none is given.
export const MEASURES = Object.freeze([
  { id: "always", label: "Always" },
  { id: "my_charge", label: "My charge", unit: () => "%" },
  { id: "emptiest_shelf", label: "The emptiest shelf", unit: () => "% full" },
  { id: "longest_line", label: "The longest register line", unit: (n) => (n === 1 ? "customer long" : "customers long") },
  { id: "customers_waiting", label: "The number of customers waiting at registers" },
  { id: "pad_crates", label: "The number of crates on the loading pad" },
  { id: "stored_crates", label: "The number of crates stored in the backroom" },
  { id: "backroom_space", label: "The number of empty crate spaces in the backroom" },
  { id: "messes", label: "The number of messes on the sales floor" },
  { id: "free_stations", label: "The number of free charging stations" },
]);
export const COMPARES = Object.freeze([
  { id: "below", label: "is below", test: (a, b) => a < b },
  { id: "at_most", label: "is at most", test: (a, b) => a <= b },
  { id: "at_least", label: "is at least", test: (a, b) => a >= b },
  { id: "above", label: "is above", test: (a, b) => a > b },
]);
const MEASURE_BY_ID = new Map(MEASURES.map((entry) => [entry.id, entry]));
const COMPARE_BY_ID = new Map(COMPARES.map((entry) => [entry.id, entry]));

export const CONDITIONS = Object.freeze([
  { id: "always", measure: "always" },
  { id: "customer_waiting", measure: "longest_line", compare: "at_least", value: 1 },
  { id: "line_3", measure: "longest_line", compare: "at_least", value: 3 },
  { id: "shelf_empty", measure: "emptiest_shelf", compare: "at_most", value: 0 },
  { id: "shelf_below_25", measure: "emptiest_shelf", compare: "below", value: 25 },
  { id: "shelf_below_50", measure: "emptiest_shelf", compare: "below", value: 50 },
  { id: "shelf_not_full", measure: "emptiest_shelf", compare: "below", value: 100 },
  { id: "crate_on_pad", measure: "pad_crates", compare: "at_least", value: 1 },
  { id: "mess", measure: "messes", compare: "at_least", value: 1 },
  { id: "battery_below_20", measure: "my_charge", compare: "below", value: 20 },
  { id: "battery_below_50", measure: "my_charge", compare: "below", value: 50 },
  { id: "battery_not_full", measure: "my_charge", compare: "below", value: 100 },
].map(Object.freeze));

/** A condition as a sentence, like "My charge is below 20%". */
export function conditionLabel(condition) {
  const measure = MEASURE_BY_ID.get(condition?.measure);
  if (!measure) return "Unknown condition";
  if (measure.id === "always") return measure.label;
  const unit = measure.unit?.(condition.value) ?? "";
  return `${measure.label} ${COMPARE_BY_ID.get(condition.compare)?.label ?? "?"} ${condition.value}${unit.startsWith("%") ? "" : " "}${unit}`.trim();
}

/** The number a measure reads from the store right now. */
export function measureValue(measureId, world, robot) {
  switch (measureId) {
    case "my_charge": return robot.battery * 100;
    case "emptiest_shelf": return (lowestShelf(world)?.fill ?? 1) * 100;
    case "longest_line": return world.registers.reduce((most, register) => Math.max(most, register.line), 0);
    case "customers_waiting": return world.registers.reduce((total, register) => total + register.line, 0);
    case "pad_crates": return world.padCrates;
    case "stored_crates": return world.backroomCrates;
    case "backroom_space": return Math.max(0, world.backroomCapacity - world.backroomCrates);
    case "messes": return world.messes;
    case "free_stations": return world.stations.filter((station) => !station.usedBy || station.usedBy === robot.id).length;
    default: throw new Error(`Unknown robot measure: ${measureId}`);
  }
}

export const ACTIONS = Object.freeze([
  { id: "work_register", label: "Work a register", description: "Goes to a free register (the one with the longest line) and serves the customer at the front.", cantWhen: "Every register already has another robot on it." },
  { id: "restock", label: "Restock the emptiest shelf from the backroom", description: "Takes one crate from the backroom and fills the emptiest shelf with it.", cantWhen: "The backroom has no crates, or every shelf is full." },
  { id: "unload_pad", label: "Carry a crate from the loading pad into the backroom", description: "Carries one delivery crate off the loading pad into backroom storage.", cantWhen: "There's no crate on the pad, or the backroom is full." },
  { id: "clean", label: "Clean up a mess", description: "Cleans up one mess on the sales floor.", cantWhen: "There are no messes, or other robots are already cleaning every one." },
  { id: "charge", label: "Go to a charging station and charge fully", description: "Goes to a free charging station and stays until its charge is full.", cantWhen: "Its charge is already full, or every station is taken." },
  { id: "wait", label: "Wait", description: "Stands still for a second. Waiting uses a quarter of the normal drain.", cantWhen: "Never: a robot can always wait." },
]);

// Prefab logic boards don't hold commands. Each one is a fixed ability written here in code; a
// higher number is a smarter version of the same job. `choose` returns { action, target } when the
// board wants to do something right now, or null to let the next board try.
function pick(actionId, world, robot) {
  const target = actionTarget(actionId, world, robot);
  return target ? { action: actionId, target } : null;
}
const lowFill = (world) => lowestShelf(world)?.fill ?? 1;
export const PREFAB_ABILITIES = Object.freeze([
  { id: "self_charge_1", label: "Self-charge 1", description: "Goes to charge when its charge drops below 20%.",
    choose: (world, robot) => (robot.battery < 0.2 ? pick("charge", world, robot) : null) },
  { id: "self_charge_2", label: "Self-charge 2", description: "Goes to charge below 20%, and also tops up below 60% while the store is quiet (no one waiting, no messes, no shelf under half full).",
    choose: (world, robot) => {
      if (robot.battery < 0.2) return pick("charge", world, robot);
      const quiet = !world.registers.some((register) => register.line > 0) && world.messes <= 0 && lowFill(world) >= 0.5;
      return quiet && robot.battery < 0.6 ? pick("charge", world, robot) : null;
    } },
  { id: "register_1", label: "Register 1", description: "Works a register while a customer is waiting.",
    choose: (world, robot) => (world.registers.some((register) => register.line > 0) ? pick("work_register", world, robot) : null) },
  { id: "register_2", label: "Register 2", description: "Stays at a register all the time, so customers never wait for it to walk over.",
    choose: (world, robot) => pick("work_register", world, robot) },
  { id: "stock_1", label: "Stock 1", description: "Refills a shelf once it's completely empty, and otherwise carries delivery crates into the backroom.",
    choose: (world, robot) => (lowFill(world) <= 0 ? pick("restock", world, robot) : null) ?? pick("unload_pad", world, robot) },
  { id: "stock_2", label: "Stock 2", description: "Refills the emptiest shelf once one drops below half full, and otherwise carries delivery crates into the backroom.",
    choose: (world, robot) => (lowFill(world) < 0.5 ? pick("restock", world, robot) : null) ?? pick("unload_pad", world, robot) },
  { id: "stock_3", label: "Stock 3", description: "Like Stock 2, but when there's nothing else to do it tops off any shelf that isn't full.",
    choose: (world, robot) => (lowFill(world) < 0.5 ? pick("restock", world, robot) : null) ?? pick("unload_pad", world, robot) ?? pick("restock", world, robot) },
  { id: "clean_1", label: "Clean 1", description: "Cleans up messes on the sales floor.",
    choose: (world, robot) => pick("clean", world, robot) },
]);
const ABILITIES = new Map(PREFAB_ABILITIES.map((entry) => [entry.id, entry]));
export const findAbility = (id) => ABILITIES.get(id) ?? null;

const ACTION_IDS = new Set(ACTIONS.map((entry) => entry.id));

const lowestShelf = (world) => world.shelves.reduce((low, shelf) => (!low || shelf.fill < low.fill ? shelf : low), null);

/** Whether a condition (see MEASURES) is true for this robot right now. */
export function conditionMet(condition, world, robot) {
  if (condition?.measure === "always") return true;
  const compare = COMPARE_BY_ID.get(condition?.compare);
  if (!compare) throw new Error(`Unknown robot comparison: ${condition?.compare}`);
  return compare.test(measureValue(condition.measure, world, robot), condition.value);
}

/** The register/shelf/station the action would use, or null when it can't be done right now. */
export function actionTarget(actionId, world, robot) {
  switch (actionId) {
    case "work_register": {
      const free = world.registers.filter((register) => !register.staffedBy || register.staffedBy === robot.id);
      return free.reduce((best, register) => (!best || register.line > best.line ? register : best), null);
    }
    case "restock": {
      const low = lowestShelf(world);
      return world.backroomCrates > 0 && low && low.fill < 1 ? low : null;
    }
    case "unload_pad": return world.padCrates > 0 && world.backroomCrates < world.backroomCapacity ? { id: "pad" } : null;
    case "clean": return world.messes > 0 ? { id: "mess" } : null;
    case "charge":
      if (robot.battery >= 1) return null;
      return world.stations.find((station) => !station.usedBy || station.usedBy === robot.id) ?? null;
    case "wait": return { id: "wait" };
    default: throw new Error(`Unknown robot action: ${actionId}`);
  }
}

/**
 * Runs a robot's program against the store. Returns the action it picked, which rule picked it
 * (-1 when no rule fit and it waits), and why each rule was or wasn't used.
 * Entries are either commands or prefab boards ({ ability }), checked in order.
 * @param {({ condition: string, action: string, on?: boolean } | { ability: string })[]} program
 * @param {object[]} [conditions] the conditions the program's commands name (see CONDITIONS)
 */
export function chooseAction(program, world, robot, conditions = CONDITIONS) {
  const byId = new Map(conditions.map((entry) => [entry.id, entry]));
  const checks = [];
  for (let index = 0; index < program.length; index += 1) {
    const rule = program[index];
    if (rule.on === false) {
      checks.push({ index, result: "off" });
      continue;
    }
    if (rule.ability) {
      const decision = findAbility(rule.ability)?.choose(world, robot) ?? null;
      if (!decision) {
        checks.push({ index, result: "nothing to do" });
        continue;
      }
      checks.push({ index, result: "chosen" });
      return { ruleIndex: index, action: decision.action, target: decision.target, checks };
    }
    const condition = byId.get(rule.condition);
    if (!condition) throw new Error(`Unknown robot condition: ${rule.condition}`);
    if (!conditionMet(condition, world, robot)) {
      checks.push({ index, result: "condition false" });
      continue;
    }
    const target = actionTarget(rule.action, world, robot);
    if (!target) {
      checks.push({ index, result: "can't do it right now" });
      continue;
    }
    checks.push({ index, result: "chosen" });
    return { ruleIndex: index, action: rule.action, target, checks };
  }
  return { ruleIndex: -1, action: "wait", target: { id: "wait" }, checks };
}

/** Readable reasons a program can't be used; empty when it's fine. */
export function programProblems(program, slots, conditions = CONDITIONS) {
  const conditionIds = new Set(conditions.map((entry) => entry.id));
  const problems = [];
  if (!Array.isArray(program)) return ["The program is missing."];
  if (program.length > slots) problems.push(`Has ${program.length} commands but only ${slots} command spaces.`);
  program.forEach((rule, index) => {
    if (!conditionIds.has(rule?.condition)) problems.push(`Command ${index + 1}: unknown condition "${rule?.condition}".`);
    if (!ACTION_IDS.has(rule?.action)) problems.push(`Command ${index + 1}: unknown action "${rule?.action}".`);
  });
  return problems;
}

/** Readable reasons a condition list can't be used; empty when it's fine. */
export function conditionProblems(conditions) {
  if (!Array.isArray(conditions)) return ["The condition list is missing."];
  const problems = [];
  const seen = new Set();
  conditions.forEach((condition, index) => {
    const name = `Condition ${index + 1}`;
    if (typeof condition?.id !== "string" || !condition.id) problems.push(`${name}: needs an id.`);
    else if (seen.has(condition.id)) problems.push(`Two conditions share the id "${condition.id}".`);
    seen.add(condition?.id);
    if (!MEASURE_BY_ID.has(condition?.measure)) return problems.push(`${name}: unknown thing to check "${condition?.measure}".`);
    if (condition.measure === "always") return;
    if (!COMPARE_BY_ID.has(condition.compare)) problems.push(`${name}: unknown comparison "${condition.compare}".`);
    if (!Number.isFinite(condition.value) || condition.value < 0) problems.push(`${name}: the number must be 0 or more.`);
  });
  return problems;
}
