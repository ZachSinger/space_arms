# Arcade cabinet prompts

Paste one prompt into Gemini per game. Each prompt is complete by itself. Gemini should hand back one file; save it into `js/arcade/games/` under the name the prompt asks for. The shop side (buying the cabinet, passive income, walking up to play) is built separately and does not need anything else from Gemini.

The contract inside each prompt is copied from `js/arcade/ArcadeGame.js`. If that file changes, update the contract section in all three prompts to match.

## Space shooter: VOID RAIDERS

````text
You are writing one small arcade game that will run inside a cabinet in my PC game, "Space Arms Dealer" (a retro-futuristic space shop sim built with Electron, Phaser 3 and plain modern JavaScript). Players buy the cabinet for their shop and can walk up and play it. The shop runs your game through the contract below, so following it exactly matters more than anything else.

=== WHAT TO HAND BACK ===
Exactly one file, `js/arcade/games/void-raiders.js`, as a single code block. Plain JavaScript ES2022 module, no TypeScript, no build step. Its default export is the game object described in the contract. No other exports are needed.

=== HARD RULES (the game will be rejected if any are broken) ===
1. Zero imports. Zero dependencies. No image, sound, font or data files: draw everything with canvas 2D calls (rectangles, paths, arcs, fillText) and make every sound with the Web Audio API.
2. Draw only on `host.context`. The screen is always 320x240 pixels; the shop scales it up with nearest-neighbor, so use crisp, chunky pixel-art shapes, whole-pixel positions, and the canvas default "monospace" font at sizes 8, 10 or 16. Never resize the canvas, never touch any other DOM element, never use CSS.
3. Never call requestAnimationFrame, setTimeout or setInterval for game logic. The shop calls `update(seconds)` then `render()` every frame. All movement and timers must be based on `seconds` so the game runs the same at any frame rate.
4. Never add event listeners (no keydown, no gamepad API). Read controls only with `host.readPad(1)` and `host.readPad(2)`, which return the buttons each player is holding right now. Detect a fresh press yourself by comparing with the previous frame. The shop maps keyboards and controllers to these buttons.
5. Every sound connects to `host.audioOutput`, never to `audioContext.destination`. Never create, close or suspend an AudioContext. `pause()` and `destroy()` must silence everything immediately (stop or disconnect all oscillators and the music loop). In "attract" mode the game is completely silent.
6. Never use localStorage, fetch, eval, Math.random or Date.now. Use `host.random()` for randomness. Save high scores only through `host.saveHighScore`.
7. Call `host.gameOver(result)` exactly once at the end of each match, after any high-score entry is done. Call `host.exit()` when the player chooses to leave from the title screen (pressing B there).
8. No global variables, no top-level side effects. Everything lives inside `create()`, so two cabinets can run two copies at once without interfering.
9. Keep it under about 1200 lines, readable, with short comments only where something is not obvious.

