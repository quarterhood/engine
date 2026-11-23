// Dune Skimmer: sandboard down an endless dune field in a sandstorm. Steer left and right; crests throw you
// into the air when you're fast enough, and in the air you clear rocks you'd otherwise hit. Crystals are
// worth points. Hit a rock or a ruin pillar on the ground and the run ends.
// Integer-only physics (positions in 1/256 px) so the Worker replays it exactly.
// Axes: z = distance down the field, x = across (-LANE..LANE), y = height.

import { type Game, Rng, mix } from "../engine.ts";
import { icos } from "./vineswing.ts";

export const FP = 256;
export const ACT = { leftDown: 1, leftUp: 2, rightDown: 3, rightUp: 4 } as const;
export const LANE = 64; // px either side of the centre line
export const ROCK_R = 7;
export const ROCK_H = 11; // px: clear this much air over a rock and you pass it
export const PILLAR_R = 6;
export const PILLAR_H = 60;
export const CRYSTAL_R = 7;
const CRYSTAL_SCORE = 25;

const TURN = 1 << 20;
const G = 5; // FP px per frame^2
const STEER = 70; // FP px per frame^2 of sideways push on the sand
const SIDE_MAX = 640; // FP px per frame
const MAX_FRAMES = 60 * 240;

export interface Dune {
  z: number; // px where it starts
  len: number; // px
  amp: number; // px of crest height
}
export type Thing =
  | { kind: "rock"; x: number; z: number; r: number }
  | { kind: "arch"; x: number; z: number; gap: number } // two pillars at x - gap and x + gap
  | { kind: "crystal"; x: number; z: number; y: number; taken: boolean };

export interface DuneState {
  frame: number;
  rng: Rng;
  left: boolean;
  right: boolean;
  x: number; // FP
  z: number; // FP
  y: number; // FP height
  vx: number;
  vy: number;
  speed: number; // FP px per frame, down the field
  grounded: boolean;
  air: number; // frames in the air on the current jump
  jumps: number;
  dunes: Dune[];
  things: Thing[];
  crystals: number;
  end: "crash" | "time" | null;
  hit: { x: number; z: number } | null;
  score: number;
}

/** Ground height in FP at a distance in FP. */
export function groundAt(s: { dunes: Dune[] }, zfp: number): number {
  const z = zfp / FP;
  for (const d of s.dunes) {
    if (z < d.z) return 0;
    if (z < d.z + d.len) {
      const dz = zfp - d.z * FP;
      const a = Math.trunc((dz * TURN) / (d.len * FP));
      return Math.trunc((d.amp * FP * (4096 - icos(a))) / 8192);
    }
  }
  return 0;
}

function addDune(s: DuneState) {
  const last = s.dunes[s.dunes.length - 1];
  const z = last ? last.z + last.len : 0;
  const far = Math.min(1, z / 40000);
  s.dunes.push({ z, len: s.rng.int(300, 520), amp: s.rng.int(14, 30) + Math.floor(far * s.rng.int(0, 16)) });
}

function lastThingZ(s: DuneState) {
  return s.things.length ? s.things[s.things.length - 1].z : 260;
}

function addRow(s: DuneState) {
  const z0 = lastThingZ(s);
  const far = Math.min(1, z0 / 50000);
  const z = z0 + s.rng.int(90, 140) - Math.floor(far * 30);
  const roll = s.rng.int(0, 99);
  if (roll < 14) {
    // an old arch: pass between its pillars
    s.things.push({ kind: "arch", x: s.rng.int(-30, 30), z, gap: s.rng.int(20, 26) });
    return;
  }
  // one to three rocks, always leaving a gap at least 34 px wide somewhere across the lane
  const n = 1 + (s.rng.int(0, 99) < 45 + far * 30 ? 1 : 0) + (s.rng.int(0, 99) < far * 40 ? 1 : 0);
  const gapAt = s.rng.int(-LANE + 20, LANE - 20);
  for (let i = 0; i < n; i++) {
    let x = s.rng.int(-LANE + 6, LANE - 6);
    if (Math.abs(x - gapAt) < 24) x = gapAt + (x < gapAt ? -26 : 26);
    s.things.push({ kind: "rock", x, z: z + s.rng.int(-8, 8), r: ROCK_R + s.rng.int(0, 3) });
  }
  // crystals: a short line through the gap, some of them up in the air over a crest
  if (s.rng.int(0, 99) < 60) {
    const high = s.rng.int(0, 99) < 35;
    for (let k = 0; k < 3; k++) s.things.push({ kind: "crystal", x: gapAt, z: z + 30 + k * 16, y: high ? 16 + k * 4 : 4, taken: false });
  }
}

