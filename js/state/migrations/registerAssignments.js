// Upgrade step (layout version 14 to 15): employees work registers only when assigned to one.
// Staff whose saved job order puts the register first keep working it: each takes the next
// register in layout order until every register has someone or nobody is left.
import employeeRoster from "../../../data/Employees.json" with { type: "json" };
import { getFixtureType } from "../../logic/FixtureLayout.js";
import { isRecord } from "../saveHelpers.js";

export function addRegisterAssignments(data) {
  const player = data.playerState;
  if (!isRecord(player) || player.registerAssignments !== undefined) return data;
  const registerIds = (data.fixtures ?? [])
    .filter((fixture) => getFixtureType(fixture?.type)?.kind === "register")
    .map((fixture) => fixture.id);
  const cashiers = (player.hiredEmployees ?? []).filter((employeeId) =>
    (player.employeeJobPriorities?.[employeeId] ??
      employeeRoster.find(({ id }) => id === employeeId)?.jobPriorities)?.[0] === "register");
  const registerAssignments = Object.fromEntries(registerIds.slice(0, cashiers.length)
    .map((registerId, index) => [registerId, cashiers[index]]));
  return { ...data, playerState: { ...player, registerAssignments } };
}
