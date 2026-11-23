// Bullseye Wind: the bow's aim sweeps up and down on its own; press to loose the arrow.
// Wind changes before every arrow and pushes the arrow sideways in flight. Three arrows per round;
// a round needs 12 points to go on. Targets move farther and shrink each round. A 5 s shot clock
// looses the arrow if you wait too long.
// Integer-only: angles come from a fixed sine table, positions are in 1/256 px (FP).

import { type Game, Rng, mix } from "../engine.ts";

export const FP = 256;
export const ACTION_SHOOT = 1;
export const BOW = { x: 18, y: 188 }; // px
export const GROUND_Y = 204;
export const ARROWS_PER_ROUND = 3;
export const PASS_POINTS = 12;
const MAX_ROUNDS = 10;
/** Shot clock: after this many frames of aiming the arrow is loosed wherever the bow points. */
export const SHOT_CLOCK = 300;
const MAX_FRAMES = 60 * 300;

// sin(d) * 4096 for d = 0..90, written out so every engine uses identical numbers.
const SIN = [
  0, 71, 143, 214, 286, 357, 428, 499, 570, 641, 711, 782, 852, 921, 991, 1060, 1129, 1198, 1266, 1334, 1401, 1468, 1534,
  1600, 1666, 1731, 1796, 1860, 1923, 1986, 2048, 2110, 2171, 2231, 2290, 2349, 2408, 2465, 2522, 2578, 2633, 2687, 2741,
  2793, 2845, 2896, 2946, 2996, 3044, 3091, 3138, 3183, 3228, 3271, 3314, 3355, 3396, 3435, 3474, 3511, 3547, 3582, 3617,
  3650, 3681, 3712, 3742, 3770, 3798, 3824, 3849, 3873, 3896, 3917, 3937, 3956, 3974, 3991, 4006, 4021, 4034, 4046, 4056,
  4065, 4074, 4080, 4086, 4090, 4094, 4095, 4096,
];

/** sin/cos * 4096 for an angle in tenths of a degree, 0..900. */
export function sinT(t: number): number {
  const d = Math.floor(t / 10);
  const f = t - d * 10;
  if (d >= 90) return SIN[90];
  return SIN[d] + Math.trunc(((SIN[d + 1] - SIN[d]) * f) / 10);
}
export function cosT(t: number): number {
  return sinT(900 - t);
}

const ARROW_V = 1600; // FP per frame (~6.25 px)
const GRAVITY = 22; // FP per frame^2
const AIM_MIN = 0; // tenths of a degree above horizontal
const AIM_MAX = 600;
const SHOW_FRAMES = 40; // pause after an arrow lands

export type BullseyePhase = "aim" | "flight" | "show";

export interface Shot {
  points: number;
  hitY: number | null; // px where it crossed the target, null if it missed the target plane
}

export interface BullseyeState {
  frame: number;
  rng: Rng;
  round: number; // 1-based
  arrow: number; // 0..2 within the round
  roundPoints: number;
  phase: BullseyePhase;
  phaseFrames: number;
  aim: number; // tenths of a degree
  aimDir: 1 | -1;
  aimSpeed: number; // tenths per frame
  wind: number; // FP per frame^2, + pushes right (away from the archer)
  target: { x: number; y: number; r: number }; // px
  arrowX: number; // FP
  arrowY: number;
  vx: number;
  vy: number;
  shots: Shot[];
  tens: number;
  score: number;
  end: "round" | "rounds" | "time" | null;
}

function newRound(s: BullseyeState) {
  const k = s.round - 1;
  s.target = {
    x: Math.min(150, 96 + k * 5 + s.rng.int(0, 10)),
    y: s.rng.int(80, 170),
    r: Math.max(7, 16 - k),
  };
  s.arrow = 0;
  s.roundPoints = 0;
  s.aimSpeed = Math.min(22, 9 + k * 1);
}

function newArrow(s: BullseyeState) {
  s.wind = s.rng.int(-10, 10) * Math.min(3, 1 + Math.floor((s.round - 1) / 3));
  s.phase = "aim";
  s.phaseFrames = 0;
}

function pointsFor(s: BullseyeState, hitY: number): number {
  const d = Math.abs(hitY - s.target.y * FP);
  const r = s.target.r * FP;
  if (d >= r) return 0;
  return 10 - 2 * Math.floor((d * 5) / r);
}

