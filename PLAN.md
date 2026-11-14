# Brick Breaker — implementation plan

Repo: `alikonainofficial/Brick_Breaker` · Live: `https://alikonainofficial.github.io/Brick_Breaker/` · Game id for storage: `brick-breaker`

## 0. What the repo is today

A single `index.html` (~230 lines) with inline JS: an 800×600 canvas, a `setInterval` loop at 30 fps, a 10×14 brick grid (`BRICK_W 80`, `BRICK_H 20`, `BRICK_GAP 2`) filled 50% at random with the top 3 rows cleared, a ball (`ballSpeedX 10`, `ballSpeedY 4` px/frame), a 100×10 mouse-controlled paddle at `PADDLE_Y 540`, and a win screen that shows when `brickCounter == 0` **and** the ball next hits the paddle, dismissed by a click.

Known defects:

- Unlimited lives: a missed ball silently calls `ballReset()`. No score, no levels, no speed ramp, no sound, no feedback on a brick hit.
- Random layouts have no shape.
- Collision tests the ball's centre point only (`breakAndBounceOffBrickAtPixelCoord`), so at 10 px/frame it can clip brick corners.
- `calculateMousePosition` reads `evt.clienY` (typo; `y` unused). `colorRect` passes `color` as a 5th arg to `fillRect` (ignored).
- Mouse only.

## 1. Target

A 3-ball, scored, levelled Breakout with a combo multiplier, designed layouts, power-ups, and the full "juice" layer. Three-minute runs that end in a results overlay with best score and a copyable line. Keyboard, mouse and touch.

## 2. File layout after

```
index.html            canvas + script/link tags only
css/arcade-shell.css  (copied, unmodified)
css/game.css          (optional, game-specific tweaks)
js/arcade-shell.js    (copied, unmodified)
js/levels.js          LEVELS array (designed grids)
js/game.js            all game code
```

## 3. Steps (in order; verify each in the browser before the next)

### Step 1 — Move to the shell, keep the game identical
1. Copy `arcade-shell.js` → `js/`, `arcade-shell.css` → `css/`. Rewrite `index.html` to: `<link rel="stylesheet" href="css/arcade-shell.css">`, `<canvas id="gameCanvas" width="800" height="600">`, `<script src="js/arcade-shell.js">`, `<script src="js/levels.js">`, `<script src="js/game.js">`.
2. Move the inline JS into `js/game.js`. Replace `window.onload` + `setInterval` with `Arcade.init({ game: 'brick-breaker', title: 'Brick Breaker', onRestart: startGame })` and `Arcade.loop(update, draw)`.
3. Convert speeds to px/s: ball speed becomes a vector with magnitude `BALL_SPEED = 320` (was ~10.8 px/frame · 30). Paddle follows `Arcade.input.pointer.x` (already in canvas coordinates) and, when no pointer is active, `ArrowLeft/ArrowRight` / `KeyA/KeyD` at `PADDLE_SPEED = 600` px/s. Call `Arcade.input.capture(['ArrowLeft','ArrowRight','Space'])`.
4. Fix the collision: test the four edge points of the ball (`x±r, y` and `x, y±r`) against the grid instead of the centre; keep the existing "which side did I come from" logic. Move the ball in sub-steps when `speed·dt > r` so it never tunnels.
5. Mobile: `Arcade.touch.buttons([{label:'◀', code:'ArrowLeft'},{label:'▶', code:'ArrowRight'}], 'left')` and `[{label:'GO', code:'Space'}]` on the right. Dragging on the canvas also moves the paddle (pointer already does this).

Acceptance: plays exactly as before but at 60+ fps, `R` restarts, `P` pauses, works on a phone.

### Step 2 — Lives, score, combo, levels, results
1. State: `lives = 3`, `score = 0`, `combo = 0`, `level = 1`, `bricksLeft`, `phase: 'ready' | 'play' | 'levelClear' | 'over'`.
2. **Ready phase:** ball sits on the paddle, follows it; Space / tap / click launches it at a 60° angle in the direction of the last paddle movement. Overlay at the very first start: title "Brick Breaker", lines "Move: mouse, arrows or drag", "Launch: Space or tap", hint "Press Space".
3. **Scoring:** each brick = `10 × (1 + combo)`, `combo` increments per brick broken since the last paddle contact and resets to 0 on paddle contact or ball loss. Show `combo` as "×3" next to the score while `combo ≥ 2`.
4. **Ball loss:** `lives--`, `Arcade.sfx.play('lose')`, `Arcade.fx.shake(6, 200)`, 600 ms pause, back to ready phase. At 0 lives → `phase = 'over'`.
5. **Level clear** when `bricksLeft == 0`: `Arcade.sfx.play('win')`, flash, overlay "Level 3 clear" with `+500` bonus and `+100 × livesLeft`, Space → next level. Ball speed = `320 × (1 + 0.05 × (level−1))`, capped at 560.
6. **Levels:** `js/levels.js` exports `LEVELS`, an array of 8 string grids, 10 columns × up to 11 rows, chars: `.` empty, `1`–`4` brick colour row (also = hit points? keep 1 hp for all except `4` = 2 hp, drawn darker until hit once), `P` brick that always drops a power-up. Author at least: a solid block, a diamond, a heart, two columns with a gap, a space-invader, your initials "AK", a checkerboard, a "fortress" with 2-hp walls. After level 8, loop with +1 hp on `4` bricks and +5% speed.
7. **HUD** via `Arcade.ui.hud({ Score, Best, Level, Lives: '●'.repeat(lives), 'Bricks left': bricksLeft })`. Show "Bricks left" in coral when ≤ 3.
8. **Results overlay** on game over: kicker "Game over", title = score, lines: "Best: N" (or "New best!" in coral when `Arcade.store.best('best', score).isNew`), "Level N · longest combo ×M", buttons: "Play again" (restart), "Copy result" → `Arcade.share.copy('🧱 Brick Breaker · 4,320 pts · level 5 · best combo ×7')`. Space = play again. Also `Arcade.store.bumpPlays()` and `Arcade.store.set('lastScore', score)`.

