import { isMoney } from "./Money.js";

export const CHIT_DIRECTION_DIGITS = Object.freeze({
  up: 1,
  down: 2,
  left: 3,
  right: 4,
});

export function generateChitCode(random = Math.random) {
  const length = 2 + Math.floor(random() * 3);
  return Array.from({ length }, () => String(1 + Math.floor(random() * 4))).join("");
}

export class ChitPayment {
  constructor(total, code = generateChitCode()) {
    if (!isMoney(total) || total < 0) throw new TypeError(`Invalid Chit value: ${total}.`);
    if (!/^[1-4]{2,4}$/.test(code)) throw new TypeError(`Invalid Chit code: ${code}.`);
    this.total = total;
    this.code = code;
    this.progress = 0;
    this.completed = false;
    this.mistakes = 0;
  }

  enterDigit(digit) {
    if (!Number.isInteger(digit) || digit < 1 || digit > 4) {
      throw new TypeError(`Invalid Chit key: ${digit}.`);
    }
    if (this.completed) return { accepted: false, completed: false, restarted: false };
    if (digit !== Number(this.code[this.progress])) {
      this.progress = 0;
      this.mistakes += 1;
      return { accepted: false, completed: false, restarted: true };
    }
    this.progress += 1;
    if (this.progress === this.code.length) this.completed = true;
    return { accepted: true, completed: this.completed, restarted: false };
  }
}
