// Frost Curling: slide stones down a frozen lake into the house. Each stone is three presses:
// tap to lock the aim as it swings, tap to lock the power as the bar fills, then hold to sweep while the
// stone runs (sweeping keeps it going and straightens the curl). Red stones already sit on the ice:
// knock them out of the house for points. Four ends of six stones.
// Integer-only physics (positions in 1/256 px) so the Worker replays it exactly.
// Sheet axes: x across (0 = centre line), y down the sheet from the hack.

import { type Game, Rng, mix } from "../engine.ts";
import { isin } from "./vineswing.ts";

export const FP = 256;
export const ACT = { down: 1, up: 2 } as const;
export const STONE_R = 5; // px
export const SHEET_HALF = 30; // px from the centre line to each side board
export const HOUSE_Y = 400; // px: centre of the house
export const BACK_Y = 440; // px: past this a stone is out
export const RINGS = [6, 14, 24] as const; // px radii: button, inner, outer
export const RING_POINTS = [10, 5, 2] as const;
export const STONES_PER_END = 6;
export const ENDS = 4;
export const KNOCK_POINTS = 4;

const FRICTION = 3; // FP px per frame^2 while not swept (0.0117 px)
const SWEEP_FRICTION = 2; // FP px per frame^2 while swept
const CURL_EVERY = 8; // the thrown stone drifts 1/256 px per frame sideways every this many frames
const CURL_EVERY_SWEPT = 24; // sweeping keeps it straighter
const MAX_FRAMES = 60 * 300;
const AIM_MAX = 60; // sideways speed at full aim, FP px per frame (about 30 px across at the house)
const V_MIN = 680; // FP px per frame at zero power: stops about 300 px down
const V_MAX = 900; // at full power: about 520 px, through the house

export interface Stone {
  red: boolean;
  x: number; // FP
  y: number;
  vx: number;
  vy: number;
  out: boolean;
  wasIn: boolean; // a red stone that started the end in the house
}

export type Phase = "aim" | "power" | "slide" | "settle" | "tally";

export interface CurlingState {
  frame: number;
  rng: Rng;
  end: number; // 0-based
  thrown: number; // stones thrown this end
  phase: Phase;
  t: number; // frames into the phase
  aim: number; // -1000..1000 locked aim
  power: number; // 0..1000 locked power
  curl: -1 | 1; // which way this stone curls
  holding: boolean;
  sweeping: boolean;
  stones: Stone[];
  current: number; // index of the moving stone, -1 if none
  endScores: number[];
  knocked: number;
  score: number;
  over: boolean;
}

/** Aim swing (-1000..1000) and power fill (0..1000) at a frame of the phase. */
export function aimAt(t: number): number {
  return Math.trunc((isin(t * 5200) * 1000) / 4096);
}
export function powerAt(t: number): number {
  const p = t % 140; // up and down over 2.3 s
  return p < 70 ? Math.trunc((p * 1000) / 70) : Math.trunc(((140 - p) * 1000) / 70);
}

const dist2 = (ax: number, ay: number, bx: number, by: number) => {
  const dx = (ax - bx) / FP;
  const dy = (ay - by) / FP;
  return dx * dx + dy * dy;
};

export function ringOf(s: Stone): number {
  const d = Math.sqrt(dist2(s.x, s.y, 0, HOUSE_Y * FP));
  for (let i = 0; i < RINGS.length; i++) if (d <= RINGS[i] + STONE_R * 0.5) return i;
  return -1;
}

function setupEnd(s: CurlingState) {
  s.stones = [];
  s.thrown = 0;
  s.current = -1;
  // two to four red stones: some guarding in front of the house, some inside it
  const n = 2 + s.rng.int(0, Math.min(2, s.end));
  for (let i = 0; i < n; i++) {
    const guard = s.rng.int(0, 99) < 40;
    const x = s.rng.int(-18, 18) * FP;
    const y = (guard ? HOUSE_Y - s.rng.int(40, 80) : HOUSE_Y + s.rng.int(-16, 16)) * FP;
    if (s.stones.some((o) => dist2(o.x, o.y, x, y) < (STONE_R * 2 + 2) ** 2)) continue;
    const st: Stone = { red: true, x, y, vx: 0, vy: 0, out: false, wasIn: false };
    st.wasIn = ringOf(st) >= 0;
    s.stones.push(st);
  }
  startThrow(s);
}

function startThrow(s: CurlingState) {
  s.phase = "aim";
  s.t = 0;
  s.curl = s.rng.int(0, 1) ? 1 : -1;
  s.sweeping = false;
}

function tallyEnd(s: CurlingState) {
  let pts = 0;
  for (const st of s.stones) {
    if (st.out) continue;
    const r = ringOf(st);
    if (!st.red && r >= 0) pts += RING_POINTS[r];
  }
  for (const st of s.stones) if (st.red && st.wasIn && (st.out || ringOf(st) < 0)) (pts += KNOCK_POINTS), s.knocked++;
  s.endScores.push(pts);
  s.score = s.endScores.reduce((a, b) => a + b, 0) * 10;
}