=== CONTRACT (this is the shop's real code; match it exactly) ===
```js
export const ARCADE_SCREEN = Object.freeze({ width: 320, height: 240 });

export const ARCADE_BUTTONS = Object.freeze(["up", "down", "left", "right", "a", "b", "start"]);

/**
 * @typedef {object} ArcadePad
 * Which buttons one player is holding right now.
 * @property {boolean} up
 * @property {boolean} down
 * @property {boolean} left
 * @property {boolean} right
 * @property {boolean} a
 * @property {boolean} b
 * @property {boolean} start
 */

/**
 * @typedef {object} ArcadeHighScore
 * @property {string} initials - exactly 3 characters, A-Z or space
 * @property {number} score - points, or milliseconds when the game's scoreType is "time"
 */

/**
 * @typedef {object} ArcadeResult
 * @property {"1p" | "2p"} mode
 * @property {0 | 1 | 2} winner - 0 for a draw, or when the computer won a 1p match
 * @property {[number, number]} scores - player 1, player 2 (the computer's score in 1p)
 */

/**
 * @typedef {object} ArcadeHost
 * @property {HTMLCanvasElement} canvas - always ARCADE_SCREEN sized; the host scales it up
 * @property {CanvasRenderingContext2D} context - 2D context of that canvas, smoothing off
 * @property {(player: 1 | 2) => ArcadePad} readPad - fresh button state for a player
 * @property {AudioContext} audioContext - shared; the game must never close or suspend it
 * @property {AudioNode} audioOutput - connect every sound here, never to audioContext.destination
 * @property {() => ArcadeHighScore[]} getHighScores - saved table, best first, at most 5 rows
 * @property {(score: number) => boolean} isHighScore - would this score enter the table?
 * @property {(entry: ArcadeHighScore) => void} saveHighScore
 * @property {(result: ArcadeResult) => void} gameOver - call once when a match ends
 * @property {() => void} exit - the player chose to leave the cabinet
 * @property {() => number} random - use instead of Math.random (0 <= n < 1)
 */

/**
 * @typedef {object} ArcadeInstance
 * @property {(options: { mode: "attract" | "play" }) => void} start - "attract" is the idle demo
 *   shown on the cabinet's screen in the shop (computer plays itself, silent); "play" opens the
 *   game's own title screen where players pick 1 player or 2 players
 * @property {(seconds: number) => void} update - advance the game; seconds is at most 1/30
 * @property {() => void} render - draw the current frame onto host.context
 * @property {() => void} pause - freeze, and silence all sound
 * @property {() => void} resume
 * @property {() => void} destroy - stop every sound and release everything; never used again
 */

/**
 * @typedef {object} ArcadeGame
 * @property {string} id - lowercase-with-dashes, matches the file name
 * @property {string} title - shown on the cabinet
 * @property {"points" | "time"} scoreType - "time" means a lower score is better
 * @property {(host: ArcadeHost) => ArcadeInstance} create
 */
```

=== FLOW EVERY GAME MUST HAVE ===
Attract mode: `start({ mode: "attract" })` shows the game playing itself (computer controls both sides), looping forever, silent, with the title and the best high score drawn on top. This is what customers see on the cabinet screen in the shop, so make it look lively.
Play mode: `start({ mode: "play" })` opens a title screen with the game name, the high score table (top 5, from `host.getHighScores()`), and a choice of "1 PLAYER" (player 1 against the computer) or "2 PLAYERS". Up/down moves the choice, A or START confirms, B leaves (`host.exit()`). Player 2 can join from the title screen by pressing START on pad 2, which selects 2 PLAYERS.
During a match: show both players' scores at the top in their own colors (player 1 cyan, player 2 orange, computer opponent drawn in player 2's spot and labeled "CPU"). START pauses and unpauses the match inside the game, with a small "PAUSED" box.
End of match: show who won for about 3 seconds. Then for each human player whose score passes `host.isHighScore(score)`, run a classic 3-letter initials entry (up/down changes the letter, A confirms a letter, B goes back a letter), then `host.saveHighScore`. Then call `host.gameOver(...)` and return to the title screen.

=== SOUND AND MUSIC ===
Keep it very simple and chiptune. Sound effects: one short synthesized blip per important event (shoot, hit, explosion, pickup, menu move, menu confirm), each well under half a second, built from an oscillator or a short noise buffer with a quick volume fade. Music: one short looping tune (8 to 16 bars) on two voices (a square-wave melody and a triangle-wave bass), scheduled a little ahead on the audio clock from inside `update()`. Music plays on the title screen and during matches, a short jingle plays at match end. Keep everything quiet: no single sound above a gain of 0.15, music around 0.06.

=== LOOK ===
Retro sci-fi arcade, dark space-blue background, a limited palette of about 12 bright colors, thick readable pixel shapes. It should read clearly even when the cabinet screen is small in the shop.

