/*
 * game.js — Brick Breaker. Loads after js/arcade-shell.js and js/levels.js.
 * A 3-ball, scored, levelled Breakout with combos, designed layouts, power-ups
 * and the shell's juice layer. Plain script, no build step.
 */
(function () {
  'use strict';

  var W = 800, H = 600;

  var PADDLE_WIDTH = 100, PADDLE_WIDE = 150, PADDLE_HEIGHT = 10, PADDLE_Y = 540, PADDLE_SPEED = 600;
  var BRICK_W = 80, BRICK_H = 20, BRICK_GAP = 2, BRICK_COLS = 10, BRICK_ROWS = 11, BRICK_TOP = 60;
  var BALL_R = 10, BALL_SPEED = 320, BALL_SPEED_MAX = 560;
  var MIN_VY_RATIO = 0.25;        // keeps the ball from bouncing nearly horizontally forever
  var LAUNCH_ANGLE = Math.PI / 3; // 60°
  var LOSE_PAUSE = 0.6;           // seconds between losing a ball and the next ready phase
  var LEVEL_BONUS = 500, LIFE_BONUS = 100;
  var START_LIVES = 3;
  var BRICK_FLASH = 60, PADDLE_SQUASH = 80; // ms
  var TRAIL_LEN = 8;

  // power-ups
  var CAPSULE_W = 24, CAPSULE_H = 12, CAPSULE_SPEED = 140, DROP_CHANCE = 0.12;
  var SLOW_FACTOR = 0.7, LASER_SPEED = 500, LASER_COOLDOWN = 0.4, BOLT_W = 4, BOLT_H = 12;
  var POWERS = {
    W: { name: 'Wide',  weight: 30, duration: 15 },
    M: { name: 'Multi', weight: 20, duration: 0 },
    S: { name: 'Slow',  weight: 20, duration: 10 },
    C: { name: 'Catch', weight: 15, duration: 12 },
    L: { name: 'Laser', weight: 15, duration: 10 }
  };

  var T = Arcade.theme;
  var BRICK_COLORS = { '1': T.coral, '2': T.brass, '3': T.cyan, '4': T.magenta, 'P': T.green };
  var POWER_COLORS = { W: T.brass, M: T.magenta, S: T.cyan, C: T.green, L: T.coral };

  // ------------------------------------------------------------ state
  var phase = 'ready'; // 'ready' | 'play' | 'lost' | 'levelClear' | 'over'
  var lives = START_LIVES, score = 0, combo = 0, maxCombo = 0, level = 1, bricksLeft = 0;
  var ballSpeed = BALL_SPEED;
  var lostTimer = 0;
  var firstStart = true;
  var bestScore = 0; // read after Arcade.init sets the storage namespace

  var paddleX = (W - PADDLE_WIDTH) / 2, paddleW = PADDLE_WIDTH;
  var paddleDir = 1; // last paddle movement direction (-1 left, 1 right)
  var balls = [];    // {x, y, vx, vy, trail: [], stuck: null | offset from paddleX}
  var bricks = new Array(BRICK_COLS * BRICK_ROWS); // null or {hp, maxHp, color, power, flashUntil}
  var brokenFlashes = [];   // {x, y, w, h, until} — white ghost of a brick that just broke
  var squashUntil = 0;      // paddle squash animation end time
  var capsules = [];        // {x, y, type}
  var bolts = [];           // {x, y}
  var power = null;         // active timed power-up: {type, time, total}
  var laserCooldown = 0;
  var overlayAction = null; // action of the game overlay currently showing (see showOverlay)
  var overlayOpts = null;   // that overlay's options, so it can come back after a pause
  var swallowSpace = false; // the GO press that just closed an overlay must not also launch / fire
  var reducedMotion = false;
  try {
    var rmq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (rmq) { reducedMotion = rmq.matches; if (rmq.addEventListener) rmq.addEventListener('change', function (e) { reducedMotion = e.matches; }); }
  } catch (e) { /* no matchMedia */ }

  // ------------------------------------------------------------ setup
  Arcade.init({ game: 'brick-breaker', title: 'Brick Breaker', onRestart: startGame, onPauseChange: onPauseChange });
  bestScore = Arcade.store.get('best', 0) || 0;
  Arcade.input.capture(['ArrowLeft', 'ArrowRight', 'Space']);
  Arcade.input.onPointerMove(function (p) { movePaddleTo(p.x - paddleW / 2); });
  Arcade.touch.buttons([{ label: '◀', code: 'ArrowLeft' }, { label: '▶', code: 'ArrowRight' }], 'left');
  Arcade.touch.buttons([{ label: 'GO', code: 'Space', onDown: onGo }], 'right');

  // Wording for the controls this player actually has: touch buttons appear on coarse
  // pointers (the shell's own test), so phones get tap / GO / drag, desktops get keys / mouse.
  var TOUCH = Arcade.touch.isCoarse();
  var COPY = TOUCH ? {
    startLines: ['Move: drag or ◀ ▶', 'Launch: tap or GO'],
    startHint: 'Tap or press GO',
    launch: 'Tap or GO to launch',
    next: function (n) { return 'Tap or GO for level ' + n; },
    again: 'Tap or GO to play again'
  } : {
    startLines: ['Move: mouse, ← → or A D', 'Launch: Space or click', 'Pause: P · Restart: R'],
    startHint: 'Press Space or click',
    launch: 'Space or click to launch',
    next: function (n) { return 'Space for level ' + n; },
    again: 'Space to play again'
  };

  // The shell runs an overlay's action on Space/Enter or a tap on the backdrop; make a tap on the
  // text box itself count too, so phone players can tap anywhere to launch / continue.
  var overlayEl = document.querySelector('.arcade-overlay');
  if (overlayEl) {
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl || !overlayAction || Arcade.isPaused() || !Arcade.ui.overlayVisible()) return; // backdrop / pause box: the shell handles it
      if (e.target.closest && e.target.closest('button')) return;
      var a = overlayAction; overlayAction = null;
      Arcade.ui.hideOverlay(); a();
    });
  }

  startGame();
  Arcade.loop(update, draw);

  // ------------------------------------------------------------ helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function now() { return performance.now(); }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function coral(s) { return '<span style="color:' + T.coral + '">' + s + '</span>'; }
  function shake(amp, ms) { if (!reducedMotion) Arcade.fx.shake(amp, ms); }
  function hitstop(ms) { if (!reducedMotion) Arcade.fx.hitstop(ms); }
  function tileIndex(col, row) { return col + BRICK_COLS * row; }
  function brickX(col) { return col * BRICK_W; }
  function brickY(row) { return BRICK_TOP + row * BRICK_H; }
  function curSpeed() { return ballSpeed * (power && power.type === 'S' ? SLOW_FACTOR : 1); }
  function shareString() {
    return '🧱 Brick Breaker · ' + fmt(score) + ' pts · level ' + level + ' · best combo ×' + maxCombo;
  }
  function newBall(x, y, vx, vy) { return { x: x, y: y, vx: vx, vy: vy, trail: [], stuck: null }; }
  function showOverlay(o) {
    var a = o.action;
    overlayAction = a || null;
    overlayOpts = a ? o : null;
    if (a) o.action = function () { overlayAction = null; overlayOpts = null; a(); };
    Arcade.ui.overlay(o);
  }
  // The shell's pause overlay replaces ours and is hidden on resume; put ours back so a
  // tab switch during "Level clear" or "Game over" doesn't leave the game stuck without one.
  function onPauseChange(paused) {
    if (!paused && overlayAction && overlayOpts) Arcade.ui.overlay(overlayOpts);
  }

  // The GO touch button fakes a Space key straight into Arcade.input, which skips the shell's
  // keyboard handling of overlays. Give it the same meaning Space has on the keyboard: resume a
  // pause, or run the showing overlay's action (start, next level, play again) — and swallow
  // that press so it doesn't also launch the ball on the next frame.
  function onGo() {
    if (Arcade.isPaused()) { swallowSpace = true; Arcade.pause(false); return; }
    if (overlayAction && Arcade.ui.overlayVisible()) {
      var a = overlayAction; overlayAction = null; overlayOpts = null;
      swallowSpace = true;
      Arcade.ui.hideOverlay(); a();
    }
  }
  function spacePressed() { return Arcade.input.wasPressed('Space') && !swallowSpace; }

  // ------------------------------------------------------------ game flow
  function startGame() {
    overlayAction = null; overlayOpts = null;
    lives = START_LIVES; score = 0; combo = 0; maxCombo = 0; level = 1;
    paddleX = (W - PADDLE_WIDTH) / 2; paddleDir = 1;
    endPower();
    loadLevel(level);
    enterReady();
    if (firstStart) {
      firstStart = false;
      showOverlay({
        title: 'Brick Breaker',
        lines: COPY.startLines,
        hint: COPY.startHint,
        action: launch
      });
    }
  }

  function loadLevel(n) {
    var grid = LEVELS[(n - 1) % LEVELS.length];
    var loop = Math.floor((n - 1) / LEVELS.length); // 0 the first time through, 1 after level 8, ...
    bricksLeft = 0;
    for (var row = 0; row < BRICK_ROWS; row++) {
      var line = grid[row] || '';
      for (var col = 0; col < BRICK_COLS; col++) {
        var ch = line.charAt(col) || '.';
        if (ch === '.' || ch === '') { bricks[tileIndex(col, row)] = null; continue; }
        var hp = ch === '4' ? 2 + loop : 1;
        bricks[tileIndex(col, row)] = { hp: hp, maxHp: hp, color: BRICK_COLORS[ch] || T.text, power: ch === 'P', flashUntil: 0 };
        bricksLeft++;
      }
    }
    ballSpeed = Math.min(BALL_SPEED_MAX, BALL_SPEED * (1 + 0.05 * (n - 1)));
    brokenFlashes = []; capsules = []; bolts = [];
  }

  function enterReady() {
    phase = 'ready';
    combo = 0;
    balls = [newBall(paddleX + paddleW / 2, PADDLE_Y - BALL_R, 0, 0)];
  }

  function launch() {
    if (phase !== 'ready') return;
    phase = 'play';
    var b = balls[0], s = curSpeed();
    b.vx = Math.cos(LAUNCH_ANGLE) * s * paddleDir;
    b.vy = -Math.sin(LAUNCH_ANGLE) * s;
  }

  function loseBall() {
    lives--;
    combo = 0;
    endPower();
    capsules = []; bolts = [];
    Arcade.sfx.play('lose');
    shake(6, 200);
    phase = 'lost';
    lostTimer = LOSE_PAUSE;
  }

  function levelClear() {
    phase = 'levelClear';
    var bonus = LEVEL_BONUS + LIFE_BONUS * lives;
    score += bonus;
    Arcade.sfx.play('win');
    Arcade.fx.flash('rgba(226,187,110,0.5)', 250);
    capsules.forEach(function (cp) { Arcade.fx.burst(cp.x + CAPSULE_W / 2, cp.y + CAPSULE_H / 2, { color: POWER_COLORS[cp.type], count: 12, speed: 200, life: 0.5 }); });
    capsules = []; bolts = [];
    endPower();
    showOverlay({
      title: 'Level ' + level + ' clear',
      lines: ['+' + LEVEL_BONUS + ' level bonus', '+' + LIFE_BONUS + ' × ' + lives + ' lives = +' + (LIFE_BONUS * lives)],
      hint: COPY.next(level + 1),
      action: nextLevel
    });
  }

  function nextLevel() {
    level++;
    loadLevel(level);
    enterReady();
  }

  function gameOver() {
    phase = 'over';
    var r = Arcade.store.best('best', score);
    bestScore = r.best;
    Arcade.store.bumpPlays();
    Arcade.store.set('lastScore', score);
    showOverlay({
      kicker: 'Game over',
      title: fmt(score),
      lines: [
        r.isNew ? coral('New best!') : 'Best: ' + fmt(r.best),
        'Level ' + level + ' · longest combo ×' + maxCombo
      ],
      buttons: [
        { label: 'Play again', onClick: function () { Arcade.restart(); } },
        { label: 'Copy result', keepOpen: true, onClick: function () { Arcade.share.copy(shareString()); } }
      ],
      hint: COPY.again,
      action: function () { Arcade.restart(); }
    });
  }

  // ------------------------------------------------------------ power-ups
  function pickPowerType() {
    var total = 0, k;
    for (k in POWERS) total += POWERS[k].weight;
    var r = Math.random() * total;
    for (k in POWERS) { r -= POWERS[k].weight; if (r < 0) return k; }
    return 'W';
  }

  function spawnCapsule(x, y, type) {
    capsules.push({ x: x - CAPSULE_W / 2, y: y - CAPSULE_H / 2, type: type || pickPowerType() });
  }

  function activatePower(type) {
    var def = POWERS[type];
    if (type === 'M') { multiball(); return; }
    if (power && power.type !== type) endPower();           // a new timed power-up replaces the old one
    if (type === 'S' && !(power && power.type === 'S')) {   // slow down every ball once
      balls.forEach(function (b) { b.vx *= SLOW_FACTOR; b.vy *= SLOW_FACTOR; });
    }
    if (type === 'W') setPaddleWidth(PADDLE_WIDE);
    power = { type: type, time: def.duration, total: def.duration };
    laserCooldown = 0;
  }

  function endPower() {
    if (!power) return;
    var type = power.type;
    power = null;
    if (type === 'S') balls.forEach(function (b) { b.vx /= SLOW_FACTOR; b.vy /= SLOW_FACTOR; });
    if (type === 'W') setPaddleWidth(PADDLE_WIDTH);
    if (type === 'C') releaseStuck();
    bolts = [];
  }

  function setPaddleWidth(w) {
    var cx = paddleX + paddleW / 2;
    paddleW = w;
    paddleX = clamp(cx - w / 2, 0, W - w);
    balls.forEach(function (b) { if (b.stuck != null) b.stuck = clamp(b.stuck, BALL_R, paddleW - BALL_R); });
  }

  function multiball() {
    var src = null;
    for (var i = 0; i < balls.length; i++) { if (balls[i].stuck == null) { src = balls[i]; break; } }
    src = src || balls[0];
    if (!src) return;
    var s = curSpeed(), a0 = (src.stuck == null && (src.vx || src.vy)) ? Math.atan2(src.vy, src.vx) : -Math.PI / 2;
    [-Math.PI / 6, Math.PI / 6].forEach(function (da) {
      balls.push(newBall(src.x, src.y, Math.cos(a0 + da) * s, Math.sin(a0 + da) * s));
    });
  }

  function releaseStuck() {
    balls.forEach(function (b) {
      if (b.stuck == null) return;
      b.stuck = null;
      b.y = PADDLE_Y - BALL_R;
      b.vy = curSpeed(); // bounceOffPaddle flips this upward and sets the angle from the offset
      bounceOffPaddle(b);
    });
  }

  function fireLaser() {
    bolts.push({ x: paddleX + 4, y: PADDLE_Y - BOLT_H });
    bolts.push({ x: paddleX + paddleW - 4 - BOLT_W, y: PADDLE_Y - BOLT_H });
    laserCooldown = LASER_COOLDOWN;
    Arcade.sfx.play('tick');
  }

  function updatePowerUps(dt) {
    var inp = Arcade.input, i;
    var fire = spacePressed() || inp.pointer.justDown;

    // timer
    if (power) {
      power.time -= dt;
      if (power.time <= 0) endPower();
    }

    // catch: release on Space / tap
    if (fire) releaseStuck();

    // laser: Space (held or tapped) fires every LASER_COOLDOWN
    laserCooldown -= dt;
    if (power && power.type === 'L' && (fire || inp.isDown('Space')) && laserCooldown <= 0) fireLaser();
    for (i = bolts.length - 1; i >= 0; i--) {
      var bt = bolts[i];
      bt.y -= LASER_SPEED * dt;
      if (bt.y + BOLT_H < 0 || hitBrickAt(bt.x + BOLT_W / 2, bt.y)) bolts.splice(i, 1);
    }

    // capsules fall; paddle catches them
    for (i = capsules.length - 1; i >= 0; i--) {
      var cp = capsules[i];
      cp.y += CAPSULE_SPEED * dt;
      if (cp.y > H) { capsules.splice(i, 1); continue; }
      if (cp.y + CAPSULE_H >= PADDLE_Y && cp.y <= PADDLE_Y + PADDLE_HEIGHT && cp.x + CAPSULE_W > paddleX && cp.x < paddleX + paddleW) {
        capsules.splice(i, 1);
        Arcade.sfx.play('pickup');
        Arcade.fx.burst(cp.x + CAPSULE_W / 2, cp.y + CAPSULE_H / 2, { color: POWER_COLORS[cp.type], count: 10, speed: 160, life: 0.4, size: 2 });
        activatePower(cp.type);
      }
    }
  }

  // ------------------------------------------------------------ update
  function update(dt) {
    updatePaddle(dt);
    var inp = Arcade.input;
    switch (phase) {
      case 'ready':
        balls[0].x = paddleX + paddleW / 2; balls[0].y = PADDLE_Y - BALL_R;
        if (spacePressed() || inp.pointer.justDown) launch();
        break;
      case 'play':
        updateBalls(dt);
        if (phase === 'play') updatePowerUps(dt);
        if (phase === 'play' && bricksLeft <= 0) levelClear();
        break;
      case 'lost':
        lostTimer -= dt;
        if (lostTimer <= 0) { if (lives > 0) enterReady(); else gameOver(); }
        break;
    }
    swallowSpace = false;
    updateHud();
  }

  function movePaddleTo(x) {
    var nx = clamp(x, 0, W - paddleW);
    if (nx !== paddleX) paddleDir = nx > paddleX ? 1 : -1;
    paddleX = nx;
  }

  function updatePaddle(dt) {
    var inp = Arcade.input, dx = 0;
    if (inp.isDown('ArrowLeft') || inp.isDown('KeyA')) dx -= 1;
    if (inp.isDown('ArrowRight') || inp.isDown('KeyD')) dx += 1;
    if (dx !== 0 && !inp.pointer.down) movePaddleTo(paddleX + dx * PADDLE_SPEED * dt);
  }

  function updateBalls(dt) {
    for (var i = balls.length - 1; i >= 0; i--) {
      var b = balls[i];
      if (b.stuck != null) { b.x = paddleX + b.stuck; b.y = PADDLE_Y - BALL_R; continue; }
      if (moveBall(b, dt)) { balls.splice(i, 1); continue; } // fell out
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > TRAIL_LEN) b.trail.shift();
    }
    if (balls.length === 0) loseBall(); // a lost extra ball costs nothing; the last one costs a life
  }

  // Move in sub-steps so a fast ball never tunnels through a brick or the paddle. Returns true if lost.
  function moveBall(b, dt) {
    var speed = Math.hypot(b.vx, b.vy);
    var steps = Math.max(1, Math.ceil((speed * dt) / (BALL_R * 0.5)));
    var sdt = dt / steps;
    for (var i = 0; i < steps; i++) {
      if (stepBall(b, sdt)) return true;
      if (b.stuck != null) return false;
    }
    return false;
  }

  function stepBall(b, dt) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    collideBricks(b);

    // walls
    if (b.x + BALL_R > W) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); Arcade.sfx.play('tick'); }
    if (b.x - BALL_R < 0) { b.x = BALL_R; b.vx = Math.abs(b.vx); Arcade.sfx.play('tick'); }
    if (b.y - BALL_R < 0) { b.y = BALL_R; b.vy = Math.abs(b.vy); Arcade.sfx.play('tick'); }

    // paddle
    if (b.vy > 0 && b.y + BALL_R >= PADDLE_Y && b.y - BALL_R <= PADDLE_Y + PADDLE_HEIGHT &&
        b.x + BALL_R > paddleX && b.x - BALL_R < paddleX + paddleW) {
      b.y = PADDLE_Y - BALL_R;
      combo = 0;
      squashUntil = now() + PADDLE_SQUASH;
      Arcade.sfx.play('bounce');
      if (power && power.type === 'C') { b.stuck = clamp(b.x - paddleX, BALL_R, paddleW - BALL_R); b.vx = 0; b.vy = 0; }
      else bounceOffPaddle(b);
      return false;
    }

    // lost
    return b.y - BALL_R > H;
  }

  // Outgoing angle depends on where the ball hits the paddle; magnitude stays at the current speed.
  function bounceOffPaddle(b) {
    var s = curSpeed();
    var deltaX = b.x - (paddleX + paddleW / 2);
    var vx = deltaX * (10.5 * PADDLE_WIDTH / paddleW), vy = -Math.abs(b.vy) || -1;
    var mag = Math.hypot(vx, vy) || 1;
    vx = vx / mag * s; vy = vy / mag * s;
    if (-vy < s * MIN_VY_RATIO) { // too flat: steepen while keeping direction
      vy = -s * MIN_VY_RATIO;
      vx = (vx < 0 ? -1 : 1) * Math.sqrt(s * s - vy * vy);
    }
    b.vx = vx; b.vy = vy;
  }

  // Test the ball's leading edge points (the side it is travelling toward) against the grid:
  // the right point when moving right, the bottom point when moving down, and so on. A hit
  // on a horizontal point flips vx, on a vertical point flips vy — so a ball coming from the
  // left of a brick bounces back left, one from above bounces back up.
  function collideBricks(b) {
    var hitX = false, hitY = false;
    if (b.vx > 0 && hitBrickAt(b.x + BALL_R, b.y)) hitX = true;
    else if (b.vx < 0 && hitBrickAt(b.x - BALL_R, b.y)) hitX = true;
    if (b.vy > 0 && hitBrickAt(b.x, b.y + BALL_R)) hitY = true;
    else if (b.vy < 0 && hitBrickAt(b.x, b.y - BALL_R)) hitY = true;
    if (hitX) b.vx = -b.vx;
    if (hitY) b.vy = -b.vy;
  }

  // Damage the brick under canvas point (px, py). Returns true if there was one (ball/bolt should stop).
  function hitBrickAt(px, py) {
    var col = Math.floor(px / BRICK_W), row = Math.floor((py - BRICK_TOP) / BRICK_H);
    if (row < 0 || row >= BRICK_ROWS || col < 0 || col >= BRICK_COLS) return false;
    var idx = tileIndex(col, row), b = bricks[idx];
    if (!b) return false;
    var bx = brickX(col), by = brickY(row), bw = BRICK_W - BRICK_GAP, bh = BRICK_H - BRICK_GAP;
    var wasHard = b.maxHp > 1 && b.hp === b.maxHp;
    b.hp--;
    Arcade.sfx.play('hit', combo);
    hitstop(combo >= 3 ? 40 : 20);
    shake(1 + Math.min(combo, 6) * 0.5, 100);
    Arcade.fx.burst(bx + bw / 2, by + bh / 2, { color: wasHard ? T.line : b.color, count: 8, speed: 220, life: 0.45 });
    if (b.hp > 0) { b.flashUntil = now() + BRICK_FLASH; return true; } // dented, still there
    bricks[idx] = null;
    brokenFlashes.push({ x: bx, y: by, w: bw, h: bh, until: now() + BRICK_FLASH });
    bricksLeft--;
    score += 10 * (1 + combo);
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    if (b.power || Math.random() < DROP_CHANCE) spawnCapsule(bx + bw / 2, by + bh / 2);
    return true;
  }

  // ------------------------------------------------------------ hud
  function updateHud() {
    var items = {
      Score: fmt(score) + (combo >= 2 ? ' ' + coral('×' + combo) : ''),
      Best: fmt(Math.max(bestScore, score)),
      Level: level,
      Lives: '●'.repeat(Math.max(0, lives)),
      'Bricks left': bricksLeft <= 3 ? coral(bricksLeft) : bricksLeft
    };
    if (power) items.Power = POWERS[power.type].name + ' ' + Math.ceil(power.time) + 's';
    Arcade.ui.hud(items);
  }

  // ------------------------------------------------------------ draw
  function draw(c) {
    c.fillStyle = T.black;
    c.fillRect(0, 0, W, H);
    drawBricks(c);
    drawCapsules(c);
    drawBolts(c);
    drawPaddle(c);
    if (phase !== 'lost') {
      for (var i = 0; i < balls.length; i++) drawBall(c, balls[i]);
    }
    if (phase === 'ready' && !Arcade.ui.overlayVisible()) {
      Arcade.ui.text(c, COPY.launch, W / 2, PADDLE_Y - 40, { align: 'center', color: T.muted, size: 16 });
    }
  }

  // Paddle squashes (wider, flatter) for a moment after a hit; a thin bar under it times the power-up.
  function drawPaddle(c) {
    var t = now(), pw = paddleW, ph = PADDLE_HEIGHT;
    if (t < squashUntil) { pw = paddleW * 1.1; ph = PADDLE_HEIGHT * 0.7; }
    c.fillStyle = T.text;
    c.fillRect(paddleX + (paddleW - pw) / 2, PADDLE_Y + (PADDLE_HEIGHT - ph), pw, ph);
    if (power && power.total > 0) {
      c.fillStyle = POWER_COLORS[power.type];
      c.fillRect(paddleX, PADDLE_Y + PADDLE_HEIGHT + 4, paddleW * clamp(power.time / power.total, 0, 1), 3);
    }
  }

  function drawBall(c, b) {
    var n = b.trail.length;
    for (var i = 0; i < n; i++) {
      var k = (i + 1) / (n + 1); // oldest → faintest/smallest
      c.globalAlpha = 0.35 * k;
      c.fillStyle = T.text;
      c.beginPath();
      c.arc(b.trail[i].x, b.trail[i].y, BALL_R * (0.3 + 0.6 * k), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.fillStyle = T.text;
    c.beginPath();
    c.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    c.fill();
  }

  function drawCapsules(c) {
    for (var i = 0; i < capsules.length; i++) {
      var cp = capsules[i];
      c.fillStyle = POWER_COLORS[cp.type];
      c.fillRect(cp.x, cp.y, CAPSULE_W, CAPSULE_H);
      Arcade.ui.text(c, cp.type, cp.x + CAPSULE_W / 2, cp.y + CAPSULE_H / 2 + 1, { align: 'center', baseline: 'middle', size: 11, color: T.black });
    }
  }

  function drawBolts(c) {
    c.fillStyle = T.coral;
    for (var i = 0; i < bolts.length; i++) c.fillRect(bolts[i].x, bolts[i].y, BOLT_W, BOLT_H);
  }

  function drawBricks(c) {
    var t = now();
    for (var i = brokenFlashes.length - 1; i >= 0; i--) {
      var f = brokenFlashes[i];
      if (t >= f.until) { brokenFlashes.splice(i, 1); continue; }
      c.fillStyle = T.white; c.fillRect(f.x, f.y, f.w, f.h);
    }
    for (var row = 0; row < BRICK_ROWS; row++) {
      for (var col = 0; col < BRICK_COLS; col++) {
        var b = bricks[tileIndex(col, row)];
        if (!b) continue;
        var x = brickX(col), y = brickY(row), w = BRICK_W - BRICK_GAP, h = BRICK_H - BRICK_GAP;
        if (t < b.flashUntil) {
          c.fillStyle = T.white; c.fillRect(x, y, w, h);
        } else if (b.maxHp > 1 && b.hp === b.maxHp) { // hard brick, not yet dented
          c.fillStyle = T.surface2; c.fillRect(x, y, w, h);
          c.strokeStyle = T.line; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        } else {
          c.fillStyle = b.color; c.fillRect(x, y, w, h);
        }
        if (b.power) Arcade.ui.text(c, 'P', x + w / 2, y + h / 2, { align: 'center', baseline: 'middle', size: 14, color: T.black });
      }
    }
  }

  // ------------------------------------------------------------ debug hook (read-only snapshot + test helpers)
  window.BrickBreaker = {
    state: function () {
      return { phase: phase, lives: lives, score: score, combo: combo, maxCombo: maxCombo, level: level,
        bricksLeft: bricksLeft, ballSpeed: ballSpeed, reducedMotion: reducedMotion,
        maxBrickHp: bricks.reduce(function (m, b) { return b && b.maxHp > m ? b.maxHp : m; }, 0),
        balls: balls.map(function (b) { return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, stuck: b.stuck }; }),
        ball: balls[0] ? { x: balls[0].x, y: balls[0].y, vx: balls[0].vx, vy: balls[0].vy } : null,
        paddleX: paddleX, paddleW: paddleW, power: power ? { type: power.type, time: power.time } : null,
        capsules: capsules.map(function (cp) { return { x: cp.x, y: cp.y, type: cp.type }; }), bolts: bolts.length };
    },
    share: shareString,
    debug: {
      brickAt: function (px, py) { // read-only: is there a live brick under this canvas point?
        var col = Math.floor(px / BRICK_W), row = Math.floor((py - BRICK_TOP) / BRICK_H);
        if (row < 0 || row >= BRICK_ROWS || col < 0 || col >= BRICK_COLS) return false;
        var bx = brickX(col), by = brickY(row);
        return !!bricks[tileIndex(col, row)] && px < bx + BRICK_W - BRICK_GAP && py < by + BRICK_H - BRICK_GAP;
      },
      clearLevel: function () { for (var i = 0; i < bricks.length; i++) bricks[i] = null; bricksLeft = 0; },
      loseBall: function () { if (phase === 'play') loseBall(); },
      setBall: function (x, y, vx, vy) { var b = balls[0]; if (b) { b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.stuck = null; } },
      givePower: function (type) { activatePower(type); },
      spawnCapsule: function (type, x, y) { spawnCapsule(x == null ? paddleX + paddleW / 2 : x, y == null ? 400 : y, type); }
    }
  };
})();
