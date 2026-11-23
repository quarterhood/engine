// Drone Range: a target hangar on a space station. Red drones fly in and close on you; shoot them before
// they get near enough to fire. Gold drones take two hits and pay more. Green courier drones are friendly:
// hit one and it costs a shield. Eight rounds, then the gun reloads (or reload early).
// The field is screen space, 0..255 across and down in 1/256 steps, so every device plays the same game.
// A shot is one action that carries its aim: SHOT_BASE + u * 256 + v.

import { type Game, Rng, mix } from "../engine.ts";
import { isin } from "./vineswing.ts";

export const FP = 256;
export const ACT = { reload: 1 } as const;
export const SHOT_BASE = 1000;
export const shotAction = (u: number, v: number) => SHOT_BASE + (u & 255) * 256 + (v & 255);
export const AMMO = 8;
export const SHIELDS = 3;
export const RELOAD = 48; // frames
export const NEAR = 46 * FP; // a red drone this big is close enough to fire
const MAX_FRAMES = 60 * 240;
const TURN = 1 << 20;

export type Kind = "red" | "gold" | "green";
export interface Drone {
  id: number;
  kind: Kind;
  x: number; // FP, 0..255
  y: number;
  vx: number;
  vy: number;
  r: number; // FP radius on screen; grows as it closes in
  dr: number;
  hp: number;
  wob: number; // wobble phase
  t: number;
}

export interface DronesState {
  frame: number;
  rng: Rng;
  drones: Drone[];
  nextId: number;
  spawnIn: number;
  ammo: number;
  reloading: number; // frames left, 0 = ready
  shields: number;
  combo: number;
  bestCombo: number;
  hits: number;
  shots: number;
  couriersHit: number;
  /** what just happened (for sound and sparks): kind, screen spot, frame */
  last: { e: "hit" | "kill" | "miss" | "courier" | "zap" | "reload" | "empty"; x: number; y: number; at: number } | null;
  end: "down" | "time" | null;
  score: number;
}

function spawn(s: DronesState) {
  const lvl = Math.min(1, s.frame / (60 * 150)); // ramps over two and a half minutes
  const roll = s.rng.int(0, 99);
  const kind: Kind = roll < 14 ? "green" : roll < 26 + lvl * 8 ? "gold" : "red";
  // entry points: the two side doors, the ceiling vents, the far hatch in the middle
  const gate = s.rng.int(0, 3);
  let x: number, y: number, vx: number, vy: number;
  const sp = (60 + Math.floor(lvl * 90) + s.rng.int(0, 40)) | 0; // FP per frame
  if (gate === 0) (x = 4 * FP), (y = s.rng.int(70, 150) * FP), (vx = sp), (vy = s.rng.int(-20, 20));
  else if (gate === 1) (x = 251 * FP), (y = s.rng.int(70, 150) * FP), (vx = -sp), (vy = s.rng.int(-20, 20));
  else if (gate === 2) (x = s.rng.int(50, 205) * FP), (y = 8 * FP), (vx = s.rng.int(-40, 40)), (vy = sp >> 1);
  else (x = s.rng.int(100, 155) * FP), (y = s.rng.int(90, 120) * FP), (vx = s.rng.int(-60, 60)), (vy = s.rng.int(-30, 30));
  const green = kind === "green";
  s.drones.push({
    id: s.nextId++,
    kind,
    x,
    y,
    vx,
    vy,
    r: (green ? 14 : 10) * FP,
    // couriers cross and leave; hostiles close in, faster as the shift goes on
    dr: green ? 0 : 6 + Math.floor(lvl * 10) + s.rng.int(0, 4),
    hp: kind === "gold" ? 2 : 1,
    wob: s.rng.int(0, TURN - 1),
    t: 0,
  });
  s.spawnIn = Math.max(22, 80 - Math.floor(lvl * 50)) + s.rng.int(0, 30);
}

function note(s: DronesState, e: NonNullable<DronesState["last"]>["e"], x: number, y: number) {
  s.last = { e, x, y, at: s.frame };
}

