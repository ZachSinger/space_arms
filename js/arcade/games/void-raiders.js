// js/arcade/games/void-raiders.js
export default {
  id: "void-raiders",
  title: "VOID RAIDERS",
  scoreType: "points",
  create(host) {
    const W = 320, H = 240;
    const PLAY_TOP = 120, PLAY_BOTTOM = 226, PLAY_LEFT = 12, PLAY_RIGHT = 308;
    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ ";
    const PAL = {
      bg: "#070b1e", panel: "#101836", dim: "#3b4a7a", white: "#f4f7ff",
      p1: "#22e5ff", p1Dark: "#0c7c9e", p2: "#ff9922", p2Dark: "#a84c0c",
      red: "#ff3b5c", yellow: "#ffe14d", green: "#39e68c", purple: "#b85cff",
    };
    const SCORES = { drone: 100, diver: 150, shooter: 200, tank: 300, boss: 2000 };

    // 8-bar (64 eighth-note) chiptune loop in C minor (MIDI notes, 0 = rest)
    const MELODY = [
      72, 0, 75, 0, 79, 75, 72, 0,   70, 0, 74, 0, 77, 74, 70, 0,
      68, 0, 72, 0, 75, 72, 68, 0,   67, 70, 74, 75, 74, 0, 70, 0,
      72, 0, 75, 79, 84, 0, 82, 79,  77, 0, 75, 74, 75, 0, 72, 0,
      68, 72, 75, 79, 77, 75, 74, 72, 74, 0, 79, 0, 74, 0, 70, 0,
    ];
    const BASS = [
      48, 0, 48, 55, 48, 0, 55, 0,   46, 0, 46, 53, 46, 0, 53, 0,
      44, 0, 44, 51, 44, 0, 51, 0,   43, 0, 43, 50, 43, 50, 43, 0,
      48, 0, 48, 55, 48, 0, 55, 0,   41, 0, 41, 48, 41, 0, 48, 0,
      44, 0, 44, 51, 46, 0, 46, 53,  43, 0, 43, 50, 43, 0, 46, 0,
    ];
    const STEP_DUR = 0.14;

    let destroyed = false, hostPaused = false, internalPaused = false;
    let mode = "attract", screen = "title", matchMode = "1p";
    let menuIndex = 0, clock = 0, stateTimer = 0, shakeTimer = 0, bombFlash = 0;
    let gameOverReported = false, matchWinner = 0;
    let hsQueue = [], hsActive = null;

    const emptyPad = () => ({ up: false, down: false, left: false, right: false, a: false, b: false, start: false });
    let prevPads = [emptyPad(), emptyPad()], currPads = [emptyPad(), emptyPad()];

    let stars = [], ships = [], bullets = [], enemyBullets = [], enemies = [];
    let pickups = [], particles = [], floats = [], bombRings = [];
    let wave = 0, waveBannerTimer = 0, waveBannerText = "";
    let spawnQueue = [], spawnTimer = 0, waveClearDelay = 0;

    // Audio engine: every sound routes through masterGain -> host.audioOutput
    const activeAudio = new Set();
    let masterGain = null, noiseBuffer = null;
    let musicNextTime = 0, musicStep = 0, musicPlaying = false, jingleTimer = 0;

    const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const randRange = (lo, hi) => lo + host.random() * (hi - lo);

    function canPlayAudio() {
      return !destroyed && !hostPaused && !internalPaused && mode === "play" && host.audioContext && host.audioOutput;
    }

    function ensureMasterGain() {
      if (!canPlayAudio()) return null;
      if (!masterGain) {
        masterGain = host.audioContext.createGain();
        masterGain.gain.value = 1;
        masterGain.connect(host.audioOutput);
      }
      return masterGain;
    }

    function ensureNoiseBuffer() {
      if (noiseBuffer || !host.audioContext) return noiseBuffer;
      const sr = host.audioContext.sampleRate || 44100;
      const len = Math.floor(sr * 0.4);
      const buf = host.audioContext.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = host.random() * 2 - 1;
      noiseBuffer = buf;
      return buf;
    }

    function silenceAll() {
      musicPlaying = false;
      for (const node of activeAudio) {
        try { node.stop(); } catch (_) {}
        try { node.disconnect(); } catch (_) {}
      }
      activeAudio.clear();
      if (masterGain) {
        try { masterGain.gain.setValueAtTime(0, host.audioContext.currentTime); } catch (_) {}
        try { masterGain.disconnect(); } catch (_) {}
        masterGain = null;
      }
    }

    function playTone(type, f0, f1, dur, peak, offset = 0) {
      const out = ensureMasterGain();
      if (!out) return;
      const ctx = host.audioContext;
      const t0 = ctx.currentTime + offset, t1 = t0 + dur;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t1);
      gain.gain.setValueAtTime(Math.min(0.15, peak), t0);
      gain.gain.exponentialRampToValueAtTime(0.0005, t1);
      osc.connect(gain);
      gain.connect(out);
      activeAudio.add(osc);
      osc.onended = () => {
        activeAudio.delete(osc);
        try { osc.disconnect(); gain.disconnect(); } catch (_) {}
      };
      osc.start(t0);
      osc.stop(t1 + 0.01);
    }

    function playNoise(dur, peak, filterFreq = 1200, offset = 0) {
      const out = ensureMasterGain();
      const buf = ensureNoiseBuffer();
      if (!out || !buf) return;
      const ctx = host.audioContext;
      const t0 = ctx.currentTime + offset, t1 = t0 + dur;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(filterFreq, t0);
      filter.frequency.exponentialRampToValueAtTime(160, t1);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(Math.min(0.15, peak), t0);
      gain.gain.exponentialRampToValueAtTime(0.0005, t1);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      activeAudio.add(src);
      src.onended = () => {
        activeAudio.delete(src);
        try { src.disconnect(); filter.disconnect(); gain.disconnect(); } catch (_) {}
      };
      src.start(t0);
      src.stop(t1 + 0.01);
    }

    const sfx = {
      shoot: () => playTone("square", 880, 260, 0.06, 0.06),
      hit: () => playTone("triangle", 420, 180, 0.05, 0.09),
      explosion: (big) => {
        playNoise(big ? 0.34 : 0.18, big ? 0.13 : 0.09, big ? 900 : 1400);
        playTone("sawtooth", big ? 140 : 190, 38, big ? 0.3 : 0.14, big ? 0.1 : 0.07);
      },
      bomb: () => {
        playNoise(0.4, 0.14, 1800);
        playTone("square", 520, 55, 0.38, 0.11);
      },
      pickup: () => {
        playTone("square", 523, 523, 0.05, 0.08, 0);
        playTone("square", 659, 659, 0.05, 0.08, 0.055);
        playTone("square", 1046, 1046, 0.09, 0.09, 0.11);
      },
      playerHit: () => {
        playNoise(0.24, 0.12, 1000);
        playTone("sawtooth", 300, 70, 0.26, 0.11);
      },
      menuMove: () => playTone("square", 520, 620, 0.035, 0.07),
      menuConfirm: () => {
        playTone("square", 523, 523, 0.05, 0.08, 0);
        playTone("square", 784, 784, 0.09, 0.09, 0.055);
      },
      jingle: (humanWon) => {
        const notes = humanWon ? [523, 659, 784, 1046] : [392, 349, 311, 261];
        for (let i = 0; i < notes.length; i++) {
          const d = i === 3 ? 0.28 : 0.11;
          playTone("square", notes[i], notes[i], d, 0.08, i * 0.12);
          playTone("triangle", notes[i] * 0.5, notes[i] * 0.5, d, 0.07, i * 0.12);
        }
      },
    };

    function updateMusic() {
      const shouldPlay = canPlayAudio() && (screen === "title" || screen === "playing") && jingleTimer <= 0;
      if (!shouldPlay) { musicPlaying = false; return; }
      const now = host.audioContext.currentTime;
      if (!musicPlaying || musicNextTime < now - 0.25) {
        musicPlaying = true;
        musicNextTime = now + 0.05;
      }
      // Schedule slightly ahead on the audio clock for steady tempo
      const horizon = now + 0.16;
      while (musicNextTime < horizon) {
        const offset = Math.max(0, musicNextTime - now);
        const vol = screen === "title" ? 0.045 : 0.055;
        const m = MELODY[musicStep], b = BASS[musicStep];
        if (m > 0) playTone("square", midiToHz(m), midiToHz(m), STEP_DUR * 0.82, vol, offset);
        if (b > 0) playTone("triangle", midiToHz(b), midiToHz(b), STEP_DUR * 0.9, vol * 1.05, offset);
        musicStep = (musicStep + 1) % MELODY.length;
        musicNextTime += STEP_DUR;
      }
    }

    function readPadCopy(playerNum) {
      const p = host.readPad(playerNum) || emptyPad();
      return { up: !!p.up, down: !!p.down, left: !!p.left, right: !!p.right, a: !!p.a, b: !!p.b, start: !!p.start };
    }

    function readInputs() {
      prevPads = currPads;
      currPads = [readPadCopy(1), readPadCopy(2)];
    }

    function syncPadsNow() {
      const p1 = readPadCopy(1), p2 = readPadCopy(2);
      prevPads = [p1, p2];
      currPads = [{ ...p1 }, { ...p2 }];
    }

    const justPressed = (idx, btn) => currPads[idx][btn] && !prevPads[idx][btn];

    function initStars() {
      stars = [];
      for (let i = 0; i < 42; i++) {
        const near = i >= 26;
        stars.push({
          x: Math.floor(host.random() * W), y: host.random() * H,
          speed: near ? 52 : 20, size: near ? 2 : 1, color: near ? PAL.white : PAL.dim,
        });
      }
    }

    function updateStars(dt) {
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.y += s.speed * dt;
        if (s.y >= H) { s.y -= H; s.x = Math.floor(host.random() * W); }
      }
    }

    function createShip(index, isCpu) {
      const startX = index === 0 ? 104 : 216;
      return {
        index, isCpu, x: startX, y: 204, lives: 3, bombs: 2, alive: true, score: 0,
        invuln: 1.0, fireCooldown: 0, doubleShot: false, shield: false,
        combo: 0, comboTimer: 0, aiThinkTimer: 0, aiTargetX: startX, aiTargetY: 204,
      };
    }

    function startMatch(selectedMode, isAttract) {
      matchMode = selectedMode;
      screen = isAttract ? "attract" : "playing";
      internalPaused = false;
      gameOverReported = false;
      matchWinner = 0;
      stateTimer = shakeTimer = bombFlash = wave = spawnTimer = 0;
      waveClearDelay = 0.6;
      bullets = []; enemyBullets = []; enemies = []; pickups = [];
      particles = []; floats = []; bombRings = []; spawnQueue = [];
      ships = [createShip(0, isAttract), createShip(1, isAttract || selectedMode === "1p")];
      musicStep = 0;
      if (isAttract) silenceAll();
      queueNextWave();
    }

    function queueNextWave() {
      wave += 1;
      spawnQueue = [];
      spawnTimer = 0.5;
      const isBoss = wave % 6 === 0;
      waveBannerText = isBoss ? `WARNING: BOSS WAVE ${wave}` : `WAVE ${wave}`;
      waveBannerTimer = 1.8;
      if (isBoss) {
        spawnQueue.push({ type: "boss", delay: 0.7, x: W / 2 });
        return;
      }
      const count = Math.min(22, 6 + Math.floor(wave * 1.8));
      const baseGap = Math.max(0.22, 0.72 - wave * 0.035);
      for (let i = 0; i < count; i++) {
        const r = host.random();
        let type = "drone";
        if (wave >= 2 && r > 0.62) type = "diver";
        if (wave >= 3 && r > 0.78) type = "shooter";
        if (wave >= 4 && r > 0.90) type = "tank";
        if (i === Math.floor(count / 2) && wave >= 2) type = "shooter";
        if (i === count - 1 && wave >= 3) type = "tank";
        spawnQueue.push({
          type, delay: i === 0 ? 0.5 : baseGap * randRange(0.7, 1.3), x: randRange(24, W - 24),
        });
      }
    }

    function spawnEnemy(type, x) {
      const sp = 1 + Math.min(1.4, (wave - 1) * 0.08);
      if (type === "drone") {
        enemies.push({
          type, x, y: -12, baseX: x, vx: 0, vy: 46 * sp, w: 14, h: 12, hp: 1, maxHp: 1,
          age: host.random() * 6, amp: randRange(18, 36), freq: randRange(2.4, 3.6), fireTimer: 99, flash: 0,
        });
      } else if (type === "diver") {
        enemies.push({
          type, x, y: -12, vx: 0, vy: 42 * sp, w: 14, h: 14, hp: 1, maxHp: 1,
          age: 0, diving: false, diveDelay: randRange(0.45, 0.95), fireTimer: 99, flash: 0,
        });
      } else if (type === "shooter") {
        enemies.push({
          type, x, y: -14, vx: (host.random() < 0.5 ? -1 : 1) * 34 * sp, vy: 30 * sp,
          targetY: randRange(36, 92), w: 16, h: 14, hp: 2, maxHp: 2, age: 0,
          fireTimer: randRange(0.7, 1.4), flash: 0,
        });
      } else if (type === "tank") {
        const hp = 5 + Math.floor(wave / 4);
        enemies.push({
          type, x, y: -18, vx: 0, vy: 22 * sp, w: 22, h: 18, hp, maxHp: hp,
          age: 0, fireTimer: randRange(1.4, 2.2), flash: 0,
        });
      } else if (type === "boss") {
        const hp = 36 + wave * 3;
        enemies.push({
          type, x: W / 2, y: -32, vx: 42 + wave * 1.5, vy: 26, targetY: 54,
          w: 54, h: 28, hp, maxHp: hp, age: 0, fireTimer: 1.2, minionTimer: 4.5, flash: 0, phase: 0,
        });
      }
    }

    function addParticles(x, y, color, count, speed = 70) {
      for (let i = 0; i < count; i++) {
        const ang = host.random() * Math.PI * 2, spd = randRange(speed * 0.25, speed);
        particles.push({
          x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
          life: randRange(0.18, 0.48), size: host.random() < 0.45 ? 3 : 2,
          color: i % 3 === 0 ? PAL.white : color,
        });
      }
    }

    const addFloat = (x, y, text, color) => floats.push({ x, y, text, color, life: 0.85 });

    function awardKill(ship, enemy) {
      const base = SCORES[enemy.type] || 100;
      ship.combo = ship.comboTimer > 0 ? Math.min(5, ship.combo + 1) : 1;
      ship.comboTimer = 1.45;
      const bonus = ship.combo > 1 ? Math.floor(base * 0.2 * (ship.combo - 1)) : 0;
      const total = base + bonus;
      ship.score += total;
      const col = ship.index === 0 ? PAL.p1 : PAL.p2;
      addFloat(enemy.x, enemy.y - 4, bonus > 0 ? `+${total} x${ship.combo}` : `+${total}`, col);
    }

    function maybeDropPickup(enemy) {
      const chance = enemy.type === "boss" ? 1.0 : enemy.type === "tank" ? 0.35 : 0.11;
      if (host.random() < chance) {
        pickups.push({ x: enemy.x, y: enemy.y, vy: 36, kind: host.random() < 0.55 ? "double" : "shield" });
      }
    }

    function nearestAliveShip(x, y) {
      let best = null, bestD = Infinity;
      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (!s.alive) continue;
        const d = (s.x - x) ** 2 + (s.y - y) ** 2;
        if (d < bestD) { bestD = d; best = s; }
      }
      return best;
    }

    function fireShipWeapon(ship) {
      const col = ship.index === 0 ? PAL.p1 : PAL.p2;
      if (ship.doubleShot) {
        bullets.push({ x: ship.x - 5, y: ship.y - 9, vx: 0, vy: -290, owner: ship.index, color: col });
        bullets.push({ x: ship.x + 5, y: ship.y - 9, vx: 0, vy: -290, owner: ship.index, color: col });
      } else {
        bullets.push({ x: ship.x, y: ship.y - 10, vx: 0, vy: -290, owner: ship.index, color: col });
      }
      ship.fireCooldown = ship.isCpu ? 0.25 : 0.155;
      sfx.shoot();
    }

    function destroyEnemyAt(idx, killerShip) {
      const e = enemies[idx];
      enemies.splice(idx, 1);
      const big = e.type === "boss" || e.type === "tank";
      const col = e.type === "boss" ? PAL.purple : e.type === "tank" ? PAL.yellow : PAL.red;
      addParticles(e.x, e.y, col, e.type === "boss" ? 36 : big ? 16 : 10, e.type === "boss" ? 130 : 80);
      if (e.type === "boss") shakeTimer = 0.45;
      sfx.explosion(big);
      if (killerShip) awardKill(killerShip, e);
      maybeDropPickup(e);
    }

    function triggerBomb(ship) {
      if (!ship.alive || ship.bombs <= 0) return;
      ship.bombs -= 1;
      bombFlash = 0.28;
      shakeTimer = 0.32;
      bombRings.push({ x: ship.x, y: ship.y, r: 8, maxR: 260, color: ship.index === 0 ? PAL.p1 : PAL.p2 });
      sfx.bomb();
      for (let i = 0; i < enemyBullets.length; i++) addParticles(enemyBullets[i].x, enemyBullets[i].y, PAL.yellow, 2, 40);
      enemyBullets = [];
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.y < -16) continue;
        if (e.type === "boss") {
          e.hp -= 14;
          e.flash = 0.16;
          addParticles(e.x, e.y, PAL.yellow, 14, 95);
          if (e.hp <= 0) destroyEnemyAt(i, ship);
        } else {
          destroyEnemyAt(i, ship);
        }
      }
    }

    function damageShip(ship) {
      if (!ship.alive || ship.invuln > 0) return;
      if (ship.shield) {
        ship.shield = false;
        ship.invuln = 0.9;
        addParticles(ship.x, ship.y, PAL.green, 12, 75);
        addFloat(ship.x, ship.y - 10, "SHIELD!", PAL.green);
        sfx.hit();
        return;
      }
      ship.lives -= 1;
      ship.doubleShot = false;
      ship.combo = ship.comboTimer = 0;
      shakeTimer = 0.25;
      addParticles(ship.x, ship.y, ship.index === 0 ? PAL.p1 : PAL.p2, 20, 95);
      sfx.playerHit();
      if (ship.lives <= 0) {
        ship.alive = false;
        addFloat(ship.x, ship.y - 8, "OUT!", PAL.red);
      } else {
        ship.invuln = 2.0;
      }
    }

    // Competent-but-beatable AI for CPU ship and attract demo
    function computeCpuPad(ship, dt) {
      const pad = emptyPad();
      if (!ship.alive) return pad;
      let threatX = 0, threatY = 0, imminent = false, urgent = false;

      for (let i = 0; i < enemyBullets.length; i++) {
        const b = enemyBullets[i], dx = b.x - ship.x, dy = b.y - ship.y, d2 = dx * dx + dy * dy;
        if (d2 < 324 && b.y < ship.y + 8) imminent = true;
        const dodgeR2 = (screen === "playing" && matchMode === "1p" && !ships[0].alive) ? 784 : 1369;
        if (d2 < dodgeR2 && b.y < ship.y + 12) {
          const w = 1 / Math.max(12, Math.sqrt(d2));
          threatX += dx * w; threatY += dy * w; urgent = true;
        }
      }
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i], dx = e.x - ship.x, dy = e.y - ship.y, d2 = dx * dx + dy * dy;
        if (d2 < 484) imminent = true;
        if (d2 < 1764 && e.y > PLAY_TOP - 28) {
          const w = 1.2 / Math.max(14, Math.sqrt(d2));
          threatX += dx * w; threatY += dy * w; urgent = true;
        }
      }
      if (imminent && ship.invuln <= 0 && !ship.shield && ship.bombs > 0) {
        pad.b = true;
        return pad;
      }
      if (urgent) {
        if (threatX >= 0) pad.left = true; else pad.right = true;
        if (threatY < 0 && ship.y < PLAY_BOTTOM - 8) pad.down = true;
        else if (ship.y > PLAY_TOP + 24) pad.up = true;
        pad.a = enemies.length > 0;
        return pad;
      }

      ship.aiThinkTimer -= dt;
      if (ship.aiThinkTimer <= 0) {
        ship.aiThinkTimer = 0.22 + host.random() * 0.14;
        let tx = ship.index === 0 ? 104 : 216, ty = 202;
        const p = pickups.find((pk) => pk.y > 90);
        if (p) {
          tx = p.x; ty = clamp(p.y + 8, PLAY_TOP + 6, PLAY_BOTTOM - 6);
        } else if (enemies.length > 0) {
          let best = enemies[0], bestD = Infinity;
          for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i], d = Math.abs(e.x - ship.x) + (e.type === "boss" ? -20 : 0);
            if (d < bestD) { bestD = d; best = e; }
          }
          tx = clamp(best.x + (host.random() - 0.5) * 20, PLAY_LEFT + 12, PLAY_RIGHT - 12);
          ty = clamp(192 + (host.random() - 0.5) * 32, PLAY_TOP + 24, PLAY_BOTTOM - 8);
        }
        ship.aiTargetX = tx;
        ship.aiTargetY = ty;
      }

      if (ship.x < ship.aiTargetX - 6) pad.right = true;
      else if (ship.x > ship.aiTargetX + 6) pad.left = true;
      if (ship.y < ship.aiTargetY - 6) pad.down = true;
      else if (ship.y > ship.aiTargetY + 6) pad.up = true;
      if (enemies.length > 0) pad.a = true;
      return pad;
    }

    function updateGameplay(dt, isAttract) {
      if (shakeTimer > 0) shakeTimer = Math.max(0, shakeTimer - dt);
      if (bombFlash > 0) bombFlash = Math.max(0, bombFlash - dt);
      if (waveBannerTimer > 0) waveBannerTimer = Math.max(0, waveBannerTimer - dt);

      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (!s.alive) continue;
        if (s.invuln > 0) s.invuln = Math.max(0, s.invuln - dt);
        if (s.fireCooldown > 0) s.fireCooldown = Math.max(0, s.fireCooldown - dt);
        if (s.comboTimer > 0) {
          s.comboTimer -= dt;
          if (s.comboTimer <= 0) s.combo = 0;
        }
        const pad = s.isCpu ? computeCpuPad(s, dt) : currPads[i];
        let mx = (pad.right ? 1 : 0) - (pad.left ? 1 : 0);
        let my = (pad.down ? 1 : 0) - (pad.up ? 1 : 0);
        if (mx && my) { mx *= 0.7071; my *= 0.7071; }
        s.x = clamp(s.x + mx * 128 * dt, PLAY_LEFT, PLAY_RIGHT);
        s.y = clamp(s.y + my * 128 * dt, PLAY_TOP, PLAY_BOTTOM);
        if (pad.a && s.fireCooldown <= 0) fireShipWeapon(s);
        if ((s.isCpu ? pad.b : justPressed(i, "b")) && s.bombs > 0) triggerBomb(s);
      }

      if (spawnQueue.length > 0) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          const item = spawnQueue.shift();
          spawnEnemy(item.type, item.x);
          spawnTimer = spawnQueue.length > 0 ? spawnQueue[0].delay : 0;
        }
      } else if (enemies.length === 0) {
        waveClearDelay -= dt;
        if (waveClearDelay <= 0) { waveClearDelay = 0.9; queueNextWave(); }
      }

      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y < -10) { bullets.splice(i, 1); continue; }
        let hit = false;
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (Math.abs(b.x - e.x) < e.w * 0.5 + 3 && Math.abs(b.y - e.y) < e.h * 0.5 + 4) {
            e.hp -= 1; e.flash = 0.08; hit = true;
            if (e.hp <= 0) destroyEnemyAt(j, ships[b.owner]);
            else { addParticles(b.x, b.y, PAL.white, 3, 45); sfx.hit(); }
            break;
          }
        }
        if (hit) bullets.splice(i, 1);
      }

      const bSpd = Math.min(135, 76 + wave * 3.5);
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        e.age += dt;
        if (e.flash > 0) e.flash = Math.max(0, e.flash - dt);

        if (e.type === "drone") {
          e.y += e.vy * dt;
          e.x = clamp(e.baseX + Math.sin(e.age * e.freq) * e.amp, 12, W - 12);
        } else if (e.type === "diver") {
          if (!e.diving) {
            e.y += e.vy * dt;
            if (e.age >= e.diveDelay) {
              e.diving = true;
              const t = nearestAliveShip(e.x, e.y);
              if (t) {
                const dx = t.x - e.x, dy = t.y - e.y, len = Math.max(1, Math.hypot(dx, dy));
                const spd = 118 + Math.min(70, wave * 5);
                e.vx = (dx / len) * spd; e.vy = (dy / len) * spd;
              } else e.vy = 135;
            }
          } else { e.x += e.vx * dt; e.y += e.vy * dt; }
        } else if (e.type === "shooter") {
          if (e.y < e.targetY) e.y += e.vy * dt;
          else {
            e.x += e.vx * dt;
            if (e.x < 18 || e.x > W - 18) e.vx = -e.vx;
            e.y += 8 * dt;
          }
          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && e.y > 16 && e.y < 145) {
            e.fireTimer = Math.max(0.85, 1.9 - wave * 0.06) + host.random() * 0.4;
            const t = nearestAliveShip(e.x, e.y);
            if (t) {
              const dx = t.x - e.x, dy = t.y - e.y, len = Math.max(1, Math.hypot(dx, dy));
              enemyBullets.push({ x: e.x, y: e.y + 7, vx: (dx / len) * bSpd, vy: (dy / len) * bSpd, color: PAL.yellow });
            }
          }
        } else if (e.type === "tank") {
          e.y += e.vy * dt;
          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && e.y > 20 && e.y < 150) {
            e.fireTimer = Math.max(1.1, 2.2 - wave * 0.05);
            enemyBullets.push({ x: e.x - 6, y: e.y + 9, vx: -18, vy: bSpd * 0.9, color: PAL.red });
            enemyBullets.push({ x: e.x + 6, y: e.y + 9, vx: 18, vy: bSpd * 0.9, color: PAL.red });
          }
        } else if (e.type === "boss") {
          if (e.y < e.targetY) e.y += e.vy * dt;
          else {
            e.x += e.vx * dt;
            if (e.x < 40 || e.x > W - 40) e.vx = -e.vx;
          }
          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && e.y >= e.targetY - 2) {
            e.phase = (e.phase + 1) % 2;
            e.fireTimer = Math.max(0.65, 1.25 - wave * 0.02);
            if (e.phase === 0) {
              for (let k = -2; k <= 2; k++) {
                const ang = Math.PI * 0.5 + k * 0.24;
                enemyBullets.push({ x: e.x, y: e.y + 12, vx: Math.cos(ang) * bSpd, vy: Math.sin(ang) * bSpd, color: PAL.purple });
              }
            } else {
              const t = nearestAliveShip(e.x, e.y);
              if (t) {
                const dx = t.x - e.x, dy = t.y - e.y, len = Math.max(1, Math.hypot(dx, dy));
                const vx = (dx / len) * bSpd * 1.1, vy = (dy / len) * bSpd * 1.1;
                enemyBullets.push({ x: e.x - 14, y: e.y + 10, vx, vy, color: PAL.yellow });
                enemyBullets.push({ x: e.x + 14, y: e.y + 10, vx, vy, color: PAL.yellow });
              }
            }
          }
          e.minionTimer -= dt;
          if (e.minionTimer <= 0 && enemies.length < 5) {
            e.minionTimer = 4.2;
            spawnEnemy("drone", clamp(e.x + randRange(-50, 50), 24, W - 24));
          }
        }

        if (e.y > H + 24 || e.x < -40 || e.x > W + 40) { enemies.splice(i, 1); continue; }
        for (let sIdx = 0; sIdx < ships.length; sIdx++) {
          const s = ships[sIdx];
          if (!s.alive) continue;
          if (Math.abs(s.x - e.x) < e.w * 0.45 + 6 && Math.abs(s.y - e.y) < e.h * 0.45 + 6) {
            damageShip(s);
            if (e.type !== "boss") { enemies.splice(i, 1); addParticles(e.x, e.y, PAL.red, 8, 65); }
            break;
          }
        }
      }

      for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y > H + 8 || b.y < -8 || b.x < -8 || b.x > W + 8) { enemyBullets.splice(i, 1); continue; }
        for (let sIdx = 0; sIdx < ships.length; sIdx++) {
          const s = ships[sIdx];
          if (s.alive && Math.abs(s.x - b.x) < 7 && Math.abs(s.y - b.y) < 7) {
            enemyBullets.splice(i, 1); damageShip(s); break;
          }
        }
      }

      for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        p.y += p.vy * dt;
        if (p.y > H + 12) { pickups.splice(i, 1); continue; }
        for (let sIdx = 0; sIdx < ships.length; sIdx++) {
          const s = ships[sIdx];
          if (!s.alive || Math.abs(s.x - p.x) >= 12 || Math.abs(s.y - p.y) >= 12) continue;
          if (p.kind === "double") {
            if (s.doubleShot) { s.score += 250; addFloat(s.x, s.y - 10, "+250", PAL.yellow); }
            else { s.doubleShot = true; addFloat(s.x, s.y - 10, "2X SHOT!", PAL.yellow); }
          } else {
            if (s.shield) { s.score += 250; addFloat(s.x, s.y - 10, "+250", PAL.green); }
            else { s.shield = true; addFloat(s.x, s.y - 10, "SHIELD!", PAL.green); }
          }
          sfx.pickup();
          pickups.splice(i, 1);
          break;
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.life -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt;
        if (pt.life <= 0) particles.splice(i, 1);
      }
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        f.life -= dt; f.y -= 20 * dt;
        if (f.life <= 0) floats.splice(i, 1);
      }
      for (let i = bombRings.length - 1; i >= 0; i--) {
        const r = bombRings[i];
        r.r += 480 * dt;
        if (r.r > r.maxR) bombRings.splice(i, 1);
      }

      if (!ships[0].alive && !ships[1].alive) {
        if (isAttract) startMatch("2p", true);
        else finishMatch();
      }
    }

    function finishMatch() {
      const s1 = ships[0].score, s2 = ships[1].score;
      matchWinner = matchMode === "1p" ? (s1 > s2 ? 1 : 0) : (s1 > s2 ? 1 : s2 > s1 ? 2 : 0);
      screen = "gameover";
      stateTimer = 3.0;
      jingleTimer = 1.6;
      musicPlaying = false;
      sfx.jingle(matchMode === "1p" ? s1 > s2 : s1 !== s2);
    }

    function advanceHighScoreQueue() {
      hsActive = null;
      while (hsQueue.length > 0) {
        const pIdx = hsQueue.shift();
        const sc = ships[pIdx].score;
        if (host.isHighScore(sc)) {
          hsActive = { playerIndex: pIdx, score: sc, chars: [0, 0, 0], cursor: 0 };
          screen = "initials";
          return;
        }
      }
      if (!gameOverReported) {
        gameOverReported = true;
        host.gameOver({ mode: matchMode, winner: matchWinner, scores: [ships[0].score, ships[1].score] });
      }
      screen = "title";
      musicStep = 0;
    }

    function updateTitle() {
      if (justPressed(0, "up") || justPressed(0, "down") || justPressed(1, "up") || justPressed(1, "down")) {
        menuIndex = menuIndex === 0 ? 1 : 0;
        sfx.menuMove();
      }
      if (justPressed(1, "start")) {
        menuIndex = 1; sfx.menuConfirm(); startMatch("2p", false); return;
      }
      if (justPressed(0, "a") || justPressed(0, "start")) {
        sfx.menuConfirm(); startMatch(menuIndex === 0 ? "1p" : "2p", false); return;
      }
      if (justPressed(0, "b")) { silenceAll(); host.exit(); }
    }

    function updateInitials() {
      if (!hsActive) return;
      const p = hsActive.playerIndex, c = hsActive.cursor;
      if (justPressed(p, "up")) {
        hsActive.chars[c] = (hsActive.chars[c] + 1) % ALPHABET.length; sfx.menuMove();
      } else if (justPressed(p, "down")) {
        hsActive.chars[c] = (hsActive.chars[c] + ALPHABET.length - 1) % ALPHABET.length; sfx.menuMove();
      } else if (justPressed(p, "b") && c > 0) {
        hsActive.cursor -= 1; sfx.menuMove();
      } else if (justPressed(p, "a") || justPressed(p, "start")) {
        sfx.menuConfirm();
        if (c < 2) hsActive.cursor += 1;
        else {
          const initials = ALPHABET[hsActive.chars[0]] + ALPHABET[hsActive.chars[1]] + ALPHABET[hsActive.chars[2]];
          host.saveHighScore({ initials, score: hsActive.score });
          advanceHighScoreQueue();
        }
      }
    }

    // Pixel-art rendering helpers
    function drawShip(ctx, ship) {
      if (!ship.alive || (ship.invuln > 0 && Math.floor(clock * 16) % 2 === 0)) return;
      const x = Math.floor(ship.x), y = Math.floor(ship.y);
      const main = ship.index === 0 ? PAL.p1 : PAL.p2;
      const dark = ship.index === 0 ? PAL.p1Dark : PAL.p2Dark;

      if (ship.shield) {
        ctx.strokeStyle = PAL.green;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.stroke();
      }
      const flame = 3 + (Math.floor(clock * 20) % 3);
      ctx.fillStyle = PAL.yellow; ctx.fillRect(x - 2, y + 6, 4, flame);
      ctx.fillStyle = PAL.red; ctx.fillRect(x - 1, y + 5 + flame, 2, 2);
      ctx.fillStyle = dark; ctx.fillRect(x - 7, y + 1, 14, 4); ctx.fillRect(x - 5, y - 2, 10, 4);
      ctx.fillStyle = main; ctx.fillRect(x - 6, y + 2, 12, 3); ctx.fillRect(x - 3, y - 5, 6, 9); ctx.fillRect(x - 1, y - 8, 2, 4);
      ctx.fillStyle = PAL.white; ctx.fillRect(x - 1, y - 4, 2, 3);
      if (ship.doubleShot) {
        ctx.fillStyle = PAL.yellow; ctx.fillRect(x - 7, y - 2, 2, 4); ctx.fillRect(x + 5, y - 2, 2, 4);
      }
    }

    function drawEnemy(ctx, e) {
      const x = Math.floor(e.x), y = Math.floor(e.y), lit = e.flash > 0;
      if (e.type === "drone") {
        ctx.fillStyle = lit ? PAL.white : PAL.red;
        ctx.fillRect(x - 6, y - 3, 12, 6); ctx.fillRect(x - 3, y - 5, 6, 10);
        ctx.fillStyle = lit ? PAL.white : PAL.yellow; ctx.fillRect(x - 2, y - 1, 4, 3);
      } else if (e.type === "diver") {
        ctx.fillStyle = lit ? PAL.white : PAL.purple;
        ctx.fillRect(x - 6, y - 5, 12, 4); ctx.fillRect(x - 4, y - 1, 8, 4); ctx.fillRect(x - 2, y + 3, 4, 4);
        ctx.fillStyle = PAL.white; ctx.fillRect(x - 3, y - 3, 2, 2); ctx.fillRect(x + 1, y - 3, 2, 2);
      } else if (e.type === "shooter") {
        ctx.fillStyle = lit ? PAL.white : PAL.green;
        ctx.fillRect(x - 7, y - 4, 14, 8); ctx.fillRect(x - 4, y - 6, 8, 3);
        ctx.fillStyle = lit ? PAL.white : PAL.yellow; ctx.fillRect(x - 2, y + 4, 4, 3);
        ctx.fillStyle = PAL.bg; ctx.fillRect(x - 4, y - 2, 8, 3);
      } else if (e.type === "tank") {
        ctx.fillStyle = lit ? PAL.white : PAL.yellow; ctx.fillRect(x - 10, y - 8, 20, 16);
        ctx.fillStyle = lit ? PAL.white : PAL.red; ctx.fillRect(x - 7, y - 5, 14, 10);
        ctx.fillStyle = PAL.white; ctx.fillRect(x - 6, y + 6, 3, 4); ctx.fillRect(x + 3, y + 6, 3, 4);
      } else if (e.type === "boss") {
        ctx.fillStyle = lit ? PAL.white : PAL.purple;
        ctx.fillRect(x - 26, y - 10, 52, 18); ctx.fillRect(x - 18, y - 14, 36, 6);
        ctx.fillRect(x - 22, y + 8, 12, 6); ctx.fillRect(x + 10, y + 8, 12, 6);
        ctx.fillStyle = lit ? PAL.white : PAL.red; ctx.fillRect(x - 12, y - 6, 24, 10);
        ctx.fillStyle = PAL.yellow;
        ctx.fillRect(x - 6, y - 3, 12, 4); ctx.fillRect(x - 18, y + 10, 4, 4); ctx.fillRect(x + 14, y + 10, 4, 4);
      }
    }

    function drawPickup(ctx, p) {
      const x = Math.floor(p.x), y = Math.floor(p.y);
      const col = p.kind === "double" ? PAL.yellow : PAL.green;
      ctx.fillStyle = Math.floor(clock * 8) % 2 === 0 ? col : PAL.white;
      ctx.fillRect(x - 6, y - 6, 12, 12);
      ctx.fillStyle = PAL.panel; ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.fillStyle = col; ctx.font = "8px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.kind === "double" ? "2X" : "S", x, y + 1);
    }

    function drawHud(ctx) {
      ctx.fillStyle = "rgba(7, 11, 30, 0.78)";
      ctx.fillRect(0, 0, W, 24);
      const p1 = ships[0], p2 = ships[1];
      const p1Label = screen === "attract" ? "CPU1" : "P1";
      const p2Label = screen === "attract" ? "CPU2" : matchMode === "1p" ? "CPU" : "P2";

      ctx.font = "8px monospace";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillStyle = PAL.p1;
      ctx.fillText(`${p1Label} ${String(p1.score).padStart(6, "0")}`, 6, 3);
      for (let i = 0; i < p1.lives; i++) {
        ctx.fillStyle = PAL.p1; ctx.fillRect(6 + i * 7, 14, 5, 4); ctx.fillRect(8 + i * 7, 13, 1, 1);
      }
      for (let i = 0; i < p1.bombs; i++) {
        ctx.fillStyle = PAL.yellow; ctx.fillRect(32 + i * 7, 14, 4, 4);
      }

      ctx.textAlign = "center";
      ctx.fillStyle = PAL.white;
      ctx.fillText(`W${wave}`, W / 2, 3);
      const boss = enemies.find((e) => e.type === "boss");
      if (boss) {
        const bw = 90, bx = Math.floor((W - bw) / 2);
        ctx.fillStyle = PAL.dim; ctx.fillRect(bx, 14, bw, 5);
        ctx.fillStyle = PAL.red; ctx.fillRect(bx, 14, Math.max(0, Math.floor((bw * boss.hp) / boss.maxHp)), 5);
      }

      ctx.textAlign = "right";
      ctx.fillStyle = PAL.p2;
      ctx.fillText(`${p2Label} ${String(p2.score).padStart(6, "0")}`, W - 6, 3);
      for (let i = 0; i < p2.lives; i++) {
        ctx.fillStyle = PAL.p2; ctx.fillRect(W - 11 - i * 7, 14, 5, 4); ctx.fillRect(W - 9 - i * 7, 13, 1, 1);
      }
      for (let i = 0; i < p2.bombs; i++) {
        ctx.fillStyle = PAL.yellow; ctx.fillRect(W - 36 - i * 7, 14, 4, 4);
      }
    }

    function renderWorld(ctx) {
      ctx.save();
      if (shakeTimer > 0) ctx.translate(Math.floor((host.random() - 0.5) * 6), Math.floor((host.random() - 0.5) * 6));
      for (let i = 0; i < bombRings.length; i++) {
        const r = bombRings[i];
        ctx.strokeStyle = r.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(Math.floor(r.x), Math.floor(r.y), Math.floor(r.r), 0, Math.PI * 2); ctx.stroke();
      }
      for (let i = 0; i < pickups.length; i++) drawPickup(ctx, pickups[i]);
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        ctx.fillStyle = b.color; ctx.fillRect(Math.floor(b.x) - 1, Math.floor(b.y) - 4, 2, 7);
      }
      for (let i = 0; i < enemyBullets.length; i++) {
        const b = enemyBullets[i];
        ctx.fillStyle = b.color; ctx.fillRect(Math.floor(b.x) - 2, Math.floor(b.y) - 2, 4, 4);
        ctx.fillStyle = PAL.white; ctx.fillRect(Math.floor(b.x) - 1, Math.floor(b.y) - 1, 2, 2);
      }
      for (let i = 0; i < enemies.length; i++) drawEnemy(ctx, enemies[i]);
      for (let i = 0; i < ships.length; i++) drawShip(ctx, ships[i]);
      for (let i = 0; i < particles.length; i++) {
        const pt = particles[i];
        ctx.fillStyle = pt.color; ctx.fillRect(Math.floor(pt.x), Math.floor(pt.y), pt.size, pt.size);
      }
      ctx.font = "8px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (let i = 0; i < floats.length; i++) {
        ctx.fillStyle = floats[i].color;
        ctx.fillText(floats[i].text, Math.floor(floats[i].x), Math.floor(floats[i].y));
      }
      ctx.restore();

      if (bombFlash > 0) {
        ctx.fillStyle = `rgba(244, 247, 255, ${(bombFlash / 0.28) * 0.45})`;
        ctx.fillRect(0, 0, W, H);
      }
      drawHud(ctx);
      if (waveBannerTimer > 0 && screen === "playing") {
        ctx.font = "10px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = wave % 6 === 0 ? PAL.red : PAL.yellow;
        ctx.fillText(waveBannerText, W / 2, 92);
      }
    }

    function renderAttractOverlay(ctx) {
      ctx.fillStyle = "rgba(7, 11, 30, 0.55)"; ctx.fillRect(34, 42, 252, 54);
      ctx.strokeStyle = PAL.p1; ctx.lineWidth = 2; ctx.strokeRect(34, 42, 252, 54);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "16px monospace";
      ctx.fillStyle = PAL.p2; ctx.fillText("VOID RAIDERS", W / 2 + 1, 61);
      ctx.fillStyle = PAL.p1; ctx.fillText("VOID RAIDERS", W / 2, 60);

      const highs = host.getHighScores() || [];
      ctx.font = "8px monospace"; ctx.fillStyle = PAL.yellow;
      ctx.fillText(
        highs.length > 0 ? `HIGH SCORE  ${highs[0].initials}  ${String(highs[0].score).padStart(6, "0")}` : "HIGH SCORE  ---  000000",
        W / 2, 82
      );
      if (Math.floor(clock * 2.5) % 2 === 0) {
        ctx.font = "10px monospace"; ctx.fillStyle = PAL.white;
        ctx.fillText("INSERT COIN / PRESS START", W / 2, 218);
      }
    }

    function renderTitle(ctx) {
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.font = "16px monospace";
      ctx.fillStyle = PAL.p2; ctx.fillText("VOID RAIDERS", W / 2 + 1, 17);
      ctx.fillStyle = PAL.p1; ctx.fillText("VOID RAIDERS", W / 2, 16);

      drawShip(ctx, { x: 46, y: 24, index: 0, alive: true, invuln: 0, shield: false, doubleShot: false });
      drawShip(ctx, { x: 274, y: 24, index: 1, alive: true, invuln: 0, shield: false, doubleShot: false });

      ctx.fillStyle = PAL.panel; ctx.fillRect(76, 48, 168, 48);
      ctx.strokeStyle = PAL.dim; ctx.lineWidth = 1; ctx.strokeRect(76, 48, 168, 48);
      ctx.font = "10px monospace";
      ctx.fillStyle = menuIndex === 0 ? PAL.yellow : PAL.white;
      ctx.fillText(menuIndex === 0 ? "> 1 PLAYER (VS CPU) <" : "  1 PLAYER (VS CPU)  ", W / 2, 57);
      ctx.fillStyle = menuIndex === 1 ? PAL.yellow : PAL.white;
      ctx.fillText(menuIndex === 1 ? "> 2 PLAYERS <" : "  2 PLAYERS  ", W / 2, 76);

      ctx.font = "8px monospace"; ctx.fillStyle = PAL.p1;
      ctx.fillText("HIGH SCORES", W / 2, 108);
      const highs = host.getHighScores() || [];
      for (let i = 0; i < 5; i++) {
        const y = 122 + i * 13, row = highs[i];
        ctx.fillStyle = row ? (i === 0 ? PAL.yellow : PAL.white) : PAL.dim;
        ctx.fillText(row ? `${i + 1}. ${row.initials}  ${String(row.score).padStart(6, "0")}` : `${i + 1}. ---  000000`, W / 2, y);
      }
      ctx.fillStyle = PAL.p2; ctx.fillText("P2: PRESS START TO JOIN", W / 2, 194);
      ctx.fillStyle = PAL.dim;
      ctx.fillText("A: FIRE/OK   B: BOMB/EXIT", W / 2, 208);
      ctx.fillText("START: PAUSE", W / 2, 220);
    }

    function renderPausedBox(ctx) {
      ctx.fillStyle = "rgba(7, 11, 30, 0.85)"; ctx.fillRect(96, 94, 128, 48);
      ctx.strokeStyle = PAL.yellow; ctx.lineWidth = 2; ctx.strokeRect(96, 94, 128, 48);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "16px monospace"; ctx.fillStyle = PAL.yellow; ctx.fillText("PAUSED", W / 2, 112);
      ctx.font = "8px monospace"; ctx.fillStyle = PAL.white; ctx.fillText("PRESS START", W / 2, 130);
    }

    function renderGameOver(ctx) {
      ctx.fillStyle = "rgba(7, 11, 30, 0.86)"; ctx.fillRect(46, 66, 228, 104);
      ctx.strokeStyle = PAL.p1; ctx.lineWidth = 2; ctx.strokeRect(46, 66, 228, 104);
      const s1 = ships[0].score, s2 = ships[1].score;
      let headline = "DRAW!", hCol = PAL.yellow;
      if (s1 > s2) { headline = "PLAYER 1 WINS!"; hCol = PAL.p1; }
      else if (s2 > s1) { headline = matchMode === "1p" ? "CPU WINS!" : "PLAYER 2 WINS!"; hCol = PAL.p2; }

      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "16px monospace"; ctx.fillStyle = hCol; ctx.fillText(headline, W / 2, 92);
      ctx.font = "10px monospace";
      ctx.fillStyle = PAL.p1; ctx.fillText(`P1: ${String(s1).padStart(6, "0")}`, W / 2, 122);
      ctx.fillStyle = PAL.p2; ctx.fillText(`${matchMode === "1p" ? "CPU" : "P2"}: ${String(s2).padStart(6, "0")}`, W / 2, 142);
    }

    function renderInitials(ctx) {
      if (!hsActive) return;
      const col = hsActive.playerIndex === 0 ? PAL.p1 : PAL.p2;
      ctx.fillStyle = PAL.panel; ctx.fillRect(40, 44, 240, 152);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(40, 44, 240, 152);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "10px monospace";
      ctx.fillStyle = PAL.yellow; ctx.fillText("NEW HIGH SCORE!", W / 2, 66);
      ctx.fillStyle = col; ctx.fillText(`PLAYER ${hsActive.playerIndex + 1}  ${String(hsActive.score).padStart(6, "0")}`, W / 2, 86);

      ctx.font = "16px monospace";
      for (let i = 0; i < 3; i++) {
        const lx = W / 2 + (i - 1) * 32, ch = ALPHABET[hsActive.chars[i]], sel = i === hsActive.cursor;
        ctx.fillStyle = sel ? PAL.yellow : PAL.white;
        ctx.fillText(ch === " " ? "_" : ch, lx, 122);
        if (sel && Math.floor(clock * 6) % 2 === 0) ctx.fillRect(lx - 7, 134, 14, 2);
      }
      ctx.font = "8px monospace"; ctx.fillStyle = PAL.white;
      ctx.fillText("UP/DOWN: LETTER", W / 2, 160);
      ctx.fillText("A: CONFIRM   B: BACK", W / 2, 174);
    }

    initStars();

    return {
      start(options) {
        if (destroyed) return;
        mode = options && options.mode === "play" ? "play" : "attract";
        hostPaused = false; internalPaused = false; jingleTimer = 0;
        syncPadsNow();
        if (mode === "attract") { silenceAll(); startMatch("2p", true); }
        else { screen = "title"; menuIndex = 0; musicStep = 0; }
      },
      update(seconds) {
        if (destroyed || hostPaused) return;
        const dt = clamp(seconds || 0, 0, 1 / 30);
        clock += dt;
        if (jingleTimer > 0) jingleTimer = Math.max(0, jingleTimer - dt);
        readInputs();

        if (screen === "playing") {
          if (justPressed(0, "start") || (matchMode === "2p" && justPressed(1, "start"))) {
            internalPaused = !internalPaused;
            if (internalPaused) silenceAll(); else sfx.menuMove();
          }
          if (internalPaused) return;
          updateStars(dt);
          updateGameplay(dt, false);
        } else if (screen === "attract") {
          updateStars(dt);
          updateGameplay(dt, true);
        } else if (screen === "title") {
          updateStars(dt);
          updateTitle();
        } else if (screen === "gameover") {
          updateStars(dt);
          stateTimer -= dt;
          if (stateTimer <= 0) {
            hsQueue = matchMode === "2p" ? [0, 1] : [0];
            advanceHighScoreQueue();
          }
        } else if (screen === "initials") {
          updateStars(dt);
          updateInitials();
        }
        updateMusic();
      },
      render() {
        if (destroyed || !host.context) return;
        const ctx = host.context;
        ctx.fillStyle = PAL.bg;
        ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          ctx.fillStyle = s.color;
          ctx.fillRect(Math.floor(s.x), Math.floor(s.y), s.size, s.size);
        }
        if (screen === "title") renderTitle(ctx);
        else if (screen === "attract") { renderWorld(ctx); renderAttractOverlay(ctx); }
        else if (screen === "playing") { renderWorld(ctx); if (internalPaused) renderPausedBox(ctx); }
        else if (screen === "gameover") { renderWorld(ctx); renderGameOver(ctx); }
        else if (screen === "initials") renderInitials(ctx);
      },
      pause() {
        hostPaused = true;
        silenceAll();
      },
      resume() {
        if (destroyed) return;
        hostPaused = false;
        syncPadsNow();
      },
      destroy() {
        destroyed = true;
        silenceAll();
        enemies = []; bullets = []; enemyBullets = []; pickups = [];
        particles = []; floats = []; bombRings = []; ships = []; stars = [];
      },
    };
  },
};