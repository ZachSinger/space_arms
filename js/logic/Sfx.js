// ==========================================
// FILE: Sfx.js
// ==========================================
// Tiny synthesized sound effects via the Web Audio API, so simple UI feedback
// (like the register scan beep) doesn't need a shipped audio asset.
//
// Each sound is drawn once into a buffer with its fade baked in, then played from its first
// sample. Fades scheduled against the audio clock could land entirely in the past when that
// clock ran ahead of the page, which silently dropped short beeps like the scan.
let sharedContext = null;
let paused = false;
const buffers = new Map();

// Each note: wave shape, pitch, start offset, length, and its volume curve as
// [seconds, volume] points joined by exponential ramps (like exponentialRampToValueAtTime).
const SOUNDS = {
  // Short "register beep" at C6.
  scan: [{ wave: "square", frequency: 1046.5, start: 0, length: 0.08, curve: [[0, 0.15], [0.08, 0.001]] }],
  // Soft tick for numpad digit/clear presses.
  keypad: [{ wave: "square", frequency: 600, start: 0, length: 0.04, curve: [[0, 0.08], [0.04, 0.001]] }],
  // Quick three-note ascending chime for a completed sale.
  sale: [784, 988, 1175].map((frequency, index) => ({
    wave: "sine", frequency, start: index * 0.07, length: 0.22,
    curve: [[0, 0.0001], [0.01, 0.18], [0.2, 0.001]],
  })),
  // Low buzz for a rejected (wrong-amount) payment attempt.
  error: [{ wave: "sawtooth", frequency: 160, start: 0, length: 0.22, curve: [[0, 0.12], [0.22, 0.001]] }],
  // Two bright bell notes, then a repeat, for a new remote order arriving.
  order: [1318.5, 1760, 1318.5, 1760].map((frequency, index) => ({
    wave: "sine", frequency, start: index * 0.12 + (index >= 2 ? 0.18 : 0), length: 0.35,
    curve: [[0, 0.0001], [0.01, 0.16], [0.34, 0.001]],
  })),
  // Rising four-note fanfare (C, E, G, high C held) for a remote order that shipped.
  shipped: [523.25, 659.25, 783.99, 1046.5].map((frequency, index) => ({
    wave: "square", frequency, start: index * 0.11, length: index === 3 ? 0.6 : 0.12,
    curve: index === 3
      ? [[0, 0.0001], [0.01, 0.07], [0.25, 0.05], [0.6, 0.001]]
      : [[0, 0.0001], [0.01, 0.07], [0.12, 0.01]],
  })),
  // Cardboard thud for a thrown box hitting a customer: a low drop in pitch under a short slap.
  crateHit: [
    { wave: "sine", frequency: 130, sweepTo: 55, start: 0, length: 0.18, curve: [[0, 0.45], [0.18, 0.001]] },
    { wave: "noise", start: 0, length: 0.07, curve: [[0, 0.22], [0.07, 0.001]] },
  ],
};

function getContext() {
  if (!sharedContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    sharedContext = new AudioContextClass();
  }
  // Browsers start sound muted until the player clicks or presses a key.
  if (!paused && sharedContext.state === "suspended") sharedContext.resume().catch(() => {});
  return sharedContext;
}

export function setSfxPaused(value) {
  paused = value;
  if (!sharedContext) return;
  const operation = value ? sharedContext.suspend() : sharedContext.resume();
  operation.catch((error) => console.error("Could not change game sound pause state:", error));
}

// Band-limited like the Web Audio oscillators, so the beeps sound the same as before.
// A note with `sweepTo` slides its pitch evenly from `frequency` to `sweepTo` over its length.
function waveSample(note, seconds, nyquist) {
  const { wave, frequency, sweepTo, length } = note;
  if (wave === "noise") return Math.random() * 2 - 1;
  const phase = sweepTo === undefined
    ? 2 * Math.PI * frequency * seconds
    : 2 * Math.PI * (frequency * seconds + (sweepTo - frequency) * seconds * seconds / (2 * length));
  if (wave === "sine") return Math.sin(phase);
  let sum = 0;
  for (let harmonic = 1; harmonic * frequency < nyquist; harmonic += 1) {
    if (wave === "square") {
      if (harmonic % 2 === 1) sum += Math.sin(harmonic * phase) / harmonic;
    } else {
      sum += ((harmonic % 2 === 1 ? 1 : -1) * Math.sin(harmonic * phase)) / harmonic;
    }
  }
  return (wave === "square" ? 4 : 2) / Math.PI * sum;
}

function volumeAt(curve, seconds) {
  if (seconds <= curve[0][0]) return curve[0][1];
  for (let index = 1; index < curve.length; index += 1) {
    const [endTime, endVolume] = curve[index];
    const [startTime, startVolume] = curve[index - 1];
    if (seconds <= endTime) {
      return startVolume * (endVolume / startVolume) ** ((seconds - startTime) / (endTime - startTime));
    }
  }
  return curve[curve.length - 1][1];
}

function getBuffer(ctx, name) {
  if (buffers.has(name)) return buffers.get(name);
  const notes = SOUNDS[name];
  const rate = ctx.sampleRate;
  const length = Math.ceil(Math.max(...notes.map((note) => note.start + note.length)) * rate);
  const buffer = ctx.createBuffer(1, length, rate);
  const samples = buffer.getChannelData(0);
  for (const note of notes) {
    const first = Math.round(note.start * rate);
    const count = Math.round(note.length * rate);
    for (let index = 0; index < count && first + index < length; index += 1) {
      const seconds = index / rate;
      samples[first + index] += waveSample(note, seconds, rate / 2) *
        volumeAt(note.curve, seconds);
    }
  }
  buffers.set(name, buffer);
  return buffer;
}

function play(name) {
  const ctx = getContext();
  const source = ctx.createBufferSource();
  source.buffer = getBuffer(ctx, name);
  source.connect(ctx.destination);
  source.start();
}

// Turn sound on (and draw every sound) at the player's first click or key press, before
// the register needs it.
function unlockOnFirstInput() {
  const unlock = () => {
    const ctx = getContext();
    for (const name of Object.keys(SOUNDS)) getBuffer(ctx, name);
    if (ctx.state === "running") {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    }
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}
if (typeof window !== "undefined" && window.addEventListener) unlockOnFirstInput();

export function playScanBeep() {
  play("scan");
}

export function playKeypadClick() {
  play("keypad");
}

export function playSaleComplete() {
  play("sale");
}

export function playErrorBuzz() {
  play("error");
}

export function playOrderAlert() {
  play("order");
}

export function playOrderShipped() {
  play("shipped");
}

export function playCrateHit() {
  play("crateHit");
}