=== THE GAME ===
Name: VOID RAIDERS. id: "void-raiders". scoreType: "points".
A vertical scrolling space shooter for two ships at once, in the spirit of classic 80s arcade shooters but much smaller.
Both ships fly at the bottom of the screen side by side (player 1 cyan, player 2 orange) against the same waves of enemies. It is a race for points: ships cannot hurt each other, they compete for kills.
Controls: d-pad moves freely in the lower half of the screen, A fires (hold for steady fire), B fires a single screen-clearing smart bomb (each ship has 2 per match, shown as icons).
Enemies: 3 or 4 simple types (a zig-zag drone, a diver that swoops at the nearest ship, a slow tank that takes several hits, a shooter that fires slow bullets). Waves get faster and denser over time. Every 6th wave is a mini-boss that takes many hits and is worth big points.
Pickups dropped by enemies: a double-shot upgrade and a shield that absorbs one hit. Whoever touches a pickup first gets it.
Each ship has 3 lives. Getting hit costs a life and gives 2 seconds of blinking invincibility. A ship that runs out of lives stays out; the match ends when both are out. The winner is the higher score.
Scoring: drone 100, diver 150, tank 300, shooter 200, mini-boss 2000. A small combo bonus for kills in quick succession, shown as floating numbers.
In 1 PLAYER mode the computer flies the orange ship: it dodges nearby bullets, drifts toward enemies, fires constantly, and uses a bomb when it is about to be hit. Make it competent but beatable.
Background: two layers of scrolling stars at different speeds.
````

## Beat 'em up: DOCK BRAWL

````text
You are writing one small arcade game that will run inside a cabinet in my PC game, "Space Arms Dealer" (a retro-futuristic space shop sim built with Electron, Phaser 3 and plain modern JavaScript). Players buy the cabinet for their shop and can walk up and play it. The shop runs your game through the contract below, so following it exactly matters more than anything else.

=== WHAT TO HAND BACK ===
Exactly one file, `js/arcade/games/dock-brawl.js`, as a single code block. Plain JavaScript ES2022 module, no TypeScript, no build step. Its default export is the game object described in the contract. No other exports are needed.

=== HARD RULES (the game will be rejected if any are broken) ===
1. Zero imports. Zero dependencies. No image, sound, font or data files: draw everything with canvas 2D calls (rectangles, paths, arcs, fillText) and make every sound with the Web Audio API.
2. Draw only on `host.context`. The screen is always 320x240 pixels; the shop scales it up with nearest-neighbor, so use crisp, chunky pixel-art shapes, whole-pixel positions, and the canvas default "monospace" font at sizes 8, 10 or 16. Never resize the canvas, never touch any other DOM element, never use CSS.
3. Never call requestAnimationFrame, setTimeout or setInterval for game logic. The shop calls `update(seconds)` then `render()` every frame. All movement and timers must be based on `seconds` so the game runs the same at any frame rate.
4. Never add event listeners (no keydown, no gamepad API). Read controls only with `host.readPad(1)` and `host.readPad(2)`, which return the buttons each player is holding right now. Detect a fresh press yourself by comparing with the previous frame. The shop maps keyboards and controllers to these buttons.
5. Every sound connects to `host.audioOutput`, never to `audioContext.destination`. Never create, close or suspend an AudioContext. `pause()` and `destroy()` must silence everything immediately (stop or disconnect all oscillators and the music loop). In "attract" mode the game is completely silent.
6. Never use localStorage, fetch, eval, Math.random or Date.now. Use `host.random()` for randomness. Save high scores only through `host.saveHighScore`.
7. Call `host.gameOver(result)` exactly once at the end of each match, after any high-score entry is done. Call `host.exit()` when the player chooses to leave from the title screen (pressing B there).
8. No global variables, no top-level side effects. Everything lives inside `create()`, so two cabinets can run two copies at once without interfering.
9. Keep it under about 1200 lines, readable, with short comments only where something is not obvious.

