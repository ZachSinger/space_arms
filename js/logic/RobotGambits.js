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

export const CONDITIONS = Object.freeze([
  { id: "always", label: "Always" },
  { id: "customer_waiting", label: "A customer is waiting at a register" },
  { id: "line_3", label: "3 or more customers are waiting at one register" },
  { id: "shelf_empty", label: "A shelf is empty" },
  { id: "shelf_below_25", label: "A shelf is less than a quarter full" },
  { id: "shelf_below_50", label: "A shelf is less than half full" },
  { id: "shelf_not_full", label: "A shelf isn't full" },
  { id: "crate_on_pad", label: "A delivery crate is on the loading pad" },
  { id: "mess", label: "There's a mess on the sales floor" },
  { id: "battery_below_20", label: "My charge is below 20%" },
  { id: "battery_below_50", label: "My charge is below 50%" },
  { id: "battery_not_full", label: "My charge isn't full" },
]);

export const ACTIONS = Object.freeze([
  { id: "work_register", label: "Work a register" },
  { id: "restock", label: "Restock the emptiest shelf from the backroom" },
  { id: "unload_pad", label: "Carry a crate from the loading pad into the backroom" },
  { id: "clean", label: "Clean up a mess" },
  { id: "charge", label: "Go to a charging station and charge fully" },
  { id: "wait", label: "Wait" },
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

const CONDITION_IDS = new Set(CONDITIONS.map((entry) => entry.id));
const ACTION_IDS = new Set(ACTIONS.map((entry) => entry.id));

const lowestShelf = (world) => world.shelves.reduce((low, shelf) => (!low || shelf.fill < low.fill ? shelf : low), null);

/** Whether a rule's "if" part is true for this robot right now. */
export function conditionMet(conditionId, world, robot) {
  const low = lowestShelf(world)?.fill ?? 1;
  switch (conditionId) {
    case "always": return true;
    case "customer_waiting": return world.registers.some((register) => register.line > 0);
    case "line_3": return world.registers.some((register) => register.line >= 3);
    case "shelf_empty": return low <= 0;
    case "shelf_below_25": return low < 0.25;
    case "shelf_below_50": return low < 0.5;
    case "shelf_not_full": return low < 1;
    case "crate_on_pad": return world.padCrates > 0;
    case "mess": return world.messes > 0;
    case "battery_below_20": return robot.battery < 0.2;
    case "battery_below_50": return robot.battery < 0.5;
    case "battery_not_full": return robot.battery < 1;
    default: throw new Error(`Unknown robot condition: ${conditionId}`);
  }
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
 */
export function chooseAction(program, world, robot) {
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
    if (!conditionMet(rule.condition, world, robot)) {
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
export function programProblems(program, slots) {
  const problems = [];
  if (!Array.isArray(program)) return ["The program is missing."];
  if (program.length > slots) problems.push(`Has ${program.length} commands but only ${slots} command spaces.`);
  program.forEach((rule, index) => {
    if (!CONDITION_IDS.has(rule?.condition)) problems.push(`Command ${index + 1}: unknown condition "${rule?.condition}".`);
    if (!ACTION_IDS.has(rule?.action)) problems.push(`Command ${index + 1}: unknown action "${rule?.action}".`);
  });
  return problems;
}
