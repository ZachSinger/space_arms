// ==========================================
// FILE: RobotParts.js
// ==========================================
// A robot is built from three kinds of part:
//   Frame       - the body. Needs some power, has ordered slots for logic boards, sets speed.
//   Logic board - the program. A prefab board has fixed commands or a legacy built-in ability,
//                 with a fixed power need; its commands can't be edited on a robot.
//                 A custom board holds up to N commands you write, and each command's condition
//                 and action add to the board's power need.
//   Modifier board - boosts skills by percentages, using the same slots and power limit.
//   Power cell  - Capacity is the most power the robot's parts may need in total (a limit that
//                 never runs down). Charge is the fuel tank that empties as the robot works:
//                 each working second costs the game's standard drain times the cell's drain rate,
//                 and the charge rate is how much comes back per second on a charging station.
// The robot reads its boards in slot order as one long list of commands (RobotGambits.js).
// `parts` looks like data/RobotPrograms.json's "parts":
//   { frames: [{ id, name, power, boardSlots, speed }],
//     cells: [{ id, name, capacity, charge, drainRate, chargeRate }],
//     boards: [{ id, name, kind: "prefab", power, ability } | { id, name, kind: "custom", power, commands }],
//     measures: [{ id, label, fact, combine?, minus?, minusCombine?, unit? }] (see MEASURES in RobotGambits.js),
//     conditions: [{ id, measure, compare, value }] (see CONDITIONS in RobotGambits.js),
//     commandPower: { conditions: { [conditionId]: number }, actions: { [actionId]: number } } }
// and a robot looks like { name, frame, cell, boards: [{ board, program? }] } where `program`
// is only stored for custom boards.
import { CONDITIONS, MEASURES, conditionProblems, findAbility, measureProblems, programProblems } from "./RobotGambits.js";

const byId = (list, id) => list?.find((entry) => entry.id === id) ?? null;

export const ROBOT_SKILLS = Object.freeze([
  { id: "stocking", label: "Stocking", base: 2, unit: "units/second" },
  { id: "carry", label: "Carry", base: 2, unit: "crates/trip", whole: true },
  { id: "scanning", label: "Scanning", base: 1, unit: "items/second" },
  { id: "counting", label: "Counting", base: 1, unit: "pieces of change/second" },
  { id: "handleWaste", label: "Handle Waste", base: 2, unit: "garbage/trip", whole: true },
  { id: "mopping", label: "Mopping", base: 0.25, unit: "spots/second" },
]);

/** Resolve each skill separately; every fitted board still consumes power, including beaten bonuses. */
export function robotSkills(robot, parts) {
  return ROBOT_SKILLS.map((skill) => {
    const base = parts.baseSkills?.[skill.id] ?? skill.base;
    const offers = robot.boards.flatMap((fitted, slot) => {
      const board = findBoard(parts, fitted.board);
      const bonus = board?.modifiers?.[skill.id] ?? 0;
      return bonus > 0 ? [{ slot, board: board.name, bonus }] : [];
    });
    const best = offers.reduce((winner, offer) => (!winner || offer.bonus > winner.bonus ? offer : winner), null);
    const boosted = base + base * (best?.bonus ?? 0) / 100;
    return { ...skill, base, bonus: best?.bonus ?? 0, value: skill.whole ? Math.floor(boosted) : boosted,
      source: best, ignored: offers.filter((offer) => offer !== best) };
  });
}

export function buildWarnings(robot, parts) {
  const skills = robotSkills(robot, parts);
  const warnings = skills.flatMap((skill) => skill.ignored.map((offer) =>
    `Slot ${offer.slot + 1}: ${offer.board}'s ${skill.label} +${offer.bonus}% does nothing. Slot ${skill.source.slot + 1} already gives +${skill.bonus}%. This board still uses power and a slot.`));
  for (const skill of skills) {
    if (skill.whole && skill.bonus > 0 && skill.value === skill.base) {
      warnings.push(`${skill.label} +${skill.bonus}% still holds only ${skill.value}; capacity rounds down to whole objects.`);
    }
  }
  if (!robotProgram(robot, parts).length) warnings.push("No logic board fitted: this robot will wait rather than do jobs.");
  return warnings;
}

export const findFrame = (parts, id) => byId(parts.frames, id);
export const findCell = (parts, id) => byId(parts.cells, id);
export const findBoard = (parts, id) => byId(parts.boards, id);
/** The conditions commands can use: the saved list, or the starting list when there isn't one. */
export const partConditions = (parts) => parts?.conditions ?? CONDITIONS;
/** The things conditions can check: the saved list, or the starting list when there isn't one. */
export const partMeasures = (parts) => parts?.measures ?? MEASURES;

/** What a fitted board adds to the robot's list: one fixed ability for a prefab, the robot's commands for a custom one. */
export function boardProgram(fitted, parts) {
  const board = findBoard(parts, fitted.board);
  if (!board) return [];
  if (board.kind === "modifier") return [];
  return board.kind === "prefab" ? (board.program ?? [{ ability: board.ability }]) : (fitted.program ?? []);
}

/** How much one command adds to a custom board's power need. */
export function commandPower(rule, parts) {
  const costs = parts.commandPower ?? {};
  return (costs.conditions?.[rule.condition] ?? 0) + (costs.actions?.[rule.action] ?? 0);
}

/** A fitted board's power need. Switched-off commands still sit on the board, so they still count. */
export function boardPower(fitted, parts) {
  const board = findBoard(parts, fitted.board);
  if (!board) return 0;
  if (board.kind !== "custom") return board.power;
  return board.power + (fitted.program ?? []).reduce((total, rule) => total + commandPower(rule, parts), 0);
}

