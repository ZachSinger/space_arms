import { generateChitCode } from "./ChitPayment.js";

export const FACTION_CURRENCY_PAYMENT_CHANCE = 0.75;
export const EXACT_CASH_PAYMENT_CHANCE = 0.25;
export const CASH_PAYMENT_CHANCE = 0.5;

export function chooseCustomerPayment(factionId, random = Math.random) {
  if (factionId === "scavengers" && random() < FACTION_CURRENCY_PAYMENT_CHANCE) {
    return {
      type: "m-scrips",
      exact: random() < EXACT_CASH_PAYMENT_CHANCE,
    };
  }
  if (factionId === "explorers" && random() < FACTION_CURRENCY_PAYMENT_CHANCE) {
    return {
      type: "chit",
      code: generateChitCode(random),
    };
  }
  const cash = random() < CASH_PAYMENT_CHANCE;
  return {
    type: cash ? "cash" : "card",
    exact: cash && random() < EXACT_CASH_PAYMENT_CHANCE,
  };
}
