// Cobble Kart: a time trial on a closed street circuit. The kart accelerates on its own; hold left or
// right to steer. Off the cobbles (past the kerb) it slows to a crawl. Three laps, fastest time wins.
// Integer-only: position in 1/256 px (FP), heading in 1/1024 of a turn, trig from an integer table.
// The progress check walks the centreline segment by segment, so cutting a corner never counts.

import { type Game, mix } from "../engine.ts";
import { TRACKS, type TrackData } from "./kart-tracks.ts";

export const FP = 256;
export const TURN = 1024; // heading units per full turn
export const LAPS = 3;
export const COUNTDOWN = 120; // frames before the lights go green
export const ACT = { leftDown: 1, leftUp: 2, rightDown: 3, rightUp: 4 } as const;
/** A finish time t (ms) is stored as SCORE_CAP_MS - t, so a faster lap is a higher score and the boards,
 * prizes and profiles that rank by highest score need no special case. 0 means no finish. */
export const SCORE_CAP_MS = 600_000;

const MAX_FRAMES = COUNTDOWN + 60 * 180;
const V_MAX = 3 * FP; // on the cobbles, per frame
const V_OFF = FP; // off the track
const ACCEL = 7;
const DRAG_OFF = 22; // per frame while above V_OFF off track
const STEER = 10; // heading units per frame at low speed
const STEER_FAST = 7; // at top speed
const SCRUB = 2; // speed lost per frame while steering

// sin(a) * 4096 for a in [0, 1024), from Bhaskara's integer approximation (max error about 0.2%).
// Plain integer and double arithmetic, so every engine builds the same table.
const SIN = new Int32Array(TURN);
for (let a = 0; a < TURN; a++) {
  const half = a & 511;
  const u = half * (512 - half);
  const v = Math.floor((4096 * 16 * u) / (5 * 262144 - 4 * u));
  SIN[a] = a < 512 ? v : -v;
}
const sin = (a: number) => SIN[a & (TURN - 1)];
const cos = (a: number) => SIN[(a + 256) & (TURN - 1)];

export interface KartState {
  frame: number;
  track: string;
  x: number; // FP
  y: number; // FP
  head: number; // 0..1023
  v: number; // FP per frame
  left: boolean;
  right: boolean;
  seg: number; // centreline segment the kart is on
  lap: number; // laps completed
  lapFrames: number[]; // frame each lap was completed on
  offFrames: number; // frames spent off the track
  finished: boolean;
  offTrack: boolean;
}

const n = (t: TrackData) => t.pts.length / 2;
const px = (t: TrackData, i: number) => t.pts[2 * (((i % n(t)) + n(t)) % n(t))];
const py = (t: TrackData, i: number) => t.pts[2 * (((i % n(t)) + n(t)) % n(t)) + 1];

/** Is point (x, y) (px) within `r` of segment i? Integer only: compares squares, no division. */
function near(t: TrackData, i: number, x: number, y: number, r: number): boolean {
  const ax = px(t, i), ay = py(t, i), bx = px(t, i + 1), by = py(t, i + 1);
  const dx = bx - ax, dy = by - ay;
  const wx = x - ax, wy = y - ay;
  const len2 = dx * dx + dy * dy;
  const dot = wx * dx + wy * dy;
  if (dot <= 0) return wx * wx + wy * wy <= r * r;
  if (dot >= len2) {
    const ex = x - bx, ey = y - by;
    return ex * ex + ey * ey <= r * r;
  }
  const cross = wx * dy - wy * dx;
  return cross * cross <= r * r * len2;
}
/** Has the point passed the end of segment i (projection beyond its far end)? */
function past(t: TrackData, i: number, x: number, y: number): boolean {
  const ax = px(t, i), ay = py(t, i), bx = px(t, i + 1), by = py(t, i + 1);
  const dx = bx - ax, dy = by - ay;
  return (x - ax) * dx + (y - ay) * dy >= dx * dx + dy * dy;
}

export function makeKart(trackKey: string): Game<KartState> {
  const t = TRACKS[trackKey];
  return {
    id: "kart-" + trackKey,
    maxFrames: MAX_FRAMES,
    actions: [ACT.leftDown, ACT.leftUp, ACT.rightDown, ACT.rightUp],
    init() {
      // the seed is unused: a time trial is the same track for everyone
      return {
        frame: 0,
        track: trackKey,
        x: px(t, 0) * FP,
        y: py(t, 0) * FP,
        head: t.head,
        v: 0,
        left: false,
        right: false,
        seg: 0,
        lap: 0,
        lapFrames: [],
        offFrames: 0,
        finished: false,
        offTrack: false,
      };
    },
    step(s, actions) {
      for (const a of actions) {
        if (a === ACT.leftDown) s.left = true;
        else if (a === ACT.leftUp) s.left = false;
        else if (a === ACT.rightDown) s.right = true;
        else if (a === ACT.rightUp) s.right = false;
      }
      s.frame++;
      if (s.frame <= COUNTDOWN) return;

      const steer = (s.right ? 1 : 0) - (s.left ? 1 : 0);
      if (steer !== 0) {
        const rate = STEER - (((STEER - STEER_FAST) * s.v) / V_MAX) | 0;
        s.head = (s.head + steer * rate + TURN) & (TURN - 1);
        s.v = Math.max(0, s.v - SCRUB);
      }
      const cx = s.x >> 8;
      const cy = s.y >> 8;
      let on = false;
      for (let k = -1; k <= 2 && !on; k++) if (near(t, s.seg + k, cx, cy, t.hw)) on = true;
      s.offTrack = !on;
      if (on) s.v = Math.min(V_MAX, s.v + ACCEL);
      else {
        s.offFrames++;
        s.v = s.v > V_OFF ? Math.max(V_OFF, s.v - DRAG_OFF) : Math.min(V_OFF, s.v + ACCEL);
      }
      s.x += (s.v * cos(s.head)) >> 12;
      s.y += (s.v * sin(s.head)) >> 12;

      // progress: move to the next segment only while close to the line and past the current one's end
      const nx = s.x >> 8;
      const ny = s.y >> 8;
      for (let guard = 0; guard < 3; guard++) {
        if (!past(t, s.seg, nx, ny) || !near(t, s.seg + 1, nx, ny, t.hw * 2)) break;
        s.seg++;
        if (s.seg >= n(t)) {
          s.seg = 0;
          s.lap++;
          s.lapFrames.push(s.frame - COUNTDOWN);
          if (s.lap >= LAPS) s.finished = true;
        }
      }
    },
    over: (s) => s.finished || s.frame >= MAX_FRAMES,
    score: (s) => (s.finished ? Math.max(1, SCORE_CAP_MS - framesToMs(s.lapFrames[LAPS - 1])) : 0),
  };
}

export const framesToMs = (f: number) => Math.floor((f * 1000) / 60);
/** 1:02.35 style, from milliseconds. */
export function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}
/** Score back to the finish time it encodes. */
export const scoreToMs = (score: number) => SCORE_CAP_MS - score;

export function hashKart(s: KartState): number {
  let h = 0x811c9dc5;
  for (const v of [s.frame, s.x, s.y, s.head, s.v, s.seg, s.lap, s.offFrames, ...s.lapFrames]) h = mix(h, v);
  return h;
}

export const TRACK_KEYS = Object.keys(TRACKS);
export { TRACKS };