/** The robot's Power Requirement: its frame plus every board in it. */
export function powerNeeded(robot, parts) {
  const frame = findFrame(parts, robot.frame);
  return (frame?.power ?? 0) + robot.boards.reduce((total, fitted) => total + boardPower(fitted, parts), 0);
}

/** Whether the cell's capacity covers everything the robot needs, so it can switch on. */
export function hasEnoughPower(robot, parts) {
  const cell = findCell(parts, robot.cell);
  return Boolean(cell) && powerNeeded(robot, parts) <= cell.capacity;
}

/**
 * Every board's commands joined in slot order (slot 1 first), which is the order the robot checks
 * them. Each entry also says which board and which of that board's commands it came from.
 */
export function robotProgram(robot, parts) {
  return robot.boards.flatMap((fitted, slot) => {
    const boardName = findBoard(parts, fitted.board)?.name ?? "";
    return boardProgram(fitted, parts).map((rule, command) => ({ ...rule, slot, command, boardName }));
  });
}

/** Readable reasons a robot's build doesn't hold together; empty when it's fine. */
export function buildProblems(robot, parts) {
  const problems = [];
  const frame = findFrame(parts, robot?.frame);
  if (!frame) problems.push(`unknown frame "${robot?.frame}".`);
  if (!findCell(parts, robot?.cell)) problems.push(`unknown power cell "${robot?.cell}".`);
  if (!Array.isArray(robot?.boards)) return [...problems, "the board list is missing."];
  if (frame && robot.boards.length > frame.boardSlots) problems.push(`has ${robot.boards.length} boards but ${frame.name} only has ${frame.boardSlots} board slots.`);
  robot.boards.forEach((fitted, slot) => {
    const board = findBoard(parts, fitted?.board);
    if (!board) return problems.push(`slot ${slot + 1}: unknown board "${fitted?.board}".`);
    if (board.kind !== "custom") return;
    for (const problem of programProblems(fitted.program, board.commands, partConditions(parts))) problems.push(`slot ${slot + 1} (${board.name}): ${problem}`);
  });
  return problems;
}

/** Readable reasons the parts list doesn't hold together; empty when it's fine. */
export function partsProblems(parts) {
  const problems = [];
  const lists = { frames: "frame", cells: "power cell", boards: "logic board" };
  for (const [key, word] of Object.entries(lists)) {
    if (!Array.isArray(parts?.[key])) {
      problems.push(`The ${word} list is missing.`);
      continue;
    }
    const seen = new Set();
    parts[key].forEach((part, index) => {
      if (typeof part?.id !== "string" || !part.id) problems.push(`${word} ${index + 1}: needs an id.`);
      else if (seen.has(part.id)) problems.push(`Two ${word}s share the id "${part.id}".`);
      seen.add(part?.id);
      if (typeof part?.name !== "string" || !part.name.trim()) problems.push(`${word} ${index + 1}: needs a name.`);
    });
  }
  if (problems.length) return problems;
  if (parts.measures !== undefined) problems.push(...measureProblems(parts.measures));
  if (parts.conditions !== undefined) problems.push(...conditionProblems(parts.conditions, partMeasures(parts)));
  for (const skill of ROBOT_SKILLS) {
    const base = parts.baseSkills?.[skill.id];
    if (base !== undefined && (!Number.isFinite(base) || base <= 0 || (skill.whole && !Number.isInteger(base)))) {
      problems.push(`Base ${skill.label} must be a positive ${skill.whole ? "whole " : ""}number.`);
    }
  }
  if (!parts.frames.length) problems.push("Needs at least one frame.");
  if (!parts.cells.length) problems.push("Needs at least one power cell.");
  const number = (part, key, what, minimum = 0) => {
    if (!Number.isFinite(part[key]) || part[key] < minimum) problems.push(`${part.name}: ${what} must be ${minimum} or more.`);
  };
  for (const frame of parts.frames) {
    number(frame, "power", "power needed");
    number(frame, "speed", "speed", 0.1);
    if (!Number.isInteger(frame.boardSlots) || frame.boardSlots < 1) problems.push(`${frame.name}: needs at least 1 board slot.`);
  }
  for (const cell of parts.cells) {
    number(cell, "capacity", "capacity");
    number(cell, "charge", "charge", 1);
    number(cell, "drainRate", "drain rate");
    number(cell, "chargeRate", "charge rate", 0.1);
  }
  for (const board of parts.boards) {
    number(board, "power", "power needed");
    if (board.kind === "prefab") {
      if (board.program !== undefined) problems.push(...programProblems(board.program, Array.isArray(board.program) ? board.program.length : 0, partConditions(parts)).map((problem) => `${board.name}: ${problem}`));
      else if (!findAbility(board.ability)) problems.push(`${board.name}: unknown prefab ability "${board.ability}".`);
    } else if (board.kind === "modifier") {
      if (!board.modifiers || typeof board.modifiers !== "object" || Array.isArray(board.modifiers) || !Object.keys(board.modifiers).length) {
        problems.push(`${board.name}: needs at least one skill bonus.`);
      }
      for (const [id, bonus] of Object.entries(board.modifiers ?? {})) {
        if (!ROBOT_SKILLS.some((skill) => skill.id === id) || !Number.isFinite(bonus) || bonus <= 0) {
          problems.push(`${board.name}: ${id} needs a known skill and a positive percentage.`);
        }
      }
    } else if (board.kind === "custom") {
      if (!Number.isInteger(board.commands) || board.commands < 1) problems.push(`${board.name}: needs room for at least 1 command.`);
    } else problems.push(`${board.name}: must be a prefab, modifier or custom board.`);
  }
  return problems;
}
