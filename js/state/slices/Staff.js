// ==========================================
// FILE: Staff.js
// ==========================================
// Hired employees and their records: who is on shift, job priorities, skill levels, and training
// booked for the next shift. Money for hiring and training is handled by GameState.
import { Slice } from "../Slice.js";
import employeeRoster from "../../../data/Employees.json" with { type: "json" };
import { getEmployeeProfile, getEmployeeTrainingOffer } from "../../logic/EmployeeTraining.js";

function defaultJobPriorities(employeeId) {
  const employee = employeeRoster.find((candidate) => candidate.id === employeeId);
  if (!employee) throw new Error(`Unknown employee: ${employeeId}`);
  return [...employee.jobPriorities];
}

export class Staff extends Slice {
  constructor() {
    super();
    /** @type {string[]} */
    this.hired = [];
    // Hired staff who skip shifts: they don't work and aren't paid.
    /** @type {string[]} */
    this.offShift = [];
    /** @type {Record<string, string[]>} */
    this.jobPriorities = {};
    /** @type {Record<string, Record<string, number>>} */
    this.skills = {};
    // Employee id -> job they're away training in this shift.
    /** @type {Record<string, string>} */
    this.training = {};
    // Register fixture id -> the one employee assigned to work it all shift.
    /** @type {Record<string, string>} */
    this.registerAssignments = {};
    /** @type {Record<string, string>} charger fixture id -> employee id */
    this.hovercartAssignments = {};
  }

  hovercartFor(employeeId) {
    return Object.keys(this.hovercartAssignments)
      .find((id) => this.hovercartAssignments[id] === employeeId) ?? null;
  }

  assignHovercart(employeeId, chargerId) {
    if (!this.hired.includes(employeeId) || this.hovercartFor(employeeId) === chargerId) return false;
    const current = this.hovercartFor(employeeId);
    if (current) delete this.hovercartAssignments[current];
    if (chargerId) this.hovercartAssignments[chargerId] = employeeId;
    this.changed();
    return true;
  }

  /** @param {string} employeeId @returns {string | null} register fixture id */
  registerFor(employeeId) {
    return Object.keys(this.registerAssignments)
      .find((registerId) => this.registerAssignments[registerId] === employeeId) ?? null;
  }

  /**
   * Puts an employee on one register (taking it from whoever had it), or on none.
   * @param {string} employeeId
   * @param {string | null} registerId
   */
  assignRegister(employeeId, registerId) {
    if (!this.hired.includes(employeeId) || this.registerFor(employeeId) === registerId) return false;
    const current = this.registerFor(employeeId);
    if (current) delete this.registerAssignments[current];
    if (registerId) this.registerAssignments[registerId] = employeeId;
    this.changed();
    return true;
  }

  /** @param {string} employeeId */
  isHired(employeeId) {
    return this.hired.includes(employeeId);
  }

  /** @param {string} employeeId */
  profile(employeeId) {
    return getEmployeeProfile(employeeId, this.skills[employeeId]);
  }

  onShift() {
    return this.hired.filter((employeeId) => !this.offShift.includes(employeeId));
  }

  // Paid at shift start: On Shift staff plus anyone away training (training is a paid shift).
  paid() {
    return this.hired.filter((employeeId) => this.training[employeeId] || !this.offShift.includes(employeeId));
  }

  // Working this shift: On Shift and not away training.
  working() {
    return this.onShift().filter((employeeId) => !this.training[employeeId]);
  }

  /** @param {string} employeeId */
  trainingOffer(employeeId, jobId) {
    return getEmployeeTrainingOffer(employeeId, this.skills[employeeId], jobId);
  }

  /** @param {string} employeeId - already checked and paid for by GameState */
  add(employeeId) {
    const jobPriorities = defaultJobPriorities(employeeId);
    this.hired.push(employeeId);
    this.jobPriorities[employeeId] = jobPriorities;
    this.changed();
  }

  /**
   * @param {string} employeeId
   * @param {string} jobId - already checked and paid for by GameState
   */
  bookTraining(employeeId, jobId) {
    this.training[employeeId] = jobId;
    this.changed();
  }

  // Trainees are simply away, so their setting can't change until they return.
  setOnShift(employeeId, onShift) {
    if (!this.hired.includes(employeeId) || this.training[employeeId]) return false;
    const isOnShift = !this.offShift.includes(employeeId);
    if (isOnShift === onShift) return false;
    this.offShift = onShift
      ? this.offShift.filter((id) => id !== employeeId)
      : [...this.offShift, employeeId];
    this.changed();
    return true;
  }

  // Puts one job first; the others keep their order behind it.
  prioritizeJob(employeeId, jobId) {
    return this.moveJob(employeeId, jobId, 0);
  }

  moveJob(employeeId, jobId, targetIndex) {
    if (!this.hired.includes(employeeId)) return false;
    const priorities = this.jobPriorities[employeeId];
    if (!Array.isArray(priorities)) throw new Error(`Employee ${employeeId} has no saved job priorities.`);
    const index = priorities.indexOf(jobId);
    if (index < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 ||
      targetIndex >= priorities.length || index === targetIndex) return false;
    priorities.splice(index, 1);
    priorities.splice(targetIndex, 0, jobId);
    this.changed();
    return true;
  }

  // At the end of a shift, everyone away training comes back one level better.
  finishTraining() {
    for (const [employeeId, jobId] of Object.entries(this.training)) {
      const employee = this.profile(employeeId);
      const offer = getEmployeeTrainingOffer(employeeId, employee.skillLevels, jobId);
      if (!offer || !this.hired.includes(employeeId)) throw new Error(`Invalid booked training for ${employeeId}.`);
      this.skills[employeeId] = { ...employee.skillLevels, [jobId]: offer.targetLevel };
    }
    this.training = {};
    this.changed();
  }

  toSave() {
    return {
      hiredEmployees: [...this.hired],
      offShiftEmployees: [...this.offShift],
      employeeJobPriorities: Object.fromEntries(
        this.hired.map((employeeId) => [employeeId, [...this.jobPriorities[employeeId]]])),
      employeeSkills: Object.fromEntries(Object.entries(this.skills).map(([id, levels]) => [id, { ...levels }])),
      employeeTraining: { ...this.training },
      registerAssignments: { ...this.registerAssignments },
      hovercartAssignments: { ...this.hovercartAssignments },
    };
  }

  /** @param {object} data - the saved player section */
  static fromSave(data) {
    const staff = new Staff();
    staff.hired = [...(data.hiredEmployees || [])];
    staff.offShift = [...(data.offShiftEmployees ?? [])];
    staff.jobPriorities = Object.fromEntries(staff.hired.map((employeeId) => [
      employeeId, [...(data.employeeJobPriorities?.[employeeId] ?? defaultJobPriorities(employeeId))],
    ]));
    staff.skills = Object.fromEntries(Object.entries(data.employeeSkills ?? {}).map(([id, levels]) => [id, { ...levels }]));
    staff.training = { ...(data.employeeTraining ?? {}) };
    staff.registerAssignments = { ...(data.registerAssignments ?? {}) };
    staff.hovercartAssignments = { ...(data.hovercartAssignments ?? {}) };
    return staff;
  }
}
