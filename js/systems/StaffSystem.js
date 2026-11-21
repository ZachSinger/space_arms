// ==========================================
// FILE: StaffSystem.js
// ==========================================
// The player's staff decisions between shifts (hiring, On/Off Shift, training, job order),
// paying wages at shift start, and putting working staff on the floor.
import { getStaffLimitReason } from "../logic/ShopProgression.js";
import { getEmployeeTrainingOffer } from "../logic/EmployeeTraining.js";
import { Employee } from "../logic/Employee.js";

const STAFF_MESSAGE_COLOR = "#10b981";

export class StaffSystem {
  constructor(shop) {
    this.shop = shop;
  }

  get staff() {
    return this.shop.gameState.staff;
  }

  // Staff changes need the same quiet store as saving, and not mid shift start.
  canManage() {
    const { shop } = this;
    return !shop.shift.starting && !shop.saves.loadFailed && shop.saves.canSaveOffShift();
  }

  hire(employeeId) {
    const { shop, staff } = this;
    const employee = staff.profile(employeeId);
    if (!this.canManage()) {
      shop.messages.show("Staff can only be hired between shifts.");
      return false;
    }
    if (staff.hired.includes(employeeId)) return false;
    const staffLimitReason = getStaffLimitReason(shop.gameState.reputation.shopLevel, staff.hired.length);
    if (staffLimitReason) {
      shop.messages.show(staffLimitReason);
      return false;
    }
    if (!shop.gameState.hireEmployee(employeeId)) {
      shop.messages.show(`Not enough money. Hiring ${employee.name} costs ${employee.hireCost}.`);
      return false;
    }
    shop.messages.show(
      `${employee.name} hired and On Shift. Their wage of ${employee.wagePerShift} is due at each shift start.`,
      STAFF_MESSAGE_COLOR,
    );
    shop.saves.requestAutosave();
    return true;
  }

  setOnShift(employeeId, onShift) {
    const { shop, staff } = this;
    const employee = staff.profile(employeeId);
    if (!this.canManage()) {
      shop.messages.show("Staff can only be set On Shift or Off Shift between shifts.");
      return false;
    }
    if (staff.training[employeeId]) {
      shop.messages.show(`${employee.name} is away training next shift. They're available again once they return.`);
      return false;
    }
    if (!staff.setOnShift(employeeId, onShift)) return false;
    shop.messages.show(
      onShift
        ? `${employee.name} is On Shift. They'll work and be paid ${employee.wagePerShift} each shift.`
        : `${employee.name} is Off Shift. They'll stay home and won't be paid until you set them On Shift.`,
      STAFF_MESSAGE_COLOR,
    );
    shop.saves.requestAutosave();
    return true;
  }

  trainingBlockReason(employeeId, jobId) {
    const { shop, staff } = this;
    const offer = getEmployeeTrainingOffer(employeeId, staff.skills[employeeId], jobId);
    if (!this.canManage()) return "Book employee training between shifts.";
    if (!staff.hired.includes(employeeId)) return "Hire this employee before booking training.";
    if (staff.training[employeeId]) return "This employee already has training booked.";
    if (!offer) return "This skill is already at Level 5.";
    if (shop.gameState.economy.credits < offer.cost) return `Training costs ${offer.cost}. You don't have enough money.`;
    return null;
  }

  train(employeeId, jobId) {
    const { shop } = this;
    const reason = this.trainingBlockReason(employeeId, jobId);
    if (reason) {
      shop.messages.show(reason);
      return false;
    }
    if (!shop.gameState.trainEmployee(employeeId, jobId)) {
      shop.messages.show("Training is no longer available. Check the employee's skill and your money.");
      return false;
    }
    const employee = this.staff.profile(employeeId);
    shop.messages.show(
      `${employee.name} will be away training next shift. Their wage of ${employee.wagePerShift} is still due.`,
      STAFF_MESSAGE_COLOR,
    );
    shop.saves.requestAutosave();
    return true;
  }

  prioritizeJob(employeeId, jobId) {
    const { shop } = this;
    if (!this.canManage()) {
      shop.messages.show("Staff job priorities can only be changed between shifts.");
      return false;
    }
    if (!this.staff.prioritizeJob(employeeId, jobId)) return false;
    shop.saves.requestAutosave();
    return true;
  }

  // Wages are paid up front, even into the red (bible Step 32), one receipt line each.
  payWages() {
    let total = 0;
    for (const employeeId of this.staff.paid()) {
      const employee = this.staff.profile(employeeId);
      if (employee.wagePerShift <= 0) continue;
      this.shop.gameState.economy.spend(employee.wagePerShift, {
        category: "wages",
        label: employee.name,
      });
      total += employee.wagePerShift;
    }
    return total;
  }

  spawnWorking() {
    this.shop.employees = this.staff.working()
      .map((employeeId) => new Employee(this.staff.profile(employeeId), this.shop.employeeStore));
  }

  clear() {
    for (const employee of this.shop.employees) employee.destroy();
    this.shop.employees = [];
  }
}