Acceptance: a full run from first launch to game over with all overlays; best survives reload; copy works.

### Step 3 — Juice
Do all of these; each is a few lines with the shell:
1. Brick hit: `Arcade.fx.burst(bx, by, { color: brickColor, count: 8, speed: 220, life: 0.45 })`, draw the brick white for 60 ms (keep a `flashUntil` per brick), `Arcade.sfx.play('hit', combo)` (pitch rises with the combo), `Arcade.fx.hitstop(combo >= 3 ? 40 : 20)`, `Arcade.fx.shake(1 + Math.min(combo, 6) * 0.5, 100)`.
2. Paddle hit: squash the paddle (draw it 110% wide / 70% high for 80 ms), `Arcade.sfx.play('bounce')`.
3. Wall hit: `Arcade.sfx.play('tick')`.
4. Ball trail: keep the last 8 positions, draw them with decreasing alpha and radius.
5. Brick colours by row from `Arcade.theme`: `coral, brass, cyan, magenta, green` cycling; 2-hp bricks drawn in `surface2` with a 1-px `line` border until first hit.
6. Level-clear: `Arcade.fx.flash('rgba(226,187,110,0.5)', 250)` and a burst at every remaining power-up position.
7. Respect `prefers-reduced-motion`: if `matchMedia('(prefers-reduced-motion: reduce)').matches`, skip shake and hitstop (keep flashes and sound).

Acceptance: the "before/after" is obvious; shake never exceeds a few pixels and decays within 150 ms.

### Step 4 — Power-ups
1. 12% of bricks (plus every `P` brick) drop a capsule: 24×12 rect falling at 140 px/s, letter inside, colour per type. Catch it with the paddle to activate; miss = gone.
2. Types and durations: `W` wide paddle (150 px, 15 s), `M` multiball (spawn 2 extra balls at ±30° from the current ball; no timer; the level continues as long as one ball is alive, a lost extra ball does not cost a life), `S` slow (speed ×0.7, 10 s), `C` catch (ball sticks to the paddle on contact, Space releases, 12 s), `L` laser (Space fires two 4-px bolts at 500 px/s from the paddle ends every 400 ms, bolts break the first brick they touch, 10 s).
3. One timed power-up at a time; picking a new one replaces the old. Show the active one in the HUD as `'Power': 'Wide 12s'` and draw a thin timer bar under the paddle.
4. Weighting: W 30%, M 20%, S 20%, C 15%, L 15%. On catch: `Arcade.sfx.play('pickup')`, small burst in the capsule colour.

Acceptance: each power-up visibly works and expires; multiball + wide at once is chaotic but survivable.

### Step 5 — Polish and ship
- `index.html` `<title>Brick Breaker</title>`; remove dead code (`checkForAndremoveBrickAtPixelCoord`, the typo'd mouse function).
- README: controls, scoring, power-ups, and "scores are stored only in your browser".
- Test on Chrome, Safari, Firefox, and a phone (touch buttons appear, drag moves paddle).
- Commit per step; push to `master` (GitHub Pages serves it).

## 4. Data formats (do not change — the portfolio reads them)

- `arcade.brick-breaker.best` → number (highest score)
- `arcade.brick-breaker.plays` → number
- `arcade.brick-breaker.lastScore` → number
- Share string: `🧱 Brick Breaker · {score} pts · level {level} · best combo ×{combo}`

## 5. Test checklist

- [ ] No console errors on load, during play, on game over
- [ ] 60 fps; ball never passes through a brick or the paddle at max speed
- [ ] Mouse, arrows, A/D and touch drag all move the paddle; Space/tap launches
- [ ] Combo pitch rises and resets on paddle contact
- [ ] Losing all 3 balls shows results; "New best!" only when it is
- [ ] Level 8 → level 9 loops with harder bricks
- [ ] `R` restarts mid-game instantly; `P`/`Esc` pauses; tab switch pauses
- [ ] Copy result puts the exact share string on the clipboard and shows a toast
- [ ] Reduced-motion: no shake/hitstop
