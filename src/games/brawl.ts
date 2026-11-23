// Harbor Brawl: a one-on-one fight in a rope ring on a harbour deck. Tap to jab, hold and let go for a
// heavy punch, hold the guard to block. Every rival shows its punch before it lands: block just as it comes
// in for a parry, or land a heavy during the wind-up for a counter. Knock a rival down and a tougher one steps in.
// Integer frame counts only, so the Worker replays it exactly.

import { type Game, Rng, mix } from "../engine.ts";

export const ACT = { punchDown: 1, punchUp: 2, guardDown: 3, guardUp: 4 } as const;

export const PLAYER_HP = 100;
const HEAVY_HOLD = 22; // frames of holding before a release throws a heavy
const PARRY = 9; // guard raised this many frames before the impact or fewer = parry
const MAX_FRAMES = 60 * 240;

export type PState = "idle" | "jab" | "heavy" | "recoil" | "hurt";
export type FState = "idle" | "guard" | "windup" | "strike" | "recover" | "stun" | "down";

export interface BrawlState {
  frame: number;
  rng: Rng;
  round: number; // 1-based: the rival number
  php: number;
  fhp: number;
  fmax: number;
  // player
  p: PState;
  pt: number; // frames into the current state
  pHeavyReady: boolean; // the release that started this punch was a heavy
  hold: number; // frames the punch button has been held, -1 when up
  guard: boolean;
  guardAt: number; // frame the guard went up
  // rival
  f: FState;
  ft: number;
  fLen: number; // frames this rival state lasts
  fHand: 0 | 1; // which hand the coming punch uses (for the view)
  // what just happened, for sounds and sparks
  last: "jab" | "heavy" | "counter" | "blocked" | "parry" | "chip" | "hit" | "ko" | null;
  lastAt: number;
  dealt: number;
  parries: number;
  counters: number;
  kos: number;
  end: "ko" | "time" | null;
  score: number;
}

const windupLen = (s: BrawlState) => Math.max(14, 40 - s.round * 4) + s.rng.int(0, Math.max(4, 12 - s.round));
const recoverLen = (s: BrawlState) => Math.max(18, 38 - s.round * 3);
const strikeDmg = (s: BrawlState) => 9 + Math.min(12, s.round * 2);

/** read through a function: hurtRival() can change the rival's state mid-branch */
const knockedDown = (s: BrawlState) => s.f === "down";

function setF(s: BrawlState, f: FState, len: number) {
  s.f = f;
  s.ft = 0;
  s.fLen = len;
}
function note(s: BrawlState, e: BrawlState["last"]) {
  s.last = e;
  s.lastAt = s.frame;
}
function hurtRival(s: BrawlState, dmg: number) {
  s.fhp = Math.max(0, s.fhp - dmg);
  s.dealt += dmg;
  if (s.fhp === 0) {
    s.kos++;
    setF(s, "down", 130);
    note(s, "ko");
  }
}

/** The player's punch connects: what it does depends on what the rival is doing. */
function land(s: BrawlState, heavy: boolean) {
  if (s.f === "down") return;
  if (s.f === "guard") {
    if (heavy) {
      // a heavy breaks the guard
      hurtRival(s, 8);
      if (!knockedDown(s)) setF(s, "stun", 30);
      note(s, "heavy");
    } else {
      note(s, "blocked");
      s.p = "recoil";
      s.pt = 0;
    }
    return;
  }
  if (s.f === "windup") {
    // only a heavy breaks a wind-up; a jab just glances off and the punch still comes
    if (heavy) {
      s.counters++;
      hurtRival(s, 22);
      if (!knockedDown(s)) setF(s, "stun", 44);
      note(s, "counter");
    } else {
      hurtRival(s, 3);
      if (!knockedDown(s)) note(s, "jab");
    }
    return;
  }
  hurtRival(s, heavy ? 15 : 5);
  if (!knockedDown(s) && heavy) setF(s, "stun", 22);
  if (!knockedDown(s)) note(s, heavy ? "heavy" : "jab");
}

function nextRival(s: BrawlState) {
  s.round++;
  s.fmax = 50 + s.round * 20;
  s.fhp = s.fmax;
  s.php = Math.min(PLAYER_HP, s.php + 25);
  setF(s, "idle", 50);
}