export const DuneSkimmer: Game<DuneState> = {
  id: "dune-skimmer",
  maxFrames: MAX_FRAMES,
  actions: [ACT.leftDown, ACT.leftUp, ACT.rightDown, ACT.rightUp],
  init(seed) {
    const s: DuneState = {
      frame: 0,
      rng: new Rng(seed),
      left: false,
      right: false,
      x: 0,
      z: 0,
      y: 0,
      vx: 0,
      vy: 0,
      speed: 520,
      grounded: true,
      air: 0,
      jumps: 0,
      dunes: [],
      things: [],
      crystals: 0,
      end: null,
      hit: null,
      score: 0,
    };
    while (!s.dunes.length || s.dunes[s.dunes.length - 1].z < 1500) addDune(s);
    while (lastThingZ(s) < 900) addRow(s);
    return s;
  },
  step(s, actions) {
    if (s.end) return;
    for (const a of actions) {
      if (a === ACT.leftDown) s.left = true;
      else if (a === ACT.leftUp) s.left = false;
      else if (a === ACT.rightDown) s.right = true;
      else if (a === ACT.rightUp) s.right = false;
    }
    // speed builds from 2 to 4.6 px per frame over about three minutes
    if (s.speed < 1180 && s.frame % 16 === 0) s.speed += 1;
    // steering: full grip on the sand, a little in the air; the board straightens when you let go
    const steer = (s.right ? 1 : 0) - (s.left ? 1 : 0);
    const grip = s.grounded ? STEER : STEER >> 2;
    if (steer) s.vx += steer * grip;
    else s.vx -= Math.trunc(s.vx / (s.grounded ? 6 : 24));
    s.vx = Math.max(-SIDE_MAX, Math.min(SIDE_MAX, s.vx));
    s.x += s.vx;
    const lim = LANE * FP;
    if (s.x < -lim) (s.x = -lim), (s.vx = 0);
    if (s.x > lim) (s.x = lim), (s.vx = 0);

    // down the field; the ground falling away faster than gravity throws you off a crest
    const g0 = groundAt(s, s.z);
    s.z += s.speed;
    const g1 = groundAt(s, s.z);
    if (s.grounded) {
      const follow = g1 - g0;
      const ballistic = s.vy - G;
      if (follow < ballistic - 2) {
        s.grounded = false;
        s.vy = ballistic;
        s.y += s.vy;
        s.air = 0;
      } else {
        s.vy = follow;
        s.y = g1;
      }
    } else {
      s.vy -= G;
      s.y += s.vy;
      s.air++;
      if (s.y <= g1) {
        s.y = g1;
        s.vy = g1 - g0;
        s.grounded = true;
        if (s.air > 20) s.jumps++;
      }
    }

    const px = Math.floor(s.x / FP);
    const pz = Math.floor(s.z / FP);
    const lift = Math.floor((s.y - g1) / FP); // height above the sand
    for (const t of s.things) {
      if (t.z > pz + 20) break;
      if (Math.abs(t.z - pz) > 14) continue;
      if (t.kind === "rock") {
        if (lift < ROCK_H && (t.x - px) ** 2 + (t.z - pz) ** 2 < (t.r + 4) ** 2) (s.end = "crash"), (s.hit = { x: t.x, z: t.z });
      } else if (t.kind === "arch") {
        for (const side of [-1, 1]) {
          const cx = t.x + side * t.gap;
          if (lift < PILLAR_H && (cx - px) ** 2 + (t.z - pz) ** 2 < (PILLAR_R + 4) ** 2) (s.end = "crash"), (s.hit = { x: cx, z: t.z });
        }
      } else if (!t.taken && (t.x - px) ** 2 + (t.z - pz) ** 2 <= (CRYSTAL_R + 5) ** 2 && Math.abs(lift - t.y) <= 12) {
        t.taken = true;
        s.crystals++;
      }
    }
    while (s.dunes[s.dunes.length - 1].z < pz + 1500) addDune(s);
    while (s.dunes.length > 2 && s.dunes[0].z + s.dunes[0].len < pz - 200) s.dunes.shift();
    while (lastThingZ(s) < pz + 900) addRow(s);
    while (s.things.length && s.things[0].z < pz - 60) s.things.shift();
    s.score = Math.floor(pz / 8) + s.crystals * CRYSTAL_SCORE;
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

export function hashDune(s: DuneState): number {
  let h = 0x811c9dc5;
  h = mix(h, s.frame);
  h = mix(h, s.score);
  h = mix(h, s.x);
  h = mix(h, s.z);
  h = mix(h, s.y);
  h = mix(h, s.rng.state);
  return h;
}