function shoot(s: DronesState, u: number, v: number) {
  if (s.reloading) return;
  if (s.ammo <= 0) {
    s.reloading = RELOAD;
    note(s, "empty", u, v);
    return;
  }
  s.ammo--;
  s.shots++;
  // the nearest drone (largest on screen) under the shot takes it
  let hit: Drone | null = null;
  const px = u * FP + FP / 2;
  const py = v * FP + FP / 2;
  for (const d of s.drones) {
    const rr = d.r + 3 * FP; // a little forgiveness around the hull
    const dx = (d.x - px) / FP;
    const dy = (d.y - py) / FP;
    if (dx * dx + dy * dy <= (rr / FP) ** 2 && (!hit || d.r > hit.r)) hit = d;
  }
  if (!hit) {
    s.combo = 0;
    note(s, "miss", u, v);
  } else if (hit.kind === "green") {
    s.couriersHit++;
    s.shields--;
    s.combo = 0;
    s.score = Math.max(0, s.score - 50);
    s.drones = s.drones.filter((d) => d !== hit);
    note(s, "courier", hit.x / FP, hit.y / FP);
  } else {
    hit.hp--;
    s.hits++;
    if (hit.hp > 0) note(s, "hit", hit.x / FP, hit.y / FP);
    else {
      s.combo++;
      s.bestCombo = Math.max(s.bestCombo, s.combo);
      // further away (smaller) is worth more: a quick shot beats a panicked one
      const far = Math.max(0, Math.floor((NEAR - hit.r) / (4 * FP)));
      s.score += (hit.kind === "gold" ? 30 : 10) + far + Math.min(10, s.combo) * 2;
      s.drones = s.drones.filter((d) => d !== hit);
      note(s, "kill", hit.x / FP, hit.y / FP);
    }
  }
  if (s.ammo === 0) s.reloading = RELOAD;
}

export const DroneRange: Game<DronesState> = {
  id: "drone-range",
  maxFrames: MAX_FRAMES,
  actions: [ACT.reload, SHOT_BASE],
  isAction: (a) => a === ACT.reload || (Number.isInteger(a) && a >= SHOT_BASE && a < SHOT_BASE + 65536),
  init(seed) {
    return {
      frame: 0,
      rng: new Rng(seed),
      drones: [],
      nextId: 1,
      spawnIn: 50,
      ammo: AMMO,
      reloading: 0,
      shields: SHIELDS,
      combo: 0,
      bestCombo: 0,
      hits: 0,
      shots: 0,
      couriersHit: 0,
      last: null,
      end: null,
      score: 0,
    };
  },
  step(s, actions) {
    if (s.end) return;
    for (const a of actions) {
      if (a === ACT.reload) {
        if (!s.reloading && s.ammo < AMMO) {
          s.reloading = RELOAD;
          note(s, "reload", 128, 128);
        }
      } else if (a >= SHOT_BASE) {
        const c = a - SHOT_BASE;
        shoot(s, c >> 8, c & 255);
      }
    }
    if (s.reloading && --s.reloading === 0) s.ammo = AMMO;

    if (--s.spawnIn <= 0) spawn(s);
    const keep: Drone[] = [];
    for (const d of s.drones) {
      d.t++;
      // drift with a wobble; hostiles home in toward the middle of the view as they close
      const w = isin(d.wob + d.t * 9000);
      d.x += d.vx + Math.trunc((w * 40) / 4096);
      d.y += d.vy + Math.trunc((isin(d.wob + d.t * 6000 + TURN / 4) * 24) / 4096);
      if (d.kind !== "green") {
        d.vx += Math.sign(128 * FP - d.x) * 2;
        d.vy += Math.sign(118 * FP - d.y) * 2;
        d.vx = Math.max(-200, Math.min(200, d.vx));
        d.vy = Math.max(-160, Math.min(160, d.vy));
      }
      d.r += d.dr;
      if (d.kind !== "green" && d.r >= NEAR) {
        s.shields--;
        s.combo = 0;
        note(s, "zap", d.x / FP, d.y / FP);
        continue;
      }
      const out = d.x < -20 * FP || d.x > 276 * FP || d.y < -20 * FP || d.y > 276 * FP;
      if (out) continue;
      keep.push(d);
    }
    s.drones = keep;
    if (s.shields <= 0) s.end = "down";
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

export function hashDrones(s: DronesState): number {
  let h = 0x811c9dc5;
  h = mix(h, s.frame);
  h = mix(h, s.score);
  h = mix(h, s.shields);
  h = mix(h, s.hits);
  h = mix(h, s.shots);
  h = mix(h, s.drones.length);
  h = mix(h, s.rng.state);
  return h;
}