export const HarborBrawl: Game<BrawlState> = {
  id: "harbor-brawl",
  maxFrames: MAX_FRAMES,
  actions: [ACT.punchDown, ACT.punchUp, ACT.guardDown, ACT.guardUp],
  init(seed) {
    const s: BrawlState = {
      frame: 0,
      rng: new Rng(seed),
      round: 0,
      php: PLAYER_HP,
      fhp: 0,
      fmax: 0,
      p: "idle",
      pt: 0,
      pHeavyReady: false,
      hold: -1,
      guard: false,
      guardAt: -100,
      f: "idle",
      ft: 0,
      fLen: 60,
      fHand: 0,
      last: null,
      lastAt: -100,
      dealt: 0,
      parries: 0,
      counters: 0,
      kos: 0,
      end: null,
      score: 0,
    };
    nextRival(s);
    s.php = PLAYER_HP;
    setF(s, "idle", 70);
    return s;
  },
  step(s, actions) {
    if (s.end) return;
    for (const a of actions) {
      if (a === ACT.punchDown) {
        if (s.hold < 0) s.hold = 0;
      } else if (a === ACT.punchUp) {
        if (s.hold >= 0 && s.p === "idle" && !s.guard) {
          s.p = s.hold >= HEAVY_HOLD ? "heavy" : "jab";
          s.pt = 0;
        }
        s.hold = -1;
      } else if (a === ACT.guardDown) {
        if (!s.guard) (s.guard = true), (s.guardAt = s.frame);
      } else if (a === ACT.guardUp) s.guard = false;
    }
    if (s.hold >= 0) s.hold++;

    // ---- player ----
    s.pt++;
    if (s.p === "jab") {
      if (s.pt === 6) land(s, false);
      if (s.pt >= 16 && s.p === "jab") s.p = "idle";
    } else if (s.p === "heavy") {
      if (s.pt === 13) land(s, true);
      if (s.pt >= 32 && s.p === "heavy") s.p = "idle";
    } else if (s.p === "recoil") {
      if (s.pt >= 16) s.p = "idle";
    } else if (s.p === "hurt") {
      if (s.pt >= 22) s.p = "idle";
    }

    // ---- rival ----
    s.ft++;
    if (s.f === "strike") {
      // the punch lands on its first frame
      const blocking = s.guard && (s.p === "idle" || s.p === "recoil");
      if (blocking && s.frame - s.guardAt <= PARRY) {
        s.parries++;
        setF(s, "stun", 48);
        note(s, "parry");
      } else if (blocking) {
        s.php = Math.max(0, s.php - 5);
        setF(s, "recover", recoverLen(s));
        note(s, "chip");
      } else {
        s.php = Math.max(0, s.php - strikeDmg(s));
        s.p = "hurt";
        s.pt = 0;
        s.hold = -1;
        setF(s, "recover", recoverLen(s));
        note(s, "hit");
      }
      if (s.php === 0) s.end = "ko";
    } else if (s.ft >= s.fLen) {
      if (s.f === "down") nextRival(s);
      else if (s.f === "windup") setF(s, "strike", 1);
      else if (s.f === "idle" || s.f === "guard") {
        s.fHand = s.rng.int(0, 1) as 0 | 1;
        setF(s, "windup", windupLen(s));
      } else {
        // after recovering or being stunned: wait a while, guard up about half the time
        const len = s.rng.int(Math.max(12, 40 - s.round * 3), Math.max(30, 80 - s.round * 5));
        setF(s, s.rng.int(0, 99) < 45 + Math.min(25, s.round * 3) ? "guard" : "idle", len);
      }
    }

    s.score = s.dealt * 2 + s.kos * 150 + s.parries * 25 + s.counters * 10;
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

export function hashBrawl(s: BrawlState): number {
  let h = 0x811c9dc5;
  h = mix(h, s.frame);
  h = mix(h, s.score);
  h = mix(h, s.php);
  h = mix(h, s.fhp);
  h = mix(h, s.round);
  h = mix(h, s.rng.state);
  return h;
}
