// ==========================================
// FILE: EmployeeTab.js
// ==========================================
// Employee tab rendering, actions, and panel refresh behavior.
import { EmployeeRenderer } from "./EmployeeRenderer.js";

export const EMPLOYEE_PRIORITY_SELECTOR = "button[data-employee-priority-id]";
export const EMPLOYEE_TRAINING_SELECTOR = "button[data-employee-training-id]";

export class EmployeeTab {
  /** @param {GameScene} scene @param {GameState} gameState */
  constructor(scene, gameState = scene.gameState) {
    this.scene = scene;
    this.gameState = gameState;
    this.panel = null;
    this.renderPanel = null;
    this.draggedJob = null;
    this.trainingSelection = {};
  }

  draw() {
    for (const employeeId of this.gameState.staff.hired) {
      if (this.trainingSelection[employeeId] === undefined) {
        this.trainingSelection[employeeId] = this.gameState.staff.training[employeeId] ?? "register";
      }
    }
    return EmployeeRenderer.generateHTML({
      hiredEmployeeIds: this.gameState.staff.hired,
      offShiftEmployeeIds: this.gameState.staff.offShift,
      activeEmployeeIds: this.scene.employees.map((employee) => employee.data.id),
      employeeJobPriorities: this.gameState.staff.jobPriorities,
      credits: this.gameState.economy.credits,
      canHire: this.scene.staffSystem.canManage(),
      employeeSkills: this.gameState.staff.skills,
      employeeTraining: this.gameState.staff.training,
      employeeTrainingSelection: this.trainingSelection,
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
    eventRoot.addEventListener("dragstart", (event) => this.handleDragStart(event));
    eventRoot.addEventListener("dragover", (event) => this.handleDragOver(event));
    eventRoot.addEventListener("drop", (event) => this.handleDrop(event));
    eventRoot.addEventListener("dragend", () => { this.draggedJob = null; });
  }

  redraw() {
    if (!this.panel) return;
    const activeElement = document.activeElement;
    const focusedPriority = activeElement && this.panel.contains(activeElement) &&
      activeElement.matches(EMPLOYEE_PRIORITY_SELECTOR)
      ? {
        employeeId: activeElement.dataset.employeePriorityId,
        jobId: activeElement.dataset.employeePriorityJob,
        move: activeElement.dataset.employeePriorityMove,
      }
      : null;
    const focusedTraining = activeElement && this.panel.contains(activeElement) &&
      activeElement.matches(EMPLOYEE_TRAINING_SELECTOR)
      ? { ...activeElement.dataset }
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
          button.dataset.employeePriorityJob === focusedPriority.jobId && !button.disabled,
      );
      const sameMove = Array.from(this.panel.querySelectorAll(EMPLOYEE_PRIORITY_SELECTOR)).find(
        (button) => button.dataset.employeePriorityId === focusedPriority.employeeId &&
          button.dataset.employeePriorityJob === focusedPriority.jobId &&
          button.dataset.employeePriorityMove === focusedPriority.move && !button.disabled,
      );
      (sameMove ?? replacement)?.focus({ preventScroll: true });
    }
    if (focusedTraining) {
      const buttons = Array.from(this.panel.querySelectorAll(EMPLOYEE_TRAINING_SELECTOR));
      const same = buttons.find((button) => !button.disabled &&
        button.dataset.employeeTrainingId === focusedTraining.employeeTrainingId &&
        button.dataset.employeeTrainingJob === focusedTraining.employeeTrainingJob &&
        button.dataset.employeeTrainingAction === focusedTraining.employeeTrainingAction);
      const selectedSkill = buttons.find((button) => !button.disabled &&
        button.dataset.employeeTrainingId === focusedTraining.employeeTrainingId &&
        button.dataset.employeeTrainingJob === focusedTraining.employeeTrainingJob &&
        button.dataset.employeeTrainingAction === "select");
      (same ?? selectedSkill)?.focus({ preventScroll: true });
    }
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    if (!(event.target instanceof Element) || !this.panel.contains(event.target)) return;

    const hireButton = event.target.closest("[data-hire-employee-id]");
    if (hireButton) {
      this.scene.staffSystem.hire(hireButton.dataset.hireEmployeeId);
      return;
    }

    const shiftButton = event.target.closest("[data-employee-shift-id]");
    if (shiftButton) {
      this.scene.staffSystem.setOnShift(
        shiftButton.dataset.employeeShiftId,
        shiftButton.dataset.employeeShiftOn === "true",
      );
      this.redraw();
      return;
    }

    const trainingButton = event.target.closest(EMPLOYEE_TRAINING_SELECTOR);
    if (trainingButton) {
      if (trainingButton.disabled) return;
      const { employeeTrainingId: employeeId, employeeTrainingJob: jobId, employeeTrainingAction: action } =
        trainingButton.dataset;
      if (action === "select") {
        this.trainingSelection[employeeId] = jobId;
      } else if (action === "book") {
        this.scene.staffSystem.train(employeeId, jobId);
      } else {
        throw new Error(`Unknown employee training action: ${action}.`);
      }
      this.redraw();
      return;
    }

    const priorityButton = event.target.closest(EMPLOYEE_PRIORITY_SELECTOR);
    if (!priorityButton || priorityButton.getAttribute("aria-pressed") === "true") return;
    if (priorityButton.disabled) return;
    if (priorityButton.dataset.employeePriorityMove) {
      const employeeId = priorityButton.dataset.employeePriorityId;
      const jobId = priorityButton.dataset.employeePriorityJob;
      const index = this.gameState.staff.jobPriorities[employeeId].indexOf(jobId);
      this.scene.staffSystem.moveJob(
        employeeId, jobId, index + (priorityButton.dataset.employeePriorityMove === "up" ? -1 : 1),
      );
      this.redraw();
      return;
    }
    const changed = this.scene.staffSystem.prioritizeJob(
      priorityButton.dataset.employeePriorityId,
      priorityButton.dataset.employeePriorityJob,
    );
    if (!changed) this.redraw();
  }

  jobRow(event) {
    if (!(event.target instanceof Element) || !this.panel.contains(event.target)) return null;
    return event.target.closest("[data-employee-job-id]");
  }

  handleDragStart(event) {
    this.draggedJob = null;
    const row = this.jobRow(event);
    if (!row || !this.scene.staffSystem.canManage() || row.getAttribute("draggable") !== "true") {
      event.preventDefault();
      return;
    }
    this.draggedJob = { employeeId: row.dataset.employeeJobId, jobId: row.dataset.employeeJob };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.dataset.employeeJob);
  }

  handleDragOver(event) {
    const row = this.jobRow(event);
    if (!row || !this.draggedJob || row.dataset.employeeJobId !== this.draggedJob.employeeId ||
      !this.scene.staffSystem.canManage()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  handleDrop(event) {
    const dragged = this.draggedJob;
    this.draggedJob = null;
    const row = this.jobRow(event);
    if (!row || !dragged || row.dataset.employeeJobId !== dragged.employeeId ||
      !this.scene.staffSystem.canManage()) return;
    event.preventDefault();
    const priorities = this.gameState.staff.jobPriorities[dragged.employeeId];
    const fromIndex = priorities.indexOf(dragged.jobId);
    const rowIndex = priorities.indexOf(row.dataset.employeeJob);
    const bounds = row.getBoundingClientRect();
    const insertion = rowIndex + (event.clientY >= bounds.top + bounds.height / 2 ? 1 : 0);
    this.scene.staffSystem.moveJob(
      dragged.employeeId, dragged.jobId, insertion - (fromIndex < insertion ? 1 : 0),
    );
    this.redraw();
  }
}
