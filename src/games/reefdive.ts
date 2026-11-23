// Reef Dive: a diver swims right through a coral reef. Hold to dive, let go to float back up.
// Coral grows from the seabed, fishing hooks hang from the surface, jellyfish drift up and down between them.
// Air runs out below the surface and refills at the top. Pearls are worth points. One touch ends the dive.
// Integer-only physics (positions in 1/256 px) so the Worker replays it exactly. View: 160 x 240 px.

import { type Game, Rng, mix } from "../engine.ts";
import { isin } from "./vineswing.ts";

export const FP = 256;
export const ACT = { dive: 1, rise: 2 } as const;
export const VIEW_X = 48; // screen x of the diver
export const SURFACE_Y = 34; // px: the water line; the diver can't go above it
export const SEABED_Y = 222; // px: sand
export const DIVER_R = 6; // px: hit circle
export const JELLY_R = 8;
export const PEARL_R = 7;
export const AIR_MAX = 60 * 11; // frames of air
const AIR_REFILL = 8; // per frame at the surface
const PEARL_SCORE = 25;

const DIVE = 54; // FP px per frame^2 while held
const RISE = 42; // buoyancy when let go
const MAX_FRAMES = 60 * 240;
const TURN = 1 << 20;

export type Obstacle =
  | { kind: "coral"; x: number; w: number; top: number } // from `top` down to the seabed
  | { kind: "hook"; x: number; depth: number } // a line from the surface down to a hook at `depth`
  | { kind: "jelly"; x: number; base: number; amp: number; phase: number; speed: number };

export interface ReefDiveState {
  frame: number;
  rng: Rng;
  holding: boolean;
  x: number; // FP
  y: number; // FP
  vy: number; // FP per frame
  speed: number; // FP px per frame, forward
  air: number; // frames left
  obstacles: Obstacle[];
  pearls: { x: number; y: number; taken: boolean }[];
  pearlsTaken: number;
  passed: number;
  end: "coral" | "hook" | "jelly" | "air" | "time" | null;
  score: number;
}

/** Jelly centre y in px for a frame (integer bob along the shared sine table). */
export function jellyY(j: { base: number; amp: number; phase: number; speed: number }, frame: number): number {
  return j.base + Math.trunc((j.amp * isin(j.phase + frame * j.speed)) / 4096);
}

function nextX(s: ReefDiveState): number {
  const last = s.obstacles[s.obstacles.length - 1];
  return last ? last.x + (last.kind === "coral" ? last.w : 0) : 220;
}

function addObstacle(s: ReefDiveState) {
  const prevX = nextX(s);
  const far = Math.min(1, prevX / 9000);
  // gaps shrink a little with distance, but never below what a full dive-to-float swing needs
  const gap = s.rng.int(84, 112) - Math.floor(far * 18);
  const x = prevX + gap;
  const roll = s.rng.int(0, 99);
  let o: Obstacle;
  if (roll < 40) o = { kind: "coral", x, w: s.rng.int(14, 24), top: SEABED_Y - s.rng.int(36, 82 + Math.floor(far * 14)) };
  else if (roll < 68) o = { kind: "hook", x, depth: SURFACE_Y + s.rng.int(46, 96 + Math.floor(far * 12)) };
  else {
    const amp = s.rng.int(10, 26 + Math.floor(far * 10));
    o = { kind: "jelly", x, base: s.rng.int(SURFACE_Y + 40 + amp, SEABED_Y - 24 - amp), amp, phase: s.rng.int(0, TURN - 1), speed: s.rng.int(4000, 7000) };
  }
  s.obstacles.push(o);
  // a pearl in most gaps, somewhere a diver can reach
  if (s.rng.int(0, 99) < 60) {
    const deep = s.rng.int(0, 99) < 45;
    const py = deep ? SEABED_Y - s.rng.int(8, 15) : s.rng.int(SURFACE_Y + 24, SEABED_Y - 40);
    s.pearls.push({ x: prevX + Math.floor(gap / 2) + s.rng.int(-8, 8), y: py, taken: false });
  }
}

