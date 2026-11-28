// ==========================================
// FILE: StaffSystem.js
// ==========================================
// The player's staff decisions between shifts (hiring, On/Off Shift, training, job order),
// paying wages at shift start, and putting working staff on the floor.
import { getStaffLimitReason } from "../logic/ShopProgression.js";
import { getEmployeeTrainingBlockReason, getEmployeeTrainingOffer } from "../logic/EmployeeTraining.js";
import { Employee } from "../logic/Employee.js";
import { RobotWorker } from "../logic/RobotWorker.js";

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
    return true;
  }

  trainingBlockReason(employeeId, jobId) {
    const { shop, staff } = this;
    const offer = getEmployeeTrainingOffer(employeeId, staff.skills[employeeId], jobId);
    return getEmployeeTrainingBlockReason({
      canManage: this.canManage(),
      isHired: staff.isHired(employeeId),
      isTraining: Boolean(staff.training[employeeId]),
      offer,
      credits: shop.gameState.economy.credits,
    });
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
    return true;
  }

  prioritizeJob(employeeId, jobId) {
    const { shop } = this;
    if (!this.canManage()) {
      shop.messages.show("Staff job priorities can only be changed between shifts.");
      return false;
    }
    if (!this.staff.prioritizeJob(employeeId, jobId)) return false;
    return true;
  }

  moveJob(employeeId, jobId, targetIndex) {
    const { shop } = this;
    if (!this.canManage()) {
      shop.messages.show("Staff job priorities can only be changed between shifts.");
      return false;
    }
    if (!this.staff.moveJob(employeeId, jobId, targetIndex)) return false;
    return true;
  }

  /** Puts an employee on a register for the whole shift (or on none). */
  assignRegister(employeeId, registerId) {
    const { shop, staff } = this;
    if (!this.canManage()) {
      shop.messages.show("Register assignments can only be changed between shifts.");
      return false;
    }
    const register = registerId
      ? shop.fixtures.registers().find(({ id }) => id === registerId)
      : null;
    if (registerId && !register) return false;
    const previous = registerId ? staff.registerAssignments[registerId] : null;
    if (!staff.assignRegister(employeeId, registerId)) return false;
    const employee = staff.profile(employeeId);
    const bumped = previous && previous !== employeeId ? staff.profile(previous) : null;
    shop.messages.show(
      register
        ? `${employee.name} will work ${shop.fixtures.displayName(register)} all shift.` +
          (bumped ? ` ${bumped.name} is no longer on a register.` : "")
        : `${employee.name} won't work a register. They'll do their other jobs instead.`,
      STAFF_MESSAGE_COLOR,
    );
    return true;
  }

  assignHovercart(employeeId, chargerId) {
    const { shop, staff } = this;
    if (!this.canManage()) {
      shop.messages.show("Hovercart assignments can only be changed between shifts.");
      return false;
    }
    if (!staff.isHired(employeeId)) {
      shop.messages.show("Hire this employee before assigning a hovercart.");
      return false;
    }
    const system = shop.gameModules.get("hovercart");
    const charger = chargerId ? system?.chargers().find(({ id }) => id === chargerId) : null;
    if (chargerId && !charger) {
      shop.messages.show("Place this hovercart's charger before assigning it.");
      return false;
    }
    const currentId = staff.hovercartFor(employeeId);
    const affected = system?.carts.filter((cart) =>
      cart.charger.id === currentId || cart.charger.id === chargerId) ?? [];
    if (affected.some((cart) => cart.isOut())) {
      shop.messages.show("Dock these hovercarts before changing who uses them. Leftover crates stay on the cart.");
      return false;
    }
    const previous = chargerId ? staff.hovercartAssignments[chargerId] : null;
    if (!staff.assignHovercart(employeeId, chargerId)) return false;
    system?.sync();
    const employee = staff.profile(employeeId);
    const bumped = previous && previous !== employeeId ? staff.profile(previous) : null;
    shop.messages.show(charger
      ? `${employee.name} will use this hovercart for stocking. It won't follow you.` +
        (bumped ? ` ${bumped.name} no longer has a hovercart.` : "")
      : `${employee.name} will stock by hand. Their hovercart is available to you.`,
    STAFF_MESSAGE_COLOR);
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
      .map((employeeId) => new Employee(this.staff.profile(employeeId), this.shop.employeeStore, {
        exitPoint: this.shop.exitPoint,
        exitDoor: this.shop.storeDoorAnimation,
        getClosingCustomers: () => this.shop.customers,
      }));
    for (const robot of this.shop.gameState.robotService?.robots ?? []) {
      if (robot.onShift === false) continue;
      this.shop.employees.push(new RobotWorker(robot, this.shop.employeeStore, {
        exitPoint: this.shop.exitPoint,
        exitDoor: this.shop.storeDoorAnimation,
        getClosingCustomers: () => this.shop.customers,
      }));
    }
  }

  clear() {
    for (const employee of this.shop.employees) employee.destroy();
    this.shop.employees = [];
  }
}
