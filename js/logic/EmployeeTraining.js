// Shared employee skill, training-price, wage, and rehiring rules.
import employeeRoster from "../../data/Employees.json" with { type: "json" };
import { EMPLOYEE_JOBS, EMPLOYEE_JOB_IDS } from "./EmployeeJobs.js";

export const MAX_EMPLOYEE_SKILL_LEVEL = 5;
export const EMPLOYEE_SPEED_BONUS_PER_LEVEL = 20;

export function getEmployeeProfile(employeeId, savedLevels = {}) {
  const employee = employeeRoster.find(({ id }) => id === employeeId);
  if (!employee) throw new Error(`Unknown employee: ${employeeId}`);
  const skillLevels = Object.fromEntries(EMPLOYEE_JOB_IDS.map((jobId) => {
    const level = savedLevels[jobId] ?? 1;
    if (!Number.isInteger(level) || level < 1 || level > MAX_EMPLOYEE_SKILL_LEVEL) {
      throw new RangeError(`Invalid ${jobId} skill level for ${employeeId}: ${level}`);
    }
    return [jobId, level];
  }));
  const gainedLevels = Object.values(skillLevels).reduce((sum, level) => sum + level - 1, 0);
  return {
    ...employee,
    skillLevels,
    wagePerShift: employee.wagePerShift + Math.ceil(employee.wagePerShift * gainedLevels / 10),
    hireCost: employee.hireCost + Math.ceil(employee.hireCost * gainedLevels / 4),
  };
}

export function getEmployeeJobSpeed(skillLevels, jobId) {
  if (!EMPLOYEE_JOB_IDS.includes(jobId)) throw new Error(`Unknown employee job: ${jobId}`);
  return (100 + EMPLOYEE_SPEED_BONUS_PER_LEVEL * ((skillLevels?.[jobId] ?? 1) - 1)) / 100;
}

export function getEmployeeTrainingOffer(employeeId, skillLevels, jobId) {
  const job = EMPLOYEE_JOBS.find(({ id }) => id === jobId);
  if (!job) throw new Error(`Unknown employee job: ${jobId}`);
  const employee = getEmployeeProfile(employeeId, skillLevels);
  const currentLevel = employee.skillLevels[jobId];
  if (currentLevel === MAX_EMPLOYEE_SKILL_LEVEL) return null;
  const targetLevel = currentLevel + 1;
  const trained = getEmployeeProfile(employeeId, { ...employee.skillLevels, [jobId]: targetLevel });
  const base = employeeRoster.find(({ id }) => id === employeeId);
  return {
    jobId,
    label: job.label,
    targetLevel,
    cost: Math.ceil(base.hireCost * targetLevel / 2),
    wagePerShift: employee.wagePerShift,
    nextWagePerShift: trained.wagePerShift,
    nextHireCost: trained.hireCost,
  };
}
