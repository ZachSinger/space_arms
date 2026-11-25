// ==========================================
// FILE: CoopTuning.js
// ==========================================
// How much busier the shop gets while a friend is in it, so two shopkeepers still have a full
// day without it feeling twice as hard (two people still share the floor and the registers).
export const COOP_TUNING = Object.freeze({
  // Customers each shift, and how many fit in the store before more are turned away.
  customerScale: 1.5,
  // Remote order offers roll this many times as often each shift hour...
  remoteOrderChanceScale: 2,
  // ...and this many more offers can wait at the Drone Terminal at once.
  extraRemoteOffers: 1,
});

/** Whether a friend's shopkeeper is in the host's shop right now. */
export function friendInShop(shop) {
  return Boolean(shop?.coop?.partner);
}
