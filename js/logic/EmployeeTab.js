// ==========================================
// FILE: EmployeeTab.js
// ==========================================
// Employee tab rendering, actions, and panel refresh behavior.
import { EmployeeRenderer } from "./EmployeeRenderer.js";

export const EMPLOYEE_PRIORITY_SELECTOR = "button[data-employee-priority-id]";

export class EmployeeTab {
  /** @param {GameScene} scene @param {GameState} gameState */
  constructor(scene, gameState = scene.gameState) {
    this.scene = scene;
    this.gameState = gameState;
    this.panel = null;
    this.renderPanel = null;
  }

  draw() {
    return EmployeeRenderer.generateHTML({
      hiredEmployeeIds: this.gameState.staff.hired,
      offShiftEmployeeIds: this.gameState.staff.offShift,
      activeEmployeeIds: this.scene.employees.map((employee) => employee.data.id),
      employeeJobPriorities: this.gameState.staff.jobPriorities,
      credits: this.gameState.economy.credits,
      canHire: this.scene.canHireEmployees(),
      employeeSkills: this.gameState.staff.skills,
      employeeTraining: this.gameState.staff.training,
      shopLevel: this.gameState.reputation.shopLevel,
    });
  }

  /**
   * Bind employee controls and its full panel renderer.
   * @param {HTMLElement} panel
   * @param {HTMLElement} eventRoot
   * @param {() => string} [renderPanel]
   */
  bind(panel, eventRoot, renderPanel = () => this.draw()) {
    if (!panel) throw new Error("Employee tab panel is missing");
    this.panel = panel;
    this.renderPanel = renderPanel;
    eventRoot.addEventListener("click", (event) => this.handleClick(event));
  }

  redraw() {
    if (!this.panel) return;
    const activeElement = document.activeElement;
    const focusedPriority = activeElement && this.panel.contains(activeElement) &&
      activeElement.matches(EMPLOYEE_PRIORITY_SELECTOR)
      ? {
        employeeId: activeElement.dataset.employeePriorityId,
        jobId: activeElement.dataset.employeePriorityJob,
      }
      : null;
    const scrollPositions = Array.from(
      this.panel.querySelectorAll("[data-employee-scroll]"),
      (element) => ({ name: element.dataset.employeeScroll, top: element.scrollTop }),
    );

    this.panel.innerHTML = this.renderPanel();

    for (const element of this.panel.querySelectorAll("[data-employee-scroll]")) {
      const position = scrollPositions.find(({ name }) => name === element.dataset.employeeScroll);
      if (position) element.scrollTop = position.top;
    }

    if (focusedPriority) {
      const replacement = Array.from(this.panel.querySelectorAll(EMPLOYEE_PRIORITY_SELECTOR)).find(
        (button) => button.dataset.employeePriorityId === focusedPriority.employeeId &&
          button.dataset.employeePriorityJob === focusedPriority.jobId,
      );
      replacement?.focus({ preventScroll: true });
    }
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    if (!(event.target instanceof Element) || !this.panel.contains(event.target)) return;

    const hireButton = event.target.closest("[data-hire-employee-id]");
    if (hireButton) {
      this.scene.hireEmployee(hireButton.dataset.hireEmployeeId);
      return;
    }

    const shiftButton = event.target.closest("[data-employee-shift-id]");
    if (shiftButton) {
      this.scene.setEmployeeOnShift(
        shiftButton.dataset.employeeShiftId,
        shiftButton.dataset.employeeShiftOn === "true",
      );
      this.redraw();
      return;
    }

    const priorityButton = event.target.closest(EMPLOYEE_PRIORITY_SELECTOR);
    if (!priorityButton || priorityButton.getAttribute("aria-pressed") === "true") return;
    const changed = this.scene.moveEmployeeJobPriority(
      priorityButton.dataset.employeePriorityId,
      priorityButton.dataset.employeePriorityJob,
      -1,
    );
    if (!changed) this.redraw();
  }
}