function hits(s: ReefDiveState, hx: number, hy: number): ReefDiveState["end"] {
  for (const o of s.obstacles) {
    if (o.x > hx + 40) break;
    if (o.kind === "coral") {
      // circle vs box
      const cx = Math.max(o.x, Math.min(hx, o.x + o.w));
      const cy = Math.max(o.top, Math.min(hy, SEABED_Y));
      if ((hx - cx) ** 2 + (hy - cy) ** 2 < DIVER_R * DIVER_R) return "coral";
    } else if (o.kind === "hook") {
      if (Math.abs(hx - o.x) < DIVER_R + 1 && hy < o.depth + 4) return "hook";
    } else {
      const jy = jellyY(o, s.frame);
      const r = DIVER_R + JELLY_R - 2;
      if ((hx - o.x) ** 2 + (hy - jy) ** 2 < r * r) return "jelly";
    }
  }
  return null;
}

export const ReefDive: Game<ReefDiveState> = {
  id: "reef-dive",
  maxFrames: MAX_FRAMES,
  actions: [ACT.dive, ACT.rise],
  init(seed) {
    const s: ReefDiveState = {
      frame: 0,
      rng: new Rng(seed),
      holding: false,
      x: 40 * FP,
      y: (SURFACE_Y + 6) * FP,
      vy: 0,
      speed: 300,
      air: AIR_MAX,
      obstacles: [],
      pearls: [],
      pearlsTaken: 0,
      passed: 0,
      end: null,
      score: 0,
    };
    while (nextX(s) < 700) addObstacle(s);
    return s;
  },
  step(s, actions) {
    if (s.end) return;
    for (const a of actions) s.holding = a === ACT.dive;
    // swim: hold pushes down, the water lifts you when you let go; drag keeps it smooth
    s.vy += s.holding ? DIVE : -RISE;
    s.vy -= s.vy >> 4;
    s.y += s.vy;
    if (s.y < SURFACE_Y * FP) {
      s.y = SURFACE_Y * FP;
      if (s.vy < 0) s.vy = 0;
    }
    if (s.y > (SEABED_Y - DIVER_R) * FP) {
      s.y = (SEABED_Y - DIVER_R) * FP;
      if (s.vy > 0) s.vy = 0;
    }
    // speed builds from 1.2 to 2.3 px per frame over the first two minutes
    if (s.speed < 590 && s.frame % 25 === 0) s.speed += 2;
    s.x += s.speed;
    const hx = Math.floor(s.x / FP);
    const hy = Math.floor(s.y / FP);
    // air: refills at the surface, drains below
    if (hy <= SURFACE_Y + 3) s.air = Math.min(AIR_MAX, s.air + AIR_REFILL);
    else s.air--;
    for (const p of s.pearls) {
      if (p.taken) continue;
      if ((p.x - hx) ** 2 + (p.y - hy) ** 2 <= (PEARL_R + DIVER_R) ** 2) {
        p.taken = true;
        s.pearlsTaken++;
      }
    }
    const hit = hits(s, hx, hy);
    if (hit) s.end = hit;
    else if (s.air <= 0) s.end = "air";
    while (nextX(s) < hx + 420) addObstacle(s);
    while (s.obstacles.length && s.obstacles[0].x < hx - 120) {
      s.obstacles.shift();
      s.passed++;
    }
    while (s.pearls.length && s.pearls[0].x < hx - 120) s.pearls.shift();
    s.score = Math.floor((hx - 40) / 4) + s.pearlsTaken * PEARL_SCORE;
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

export function hashReefDive(s: ReefDiveState): number {
  let h = 0x811c9dc5;
  h = mix(h, s.frame);
  h = mix(h, s.score);
  h = mix(h, s.x);
  h = mix(h, s.y);
  h = mix(h, s.vy);
  h = mix(h, s.air);
  h = mix(h, s.rng.state);
  return h;
}
