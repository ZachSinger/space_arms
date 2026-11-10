// Shared employee skill, training-price, wage, and carry rules.
// Every employee starts the same; training is the only way they improve.
import employeeRoster from "../../data/Employees.json" with { type: "json" };
import { EMPLOYEE_JOBS, EMPLOYEE_JOB_IDS } from "./EmployeeJobs.js";

export const MAX_EMPLOYEE_SKILL_LEVEL = 5;
export const EMPLOYEE_SPEED_BONUS_PER_LEVEL = 20;
export const EMPLOYEE_MILESTONE_SPEED_BONUS = 10;
export const EMPLOYEE_MILESTONE_LEVELS = Object.freeze([3, 5]);
export const EMPLOYEE_HIRE_COST = 250;
export const EMPLOYEE_BASE_WAGE = 50;
export const EMPLOYEE_BASE_CARRY = 10;
export const EMPLOYEE_CARRY_PER_STOCKING_LEVEL = 5;
export const EMPLOYEE_STOCKING_MILESTONE_CARRY_BONUS = 5;

export function getEmployeeCarryCapacity(stockShelvesLevel) {
  const milestoneBonus = stockShelvesLevel >= 3
    ? EMPLOYEE_STOCKING_MILESTONE_CARRY_BONUS
    : 0;
  return EMPLOYEE_BASE_CARRY +
    EMPLOYEE_CARRY_PER_STOCKING_LEVEL * (stockShelvesLevel - 1) + milestoneBonus;
}

function countCoursesTaken(skillLevels) {
  return Object.values(skillLevels).reduce((sum, level) => sum + level - 1, 0);
}

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
  const coursesTaken = countCoursesTaken(skillLevels);
  return {
    ...employee,
    skillLevels,
    coursesTaken,
    wagePerShift: EMPLOYEE_BASE_WAGE + Math.ceil(EMPLOYEE_BASE_WAGE * coursesTaken / 10),
    hireCost: EMPLOYEE_HIRE_COST,
    backpackCapacity: getEmployeeCarryCapacity(skillLevels.stock_shelves),
  };
}

export function getEmployeeJobSpeed(skillLevels, jobId) {
  if (!EMPLOYEE_JOB_IDS.includes(jobId)) throw new Error(`Unknown employee job: ${jobId}`);
  const level = skillLevels?.[jobId] ?? 1;
  const hasSpeedMilestone = jobId === "register" || jobId === "load_storage";
  const milestoneCount = hasSpeedMilestone
    ? EMPLOYEE_MILESTONE_LEVELS.filter((milestone) => level >= milestone).length
    : 0;
  const bonus = EMPLOYEE_SPEED_BONUS_PER_LEVEL * (level - 1) +
    EMPLOYEE_MILESTONE_SPEED_BONUS * milestoneCount;
  return (100 + bonus) / 100;
}

// Each course costs more than this employee's last one, whichever skill it trains.
export function getEmployeeTrainingCost(coursesTaken) {
  return Math.ceil(EMPLOYEE_HIRE_COST * (coursesTaken + 2) / 2);
}

export function getEmployeeTrainingOffer(employeeId, skillLevels, jobId) {
  const job = EMPLOYEE_JOBS.find(({ id }) => id === jobId);
  if (!job) throw new Error(`Unknown employee job: ${jobId}`);
  const employee = getEmployeeProfile(employeeId, skillLevels);
  const currentLevel = employee.skillLevels[jobId];
  if (currentLevel === MAX_EMPLOYEE_SKILL_LEVEL) return null;
  const targetLevel = currentLevel + 1;
  const trained = getEmployeeProfile(employeeId, { ...employee.skillLevels, [jobId]: targetLevel });
  return {
    jobId,
    label: job.label,
    targetLevel,
    cost: getEmployeeTrainingCost(employee.coursesTaken),
    wagePerShift: employee.wagePerShift,
    nextWagePerShift: trained.wagePerShift,
    nextBackpackCapacity: trained.backpackCapacity,
  };
}