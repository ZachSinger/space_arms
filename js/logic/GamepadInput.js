// ==========================================
// FILE: GamepadInput.js
// ==========================================
// Polls connected controllers once per frame (browser Gamepad API, "standard" mapping) and
// turns them into held buttons, just-pressed buttons, stick vectors, and a menu direction
// that repeats while held. Every connected controller drives the same player.
// See also: UINavigator.js (menus), game.js handleGamepad (world actions).

// Standard-mapping button indexes, named after the Xbox layout.
export const PAD = Object.freeze({
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
});

const STICK_DEADZONE = 0.25;
// Analog triggers report a value; past this they count as pressed.
const TRIGGER_THRESHOLD = 0.5;
// How far a stick must lean before it moves a menu cursor.
const NAV_STICK_THRESHOLD = 0.6;
const NAV_REPEAT_DELAY_MS = 380;
const NAV_REPEAT_MS = 120;

const defaultGetPads = () =>
  (typeof navigator !== "undefined" && navigator.getGamepads ? [...navigator.getGamepads()] : []);

/**
 * Radial deadzone, rescaled so movement starts from zero just past the edge.
 * @param {number} x
 * @param {number} y
 * @returns {{x: number, y: number}}
 */
export function applyDeadzone(x, y, deadzone = STICK_DEADZONE) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone) return { x: 0, y: 0 };
  const scale = Math.min(1, (magnitude - deadzone) / (1 - deadzone)) / magnitude;
  return { x: x * scale, y: y * scale };
}

export class GamepadInput {
  /**
   * @param {() => Array<Gamepad|null>} [getPads] - injectable for tests
   */
  constructor(getPads = defaultGetPads) {
    this.getPads = getPads;
    this.down = new Set();
    this.pressed = new Set();
    this.leftStick = { x: 0, y: 0 };
    this.rightStick = { x: 0, y: 0 };
    this.connected = false;
    this.hadInput = false;
    this.navDirection = null;
    this.navHeld = null;
    this.navNextAt = 0;
    // The first poll only records what's held, so a button still down from the previous
    // screen doesn't fire again on this one.
    this.primed = false;
  }

  /**
   * @param {number} now - ms timestamp
   */
  poll(now) {
    const pads = this.getPads().filter((pad) => pad && pad.connected !== false);
    const down = new Set();
    let left = { x: 0, y: 0 };
    let right = { x: 0, y: 0 };
    for (const pad of pads) {
      pad.buttons?.forEach((button, index) => {
        if (button?.pressed || (button?.value ?? 0) > TRIGGER_THRESHOLD) down.add(index);
      });
      const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes ?? [];
      if (Math.hypot(lx, ly) > Math.hypot(left.x, left.y)) left = { x: lx, y: ly };
      if (Math.hypot(rx, ry) > Math.hypot(right.x, right.y)) right = { x: rx, y: ry };
    }

    this.connected = pads.length > 0;
    this.leftStick = applyDeadzone(left.x, left.y);
    this.rightStick = applyDeadzone(right.x, right.y);
    this.pressed = this.primed ? new Set([...down].filter((index) => !this.down.has(index))) : new Set();
    this.down = down;
    this.hadInput = this.primed && (this.pressed.size > 0 || this.leftStick.x !== 0 || this.leftStick.y !== 0 ||
      this.rightStick.x !== 0 || this.rightStick.y !== 0);
    this.updateNavDirection(now);
    this.primed = true;
  }

  updateNavDirection(now) {
    const direction = this.readDirection();
    this.navDirection = null;
    if (!direction) {
      this.navHeld = null;
      return;
    }
    if (!this.primed) {
      // Held since before this screen: ignored until released.
      this.navHeld = direction;
      this.navNextAt = Infinity;
      return;
    }
    if (direction !== this.navHeld) {
      this.navHeld = direction;
      this.navDirection = direction;
      this.navNextAt = now + NAV_REPEAT_DELAY_MS;
    } else if (now >= this.navNextAt) {
      this.navDirection = direction;
      this.navNextAt = now + NAV_REPEAT_MS;
    }
  }

  // D-pad wins over the stick; the stick counts only along its stronger axis.
  readDirection() {
    if (this.down.has(PAD.UP)) return "up";
    if (this.down.has(PAD.DOWN)) return "down";
    if (this.down.has(PAD.LEFT)) return "left";
    if (this.down.has(PAD.RIGHT)) return "right";
    const { x, y } = this.leftStick;
    if (Math.max(Math.abs(x), Math.abs(y)) < NAV_STICK_THRESHOLD) return null;
    if (Math.abs(x) > Math.abs(y)) return x < 0 ? "left" : "right";
    return y < 0 ? "up" : "down";
  }

  isDown(button) {
    return this.down.has(button);
  }

  justPressed(button) {
    return this.pressed.has(button);
  }

  /**
   * Walking direction: the D-pad as a full-speed direction, otherwise the left stick.
   * @returns {{x: number, y: number}}
   */
  moveVector() {
    const x = (this.down.has(PAD.RIGHT) ? 1 : 0) - (this.down.has(PAD.LEFT) ? 1 : 0);
    const y = (this.down.has(PAD.DOWN) ? 1 : 0) - (this.down.has(PAD.UP) ? 1 : 0);
    if (x !== 0 || y !== 0) return { x, y };
    return { ...this.leftStick };
  }

  // Holding B (thumb stays on the face buttons), either trigger, or clicking the left stick.
  wantsDash() {
    return this.down.has(PAD.B) || this.down.has(PAD.RT) || this.down.has(PAD.LT) || this.down.has(PAD.L3);
  }
}
