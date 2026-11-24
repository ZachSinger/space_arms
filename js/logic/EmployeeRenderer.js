// ==========================================
// FILE: EmployeeRenderer.js
// ==========================================
// The Employee tab's hiring roster and current staff list.
import employeeRoster from "../../data/Employees.json" with { type: "json" };
import { html } from "../core/html.js";
import { EMPLOYEE_JOBS } from "./EmployeeJobs.js";
import { getStaffLimit, getStaffLimitReason } from "./ShopProgression.js";
import {
  getEmployeeJobSpeed, getEmployeeProfile, getEmployeeTrainingBlockReason, getEmployeeTrainingOffer,
} from "./EmployeeTraining.js";
import { formatMoneyAmount, roundMoney } from "./Money.js";

const ORDER_NAMES = {
  register: "Register",
  stock_shelves: "Stocking",
  clean: "Cleaning",
};

function renderSkillLevels(employee, stockLabel = "Stock") {
  return html`<div class="type-description employee-skill-levels">
    <span>Register:${employee.skillLevels.register}</span>
    <span>${stockLabel}:${employee.skillLevels.stock_shelves}</span>
    <span>Cleaning:${employee.skillLevels.clean}</span>
  </div>`;
}

function renderTraining(employee, selectedJobId, trainingJobId, canManage, credits) {
  const label = ORDER_NAMES[selectedJobId];
  if (!label) throw new Error(`Unknown training skill: ${selectedJobId}.`);
  const offer = getEmployeeTrainingOffer(employee.id, employee.skillLevels, selectedJobId);
  const currentLevel = employee.skillLevels[selectedJobId];
  const currentSpeed = Math.round(getEmployeeJobSpeed(employee.skillLevels, selectedJobId) * 100);
  const nextSpeed = offer && Math.round(getEmployeeJobSpeed({
    ...employee.skillLevels, [selectedJobId]: offer.targetLevel,
  }, selectedJobId) * 100);
  const reason = getEmployeeTrainingBlockReason({
    canManage,
    isHired: true,
    isTraining: Boolean(trainingJobId),
    offer,
    credits,
  });
  return html`
    <hr class="divider-thin">
    <h4 class="employee-section-title">Training</h4>
    <p class="employee-training-hint">Choose a skill:</p>
    <div class="employee-training-skills" role="group" aria-label="Training skill for ${employee.name}">
      ${EMPLOYEE_JOBS.map(({ id }) => html`
        <button type="button" class="employee-training-skill${id === selectedJobId ? " active" : ""}"
          data-employee-training-id="${employee.id}" data-employee-training-job="${id}"
          data-employee-training-action="select" aria-pressed="${String(id === selectedJobId)}"
          aria-label="Choose ${ORDER_NAMES[id]} training for ${employee.name}">${ORDER_NAMES[id]}</button>
      `)}
    </div>
    <div class="employee-training-preview">
      <div class="employee-training-title">
        <strong>${label} training</strong>
        <span>${offer ? `Level ${currentLevel} → ${offer.targetLevel}` : `Level ${currentLevel} (maximum)`}</span>
      </div>
      <p>${label} speed: ${currentSpeed}%${offer ? ` → ${nextSpeed}%` : ""} of Level 1 speed</p>
      ${offer && !trainingJobId ? html`
        <p>Training price: <strong>${formatMoneyAmount(offer.cost)}</strong></p>
        <p>Wages after training: <strong>${formatMoneyAmount(offer.nextWagePerShift)} per shift worked or spent in training</strong></p>
      ` : null}
      ${trainingJobId ? html`<p class="employee-training-away">${employee.name} has ${ORDER_NAMES[trainingJobId]}
        training booked and is away for the training shift. Their current wage of ${formatMoneyAmount(employee.wagePerShift)} is still paid.</p>`
        : offer ? html`<p class="employee-training-away">${employee.name} will miss the entire next shift
          and still be paid ${formatMoneyAmount(employee.wagePerShift)} if training is booked.</p>` : null}
      <button type="button" class="action-btn employee-training-book"
        data-employee-training-id="${employee.id}" data-employee-training-job="${selectedJobId}"
        data-employee-training-action="book" ${reason ? "disabled" : ""}
        aria-label="Book ${label} training for ${employee.name}">Book ${label} training</button>
      ${reason ? html`<p class="employee-training-reason">${reason}</p>` : null}
    </div>`;
}

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
    employeeTrainingSelection = {},
    shopLevel,
    registers = [],
    registerAssignments = {},
    hovercarts = [],
    hovercartAssignments = {},
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
          : `Hire ${employee.name} for ${employee.hireCost}`;
        const reason = !staffLimitReason && canHire && !affordable
          ? `You need ${formatMoneyAmount(roundMoney(employee.hireCost - credits))} more.`
          : null;
        return html`
          <div class="item-card employee-candidate-row">
            <div class="employee-candidate-name">
              <h3 class="type-h3">${employee.name}</h3>
              ${renderSkillLevels(employee)}
              ${reason ? html`<p class="type-description employee-candidate-reason">${reason}</p>` : null}
            </div>
            <div class="type-description employee-candidate-wage">${employee.wagePerShift}</div>
            <div class="type-description employee-hire-cost">${employee.hireCost}</div>
            <button type="button" class="action-btn" data-hire-employee-id="${employee.id}"
              ${disabled ? "disabled" : ""} aria-label="${buttonLabel}">
              ${staffLimitReason ? "FULL" : "HIRE"}
            </button>
          </div>
        `;
      });

    const hiredRows = roster
      .filter((employee) => hired.has(employee.id))
      .map((employee) => {
        const priorities = employeeJobPriorities[employee.id] ?? employee.jobPriorities;
        if (priorities.length !== EMPLOYEE_JOBS.length ||
          !EMPLOYEE_JOBS.every(({ id }) => priorities.includes(id))) {
          throw new Error(`Invalid job priorities for ${employee.name}.`);
        }
        const visiblePriorities = priorities.filter((id) => id !== "register");
        const priorityOptions = visiblePriorities.map((id, index) => {
          const label = ORDER_NAMES[id];
          return html`
            <div role="listitem" draggable="${String(canHire)}"
              data-employee-job-id="${employee.id}" data-employee-job="${id}">
              <span>${index + 1}. ${label}</span>
              ${["up", "down"].map((direction) => html`
                <button type="button" class="action-btn" data-employee-priority-id="${employee.id}"
                  data-employee-priority-job="${id}" data-employee-priority-move="${direction}"
                  ${!canHire || (direction === "up" ? index === 0 : index === visiblePriorities.length - 1) ? "disabled" : ""}
                  aria-label="Move ${label} ${direction} for ${employee.name}">Move ${direction}</button>
              `)}
            </div>
          `;
        });
        const nameOf = (employeeId) => roster.find(({ id }) => id === employeeId)?.name ?? employeeId;
        const ownRegisterId = registers.find(({ id }) => registerAssignments[id] === employee.id)?.id ?? "";
        const registerOptions = [{ id: "", name: "NONE" }, ...registers].map(({ id, name }) => {
          const holder = id ? registerAssignments[id] : null;
          const takenBy = holder && holder !== employee.id ? nameOf(holder) : null;
          const label = id ? `Assign ${employee.name} to ${name}` : `Keep ${employee.name} off the registers`;
          return html`
            <button type="button" class="action-btn" data-employee-register-id="${employee.id}"
              data-employee-register="${id}" aria-pressed="${String(id === ownRegisterId)}"
              ${canHire ? "" : "disabled"}
              aria-label="${takenBy ? `${label}, replacing ${takenBy}` : label}"
              title="${takenBy ? `${takenBy} works ${name} now. Choosing it takes ${takenBy} off.` : ""}">
              ${name}${takenBy ? ` (${takenBy})` : ""}
            </button>`;
        });
        const trainingJobId = employeeTraining[employee.id];
        const ownCartId = hovercarts.find(({ id }) => hovercartAssignments[id] === employee.id)?.id ?? "";
        const cartOptions = [{ id: "", name: "NONE" }, ...hovercarts].map(({ id, name }) => {
          const holder = id ? hovercartAssignments[id] : null;
          const takenBy = holder && holder !== employee.id ? nameOf(holder) : null;
          return html`
            <button type="button" class="action-btn" data-employee-hovercart-id="${employee.id}"
              data-employee-hovercart="${id}" aria-pressed="${String(id === ownCartId)}"
              ${canHire ? "" : "disabled"}
              aria-label="${id ? `Assign ${name} to ${employee.name}` : `${employee.name} stocks by hand`}${takenBy ? `, replacing ${takenBy}` : ""}">
              ${name}${takenBy ? ` (${takenBy})` : ""}
            </button>`;
        });
        const selectedTrainingJobId = employeeTrainingSelection[employee.id] ?? trainingJobId ?? "register";
        const isOnShift = !offShift.has(employee.id);
        const shiftTitle = canHire ? "" : "Change On Shift or Off Shift between shifts.";
        const shiftButton = (on) => html`
              <button type="button" class="action-btn" data-employee-shift-id="${employee.id}"
                data-employee-shift-on="${String(on)}" aria-pressed="${String(isOnShift === on)}"
                ${canHire ? "" : "disabled"}
                aria-label="Set ${employee.name} ${on ? "On Shift" : "Off Shift"}"
                title="${shiftTitle || (on ? "" : "Off Shift: stays home and isn't paid.")}">
                ${on ? "ON SHIFT" : "OFF SHIFT"}
              </button>`;
        const shiftControl = trainingJobId
          ? html`<div class="employee-shift-away">AWAY: NOT AVAILABLE</div>`
          : html`<div class="employee-shift-toggle">${shiftButton(true)}${shiftButton(false)}</div>`;
        const status = trainingJobId
          ? html`<p class="type-description">Away ${canHire ? "next" : "this"} shift; wages are still paid.</p>`
          : !isOnShift
            ? html`<p class="type-description">Off Shift: stays home and isn't paid.</p>`
            : active.has(employee.id)
              ? html`<p class="type-description">Working this shift.</p>`
              : null;
        return html`
          <div class="item-card employee-staff-row">
            <div class="employee-staff-header">
              <h3 class="type-h3">${employee.name}</h3>
              ${shiftControl}
            </div>
            ${renderSkillLevels(employee, "Stocking")}
            ${status}
            <p class="type-description">Wages: ${employee.wagePerShift}</p>
            ${canHire ? null : html`<p class="type-description">Change register, jobs, or On Shift / Off Shift between shifts.</p>`}
            <hr class="divider-thin">
            <h4 class="employee-section-title">Register</h4>
            <p class="employee-training-hint">They stay at this register all shift. When you step onto it, they do their other jobs until you leave.</p>
            <div class="employee-register-options" role="group" aria-label="Register for ${employee.name}">
              ${registerOptions}
            </div>
            <h4 class="employee-section-title">Hovercart</h4>
            <p class="employee-training-hint">Assigned carts carry stocking crates for this employee, not you. They return to charge, keeping leftover stock on the cart. NONE leaves carts available to you. Dock the cart before changing its assignment; leftover crates stay with it.</p>
            ${hovercarts.length ? null : html`<p class="type-description">Buy a hovercart in Layout and place its charger to assign it here.</p>`}
            <div class="employee-register-options" role="group" aria-label="Hovercart for ${employee.name}">
              ${cartOptions}
            </div>
            <h4 class="employee-section-title">Other jobs</h4>
            <p class="employee-training-hint">Off the register, they do these in order. Drag to reorder.</p>
            <div class="employee-priority-options" role="list" aria-label="Job priority for ${employee.name}">
              ${priorityOptions}
            </div>
            ${renderTraining(employee, selectedTrainingJobId, trainingJobId, canHire, credits)}
          </div>
        `;
      });

    const hiringNotice = staffLimitReason
      ? html`<p class="type-description">${staffLimitReason}</p>`
      : !canHire
        ? html`<p class="type-description">Staff can only be hired between shifts.</p>`
        : null;
    const availableContent = availableRows.length > 0
      ? html`
          <div class="employee-hire-columns">
            <h3 class="type-h3">Name</h3>
            <h3 class="type-h3">Wages</h3>
            <h3 class="type-h3">Hire Cost</h3>
            <span></span>
          </div>
          <div class="employee-available-list">${availableRows}</div>
        `
      : html`<p class="type-description employee-empty">No other staff are available to hire.</p>`;

    return String(html`
      <div class="employee-panel">
        <div class="employee-panel-heading">
          <h2 class="type-h2">Staff to Hire</h2>
        </div>
        <div class="employee-panel-heading employee-section-heading">
          <h2 class="type-h2">Your Staff</h2>
          <p class="type-description">Hired: ${hired.size} of ${staffLimit}</p>
        </div>
        <hr class="divider-thick employee-panel-divider">
        <section class="employee-section">
          <div class="employee-column-scroll custom-scrollbar" data-employee-scroll="hiring">
            ${hiringNotice}
            ${availableContent}
          </div>
        </section>
        <section class="employee-section employee-section-staff">
          <div class="employee-column-scroll custom-scrollbar" data-employee-scroll="staff">
            ${hiredRows.length > 0 ? hiredRows : html`<p class="type-description employee-empty">You have not hired any staff.</p>`}
          </div>
        </section>
      </div>
    `);
  }
}
