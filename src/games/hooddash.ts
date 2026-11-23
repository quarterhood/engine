// Hood Dash: a hooded runner crosses the town's rooftops. Press to jump; press again in the air for one
// short second jump. Gaps between roofs and chimneys end the run. Speed rises the longer you last.
// Integer-only physics in 1/256 px (FP). The view is 160 x 240; the runner stays at screen x = 36.

import { type Game, Rng, mix } from "../engine.ts";

export const FP = 256;
export const ACTION_JUMP = 1;
export const RUNNER_X = 36; // px from the left edge of the view
export const RUNNER_W = 8;
export const RUNNER_H = 12;
export const FALL_Y = 260; // px; falling past this ends the run

const MAX_FRAMES = 60 * 240;
const GRAVITY = 40; // FP per frame^2
const JUMP_V = 900; // first jump
const JUMP2_V = 720; // second jump, shorter
const START_SPEED = 360; // FP per frame (~1.4 px)
const MAX_SPEED = 840; // ~3.3 px
const SPEED_EVERY = 90; // frames per speed step
const SPEED_STEP = 6;
const COIN_SCORE = 25;
const COIN_R = 6; // px pickup radius

export interface Roof {
  x0: number; // px, world
  x1: number;
  y: number; // px, roof top (screen-down)
  chimney: number; // px world x of a chimney on this roof, or -1
}

export type DashEnd = "fall" | "wall" | "chimney" | "time" | null;

export interface HoodDashState {
  frame: number;
  rng: Rng;
  x: number; // FP world x of the runner's left edge
  y: number; // FP feet y
  vy: number;
  speed: number;
  grounded: boolean;
  airJump: boolean;
  roofs: Roof[];
  coins: { x: number; y: number; taken: boolean }[];
  coinsTaken: number;
  jumps: number;
  end: DashEnd;
  score: number;
}

const CHIMNEY_W = 8;
const CHIMNEY_H = 12;

function genRoof(s: HoodDashState) {
  const prev = s.roofs[s.roofs.length - 1];
  const px = s.speed / FP;
  // The widest gap a first jump clears at the current speed is about 45 frames * speed; stay well inside it.
  const maxGap = Math.min(64, Math.floor(28 * px));
  const gap = s.rng.int(14, Math.max(16, maxGap));
  const w = s.rng.int(56, 150);
  const rise = s.rng.int(-22, 18); // negative = higher roof
  const y = Math.max(140, Math.min(204, prev.y + rise));
  const x0 = prev.x1 + gap;
  const roof: Roof = { x0, x1: x0 + w, y, chimney: -1 };
  if (w >= 80 && s.rng.int(0, 99) < 45) roof.chimney = x0 + s.rng.int(36, w - 24);
  s.roofs.push(roof);
  if (s.rng.int(0, 99) < 60) {
    const cx = x0 + s.rng.int(10, w - 10);
    const lift = s.rng.int(0, 1) ? 26 : 44; // low coins on the roof, high ones need a jump
    if (roof.chimney < 0 || Math.abs(cx - roof.chimney) > 16) s.coins.push({ x: cx, y: y - lift, taken: false });
  }
}

function roofUnder(s: HoodDashState, xpx: number): Roof | null {
  for (const r of s.roofs) if (xpx + RUNNER_W > r.x0 && xpx < r.x1) return r;
  return null;
}

export const HoodDash: Game<HoodDashState> = {
  id: "hood-dash",
  maxFrames: MAX_FRAMES,
  actions: [ACTION_JUMP],
  init(seed) {
    const s: HoodDashState = {
      frame: 0,
      rng: new Rng(seed),
      x: 0,
      y: 180 * FP,
      vy: 0,
      speed: START_SPEED,
      grounded: true,
      airJump: true,
      roofs: [{ x0: -RUNNER_X, x1: 220, y: 180, chimney: -1 }],
      coins: [],
      coinsTaken: 0,
      jumps: 0,
      end: null,
      score: 0,
    };
    while (s.roofs[s.roofs.length - 1].x1 < 600) genRoof(s);
    return s;
  },
  step(s, actions) {
    if (s.end) return;
    for (const a of actions) {
      if (a !== ACTION_JUMP) continue;
      if (s.grounded) {
        s.vy = -JUMP_V;
        s.grounded = false;
        s.airJump = true;
        s.jumps++;
      } else if (s.airJump) {
        s.vy = -JUMP2_V;
        s.airJump = false;
        s.jumps++;
      }
    }
    if (s.frame % SPEED_EVERY === SPEED_EVERY - 1) s.speed = Math.min(MAX_SPEED, s.speed + SPEED_STEP);

    const oldFeet = s.y;
    s.x += s.speed;
    const xpx = Math.floor(s.x / FP);
    if (!s.grounded) {
      s.vy += GRAVITY;
      s.y += s.vy;
    }
    const roof = roofUnder(s, xpx);
    if (roof) {
      const top = roof.y * FP;
      if (s.grounded) {
        if (s.y !== top) {
          // ran onto a different roof while grounded: step down is a fall, step up is a wall
          if (top < s.y) s.end = "wall";
          else s.grounded = false;
        }
      } else if (s.vy >= 0 && oldFeet <= top && s.y >= top) {
        s.y = top;
        s.vy = 0;
        s.grounded = true;
        s.airJump = true;
      } else if (s.y > top + 2 * FP && oldFeet > top) {
        s.end = "wall"; // hit the side of a taller building
      }
      if (!s.end && roof.chimney >= 0) {
        const feet = Math.floor(s.y / FP);
        const overlapX = xpx + RUNNER_W > roof.chimney && xpx < roof.chimney + CHIMNEY_W;
        if (overlapX && feet > roof.y - CHIMNEY_H) s.end = "chimney";
      }
    } else if (s.grounded) {
      s.grounded = false;
    }
    if (!s.end && s.y > FALL_Y * FP) s.end = "fall";

    // coins
    const cyPx = Math.floor(s.y / FP) - RUNNER_H / 2;
    for (const c of s.coins) {
      if (c.taken) continue;
      if (Math.abs(c.x - (xpx + RUNNER_W / 2)) <= COIN_R && Math.abs(c.y - cyPx) <= COIN_R + 2) {
        c.taken = true;
        s.coinsTaken++;
      }
    }
    // keep the world ahead generated, drop what's far behind
    while (s.roofs[s.roofs.length - 1].x1 < xpx + 400) genRoof(s);
    while (s.roofs.length > 2 && s.roofs[0].x1 < xpx - 100) s.roofs.shift();
    while (s.coins.length && s.coins[0].x < xpx - 100) s.coins.shift();

    s.score = Math.floor(xpx / 4) + s.coinsTaken * COIN_SCORE;
    s.frame++;
    if (!s.end && s.frame >= MAX_FRAMES) s.end = "time";
  },
  over(s) {
    return s.end !== null;
  },
  score(s) {
    return s.score;
  },
};

export function hashHoodDash(s: HoodDashState): number {
  let h = 0x811c9dc5;
  h = mix(h, s.frame);
  h = mix(h, s.score);
  h = mix(h, s.x);
  h = mix(h, s.y);
  h = mix(h, s.rng.state);
  h = mix(h, s.coinsTaken);
  return h;
}

export const DASH_CHIMNEY = { w: CHIMNEY_W, h: CHIMNEY_H };