=== CONTRACT (this is the shop's real code; match it exactly) ===
```js
export const ARCADE_SCREEN = Object.freeze({ width: 320, height: 240 });

export const ARCADE_BUTTONS = Object.freeze(["up", "down", "left", "right", "a", "b", "start"]);

/**
 * @typedef {object} ArcadePad
 * Which buttons one player is holding right now.
 * @property {boolean} up
 * @property {boolean} down
 * @property {boolean} left
 * @property {boolean} right
 * @property {boolean} a
 * @property {boolean} b
 * @property {boolean} start
 */

/**
 * @typedef {object} ArcadeHighScore
 * @property {string} initials - exactly 3 characters, A-Z or space
 * @property {number} score - points, or milliseconds when the game's scoreType is "time"
 */

/**
 * @typedef {object} ArcadeResult
 * @property {"1p" | "2p"} mode
 * @property {0 | 1 | 2} winner - 0 for a draw, or when the computer won a 1p match
 * @property {[number, number]} scores - player 1, player 2 (the computer's score in 1p)
 */

/**
 * @typedef {object} ArcadeHost
 * @property {HTMLCanvasElement} canvas - always ARCADE_SCREEN sized; the host scales it up
 * @property {CanvasRenderingContext2D} context - 2D context of that canvas, smoothing off
 * @property {(player: 1 | 2) => ArcadePad} readPad - fresh button state for a player
 * @property {AudioContext} audioContext - shared; the game must never close or suspend it
 * @property {AudioNode} audioOutput - connect every sound here, never to audioContext.destination
 * @property {() => ArcadeHighScore[]} getHighScores - saved table, best first, at most 5 rows
 * @property {(score: number) => boolean} isHighScore - would this score enter the table?
 * @property {(entry: ArcadeHighScore) => void} saveHighScore
 * @property {(result: ArcadeResult) => void} gameOver - call once when a match ends
 * @property {() => void} exit - the player chose to leave the cabinet
 * @property {() => number} random - use instead of Math.random (0 <= n < 1)
 */

/**
 * @typedef {object} ArcadeInstance
 * @property {(options: { mode: "attract" | "play" }) => void} start - "attract" is the idle demo
 *   shown on the cabinet's screen in the shop (computer plays itself, silent); "play" opens the
 *   game's own title screen where players pick 1 player or 2 players
 * @property {(seconds: number) => void} update - advance the game; seconds is at most 1/30
 * @property {() => void} render - draw the current frame onto host.context
 * @property {() => void} pause - freeze, and silence all sound
 * @property {() => void} resume
 * @property {() => void} destroy - stop every sound and release everything; never used again
 */

/**
 * @typedef {object} ArcadeGame
 * @property {string} id - lowercase-with-dashes, matches the file name
 * @property {string} title - shown on the cabinet
 * @property {"points" | "time"} scoreType - "time" means a lower score is better
 * @property {(host: ArcadeHost) => ArcadeInstance} create
 */
```

=== FLOW EVERY GAME MUST HAVE ===
Attract mode: `start({ mode: "attract" })` shows the game playing itself (computer controls both sides), looping forever, silent, with the title and the best high score drawn on top. This is what customers see on the cabinet screen in the shop, so make it look lively.
Play mode: `start({ mode: "play" })` opens a title screen with the game name, the high score table (top 5, from `host.getHighScores()`), and a choice of "1 PLAYER" (player 1 against the computer) or "2 PLAYERS". Up/down moves the choice, A or START confirms, B leaves (`host.exit()`). Player 2 can join from the title screen by pressing START on pad 2, which selects 2 PLAYERS.
During a match: show both players' scores at the top in their own colors (player 1 cyan, player 2 orange, computer opponent drawn in player 2's spot and labeled "CPU"). START pauses and unpauses the match inside the game, with a small "PAUSED" box.
End of match: show who won for about 3 seconds. Then for each human player whose score passes `host.isHighScore(score)`, run a classic 3-letter initials entry (up/down changes the letter, A confirms a letter, B goes back a letter), then `host.saveHighScore`. Then call `host.gameOver(...)` and return to the title screen.

