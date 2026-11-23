// Coin Stack: a carrier swings a coin back and forth; press to drop it on the stack.
// Each coin sits where it lands, so small misses add up and the stack starts to lean.
// The run ends when a coin misses the stack or the stack tips over its own balance point.
// All positions are integers in 1/256 px (FP). The playfield is 160 px wide.

import { type Game, Rng, mix } from "../engine.ts";

export const FP = 256;
export const FIELD_W = 160;
export const COIN_W = 24; // px
export const COIN_H = 6; // px, one coin's thickness in the stack
export const DROP_H = 40; // px between the carrier and the top of the stack
export const ACTION_DROP = 1;

const HALF = (COIN_W / 2) * FP;
const MIN_X = 16 * FP;
const MAX_X = (FIELD_W - 16) * FP;
const GRAVITY = 80; // FP per frame^2
const PERFECT = 2 * FP; // within 2 px of the coin below
const BASE_SPEED = 300; // FP per frame (~1.2 px)
const SPEED_STEP = 14; // added per coin
const MAX_SPEED = 1050; // ~4.1 px per frame
const JITTER = 60; // random extra speed per coin, from the seed
const MAX_FRAMES = 60 * 240; // four minutes

export type EndReason = "miss" | "topple" | "time" | null;

export interface Landing {
  frame: number;
  dx: number; // FP offset from the coin below
  perfect: boolean;
}

export interface CoinStackState {
  frame: number;
  rng: Rng;
  carrierX: number;
  dir: 1 | -1;
  speed: number;
  falling: { x: number; dist: number; vy: number } | null;
  /** x centre of each coin, bottom (base) first. The base coin is fixed at the centre. */
  stack: number[];
  score: number;
  combo: number;
  bestCombo: number;
  perfects: number;
  end: EndReason;
  /** Index of the lowest coin whose load tipped, when end === "topple". */
  tipAt: number;
  /** Where the missed coin would have landed, when end === "miss". */
  missX: number;
  last: Landing | null;
}

/** Coins placed before the carrier reaches its normal speed. The first drops are slow so new players can learn the timing. */
const WARMUP = 4;
const WARMUP_SPEED = 170; // ~0.66 px per frame

function nextSpeed(s: CoinStackState): number {
  const n = s.stack.length - 1;
  if (n < WARMUP) return WARMUP_SPEED + Math.floor(((BASE_SPEED - WARMUP_SPEED) * n) / WARMUP) + s.rng.int(0, JITTER / 3);
  return Math.min(MAX_SPEED, BASE_SPEED + n * SPEED_STEP + s.rng.int(0, JITTER));
}

/** Lowest coin k whose load (all coins above it) has its centre of mass past k's edge, or -1. */
function tipIndex(stack: number[]): number {
  let sum = 0;
  let count = 0;
  let lowest = -1;
  for (let k = stack.length - 1; k >= 1; k--) {
    sum += stack[k];
    count++;
    // |com - stack[k-1]| > HALF, without division: |sum - count*x| > HALF*count
    const off = sum - count * stack[k - 1];
    if (off > HALF * count || off < -HALF * count) lowest = k - 1;
  }
  return lowest;
}

function land(s: CoinStackState) {
  const f = s.falling!;
  s.falling = null;
  const top = s.stack[s.stack.length - 1];
  let x = f.x;
  const dx = x - top;
  if (dx >= COIN_W * FP || dx <= -COIN_W * FP) {
    s.end = "miss";
    s.missX = x;
    s.combo = 0;
    return;
  }
  const perfect = dx <= PERFECT && dx >= -PERFECT;
  if (perfect) x = top;
  s.stack.push(x);
  s.last = { frame: s.frame, dx: x - top, perfect };
  const tip = tipIndex(s.stack);
  if (tip >= 0) {
    s.end = "topple";
    s.tipAt = tip;
    s.combo = 0;
    return;
  }
  if (perfect) {
    s.combo++;
    s.perfects++;
    s.bestCombo = Math.max(s.bestCombo, s.combo);
    s.score += 10 + 5 * Math.min(s.combo, 10);
  } else {
    s.combo = 0;
    s.score += 10;
  }
  s.speed = nextSpeed(s);
}

export const CoinStack: Game<CoinStackState> = {
  id: "coin-stack",
  maxFrames: MAX_FRAMES,
  actions: [ACTION_DROP],
  init(seed) {
    const rng = new Rng(seed);
    const s: CoinStackState = {
      frame: 0,
      rng,
      carrierX: MIN_X + rng.int(0, MAX_X - MIN_X),
      dir: rng.int(0, 1) ? 1 : -1,
      speed: 0,
      falling: null,
      stack: [(FIELD_W / 2) * FP],
      score: 0,
      combo: 0,
      bestCombo: 0,
      perfects: 0,
      end: null,
      tipAt: -1,
      missX: 0,
      last: null,
    };
    s.speed = nextSpeed(s);
    return s;
  },
  step(s, actions) {
    if (s.end) return;
    for (const a of actions) {
      if (a === ACTION_DROP && !s.falling) s.falling = { x: s.carrierX, dist: 0, vy: 0 };
    }
    let x = s.carrierX + s.dir * s.speed;
    if (x > MAX_X) {
      x = MAX_X - (x - MAX_X);
      s.dir = -1;
    } else if (x < MIN_X) {
      x = MIN_X + (MIN_X - x);
      s.dir = 1;
    }
    s.carrierX = x;
    if (s.falling) {
      s.falling.vy += GRAVITY;
      s.falling.dist += s.falling.vy;
      if (s.falling.dist >= DROP_H * FP) land(s);
    }
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

export function hashCoinStack(s: CoinStackState): number {
  let h = 0x811c9dc5;
  h = mix(h, s.frame);
  h = mix(h, s.score);
  h = mix(h, s.rng.state);
  for (const x of s.stack) h = mix(h, x);
  return h;
}
