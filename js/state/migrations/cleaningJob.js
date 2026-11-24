// Upgrade step (layout version 11 to 12): employees gain the "clean" job. It goes last in each
// saved job order, and any saved skill levels gain cleaning at Level 1.
import { isRecord } from "../saveHelpers.js";

export function addEmployeeCleaningJob(data) {
  const player = data.playerState;
  if (!isRecord(player)) return data;
  const priorities = Object.fromEntries(Object.entries(player.employeeJobPriorities ?? {})
    .map(([employeeId, jobs]) => [employeeId,
      Array.isArray(jobs) && !jobs.includes("clean") ? [...jobs, "clean"] : jobs]));
  const skills = Object.fromEntries(Object.entries(player.employeeSkills ?? {})
    .map(([employeeId, levels]) => [employeeId,
      isRecord(levels) && levels.clean === undefined ? { ...levels, clean: 1 } : levels]));
  return {
    ...data,
    playerState: {
      ...player,
      ...(isRecord(player.employeeJobPriorities) ? { employeeJobPriorities: priorities } : {}),
      ...(isRecord(player.employeeSkills) ? { employeeSkills: skills } : {}),
    },
  };
}