=== SOUND AND MUSIC ===
Keep it very simple and chiptune. Sound effects: one short synthesized blip per important event (shoot, hit, explosion, pickup, menu move, menu confirm), each well under half a second, built from an oscillator or a short noise buffer with a quick volume fade. Music: one short looping tune (8 to 16 bars) on two voices (a square-wave melody and a triangle-wave bass), scheduled a little ahead on the audio clock from inside `update()`. Music plays on the title screen and during matches, a short jingle plays at match end. Keep everything quiet: no single sound above a gain of 0.15, music around 0.06.

=== LOOK ===
Retro sci-fi arcade, dark space-blue background, a limited palette of about 12 bright colors, thick readable pixel shapes. It should read clearly even when the cabinet screen is small in the shop.

=== THE GAME ===
Name: DOCK BRAWL. id: "dock-brawl". scoreType: "points".
A small side-view brawler set on a space station cargo dock. One fixed screen, no scrolling. A 2.5D floor strip across the lower part of the screen where fighters walk left, right, up and down (depth), drawn back-to-front by their vertical position.
Two fighters (player 1 cyan, player 2 orange) are on the dock together. Waves of dock thugs come in from both sides. Both players fight the thugs, AND they can hit each other: it is a brawl, the winner is whoever has more points when the match ends.
Controls: d-pad walks, A punches (press three times quickly for a 3-hit combo whose last hit knocks the target down), B jumps (A in the air is a jump kick that knocks down). Holding A for half a second then releasing does a slower heavy punch that knocks down and pushes far.
Each fighter has a health bar (top of the screen next to their score) and 2 lives. Knocked-down characters flash and get up after a moment, invincible for a second. When a fighter loses all health they lose a life and respawn falling in from the top after 2 seconds. A fighter with no lives left is out.
Thugs: 2 types, a quick weak one and a big slow one that grabs and throws. Every 4th wave a boss (the "Dock Boss") appears with a big health bar. Waves get bigger over time. The match ends when both fighters are out, or after the 8th wave is cleared (then the leading fighter wins).
Scoring: each hit 10, knocking down a thug 50, defeating a quick thug 200, big thug 400, boss 2500, landing a knockdown on the other player 300, defeating the other player 1000. Show small floating numbers.
Crates on the dock can be smashed for a food pickup that restores health.
Fighters and thugs are simple chunky pixel people (about 16x28 pixels): head, body, arms and legs as rectangles with 2-frame walk, punch, kick, hurt and knocked-down poses, flipped to face the way they move. Give thugs different colors and hats.
In 1 PLAYER mode the computer controls the orange fighter: it mostly fights thugs, picks up health when low, and occasionally attacks player 1 when close. Make it fair and beatable.
````

## Racing game: NEBULA RALLY

````text
You are writing one small arcade game that will run inside a cabinet in my PC game, "Space Arms Dealer" (a retro-futuristic space shop sim built with Electron, Phaser 3 and plain modern JavaScript). Players buy the cabinet for their shop and can walk up and play it. The shop runs your game through the contract below, so following it exactly matters more than anything else.

=== WHAT TO HAND BACK ===
Exactly one file, `js/arcade/games/nebula-rally.js`, as a single code block. Plain JavaScript ES2022 module, no TypeScript, no build step. Its default export is the game object described in the contract. No other exports are needed.

