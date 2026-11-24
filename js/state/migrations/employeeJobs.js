// Upgrade step (layout version 9 to 10): the retired "load storage" job becomes shelf stocking.
import { isRecord } from "../saveHelpers.js";

export function migrateRemovedEmployeeJob(data) {
  const player = data.playerState;
  if (!isRecord(player)) return data;
  const priorities = { ...(player.employeeJobPriorities ?? {}) };
  for (const [employeeId, jobs] of Object.entries(priorities)) {
    if (Array.isArray(jobs)) {
      priorities[employeeId] = jobs.map((job) => job === "load_storage" ? "stock_shelves" : job)
        .filter((job, index, list) => list.indexOf(job) === index);
    }
  }
  const skills = { ...(player.employeeSkills ?? {}) };
  for (const [employeeId, levels] of Object.entries(skills)) {
    if (!isRecord(levels) || levels.load_storage === undefined) continue;
    const { load_storage, ...remaining } = levels;
    remaining.stock_shelves = Math.max(remaining.stock_shelves ?? 1, load_storage);
    skills[employeeId] = remaining;
  }
  const training = Object.fromEntries(Object.entries(player.employeeTraining ?? {})
    .map(([employeeId, jobId]) => [employeeId, jobId === "load_storage" ? "stock_shelves" : jobId]));
  return {
    ...data,
    playerState: {
      ...player,
      employeeJobPriorities: priorities,
      employeeSkills: skills,
      employeeTraining: training,
    },
  };
}
