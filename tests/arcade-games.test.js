import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { ARCADE_SCREEN, findArcadeGameProblems, findArcadeInstanceProblems } from "../js/arcade/ArcadeGame.js";

const GAMES_DIR = new URL("../js/arcade/games/", import.meta.url);
const gameFiles = readdirSync(GAMES_DIR).filter((name) => name.endsWith(".js"));

// Accepts any drawing call or property, so a game can be run without a browser.
function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get: (target, key) => (key in target ? target[key] : key.toString().startsWith("create") ? () => gradient : key === "measureText" ? () => ({ width: 8 }) : () => {}),
    set: (target, key, value) => { target[key] = value; return true; },
  });
}

function fakeAudioNode() {
  const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} };
  return new Proxy({ frequency: param, gain: param, detune: param, Q: param, playbackRate: param }, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => { target[key] = value; return true; },
  });
}

function fakeAudioContext() {
  const context = { currentTime: 0, sampleRate: 8000, state: "running", destination: fakeAudioNode(),
    createBuffer: (_channels, length) => ({ getChannelData: () => new Float32Array(length), length, duration: length / 8000 }) };
  return new Proxy(context, { get: (target, key) => (key in target ? target[key] : () => fakeAudioNode()) });
}

function makeHost(pads) {
  let seed = 7;
  const scores = [];
  const results = [];
  const host = {
    canvas: { width: ARCADE_SCREEN.width, height: ARCADE_SCREEN.height },
    context: fakeContext(),
    readPad: (player) => ({ ...pads[player - 1] }),
    audioContext: fakeAudioContext(),
    audioOutput: fakeAudioNode(),
    getHighScores: () => scores.slice(),
    isHighScore: (score) => scores.length < 5 || score > scores[scores.length - 1].score,
    saveHighScore: (entry) => { scores.push(entry); scores.sort((a, b) => b.score - a.score); scores.length = Math.min(5, scores.length); },
    gameOver: (result) => results.push(result),
    exit: () => {},
    random: () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; },
  };
  return { host, scores, results };
}

const blankPad = () => ({ up: false, down: false, left: false, right: false, a: false, b: false, start: false });

for (const file of gameFiles) {
  test(`${file} follows the arcade rules`, async () => {
    const source = readFileSync(new URL(file, GAMES_DIR), "utf8");
    for (const banned of [/^\s*import\s/m, /Math\.random/, /Date\.now/, /localStorage/, /addEventListener/, /requestAnimationFrame/, /setTimeout/, /setInterval/, /\.destination\b/]) {
      assert.doesNotMatch(source, banned, `${file} uses ${banned}`);
    }
    const game = (await import(new URL(file, GAMES_DIR).href)).default;
    assert.deepEqual(findArcadeGameProblems(game), []);
    assert.equal(`${game.id}.js`, file, "the file name must match the game's id");
    assert.deepEqual(findArcadeInstanceProblems(game.create(makeHost([blankPad(), blankPad()]).host)), []);
  });

  test(`${file} runs its demo, a mashed-button match, and high score entry without errors`, async () => {
    const game = (await import(new URL(file, GAMES_DIR).href)).default;
    const pads = [blankPad(), blankPad()];
    const { host, results } = makeHost(pads);
    const instance = game.create(host);
    const step = 1 / 30;
    instance.start({ mode: "attract" });
    for (let frame = 0; frame < 30 * 120; frame += 1) { instance.update(step); instance.render(); }

    instance.start({ mode: "play" });
    // Both players mash buttons (never start, which would pause) until a match ends and is reported.
    for (let frame = 0; frame < 30 * 60 * 20 && results.length === 0; frame += 1) {
      for (const pad of pads) {
        for (const button of ["up", "down", "left", "right", "a", "b"]) pad[button] = host.random() < 0.5;
      }
      instance.update(step);
      instance.render();
    }
    instance.pause();
    instance.resume();
    instance.destroy();
    assert.equal(results.length, 1, "a match should end and be reported once");
    const [result] = results;
    assert.ok(result.mode === "1p" || result.mode === "2p");
    assert.ok([0, 1, 2].includes(result.winner));
    assert.equal(result.scores.length, 2);
    assert.ok(result.scores.every(Number.isFinite));
  });
}
