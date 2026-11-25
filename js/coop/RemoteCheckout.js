// ==========================================
// FILE: RemoteCheckout.js
// ==========================================
// The co-op friend's register screen, as the host's shop sees it. The scanning, keypad, and
// change counting run in a real CheckoutWindow on the friend's computer (see coopFriend.js);
// this stands in for it on the host, so CheckoutSystem rings up the partner's customers with
// the same code it uses for the player. What the friend does at the register comes back as
// messages, and the host decides what happens to the customer.

// Messages from the friend's register, and the CheckoutWindow callback each one stands for.
export const REGISTER_REPORTS = Object.freeze({
  regDone: "onComplete",
  regWrongChange: "onWrongChange",
  regCash: "onCashAttempt",
  regChangeFailed: "onChangeFailed",
  regChitFailed: "onChitFailed",
});

export class RemoteCheckout {
  /** @param {(message: object) => void} send - to the friend's game */
  constructor(send) {
    this.send = send;
    this.mode = null;
    this.cart = null;
    this.sale = 0;
    this.callbacks = null;
  }

  // The register's own keys are handled on the friend's computer, never by the host's controls.
  usesSpaceKey() {
    return false;
  }

  usesChitInput() {
    return false;
  }

  enterChitDirection() {}

  isCheckingOut(cart) {
    return this.mode === "checkout" && this.cart === cart;
  }

  openForCustomer(cart, onComplete, {
    onWrongChange = null, onCashAttempt = null, onChangeFailed = null, onChitFailed = null, ...payment
  } = {}) {
    this.mode = "checkout";
    this.cart = cart;
    this.sale += 1;
    this.callbacks = { onComplete, onWrongChange, onCashAttempt, onChangeFailed, onChitFailed };
    this.send({
      t: "reg",
      open: { sale: this.sale, cart: cart.map(({ itemId, price }) => ({ itemId, price })), ...payment },
    });
  }

  resume() {
    if (this.mode === "checkout") this.send({ t: "reg", resume: this.sale });
  }

  suspend() {
    this.send({ t: "reg", suspend: true });
  }

  close() {
    this.mode = null;
    this.cart = null;
    this.callbacks = null;
    this.send({ t: "reg", close: true });
  }

  /**
   * The callback a report from the friend's register stands for, or null when it's about a
   * sale that's already over.
   * @param {{ t: string, sale?: number }} message
   */
  callbackFor(message) {
    const name = REGISTER_REPORTS[message.t];
    if (!name || this.mode !== "checkout" || message.sale !== this.sale) return null;
    const callback = this.callbacks?.[name];
    if (!callback) return null;
    if (name === "onCashAttempt") {
      const attempt = message.attempt && typeof message.attempt === "object" ? message.attempt : {};
      return () => callback(attempt);
    }
    return callback;
  }
}
