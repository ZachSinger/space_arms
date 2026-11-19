// ==========================================
// FILE: EmployeeRenderer.js
// ==========================================
// The Employee tab's hiring roster and current staff list.
import employeeRoster from "../../data/Employees.json" with { type: "json" };
import { html } from "../core/html.js";
import { EMPLOYEE_JOBS } from "./EmployeeJobs.js";
import { getStaffLimit, getStaffLimitReason } from "./ShopProgression.js";
import { getEmployeeProfile } from "./EmployeeTraining.js";
import { formatMoneyAmount, roundMoney } from "./Money.js";

const PRIORITY_LABELS = {
  register: "Prioritize Register",
  stock_shelves: "Prioritize Stocking",
};

function renderSkillLevels(employee, stockLabel = "Stock") {
  return html`<div class="type-description employee-skill-levels">
    <span>Register:${employee.skillLevels.register}</span>
    <span>${stockLabel}:${employee.skillLevels.stock_shelves}</span>
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
        const priorityOptions = EMPLOYEE_JOBS.map(({ id }) => {
          const label = PRIORITY_LABELS[id];
          if (!label) throw new Error(`Unknown employee job: ${id}`);
          return html`
            <button type="button" class="action-btn" data-employee-priority-id="${employee.id}"
              data-employee-priority-job="${id}" aria-pressed="${String(priorities[0] === id)}"
              ${canHire ? "" : "disabled"} aria-label="${label} for ${employee.name}">${label}</button>
          `;
        });
        const trainingJobId = employeeTraining[employee.id];
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
            ${canHire ? null : html`<p class="type-description">Change priority or On Shift / Off Shift between shifts.</p>`}
            <hr class="divider-thin">
            <div class="employee-priority-options" role="group" aria-label="Job priority for ${employee.name}">
              ${priorityOptions}
            </div>
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