=== HARD RULES (the game will be rejected if any are broken) ===
1. Zero imports. Zero dependencies. No image, sound, font or data files: draw everything with canvas 2D calls (rectangles, paths, arcs, fillText) and make every sound with the Web Audio API.
2. Draw only on `host.context`. The screen is always 320x240 pixels; the shop scales it up with nearest-neighbor, so use crisp, chunky pixel-art shapes, whole-pixel positions, and the canvas default "monospace" font at sizes 8, 10 or 16. Never resize the canvas, never touch any other DOM element, never use CSS.
3. Never call requestAnimationFrame, setTimeout or setInterval for game logic. The shop calls `update(seconds)` then `render()` every frame. All movement and timers must be based on `seconds` so the game runs the same at any frame rate.
4. Never add event listeners (no keydown, no gamepad API). Read controls only with `host.readPad(1)` and `host.readPad(2)`, which return the buttons each player is holding right now. Detect a fresh press yourself by comparing with the previous frame. The shop maps keyboards and controllers to these buttons.
5. Every sound connects to `host.audioOutput`, never to `audioContext.destination`. Never create, close or suspend an AudioContext. `pause()` and `destroy()` must silence everything immediately (stop or disconnect all oscillators and the music loop). In "attract" mode the game is completely silent.
6. Never use localStorage, fetch, eval, Math.random or Date.now. Use `host.random()` for randomness. Save high scores only through `host.saveHighScore`.
7. Call `host.gameOver(result)` exactly once at the end of each match, after any high-score entry is done. Call `host.exit()` when the player chooses to leave from the title screen (pressing B there).
8. No global variables, no top-level side effects. Everything lives inside `create()`, so two cabinets can run two copies at once without interfering.
9. Keep it under about 1200 lines, readable, with short comments only where something is not obvious.

=== CONTRACT (this is the shop's real code; match it exactly) ===
```js
export const ARCADE_SCREEN = Object.freeze({ width: 320, height: 240 });

export const ARCADE_BUTTONS = Object.freeze(["up", "down", "left", "right", "a", "b", "start"]);

/**
 * @typedef {object} ArcadePad
 * Which buttons one player is holding right now.
 * @property {boolean} up
 * @property {boolean} down
 * @property {boolean} left
 * @property {boolean} right
 * @property {boolean} a
 * @property {boolean} b
 * @property {boolean} start
 */

/**
 * @typedef {object} ArcadeHighScore
 * @property {string} initials - exactly 3 characters, A-Z or space
 * @property {number} score - points, or milliseconds when the game's scoreType is "time"
 */

/**
 * @typedef {object} ArcadeResult
 * @property {"1p" | "2p"} mode
 * @property {0 | 1 | 2} winner - 0 for a draw, or when the computer won a 1p match
 * @property {[number, number]} scores - player 1, player 2 (the computer's score in 1p)
 */

/**
 * @typedef {object} ArcadeHost
 * @property {HTMLCanvasElement} canvas - always ARCADE_SCREEN sized; the host scales it up
 * @property {CanvasRenderingContext2D} context - 2D context of that canvas, smoothing off
 * @property {(player: 1 | 2) => ArcadePad} readPad - fresh button state for a player
 * @property {AudioContext} audioContext - shared; the game must never close or suspend it
 * @property {AudioNode} audioOutput - connect every sound here, never to audioContext.destination
 * @property {() => ArcadeHighScore[]} getHighScores - saved table, best first, at most 5 rows
 * @property {(score: number) => boolean} isHighScore - would this score enter the table?
 * @property {(entry: ArcadeHighScore) => void} saveHighScore
 * @property {(result: ArcadeResult) => void} gameOver - call once when a match ends
 * @property {() => void} exit - the player chose to leave the cabinet
 * @property {() => number} random - use instead of Math.random (0 <= n < 1)
 */

/**
 * @typedef {object} ArcadeInstance
 * @property {(options: { mode: "attract" | "play" }) => void} start - "attract" is the idle demo
 *   shown on the cabinet's screen in the shop (computer plays itself, silent); "play" opens the
 *   game's own title screen where players pick 1 player or 2 players
 * @property {(seconds: number) => void} update - advance the game; seconds is at most 1/30
 * @property {() => void} render - draw the current frame onto host.context
 * @property {() => void} pause - freeze, and silence all sound
 * @property {() => void} resume
 * @property {() => void} destroy - stop every sound and release everything; never used again
 */

/**
 * @typedef {object} ArcadeGame
 * @property {string} id - lowercase-with-dashes, matches the file name
 * @property {string} title - shown on the cabinet
 * @property {"points" | "time"} scoreType - "time" means a lower score is better
 * @property {(host: ArcadeHost) => ArcadeInstance} create
 */
```

=== FLOW EVERY GAME MUST HAVE ===
Attract mode: `start({ mode: "attract" })` shows the game playing itself (computer controls both sides), looping forever, silent, with the title and the best high score drawn on top. This is what customers see on the cabinet screen in the shop, so make it look lively.
Play mode: `start({ mode: "play" })` opens a title screen with the game name, the high score table (top 5, from `host.getHighScores()`), and a choice of "1 PLAYER" (player 1 against the computer) or "2 PLAYERS". Up/down moves the choice, A or START confirms, B leaves (`host.exit()`). Player 2 can join from the title screen by pressing START on pad 2, which selects 2 PLAYERS.
During a match: show both players' scores at the top in their own colors (player 1 cyan, player 2 orange, computer opponent drawn in player 2's spot and labeled "CPU"). START pauses and unpauses the match inside the game, with a small "PAUSED" box.
End of match: show who won for about 3 seconds. Then for each human player whose score passes `host.isHighScore(score)`, run a classic 3-letter initials entry (up/down changes the letter, A confirms a letter, B goes back a letter), then `host.saveHighScore`. Then call `host.gameOver(...)` and return to the title screen.

