/*
 * game.js — Brick Breaker. Loads after js/arcade-shell.js and js/levels.js.
 * Step 1 of PLAN.md: the original game, moved onto the arcade shell (rAF loop,
 * px/s speeds, edge-point collision, keyboard + pointer + touch controls).
 */
(function () {
  'use strict';

  var W = 800, H = 600;

  var PADDLE_WIDTH = 100, PADDLE_HEIGHT = 10, PADDLE_Y = 540, PADDLE_SPEED = 600;
  var BRICK_W = 80, BRICK_H = 20, BRICK_GAP = 2, BRICK_COLS = 10, BRICK_ROWS = 14;
  var BALL_R = 10, BALL_SPEED = 320;
  var MIN_VY_RATIO = 0.25; // keeps the ball from bouncing nearly horizontally forever

  var paddleX = 350;
  var paddleDir = 1; // last paddle movement direction (-1 left, 1 right)
  var ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  var brickGrid = new Array(BRICK_COLS * BRICK_ROWS);
  var brickCounter = 0;
  var showingWinScreen = false;

  // ------------------------------------------------------------ setup
  Arcade.init({ game: 'brick-breaker', title: 'Brick Breaker', onRestart: startGame });
  Arcade.input.capture(['ArrowLeft', 'ArrowRight', 'Space']);
  Arcade.input.onPointerMove(function (p) {
    var nx = clamp(p.x - PADDLE_WIDTH / 2, 0, W - PADDLE_WIDTH);
    if (nx !== paddleX) paddleDir = nx > paddleX ? 1 : -1;
    paddleX = nx;
  });
  Arcade.touch.buttons([{ label: '◀', code: 'ArrowLeft' }, { label: '▶', code: 'ArrowRight' }], 'left');
  Arcade.touch.buttons([{ label: 'GO', code: 'Space' }], 'right');

  startGame();
  Arcade.loop(update, draw);

  // ------------------------------------------------------------ helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function brickTileToIndex(col, row) { return col + BRICK_COLS * row; }
  function isBrickAtTileCoord(col, row) { return brickGrid[brickTileToIndex(col, row)] === 1; }

  // ------------------------------------------------------------ game flow
  function startGame() {
    showingWinScreen = false;
    paddleX = 350;
    ball.vx = 0; ball.vy = 0;
    resetBricks();
    ballReset();
  }

  // The original launched at (10, 4) px/frame and flipped X on every reset.
  function ballReset() {
    var dirX = ball.vx > 0 ? -1 : ball.vx < 0 ? 1 : -1;
    var mag = Math.hypot(10, 4);
    ball.x = W / 2; ball.y = H / 2;
    ball.vx = dirX * (10 / mag) * BALL_SPEED;
    ball.vy = (4 / mag) * BALL_SPEED;
  }

  function resetBricks() {
    brickCounter = 0;
    for (var i = 0; i < BRICK_COLS * BRICK_ROWS; i++) {
      if (Math.floor(Math.random() * 10) < 5) { brickGrid[i] = 1; brickCounter++; }
      else brickGrid[i] = 0;
    }
    // top three rows cleared
    for (var col = 0; col < BRICK_COLS; col++) {
      for (var row = 0; row < 3; row++) {
        if (isBrickAtTileCoord(col, row)) { brickGrid[brickTileToIndex(col, row)] = 0; brickCounter--; }
      }
    }
  }

  function showWinScreen() {
    showingWinScreen = true;
    Arcade.ui.overlay({
      title: 'Well Done!',
      hint: 'Click or press Space to continue',
      action: function () { showingWinScreen = false; }
    });
  }

  // ------------------------------------------------------------ update
  function update(dt) {
    updatePaddle(dt);
    if (showingWinScreen) return;
    updateBall(dt);
  }

  function updatePaddle(dt) {
    var inp = Arcade.input, dx = 0;
    if (inp.isDown('ArrowLeft') || inp.isDown('KeyA')) dx -= 1;
    if (inp.isDown('ArrowRight') || inp.isDown('KeyD')) dx += 1;
    if (dx !== 0 && !inp.pointer.down) {
      paddleDir = dx;
      paddleX = clamp(paddleX + dx * PADDLE_SPEED * dt, 0, W - PADDLE_WIDTH);
    }
  }

  // Move in sub-steps so a fast ball never tunnels through a brick or the paddle.
  function updateBall(dt) {
    var speed = Math.hypot(ball.vx, ball.vy);
    var steps = Math.max(1, Math.ceil((speed * dt) / (BALL_R * 0.5)));
    var sdt = dt / steps;
    for (var i = 0; i < steps; i++) {
      if (stepBall(sdt)) break; // ball reset this step
    }
  }

  function stepBall(dt) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    collideBricks();

    // walls
    if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); }
    if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
    if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); }

    // paddle
    if (ball.vy > 0 && ball.y + BALL_R >= PADDLE_Y && ball.y - BALL_R <= PADDLE_Y + PADDLE_HEIGHT &&
        ball.x + BALL_R > paddleX && ball.x - BALL_R < paddleX + PADDLE_WIDTH) {
      ball.y = PADDLE_Y - BALL_R;
      bounceOffPaddle();
      if (brickCounter === 0) { resetBricks(); showWinScreen(); }
      return false;
    }

    // lost
    if (ball.y - BALL_R > H) { ballReset(); return true; }
    return false;
  }

  // Original: ballSpeedX = deltaX * 0.35 px/frame (= deltaX * 10.5 px/s); magnitude kept constant now.
  function bounceOffPaddle() {
    var deltaX = ball.x - (paddleX + PADDLE_WIDTH / 2);
    var vx = deltaX * 10.5, vy = -Math.abs(ball.vy);
    var mag = Math.hypot(vx, vy) || 1;
    vx = vx / mag * BALL_SPEED; vy = vy / mag * BALL_SPEED;
    if (-vy < BALL_SPEED * MIN_VY_RATIO) { // too flat: steepen while keeping direction
      vy = -BALL_SPEED * MIN_VY_RATIO;
      vx = Math.sign(vx || 1) * Math.sqrt(BALL_SPEED * BALL_SPEED - vy * vy);
    }
    ball.vx = vx; ball.vy = vy;
  }

  // Test the ball's leading edge points (the side it is travelling toward) against the grid:
  // the right point when moving right, the bottom point when moving down, and so on. A hit
  // on a horizontal point flips vx, on a vertical point flips vy — so a ball coming from the
  // left of a brick bounces back left, one from above bounces back up.
  function collideBricks() {
    var hitX = false, hitY = false;
    if (ball.vx > 0 && breakBrickAt(ball.x + BALL_R, ball.y)) { hitX = true; }
    else if (ball.vx < 0 && breakBrickAt(ball.x - BALL_R, ball.y)) { hitX = true; }
    if (ball.vy > 0 && breakBrickAt(ball.x, ball.y + BALL_R)) { hitY = true; }
    else if (ball.vy < 0 && breakBrickAt(ball.x, ball.y - BALL_R)) { hitY = true; }
    if (hitX) ball.vx = -ball.vx;
    if (hitY) ball.vy = -ball.vy;
  }

  function breakBrickAt(px, py) {
    var col = Math.floor(px / BRICK_W), row = Math.floor(py / BRICK_H);
    if (row < 0 || row >= BRICK_ROWS || col < 0 || col >= BRICK_COLS) return false;
    var idx = brickTileToIndex(col, row);
    if (brickGrid[idx] !== 1) return false;
    brickGrid[idx] = 0;
    brickCounter--;
    return true;
  }

  // ------------------------------------------------------------ draw
  function draw(c) {
    c.fillStyle = 'black';
    c.fillRect(0, 0, W, H);
    drawBricks(c);
    c.fillStyle = 'white';
    c.fillRect(paddleX, PADDLE_Y, PADDLE_WIDTH, PADDLE_HEIGHT);
    c.beginPath();
    c.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    c.fill();
  }

  function drawBricks(c) {
    c.fillStyle = 'blue';
    for (var col = 0; col < BRICK_COLS; col++) {
      for (var row = 0; row < BRICK_ROWS; row++) {
        if (isBrickAtTileCoord(col, row)) {
          c.fillRect(col * BRICK_W, row * BRICK_H, BRICK_W - BRICK_GAP, BRICK_H - BRICK_GAP);
        }
      }
    }
  }
})();
