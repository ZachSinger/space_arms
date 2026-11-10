// ==========================================
// FILE: EmployeeRenderer.js
// ==========================================
// The Employee tab's hiring roster and current staff list.
import employeeRoster from "../../data/Employees.json" with { type: "json" };
import { EMPLOYEE_JOBS } from "./EmployeeJobs.js";
import { getShopLevelRequirement } from "./ShopProgression.js";
import {
  getEmployeeProfile, getEmployeeTrainingOffer, MAX_EMPLOYEE_SKILL_LEVEL,
  EMPLOYEE_SPEED_BONUS_PER_LEVEL,
} from "./EmployeeTraining.js";

export class EmployeeRenderer {
  static generateHTML({
    hiredEmployeeIds,
    activeEmployeeIds,
    employeeJobPriorities,
    credits,
    canHire,
    canFire = canHire,
    fireConfirmationEmployeeId = null,
    employeeSkills = {},
    employeeTraining = {},
    trainingConfirmation = null,
    shopLevel,
  }) {
    const hired = new Set(hiredEmployeeIds);
    const active = new Set(activeEmployeeIds);
    const roster = employeeRoster.map(({ id }) => getEmployeeProfile(id, employeeSkills[id]));
    const availableRows = roster
      .filter((employee) => !hired.has(employee.id))
      .map((employee) => {
        const affordable = credits >= employee.hireCost;
        const requiredReputation = getShopLevelRequirement(employee.requiredShopLevel);
        const unlocked = shopLevel >= employee.requiredShopLevel;
        const disabled = !unlocked || !canHire || !affordable;
        const buttonLabel = unlocked
          ? `Hire ${employee.name} for ${employee.hireCost} credits`
          : `${employee.name} is locked until Shop Level ${employee.requiredShopLevel}`;
        const reason = !unlocked
          ? `Reach Shop Level ${employee.requiredShopLevel} by having at least ${requiredReputation} store reputation at the end of a shift.`
          : !canHire
            ? "Hire between shifts."
            : !affordable
              ? `You need ${employee.hireCost - credits} more credits.`
              : "Can run the register, stock shelves, and load delivered crates into storage.";
        return `
          <div class="fixture-stock-row">
            <div>
              <strong>${employee.name} — ${employee.role}</strong>
              <div class="fixture-stock-meta">${reason}</div>
              <div class="fixture-stock-meta">Hiring cost: ${employee.hireCost} credits.
                Wages: ${employee.wagePerShift} credits per shift.</div>
              <div class="fixture-stock-meta">Skills:
                ${EMPLOYEE_JOBS.map(({ id, label }) => `${label}: Level ${employee.skillLevels[id]}`).join("; ")}.</div>
            </div>
            <button type="button" class="action-btn" data-hire-employee-id="${employee.id}"
              ${disabled ? "disabled" : ""} aria-label="${buttonLabel}">
              ${unlocked ? "HIRE" : "LOCKED"}
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
        const canLetGo = canFire && !trainingJobId;
        const confirmingFire = canLetGo && fireConfirmationEmployeeId === employee.id;
        const skillRows = EMPLOYEE_JOBS.map(({ id, label }) => {
          const level = employee.skillLevels[id];
          const bonus = (level - 1) * EMPLOYEE_SPEED_BONUS_PER_LEVEL;
          const benefit = id === "register" ? "register service" : id === "stock_shelves"
            ? "stocking trips" : "delivery-crate trips";
          const offer = getEmployeeTrainingOffer(employee.id, employee.skillLevels, id);
          const disabled = !canHire || trainingJobId || !offer || credits < offer.cost;
          return `
            <div class="employee-training-row">
              <div>
                <strong>${label}: Level ${level}/${MAX_EMPLOYEE_SKILL_LEVEL}</strong>
                <div class="fixture-stock-meta">${bonus ? `${bonus}% faster ${benefit}.` : `Normal ${benefit} speed.`}</div>
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
              Skills and higher wages are permanent, even after firing and rehiring.
              Rehiring will cost ${confirmedOffer.nextHireCost} credits.
            </p>
            <div class="employee-job-priority-controls">
              <button type="button" class="action-btn" data-confirm-employee-training>CONFIRM TRAINING</button>
              <button type="button" class="action-btn" data-cancel-employee-training>CANCEL</button>
            </div>
          </div>` : "";
        const fireControl = confirmingFire
          ? `
            <div class="employee-fire-confirmation">
              <div class="fixture-stock-meta">
                Let ${employee.name} go? The hiring cost is not refunded. Future shift wages stop.
              </div>
              <div class="employee-job-priority-controls">
                <button type="button" class="action-btn danger" data-confirm-fire-employee="${employee.id}">
                  CONFIRM
                </button>
                <button type="button" class="action-btn" data-cancel-fire-employee>
                  CANCEL
                </button>
              </div>
            </div>`
          : `
            <button type="button" class="action-btn danger" data-fire-employee-id="${employee.id}"
              ${canLetGo ? "" : "disabled"}
              aria-label="Let ${employee.name} go" title="${trainingJobId
                ? "Wait until this employee returns from training."
                : "Let staff go between shifts."}">
              LET GO
            </button>`;
        return `
        <div class="fixture-stock-row employee-staff-row">
          <div>
            <strong>${employee.name} — ${employee.role}</strong>
            <div class="fixture-stock-meta">
              ${trainingJobId
                ? `Training: ${EMPLOYEE_JOBS.find(({ id }) => id === trainingJobId).label}.
                  Away ${canHire ? "next" : "this"} shift; wages are still paid.`
                : active.has(employee.id) ? "Working this shift." : "Hired and ready for the next shift."}
            </div>
            <div class="fixture-stock-meta">Wages: ${employee.wagePerShift} credits per shift.</div>
            ${canHire ? "" : `<div class="fixture-stock-meta">Change job order or let staff go between shifts.</div>`}
            <div class="fixture-stock-meta">Job priority (top to bottom):</div>
            <ol class="employee-job-priorities">${priorityRows}</ol>
            <div class="fixture-stock-meta">JOB SKILLS &amp; TRAINING</div>
            ${skillRows}
            ${trainingControl}
            ${confirmingFire ? fireControl : ""}
          </div>
          ${confirmingFire ? "" : fireControl}
        </div>
        `;
      }).join("");

    return `
      <div class="employee-panel">
      <div class="fixture-stock-meta">
        Each employee can run the register, stock shelves, or move delivered crates into
        storage. Set their job order below. Wages are paid when a shift starts.
        Training takes one paid shift away and permanently raises wages and rehiring costs.
      </div>
      <div class="fixture-section-divider">STAFF TO HIRE</div>
      ${availableRows || `<div class="fixture-empty-hint">No other staff are available to hire.</div>`}
      <div class="fixture-section-divider">YOUR STAFF</div>
      ${hiredRows || `<div class="fixture-empty-hint">You have not hired any staff.</div>`}
      </div>
    `;
  }
}