=== SOUND AND MUSIC ===
Keep it very simple and chiptune. Sound effects: one short synthesized blip per important event (shoot, hit, explosion, pickup, menu move, menu confirm), each well under half a second, built from an oscillator or a short noise buffer with a quick volume fade. Music: one short looping tune (8 to 16 bars) on two voices (a square-wave melody and a triangle-wave bass), scheduled a little ahead on the audio clock from inside `update()`. Music plays on the title screen and during matches, a short jingle plays at match end. Keep everything quiet: no single sound above a gain of 0.15, music around 0.06.

=== LOOK ===
Retro sci-fi arcade, dark space-blue background, a limited palette of about 12 bright colors, thick readable pixel shapes. It should read clearly even when the cabinet screen is small in the shop.

=== THE GAME ===
Name: NEBULA RALLY. id: "nebula-rally". scoreType: "time" (the score is the finishing race time in whole milliseconds, lower is better; the high score table holds the best race times).
A top-down racing game with two hover-racers on the same screen, like classic overhead arcade racers. The whole track fits on one 320x240 screen (no scrolling), viewed from above.
3 hand-designed tracks, each a closed loop made of a list of points (the track's center line) with a fixed width, drawn as a road with bright edge lines, plus asteroid and space-debris decoration outside the road. The match picks the next track each time.
Two racers (player 1 cyan, player 2 orange), small arrow-like hover cars about 8x12 pixels, drawn rotated. Controls: left/right steer, A accelerates, B brakes and reverses. Simple floaty physics: momentum, a bit of drift when turning fast, slower off the road. Racers bump each other on contact.
Each race is 3 laps. Laps are counted with checkpoints along the track so cutting corners doesn't count. Show current lap, the race timer, and each racer's best lap. A big "3, 2, 1, GO" countdown starts each race.
Boost pads on the track give a short speed burst. Each racer also has one boost per lap, fired by double-tapping A.
The race ends when both racers finish, or 15 seconds after the first one finishes. The winner is whoever finished first. Each human's score is their total race time in milliseconds (a racer that did not finish gets no score and no high-score entry). Show the time on the high score table as minutes:seconds.hundredths.
In 1 PLAYER mode the computer drives the orange racer by steering toward a point a little ahead on the track's center line, slowing for sharp corners. Make it close but beatable by a player who takes good lines.
Sound: an engine hum per racer whose pitch follows its speed (two quiet oscillators), a bump sound, a boost whoosh made from noise, a beep for each countdown number and a higher beep for GO, and a lap chime.
````