/** Move every stone one frame; returns true while any stone still moves. */
function physics(s: CurlingState): boolean {
  let moving = false;
  for (let i = 0; i < s.stones.length; i++) {
    const st = s.stones[i];
    if (st.out || (st.vx === 0 && st.vy === 0)) continue;
    moving = true;
    const swept = i === s.current && s.sweeping;
    const fr = swept ? SWEEP_FRICTION : FRICTION;
    // friction along the motion, curl across it (only the thrown stone spins)
    const sp = Math.sqrt((st.vx / FP) ** 2 + (st.vy / FP) ** 2) * FP;
    if (sp <= fr) {
      st.vx = 0;
      st.vy = 0;
    } else {
      st.vx -= Math.round((st.vx * fr) / sp);
      st.vy -= Math.round((st.vy * fr) / sp);
      if (i === s.current && s.t % (swept ? CURL_EVERY_SWEPT : CURL_EVERY) === 0) st.vx += s.curl;
    }
    st.x += st.vx;
    st.y += st.vy;
    if (Math.abs(st.x) > (SHEET_HALF - STONE_R) * FP || st.y > BACK_Y * FP) {
      st.out = true;
      st.vx = st.vy = 0;
    }
  }
  // collisions: equal masses, the normal parts of the velocities swap
  for (let i = 0; i < s.stones.length; i++) {
    const a = s.stones[i];
    if (a.out) continue;
    for (let j = i + 1; j < s.stones.length; j++) {
      const b = s.stones[j];
      if (b.out) continue;
      const dx = (b.x - a.x) / FP;
      const dy = (b.y - a.y) / FP;
      const d2 = dx * dx + dy * dy;
      if (d2 >= (STONE_R * 2) ** 2 || d2 === 0) continue;
      const rvx = (a.vx - b.vx) / FP;
      const rvy = (a.vy - b.vy) / FP;
      const along = (rvx * dx + rvy * dy) / d2;
      if (along <= 0) continue; // already parting
      const ix = Math.trunc(along * dx * FP * 0.92);
      const iy = Math.trunc(along * dy * FP * 0.92);
      a.vx -= ix;
      a.vy -= iy;
      b.vx += ix;
      b.vy += iy;
      // push apart so they don't stay locked together
      const d = Math.sqrt(d2);
      const push = Math.trunc(((STONE_R * 2 - d) / 2 / d) * FP);
      a.x -= Math.trunc(push * dx);
      a.y -= Math.trunc(push * dy);
      b.x += Math.trunc(push * dx);
      b.y += Math.trunc(push * dy);
      moving = true;
    }
  }
  return moving;
}

export const FrostCurling: Game<CurlingState> = {
  id: "frost-curling",
  maxFrames: MAX_FRAMES,
  actions: [ACT.down, ACT.up],
  init(seed) {
    const s: CurlingState = {
      frame: 0,
      rng: new Rng(seed),
      end: 0,
      thrown: 0,
      phase: "aim",
      t: 0,
      aim: 0,
      power: 0,
      curl: 1,
      holding: false,
      sweeping: false,
      stones: [],
      current: -1,
      endScores: [],
      knocked: 0,
      score: 0,
      over: false,
    };
    setupEnd(s);
    return s;
  },
  step(s, actions) {
    if (s.over) return;
    for (const a of actions) {
      if (a === ACT.down) {
        s.holding = true;
        if (s.phase === "aim" && s.t > 10) {
          s.aim = aimAt(s.t);
          s.phase = "power";
          s.t = 0;
        } else if (s.phase === "power" && s.t > 10) {
          s.power = powerAt(s.t);
          // release the stone from the hack
          const st: Stone = {
            red: false,
            x: 0,
            y: 8 * FP,
            vx: Math.trunc((s.aim * AIM_MAX) / 1000),
            vy: V_MIN + Math.trunc(((V_MAX - V_MIN) * s.power) / 1000),
            out: false,
            wasIn: false,
          };
          s.stones.push(st);
          s.current = s.stones.length - 1;
          s.thrown++;
          s.phase = "slide";
          s.t = 0;
        }
      } else if (a === ACT.up) s.holding = false;
    }
    s.sweeping = s.phase === "slide" && s.holding;
    s.t++;
    if (s.phase === "slide") {
      if (!physics(s)) {
        s.phase = "settle";
        s.t = 0;
        s.sweeping = false;
      }
    } else if (s.phase === "settle" && s.t >= 75) {
      if (s.thrown >= STONES_PER_END) {
        tallyEnd(s);
        s.phase = "tally";
        s.t = 0;
      } else startThrow(s);
    } else if (s.phase === "tally" && s.t >= 120) {
      s.end++;
      if (s.end >= ENDS) s.over = true;
      else setupEnd(s);
    }
    s.frame++;
    if (s.frame >= MAX_FRAMES) s.over = true;
  },
  over(s) {
    return s.over;
  },
  score(s) {
    return s.score;
  },
};

export function hashCurling(s: CurlingState): number {
  let h = 0x811c9dc5;
  h = mix(h, s.frame);
  h = mix(h, s.score);
  h = mix(h, s.end);
  h = mix(h, s.thrown);
  h = mix(h, s.rng.state);
  for (const st of s.stones) (h = mix(h, st.x)), (h = mix(h, st.y));
  return h;
}

