// ==========================================
// FILE: Calendar.js
// ==========================================
// Which day it is, and whether the shift is over and waiting for the player to end the day.
import { Slice } from "../Slice.js";

export class Calendar extends Slice {
  constructor() {
    super();
    this.day = 1;
    // True from the end of a shift until the player clicks End Day.
    this.awaitingEndDay = false;
  }

  finishShift() {
    this.awaitingEndDay = true;
    this.changed();
  }

  nextDay() {
    this.day += 1;
    this.awaitingEndDay = false;
    this.changed();
  }

  /**
   * @param {object} player - the saved player section
   * @param {object} market - the saved market section
   */
  static fromSave(player, market) {
    const calendar = new Calendar();
    calendar.day = market.day;
    calendar.awaitingEndDay = player.awaitingEndDay ?? false;
    return calendar;
  }
}
