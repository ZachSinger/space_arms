// ==========================================
// FILE: EmployeeRenderer.js
// ==========================================
// The Employee tab's hiring roster and current staff list.
import employeeRoster from "../../data/Employees.json" with { type: "json" };
import { EMPLOYEE_JOBS } from "./EmployeeJobs.js";

export class EmployeeRenderer {
  static generateHTML({
    hiredEmployeeIds,
    activeEmployeeIds,
    employeeJobPriorities,
    credits,
    canHire,
  }) {
    const hired = new Set(hiredEmployeeIds);
    const active = new Set(activeEmployeeIds);
    const availableRows = employeeRoster
      .filter((employee) => !hired.has(employee.id))
      .map((employee) => {
        const affordable = credits >= employee.hireCost;
        const disabled = !canHire || !affordable;
        const reason = !canHire
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
            </div>
            <button type="button" class="action-btn" data-hire-employee-id="${employee.id}"
              ${disabled ? "disabled" : ""} aria-label="Hire ${employee.name} for ${employee.hireCost} credits">
              HIRE
            </button>
          </div>
        `;
      }).join("");

    const hiredRows = employeeRoster
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
        return `
        <div class="fixture-stock-row">
          <div>
            <strong>${employee.name} — ${employee.role}</strong>
            <div class="fixture-stock-meta">
              ${active.has(employee.id) ? "Working this shift." : "Hired and ready for the next shift."}
            </div>
            <div class="fixture-stock-meta">Wages: ${employee.wagePerShift} credits per shift.</div>
            ${canHire ? "" : `<div class="fixture-stock-meta">Change job order between shifts.</div>`}
            <div class="fixture-stock-meta">Job priority (top to bottom):</div>
            <ol class="employee-job-priorities">${priorityRows}</ol>
          </div>
        </div>
        `;
      }).join("");

    return `
      <div class="fixture-stock-meta">
        Each employee can run the register, stock shelves, or move delivered crates into
        storage. Set their job order below. Wages are paid when a shift starts.
      </div>
      <div class="fixture-section-divider">AVAILABLE STAFF</div>
      ${availableRows || `<div class="fixture-empty-hint">No other staff are available to hire.</div>`}
      <div class="fixture-section-divider">YOUR STAFF</div>
      ${hiredRows || `<div class="fixture-empty-hint">You have not hired any staff.</div>`}
    `;
  }
}
