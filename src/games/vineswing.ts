// Vine Swing: swing through a jungle canopy. Tap to let go and fly; the hands grab the next vine they pass. Fruit in the air is worth points. Miss every vine and you drop into the river.
// Integer-only physics (positions in 1/256 px, angles in 1/2^20 of a turn) so the Worker replays it exactly.
// The view is 160 x 240 px; the swinger stays near screen x = 52.

import { type Game, Rng, mix } from "../engine.ts";

export const FP = 256;
export const ACT = { hold: 1, release: 2 } as const;
export const VIEW_X = 52;
export const CANOPY_Y = 26; // px: where every vine hangs from
export const RIVER_Y = 232; // px: falling past this ends the run
export const REACH = 28; // px: how close to a vine the hands must pass to catch it
export const FRUIT_R = 8;
const FRUIT_SCORE = 25;

const TURN = 1 << 20;
const G = 100; // gravity, FP px per frame^2
const MAX_FRAMES = 60 * 240;
const PUMP = 40; // angle units per frame^2 of pump while hanging on
const RAD = 166886;
const MAX_FLY = 900; // FP px per frame: top launch speed (~3.5 px) // angle units per radian (2^20 / 2pi), rounded

// sine table: 1024 steps per turn, scaled to 4096. Bhaskara I's approximation, integers only.
const SIN = new Int32Array(1024);
for (let i = 0; i < 1024; i++) {
  const d = (i % 512) * 180; // degrees * 512
  const x = d * (180 * 512 - d);
  const v = Math.floor((4 * x * 4096) / (40500 * 512 * 512 - x));
  SIN[i] = i < 512 ? v : -v;
}
const idx = (a: number) => ((((a >> 10) % 1024) + 1024) % 1024) | 0;
export const isin = (a: number) => SIN[idx(a)];
export const icos = (a: number) => SIN[(idx(a) + 256) & 1023];

export interface Vine {
  x: number; // px, anchor
  len: number; // px
}

export interface VineSwingState {
  frame: number;
  rng: Rng;
  mode: "swing" | "fly";
  holding: boolean;
  vine: number; // index into vines while swinging
  ropeLen: number; // px from the anchor to the hands while swinging
  ang: number; // angle from straight down, + = toward +x
  w: number; // angular speed, angle units per frame
  x: number; // FP hands position
  y: number;
  vx: number; // FP per frame, while flying
  vy: number;
  vines: Vine[];
  fruit: { x: number; y: number; taken: boolean }[];
  fruitTaken: number;
  catches: number;
  best: number; // px: furthest x reached
  end: "river" | "time" | null;
  score: number;
}

function addVine(s: VineSwingState) {
  const prev = s.vines[s.vines.length - 1];
  const far = Math.min(1, prev.x / 6000);
  const gap = s.rng.int(58, 82) + Math.floor(far * s.rng.int(0, 28));
  const v: Vine = { x: prev.x + gap, len: s.rng.int(70, 120) };
  s.vines.push(v);
  if (s.rng.int(0, 99) < 55) {
    const fx = prev.x + Math.floor(gap / 2) + s.rng.int(-10, 10);
    const fy = CANOPY_Y + s.rng.int(70, 150);
    s.fruit.push({ x: fx, y: fy, taken: false });
  }
}

/** Angle of the point (dx, dy) seen from an anchor, measured from straight down. */
function angleOf(dx: number, dy: number): number {
  // search the table for the closest direction; 1024 steps is plenty for a catch
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < 1024; i++) {
    const err = Math.abs(dx * SIN[(i + 256) & 1023] - dy * SIN[i]);
    // same side as the point: sin has the sign of dx, cos the sign of dy
    if (Math.sign(SIN[i]) !== Math.sign(dx) && dx !== 0) continue;
    if (SIN[(i + 256) & 1023] < 0 && dy > 0) continue;
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  const a = best << 10;
  return a >= TURN / 2 ? a - TURN : a;
}

function place(s: VineSwingState) {
  const v = s.vines[s.vine];
  s.x = v.x * FP + Math.trunc((s.ropeLen * FP * isin(s.ang)) / 4096);
  s.y = CANOPY_Y * FP + Math.trunc((s.ropeLen * FP * icos(s.ang)) / 4096);
}

