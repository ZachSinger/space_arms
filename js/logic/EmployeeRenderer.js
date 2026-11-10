// ==========================================
// FILE: EmployeeRenderer.js
// ==========================================
// The Employee tab's hiring roster and current staff list.
import employeeRoster from "../../data/Employees.json" with { type: "json" };
import { EMPLOYEE_JOBS } from "./EmployeeJobs.js";
import { getStaffLimit, getStaffLimitReason } from "./ShopProgression.js";
import {
  getEmployeeProfile, getEmployeeTrainingOffer, MAX_EMPLOYEE_SKILL_LEVEL,
  getEmployeeJobSpeed,
} from "./EmployeeTraining.js";

export class EmployeeRenderer {
  static generateHTML({
    hiredEmployeeIds,
    offShiftEmployeeIds = [],
    activeEmployeeIds,
    employeeJobPriorities,
    credits,
    canHire,
    employeeSkills = {},
    employeeTraining = {},
    trainingConfirmation = null,
    shopLevel,
  }) {
    const hired = new Set(hiredEmployeeIds);
    const offShift = new Set(offShiftEmployeeIds);
    const active = new Set(activeEmployeeIds);
    const roster = employeeRoster.map(({ id }) => getEmployeeProfile(id, employeeSkills[id]));
    const staffLimit = getStaffLimit(shopLevel);
    const staffLimitReason = getStaffLimitReason(shopLevel, hired.size);
    const availableRows = roster
      .filter((employee) => !hired.has(employee.id))
      .map((employee) => {
        const affordable = credits >= employee.hireCost;
        const disabled = Boolean(staffLimitReason) || !canHire || !affordable;
        const buttonLabel = staffLimitReason
          ? `No staff spot is open to hire ${employee.name}`
          : `Hire ${employee.name} for ${employee.hireCost} credits`;
        const reason = staffLimitReason
          ? staffLimitReason
          : !canHire
            ? "Hire between shifts."
            : !affordable
              ? `You need ${employee.hireCost - credits} more credits.`
              : "Can run the register, stock shelves, and load delivered crates into storage.";
        return `
          <div class="fixture-stock-row">
            <div>
              <strong>${employee.name}</strong>
              <div class="fixture-stock-meta">${reason}</div>
              <div class="fixture-stock-meta">Hiring cost: ${employee.hireCost} credits.
                Wages: ${employee.wagePerShift} credits per shift.</div>
              <div class="fixture-stock-meta">Skills:
                ${EMPLOYEE_JOBS.map(({ id, label }) => `${label}: Level ${employee.skillLevels[id]}`).join("; ")}.
                Carries ${employee.backpackCapacity} items when stocking.</div>
            </div>
            <button type="button" class="action-btn" data-hire-employee-id="${employee.id}"
              ${disabled ? "disabled" : ""} aria-label="${buttonLabel}">
              ${staffLimitReason ? "FULL" : "HIRE"}
            </button>
          </div>
        `;
      }).join("");

    const hiredRows = roster
      .filter((employee) => hired.has(employee.id))
      .map((employee) => {
        const priorities = employeeJobPriorities[employee.id] ?? employee.jobPriorities;
        const priorityRows = priorities.map((jobId, index) => {
          const job = EMPLOYEE_JOBS.find((candidate) => candidate.id === jobId);
          if (!job) throw new Error(`Unknown employee job: ${jobId}`);
          return `
            <li class="employee-job-priority">
              <span>${index + 1}. ${job.label}</span>
              <span class="employee-job-priority-controls">
                <button type="button" class="action-btn" data-employee-priority-id="${employee.id}"
                  data-employee-priority-job="${jobId}" data-employee-priority-direction="-1"
                  ${!canHire || index === 0 ? "disabled" : ""}
                  aria-label="Move ${job.label} up for ${employee.name}">UP</button>
                <button type="button" class="action-btn" data-employee-priority-id="${employee.id}"
                  data-employee-priority-job="${jobId}" data-employee-priority-direction="1"
                  ${!canHire || index === priorities.length - 1 ? "disabled" : ""}
                  aria-label="Move ${job.label} down for ${employee.name}">DOWN</button>
              </span>
            </li>
          `;
        }).join("");
        const trainingJobId = employeeTraining[employee.id];
        const isOnShift = !offShift.has(employee.id);
        const skillRows = EMPLOYEE_JOBS.map(({ id, label }) => {
          const level = employee.skillLevels[id];
          const bonus = Math.round((getEmployeeJobSpeed(employee.skillLevels, id) - 1) * 100);
          const benefit = id === "register" ? "register service" : id === "stock_shelves"
            ? "stocking trips" : "delivery-crate trips";
          const carry = id === "stock_shelves"
            ? ` Carries ${employee.backpackCapacity} items per trip.` : "";
          const offer = getEmployeeTrainingOffer(employee.id, employee.skillLevels, id);
          const disabled = !canHire || trainingJobId || !offer || credits < offer.cost;
          return `
            <div class="employee-training-row">
              <div>
                <strong>${label}: Level ${level}/${MAX_EMPLOYEE_SKILL_LEVEL}</strong>
                <div class="fixture-stock-meta">${bonus ? `${bonus}% faster ${benefit}.` : `Normal ${benefit} speed.`}${carry}</div>
                <div class="fixture-stock-meta">${trainingJobId
                  ? trainingJobId === id && offer
                    ? `Booked: Level ${offer.targetLevel}. Wages after training: ${offer.nextWagePerShift} credits per shift.`
                    : "More training is available after this employee returns."
                  : offer ? `Next level: ${offer.cost} credits. Future wages: ${offer.nextWagePerShift} credits per shift.`
                  : "Fully trained in this skill."}</div>
              </div>
              ${offer ? `<button type="button" class="action-btn" data-train-employee-id="${employee.id}"
                data-train-employee-job="${id}" ${disabled ? "disabled" : ""}
                aria-label="Train ${employee.name}: ${label} Level ${offer.targetLevel} for ${offer.cost} credits">TRAIN</button>` : ""}
            </div>`;
        }).join("");
        const confirmedOffer = canHire && !trainingJobId && trainingConfirmation?.employeeId === employee.id
          ? getEmployeeTrainingOffer(employee.id, employee.skillLevels, trainingConfirmation.jobId)
          : null;
        const trainingControl = confirmedOffer ? `
          <div class="employee-training-confirmation">
            <div>Train ${employee.name}: ${confirmedOffer.label} Level ${confirmedOffer.targetLevel}?</div>
            <p class="fixture-stock-meta">
              Pay ${confirmedOffer.cost} credits now. Away for the next shift; still paid
              ${confirmedOffer.wagePerShift} credits for that shift.
              After training, wages become ${confirmedOffer.nextWagePerShift} credits per shift.
              ${confirmedOffer.jobId !== "stock_shelves"
                ? `After training, ${Math.round((getEmployeeJobSpeed({
                  ...employee.skillLevels,
                  [confirmedOffer.jobId]: confirmedOffer.targetLevel,
                }, confirmedOffer.jobId) - 1) * 100)}% faster ${confirmedOffer.jobId === "register"
                  ? "register service" : "delivery-crate trips"}.` : ""}
              ${confirmedOffer.jobId === "stock_shelves"
                ? `They will carry ${confirmedOffer.nextBackpackCapacity} items per stocking trip.` : ""}
              Each course for ${employee.name} costs more than the last, whichever skill it trains.
              Skills and higher wages are permanent.
            </p>
            <div class="employee-job-priority-controls">
              <button type="button" class="action-btn" data-confirm-employee-training>CONFIRM TRAINING</button>
              <button type="button" class="action-btn" data-cancel-employee-training>CANCEL</button>
            </div>
          </div>` : "";
        const shiftTitle = canHire ? "" : "Change On Shift or Off Shift between shifts.";
        const shiftButton = (on) => `
              <button type="button" class="action-btn" data-employee-shift-id="${employee.id}"
                data-employee-shift-on="${on}" aria-pressed="${isOnShift === on}"
                ${canHire ? "" : "disabled"}
                aria-label="Set ${employee.name} ${on ? "On Shift" : "Off Shift"}"
                title="${shiftTitle || (on
                  ? "On Shift: works and is paid each shift."
                  : "Off Shift: stays home and isn't paid.")}">
                ${on ? "ON SHIFT" : "OFF SHIFT"}
              </button>`;
        const shiftControl = trainingJobId
          ? `<div class="employee-shift-training">IN TRAINING: NOT AVAILABLE</div>`
          : `<div class="employee-shift-toggle">${shiftButton(true)}${shiftButton(false)}</div>`;
        return `
        <div class="fixture-stock-row employee-staff-row">
          <div>
            <div class="employee-staff-header">
              <strong>${employee.name}</strong>
              ${shiftControl}
            </div>
            <div class="fixture-stock-meta">
              ${trainingJobId
                ? `Training: ${EMPLOYEE_JOBS.find(({ id }) => id === trainingJobId).label}.
                  Away ${canHire ? "next" : "this"} shift; wages are still paid.`
                : !isOnShift ? "Off Shift: stays home and isn't paid."
                : active.has(employee.id) ? "Working this shift." : "On Shift: works and is paid each shift."}
            </div>
            <div class="fixture-stock-meta">Wages: ${employee.wagePerShift} credits per shift${isOnShift || trainingJobId ? "" : " (not paid while Off Shift)"}.</div>
            ${canHire ? "" : `<div class="fixture-stock-meta">Change job order or On Shift / Off Shift between shifts.</div>`}
            <div class="fixture-stock-meta">Job priority (top to bottom):</div>
            <ol class="employee-job-priorities">${priorityRows}</ol>
            <div class="fixture-stock-meta">JOB SKILLS &amp; TRAINING</div>
            ${skillRows}
            ${trainingControl}
          </div>
        </div>
        `;
      }).join("");

    return `
      <div class="employee-panel">
      <div class="fixture-stock-meta">
        Each employee can run the register, stock shelves, or move delivered crates into
        storage. Set their job order below. Wages are paid when a shift starts, for
        employees who are On Shift or in training. Off Shift employees stay home unpaid.
        Everyone starts with the same skills; training is how they improve. It takes one paid
        shift away and permanently raises wages.
      </div>
      <div class="fixture-stock-meta">
        Employees hired: ${hired.size} of ${staffLimit} your shop allows.
      </div>
      <div class="fixture-section-divider">STAFF TO HIRE</div>
      ${availableRows || `<div class="fixture-empty-hint">No other staff are available to hire.</div>`}
      <div class="fixture-section-divider">YOUR STAFF</div>
      ${hiredRows || `<div class="fixture-empty-hint">You have not hired any staff.</div>`}
      </div>
    `;
  }
}
