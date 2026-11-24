// =============================================================================
// FILE: ReputationPenalties.js
// =============================================================================
// Customer upsets that cost reputation at shift end: getting hit by a thrown crate, leaving
// the register line angry or in response to an outrageous price, and not finding any of the
// items they came for. Each one floats a red note over the customer saying what was lost.
// =============================================================================

import { CUSTOMER_TRAITS } from "../logic/CustomerTraits.js";
import { GAME_EVENTS } from "../core/Events.js";

// Reputation lost when a thrown crate hits a customer.
const CRATE_HIT_REPUTATION_PENALTY = 1;
// Reputation lost when a customer leaves the queue without a sale.
const ANGRY_REPUTATION_PENALTY = 1;
// Reputation lost once when a customer cannot find any of their primary items.
const MISSING_PRIMARY_REPUTATION_PENALTY = 1;

function reputationPenaltyText(penalty, factionId) {
  const faction = factionId ? CUSTOMER_TRAITS[factionId] : null;
  if (factionId && !faction?.group) throw new Error(`Unknown customer faction: ${factionId}.`);
  return `-${penalty} store reputation${faction ? `\n-${penalty} ${faction.name} reputation` : ""}\nat shift end`;
}

export class ReputationPenalties {
  constructor(shop) {
    this.shop = shop;
  }

  listen(eventBus) {
    eventBus.on(GAME_EVENTS.CUSTOMER_HIT_BY_CRATE, ({ customer }) =>
      this.penalize(customer, CRATE_HIT_REPUTATION_PENALTY, "Customer hit!"));
    eventBus.on(GAME_EVENTS.CUSTOMER_LEFT_ANGRY, ({
      customer, reputationPenalty = true, factionReputationPenalty = true,
    }) => {
      if (reputationPenalty) {
        this.penalize(customer, ANGRY_REPUTATION_PENALTY, "Left angry!", { factionReputationPenalty });
      }
    });
    eventBus.on(GAME_EVENTS.CUSTOMER_MISSING_PRIMARY, ({ customer, itemNames }) =>
      this.penalize(customer, MISSING_PRIMARY_REPUTATION_PENALTY, `Out of stock:\n${itemNames.join("\n")}`));
  }

  penalize(customer, penalty, headline, { factionReputationPenalty = true } = {}) {
    const factionId = factionReputationPenalty ? customer.factionId : null;
    customer.gameState.reputation.lose(penalty, factionId);
    this.shop.messages.floatText(
      customer.sprite.x,
      customer.sprite.y - 50,
      `${headline}\n${reputationPenaltyText(penalty, factionId)}`,
      "#ef4444",
    );
  }
}