function tryCatch(s: VineSwingState): boolean {
  const hx = Math.floor(s.x / FP);
  const hy = Math.floor(s.y / FP);
  for (let i = 0; i < s.vines.length; i++) {
    if (i === s.vine) continue; // let go of this one: catch another
    const v = s.vines[i];
    if (Math.abs(hx - v.x) > REACH) continue;
    if (hy < CANOPY_Y + 14 || hy > CANOPY_Y + v.len + 32) continue;
    // hang on where the hands met the vine; keep the speed, turned into a swing
    const dx = hx - v.x;
    const dy = hy - CANOPY_Y;
    const len = Math.max(24, Math.min(v.len, Math.floor(Math.sqrt(dx * dx + dy * dy))));
    s.vine = i;
    s.ropeLen = len;
    s.ang = angleOf(dx, dy);
    // tangential speed (px per frame) = v . (cos a, -sin a); angular speed = that / len
    const tang = Math.trunc((s.vx * icos(s.ang) - s.vy * isin(s.ang)) / 4096); // FP px per frame
    s.w = Math.trunc((tang * RAD) / (len * FP));
    s.mode = "swing";
    s.catches++;
    place(s);
    return true;
  }
  return false;
}

export const VineSwing: Game<VineSwingState> = {
  id: "vine-swing",
  maxFrames: MAX_FRAMES,
  actions: [ACT.hold, ACT.release],
  init(seed) {
    const s: VineSwingState = {
      frame: 0,
      rng: new Rng(seed),
      mode: "swing",
      holding: true,
      vine: 0,
      ropeLen: 90,
      ang: -Math.floor(TURN / 6), // start pulled back, 60 degrees
      w: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      vines: [{ x: 40, len: 90 }],
      fruit: [],
      fruitTaken: 0,
      catches: 0,
      best: 0,
      end: null,
      score: 0,
    };
    while (s.vines[s.vines.length - 1].x < 700) addVine(s);
    place(s);
    return s;
  },
  step(s, actions) {
    if (s.end) return;
    for (const a of actions) {
      if (a === ACT.hold) s.holding = true;
      else if (a === ACT.release) {
        s.holding = false;
        if (s.mode === "swing") {
          // fly off along the swing: v = w * len * (cos a, -sin a)
          // capped so quick catch-and-release chains can't build speed without limit
          const lin = Math.max(-MAX_FLY, Math.min(MAX_FLY, Math.trunc((s.w * s.ropeLen * FP) / RAD)));
          s.vx = Math.trunc((lin * icos(s.ang)) / 4096);
          s.vy = -Math.trunc((lin * isin(s.ang)) / 4096);
          s.mode = "fly";
        }
      }
    }
    if (s.mode === "swing") {
      // after a catch the hands slide down to the end of the vine, keeping their speed
      const full = s.vines[s.vine].len;
      if (s.ropeLen < full) {
        const next = Math.min(full, s.ropeLen + 3);
        s.w = Math.trunc((s.w * s.ropeLen) / next);
        s.ropeLen = next;
      }
      // pendulum: angular acceleration = -(g / len) sin(a), plus a little pump while the swing is small
      const acc = -Math.trunc((G * isin(s.ang) * RAD) / (4096 * s.ropeLen * FP));
      s.w += acc;
      // pump: while the swing has less energy than a 75 degree swing, each frame adds a little speed
      // (energy per unit mass, in px and frames: 1/2 L^2 w^2 + g L (1 - cos a); IEEE doubles are exact enough
      // and identical on every engine for + - * / and sqrt)
      const L = s.ropeLen;
      const wr = s.w / RAD;
      const e = 0.5 * L * L * wr * wr + (G / FP) * L * (1 - icos(s.ang) / 4096);
      const eTarget = (G / FP) * L * 0.74; // a 75 degree swing
      if (e < eTarget && s.w !== 0) s.w += Math.sign(s.w) * PUMP;
      s.ang += s.w;
      place(s);
    } else {
      s.vy += G;
      s.x += s.vx;
      s.y += s.vy;
      tryCatch(s); // the hands grab any vine they pass
      if (s.y > RIVER_Y * FP) s.end = "river";
    }
    const hx = Math.floor(s.x / FP);
    const hy = Math.floor(s.y / FP);
    if (hx > s.best) s.best = hx;
    for (const f of s.fruit) {
      if (f.taken) continue;
      if (Math.abs(f.x - hx) <= FRUIT_R && Math.abs(f.y - (hy + 8)) <= FRUIT_R + 4) {
        f.taken = true;
        s.fruitTaken++;
      }
    }
    while (s.vines[s.vines.length - 1].x < hx + 400) addVine(s);
    // drop what's far behind, keeping the index of the vine in hand valid
    while (s.vines.length > 3 && s.vines[0].x < hx - 160 && s.vine > 0) {
      s.vines.shift();
      s.vine--;
    }
    while (s.fruit.length && s.fruit[0].x < hx - 160) s.fruit.shift();
    s.score = Math.floor(Math.max(0, s.best - 40) / 4) + s.fruitTaken * FRUIT_SCORE;
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

export function hashVineSwing(s: VineSwingState): number {
  let h = 0x811c9dc5;
  h = mix(h, s.frame);
  h = mix(h, s.score);
  h = mix(h, s.x);
  h = mix(h, s.y);
  h = mix(h, s.rng.state);
  h = mix(h, s.catches);
  return h;
}