export const Bullseye: Game<BullseyeState> = {
  id: "bullseye-wind",
  maxFrames: MAX_FRAMES,
  actions: [ACTION_SHOOT],
  init(seed) {
    const s: BullseyeState = {
      frame: 0,
      rng: new Rng(seed),
      round: 1,
      arrow: 0,
      roundPoints: 0,
      phase: "aim",
      phaseFrames: 0,
      aim: 0,
      aimDir: 1,
      aimSpeed: 9,
      wind: 0,
      target: { x: 100, y: 120, r: 16 },
      arrowX: 0,
      arrowY: 0,
      vx: 0,
      vy: 0,
      shots: [],
      tens: 0,
      score: 0,
      end: null,
    };
    newRound(s);
    s.aim = s.rng.int(AIM_MIN, AIM_MAX);
    newArrow(s);
    return s;
  },
  step(s, actions) {
    if (s.end) return;
    if (s.phase === "aim") {
      const loose = s.phaseFrames >= SHOT_CLOCK ? [...actions, ACTION_SHOOT] : actions;
      for (const a of loose) {
        if (a === ACTION_SHOOT && s.phase === "aim") {
          s.phase = "flight";
          s.phaseFrames = 0;
          s.arrowX = BOW.x * FP;
          s.arrowY = BOW.y * FP;
          s.vx = Math.trunc((ARROW_V * cosT(s.aim)) / 4096);
          s.vy = -Math.trunc((ARROW_V * sinT(s.aim)) / 4096);
        }
      }
      if (s.phase === "aim") {
        s.aim += s.aimDir * s.aimSpeed;
        if (s.aim >= AIM_MAX) {
          s.aim = AIM_MAX;
          s.aimDir = -1;
        } else if (s.aim <= AIM_MIN) {
          s.aim = AIM_MIN;
          s.aimDir = 1;
        }
      }
    } else if (s.phase === "flight") {
      const ox = s.arrowX;
      const oy = s.arrowY;
      s.vx += s.wind;
      s.vy += GRAVITY;
      s.arrowX += s.vx;
      s.arrowY += s.vy;
      const tx = s.target.x * FP;
      let shot: Shot | null = null;
      if (ox < tx && s.arrowX >= tx) {
        // height where the arrow crossed the target's plane, interpolated inside this frame
        const hitY = oy + Math.trunc(((s.arrowY - oy) * (tx - ox)) / (s.arrowX - ox));
        shot = { points: pointsFor(s, hitY), hitY: Math.floor(hitY / FP) };
      } else if (s.arrowY >= GROUND_Y * FP || s.arrowX <= 0 || s.phaseFrames > 240) {
        shot = { points: 0, hitY: null };
      }
      if (shot) {
        s.shots.push(shot);
        s.roundPoints += shot.points;
        s.score += shot.points;
        if (shot.points === 10) s.tens++;
        s.phase = "show";
        s.phaseFrames = 0;
      }
    } else if (s.phase === "show" && s.phaseFrames >= SHOW_FRAMES) {
      s.arrow++;
      if (s.arrow >= ARROWS_PER_ROUND) {
        if (s.roundPoints < PASS_POINTS) {
          s.end = "round";
        } else if (s.round >= MAX_ROUNDS) {
          s.end = "rounds";
        } else {
          s.score += 5 * s.round; // round bonus
          s.round++;
          newRound(s);
        }
      }
      if (!s.end) newArrow(s);
    }
    s.phaseFrames++;
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

export function hashBullseye(s: BullseyeState): number {
  let h = 0x811c9dc5;
  h = mix(h, s.frame);
  h = mix(h, s.score);
  h = mix(h, s.round);
  h = mix(h, s.rng.state);
  for (const sh of s.shots) h = mix(h, sh.points * 1000 + (sh.hitY ?? 999));
  return h;
}

/** Where an arrow loosed now would cross the target plane (px), for bots and tests. Mirrors the flight step. */
export function previewHit(s: BullseyeState, aim: number): number | null {
  let x = BOW.x * FP;
  let y = BOW.y * FP;
  let vx = Math.trunc((ARROW_V * cosT(aim)) / 4096);
  let vy = -Math.trunc((ARROW_V * sinT(aim)) / 4096);
  const tx = s.target.x * FP;
  for (let i = 0; i < 241; i++) {
    const ox = x;
    const oy = y;
    vx += s.wind;
    vy += GRAVITY;
    x += vx;
    y += vy;
    if (ox < tx && x >= tx) return Math.floor((oy + Math.trunc(((y - oy) * (tx - ox)) / (x - ox))) / FP);
    if (y >= GROUND_Y * FP || x <= 0) return null;
  }
  return null;
}

/**
 * The first part of an arrow's path for a given aim, gravity only (no wind), in px.
 * View-only: the bow's aiming guide. The simulation never calls it.
 */
export function guidePath(aim: number, frames: number, every = 2): { x: number; y: number }[] {
  let x = BOW.x * FP;
  let y = BOW.y * FP;
  const vx = Math.trunc((ARROW_V * cosT(aim)) / 4096);
  let vy = -Math.trunc((ARROW_V * sinT(aim)) / 4096);
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i <= frames; i++) {
    vy += GRAVITY;
    x += vx;
    y += vy;
    if (i % every === 0) out.push({ x: x / FP, y: y / FP });
  }
  return out;
}
