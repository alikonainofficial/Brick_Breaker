# Brick Breaker

A 3-ball, scored, levelled Breakout with combos, designed layouts and power-ups.
Play it at **https://alikonainofficial.github.io/Brick_Breaker/** — desktop or phone.

Plain static site: `index.html`, `css/`, `js/`. No build step, no dependencies.

## Controls

| Action | Keyboard | Mouse / touch |
| --- | --- | --- |
| Move paddle | `←` `→` or `A` `D` | move the mouse / drag on the canvas, or the ◀ ▶ buttons on phones |
| Launch ball, release a caught ball, fire the laser | `Space` | tap the canvas, or the `GO` button on phones |
| Pause / resume | `P` or `Esc` | — |
| Restart | `R` | — |
| Sound on/off | — | the *Sound* button above the game |

Switching tabs pauses the game automatically.

## Scoring

- Each brick is worth `10 × (1 + combo)`. The combo counts bricks broken since the ball last touched the paddle; it resets on paddle contact or when a ball is lost. The HUD shows it as `×3` while it is 2 or more.
- Clearing a level pays `+500`, plus `+100` for every life left.
- You start with 3 lives. Losing the last ball in play costs one; extra balls from the multiball power-up are free.
- The ball starts at 320 px/s and gets 5 % faster every level, up to 560 px/s.
- 8 designed levels (block, diamond, heart, columns, space invader, "AK", checkerboard, fortress). After level 8 they loop with tougher hard bricks.

## Power-ups

About 12 % of bricks, and every `P` brick, drop a capsule. Catch it with the paddle:

| Capsule | Effect | Lasts |
| --- | --- | --- |
| `W` Wide | paddle grows to 150 px | 15 s |
| `M` Multi | two extra balls at ±30° | until they fall |
| `S` Slow | ball speed × 0.7 | 10 s |
| `C` Catch | the ball sticks to the paddle; `Space` or tap releases it | 12 s |
| `L` Laser | `Space` fires two bolts from the paddle ends every 0.4 s | 10 s |

Only one timed power-up is active at a time; catching a new one replaces it. The timer shows in the HUD and as a bar under the paddle.

## Scores

Scores are stored only in your browser (`localStorage`); nothing is sent anywhere. The keys are `arcade.brick-breaker.best`, `arcade.brick-breaker.plays` and `arcade.brick-breaker.lastScore`. "Copy result" puts a one-line summary on your clipboard.

## Accessibility

If your system asks for reduced motion, screen shake and hit-stop are turned off; flashes and sound stay.
