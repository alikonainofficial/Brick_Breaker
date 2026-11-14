/*
 * game.js — Brick Breaker. Loads after js/arcade-shell.js and js/levels.js.
 * A 3-ball, scored, levelled Breakout on the shared arcade shell.
 */
(function () {
  'use strict';

  var W = 800, H = 600;

  var PADDLE_WIDTH = 100, PADDLE_HEIGHT = 10, PADDLE_Y = 540, PADDLE_SPEED = 600;
  var BRICK_W = 80, BRICK_H = 20, BRICK_GAP = 2, BRICK_COLS = 10, BRICK_ROWS = 11, BRICK_TOP = 60;
  var BALL_R = 10, BALL_SPEED = 320, BALL_SPEED_MAX = 560;
  var MIN_VY_RATIO = 0.25;     // keeps the ball from bouncing nearly horizontally forever
  var LAUNCH_ANGLE = Math.PI / 3; // 60°
  var LOSE_PAUSE = 0.6;        // seconds between losing a ball and the next ready phase
  var LEVEL_BONUS = 500, LIFE_BONUS = 100;
  var START_LIVES = 3;
  var BRICK_FLASH = 60, PADDLE_SQUASH = 80; // ms
  var TRAIL_LEN = 8;

  var T = Arcade.theme;
  var BRICK_COLORS = { '1': T.coral, '2': T.brass, '3': T.cyan, '4': T.magenta, 'P': T.green };

  // ------------------------------------------------------------ state
  var phase = 'ready'; // 'ready' | 'play' | 'lost' | 'levelClear' | 'over'
  var lives = START_LIVES, score = 0, combo = 0, maxCombo = 0, level = 1, bricksLeft = 0;
  var ballSpeed = BALL_SPEED;
  var lostTimer = 0;
  var firstStart = true;
  var bestScore = 0; // read after Arcade.init sets the storage namespace

  var paddleX = (W - PADDLE_WIDTH) / 2;
  var paddleDir = 1; // last paddle movement direction (-1 left, 1 right)
  var ball = { x: W / 2, y: PADDLE_Y - BALL_R, vx: 0, vy: 0 };
  var bricks = new Array(BRICK_COLS * BRICK_ROWS); // null or {hp, maxHp, color, power, flashUntil}
  var brokenFlashes = [];   // {x, y, w, h, until} — white ghost of a brick that just broke
  var squashUntil = 0;      // paddle squash animation end time
  var trail = [];           // last TRAIL_LEN ball positions
  var reducedMotion = false;
  try {
    var rmq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (rmq) { reducedMotion = rmq.matches; if (rmq.addEventListener) rmq.addEventListener('change', function (e) { reducedMotion = e.matches; }); }
  } catch (e) { /* no matchMedia */ }

  // ------------------------------------------------------------ setup
  Arcade.init({ game: 'brick-breaker', title: 'Brick Breaker', onRestart: startGame });
  bestScore = Arcade.store.get('best', 0) || 0;
  Arcade.input.capture(['ArrowLeft', 'ArrowRight', 'Space']);
  Arcade.input.onPointerMove(function (p) { movePaddleTo(p.x - PADDLE_WIDTH / 2); });
  Arcade.touch.buttons([{ label: '◀', code: 'ArrowLeft' }, { label: '▶', code: 'ArrowRight' }], 'left');
  Arcade.touch.buttons([{ label: 'GO', code: 'Space' }], 'right');

  startGame();
  Arcade.loop(update, draw);

  // ------------------------------------------------------------ helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function now() { return performance.now(); }
  function shake(amp, ms) { if (!reducedMotion) Arcade.fx.shake(amp, ms); }
  function hitstop(ms) { if (!reducedMotion) Arcade.fx.hitstop(ms); }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function coral(s) { return '<span style="color:' + T.coral + '">' + s + '</span>'; }
  function tileIndex(col, row) { return col + BRICK_COLS * row; }
  function brickX(col) { return col * BRICK_W; }
  function brickY(row) { return BRICK_TOP + row * BRICK_H; }
  function shareString() {
    return '🧱 Brick Breaker · ' + fmt(score) + ' pts · level ' + level + ' · best combo ×' + maxCombo;
  }

  // ------------------------------------------------------------ game flow
  function startGame() {
    lives = START_LIVES; score = 0; combo = 0; maxCombo = 0; level = 1;
    paddleX = (W - PADDLE_WIDTH) / 2; paddleDir = 1;
    loadLevel(level);
    enterReady();
    if (firstStart) {
      firstStart = false;
      Arcade.ui.overlay({
        title: 'Brick Breaker',
        lines: ['Move: mouse, arrows or drag', 'Launch: Space or tap'],
        hint: 'Press Space',
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
    brokenFlashes = [];
  }

  function enterReady() {
    phase = 'ready';
    combo = 0;
    ball.vx = 0; ball.vy = 0;
    ball.x = paddleX + PADDLE_WIDTH / 2; ball.y = PADDLE_Y - BALL_R;
    trail = [];
  }

  function launch() {
    if (phase !== 'ready') return;
    phase = 'play';
    ball.vx = Math.cos(LAUNCH_ANGLE) * ballSpeed * paddleDir;
    ball.vy = -Math.sin(LAUNCH_ANGLE) * ballSpeed;
  }

  function loseBall() {
    lives--;
    combo = 0;
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
    Arcade.ui.overlay({
      title: 'Level ' + level + ' clear',
      lines: ['+' + LEVEL_BONUS + ' level bonus', '+' + LIFE_BONUS + ' × ' + lives + ' lives = +' + (LIFE_BONUS * lives)],
      hint: 'Space for level ' + (level + 1),
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
    Arcade.ui.overlay({
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
      hint: 'Space to play again',
      action: function () { Arcade.restart(); }
    });
  }

  // ------------------------------------------------------------ update
  function update(dt) {
    updatePaddle(dt);
    var inp = Arcade.input;
    switch (phase) {
      case 'ready':
        ball.x = paddleX + PADDLE_WIDTH / 2; ball.y = PADDLE_Y - BALL_R;
        if (inp.wasPressed('Space') || inp.pointer.justDown) launch();
        break;
      case 'play':
        updateBall(dt);
        trail.push({ x: ball.x, y: ball.y });
        if (trail.length > TRAIL_LEN) trail.shift();
        if (phase === 'play' && bricksLeft <= 0) levelClear();
        break;
      case 'lost':
        lostTimer -= dt;
        if (lostTimer <= 0) { if (lives > 0) enterReady(); else gameOver(); }
        break;
    }
    updateHud();
  }

  function movePaddleTo(x) {
    var nx = clamp(x, 0, W - PADDLE_WIDTH);
    if (nx !== paddleX) paddleDir = nx > paddleX ? 1 : -1;
    paddleX = nx;
  }

  function updatePaddle(dt) {
    var inp = Arcade.input, dx = 0;
    if (inp.isDown('ArrowLeft') || inp.isDown('KeyA')) dx -= 1;
    if (inp.isDown('ArrowRight') || inp.isDown('KeyD')) dx += 1;
    if (dx !== 0 && !inp.pointer.down) movePaddleTo(paddleX + dx * PADDLE_SPEED * dt);
  }

  // Move in sub-steps so a fast ball never tunnels through a brick or the paddle.
  function updateBall(dt) {
    var speed = Math.hypot(ball.vx, ball.vy);
    var steps = Math.max(1, Math.ceil((speed * dt) / (BALL_R * 0.5)));
    var sdt = dt / steps;
    for (var i = 0; i < steps; i++) {
      if (stepBall(sdt)) break; // ball lost this step
    }
  }

  function stepBall(dt) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    collideBricks();

    // walls
    if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); Arcade.sfx.play('tick'); }
    if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); Arcade.sfx.play('tick'); }
    if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); Arcade.sfx.play('tick'); }

    // paddle
    if (ball.vy > 0 && ball.y + BALL_R >= PADDLE_Y && ball.y - BALL_R <= PADDLE_Y + PADDLE_HEIGHT &&
        ball.x + BALL_R > paddleX && ball.x - BALL_R < paddleX + PADDLE_WIDTH) {
      ball.y = PADDLE_Y - BALL_R;
      bounceOffPaddle();
      combo = 0;
      squashUntil = now() + PADDLE_SQUASH;
      Arcade.sfx.play('bounce');
      return false;
    }

    // lost
    if (ball.y - BALL_R > H) { loseBall(); return true; }
    return false;
  }

  // Outgoing angle depends on where the ball hits the paddle; magnitude stays at ballSpeed.
  function bounceOffPaddle() {
    var deltaX = ball.x - (paddleX + PADDLE_WIDTH / 2);
    var vx = deltaX * 10.5, vy = -Math.abs(ball.vy) || -1;
    var mag = Math.hypot(vx, vy) || 1;
    vx = vx / mag * ballSpeed; vy = vy / mag * ballSpeed;
    if (-vy < ballSpeed * MIN_VY_RATIO) { // too flat: steepen while keeping direction
      vy = -ballSpeed * MIN_VY_RATIO;
      vx = (vx < 0 ? -1 : 1) * Math.sqrt(ballSpeed * ballSpeed - vy * vy);
    }
    ball.vx = vx; ball.vy = vy;
  }

  // Test the ball's leading edge points (the side it is travelling toward) against the grid:
  // the right point when moving right, the bottom point when moving down, and so on. A hit
  // on a horizontal point flips vx, on a vertical point flips vy — so a ball coming from the
  // left of a brick bounces back left, one from above bounces back up.
  function collideBricks() {
    var hitX = false, hitY = false;
    if (ball.vx > 0 && hitBrickAt(ball.x + BALL_R, ball.y)) hitX = true;
    else if (ball.vx < 0 && hitBrickAt(ball.x - BALL_R, ball.y)) hitX = true;
    if (ball.vy > 0 && hitBrickAt(ball.x, ball.y + BALL_R)) hitY = true;
    else if (ball.vy < 0 && hitBrickAt(ball.x, ball.y - BALL_R)) hitY = true;
    if (hitX) ball.vx = -ball.vx;
    if (hitY) ball.vy = -ball.vy;
  }

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
    return true;
  }

  // ------------------------------------------------------------ hud
  function updateHud() {
    var scoreV = fmt(score) + (combo >= 2 ? ' ' + coral('×' + combo) : '');
    var bricksV = bricksLeft <= 3 ? coral(bricksLeft) : bricksLeft;
    Arcade.ui.hud({
      Score: scoreV,
      Best: fmt(Math.max(bestScore, score)),
      Level: level,
      Lives: '●'.repeat(Math.max(0, lives)),
      'Bricks left': bricksV
    });
  }

  // ------------------------------------------------------------ draw
  function draw(c) {
    c.fillStyle = T.black;
    c.fillRect(0, 0, W, H);
    drawBricks(c);
    drawPaddle(c, paddleX, PADDLE_WIDTH);
    if (phase !== 'lost') {
      drawTrail(c);
      c.fillStyle = T.text;
      c.beginPath();
      c.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      c.fill();
    }
    if (phase === 'ready' && !Arcade.ui.overlayVisible()) {
      Arcade.ui.text(c, 'Space or tap to launch', W / 2, PADDLE_Y - 40, { align: 'center', color: T.muted, size: 16 });
    }
  }

  // Paddle squashes (wider, flatter) for a moment after a hit.
  function drawPaddle(c, x, w) {
    var t = now(), pw = w, ph = PADDLE_HEIGHT;
    if (t < squashUntil) { pw = w * 1.1; ph = PADDLE_HEIGHT * 0.7; }
    c.fillStyle = T.text;
    c.fillRect(x + (w - pw) / 2, PADDLE_Y + (PADDLE_HEIGHT - ph), pw, ph);
  }

  function drawTrail(c) {
    var n = trail.length;
    for (var i = 0; i < n; i++) {
      var k = (i + 1) / (n + 1); // oldest → faintest/smallest
      c.globalAlpha = 0.35 * k;
      c.fillStyle = T.text;
      c.beginPath();
      c.arc(trail[i].x, trail[i].y, BALL_R * (0.3 + 0.6 * k), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
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
        bricksLeft: bricksLeft, ballSpeed: ballSpeed, reducedMotion: reducedMotion, maxBrickHp: bricks.reduce(function (m, b) { return b && b.maxHp > m ? b.maxHp : m; }, 0),
        ball: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy }, paddleX: paddleX };
    },
    share: shareString,
    debug: {
      clearLevel: function () { for (var i = 0; i < bricks.length; i++) bricks[i] = null; bricksLeft = 0; },
      loseBall: function () { if (phase === 'play') loseBall(); },
      setBall: function (x, y, vx, vy) { ball.x = x; ball.y = y; ball.vx = vx; ball.vy = vy; }
    }
  };
})();
