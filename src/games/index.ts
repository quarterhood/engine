// Every playable game, keyed by id. The Worker replays submissions through this table.
import type { Game, InputEvent } from "../engine.ts";
import { Bullseye, type BullseyeState, hashBullseye } from "./bullseye.ts";
import { CoinStack, type CoinStackState, hashCoinStack } from "./coinstack.ts";
import { HoodDash, type HoodDashState, hashHoodDash } from "./hooddash.ts";
import { type KartState, SCORE_CAP_MS, hashKart, makeKart } from "./kart.ts";
import { VineSwing, type VineSwingState, hashVineSwing } from "./vineswing.ts";
import { ReefDive, type ReefDiveState, hashReefDive } from "./reefdive.ts";
import { DuneSkimmer, type DuneState, hashDune } from "./dune.ts";
import { HarborBrawl, type BrawlState, hashBrawl } from "./brawl.ts";
import { DroneRange, type DronesState, hashDrones } from "./drones.ts";
import { FrostCurling, type CurlingState, hashCurling } from "./curling.ts";

export interface Entry<S> {
  game: Game<S>;
  hash: (s: S) => number;
  /** Patterns that look scripted. A flagged run waits for review instead of going on the board. */
  flags: (s: S, events: readonly InputEvent[]) => string[];
}

const coinStack: Entry<CoinStackState> = {
  game: CoinStack,
  hash: hashCoinStack,
  flags(s, events) {
    const out: string[] = [];
    const coins = s.stack.length - 1;
    if (coins >= 25 && s.perfects / coins > 0.85) out.push("perfect_rate");
    if (coins > 150) out.push("tall_stack");
    // Human drop timing drifts; a script that waits a fixed delay after each landing does not.
    if (events.length >= 20) {
      const gaps: number[] = [];
      for (let i = 1; i < events.length; i++) gaps.push(events[i][0] - events[i - 1][0]);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
      if (mean > 0 && sd / mean < 0.04) out.push("even_timing");
    }
    return out;
  },
};

const hoodDash: Entry<HoodDashState> = {
  game: HoodDash,
  hash: hashHoodDash,
  flags(s) {
    const out: string[] = [];
    // Past this distance the runner is at top speed for minutes; worth a look before it tops the board.
    if (s.x / 256 > 30000) out.push("long_run");
    return out;
  },
};

const bullseye: Entry<BullseyeState> = {
  game: Bullseye,
  hash: hashBullseye,
  flags(s) {
    const out: string[] = [];
    if (s.shots.length >= 15 && s.tens / s.shots.length > 0.8) out.push("perfect_rate");
    return out;
  },
};

const vineSwing: Entry<VineSwingState> = {
  game: VineSwing,
  hash: hashVineSwing,
  flags(s, events) {
    const out: string[] = [];
    // a look-ahead bot that never misses a good moment reaches about 700 catches in the full four minutes
    if (s.catches > 600) out.push("long_run");
    if (events.length > 6000) out.push("input_flood");
    return out;
  },
};

const reefDive: Entry<ReefDiveState> = {
  game: ReefDive,
  hash: hashReefDive,
  flags(s, events) {
    const out: string[] = [];
    // only a look-ahead bot reliably lasts the full four minutes
    if (s.end === "time") out.push("long_run");
    if (events.length > 6000) out.push("input_flood");
    return out;
  },
};

const dune: Entry<DuneState> = {
  game: DuneSkimmer,
  hash: hashDune,
  flags(s, events) {
    const out: string[] = [];
    // a look-ahead bot lasts the four minutes; few people will
    if (s.end === "time") out.push("long_run");
    if (events.length > 8000) out.push("input_flood");
    return out;
  },
};

const brawl: Entry<BrawlState> = {
  game: HarborBrawl,
  hash: hashBrawl,
  flags(s, events) {
    const out: string[] = [];
    // a bot that parries every tell frame-perfectly reaches about rival 9 in four minutes
    if (s.round >= 10) out.push("deep_run");
    if (s.parries >= 20 && s.parries / Math.max(1, s.parries + s.kos * 3) > 0.8) out.push("parry_rate");
    if (events.length > 8000) out.push("input_flood");
    return out;
  },
};

const drones: Entry<DronesState> = {
  game: DroneRange,
  hash: hashDrones,
  flags(s, events) {
    const out: string[] = [];
    // people miss now and then; near-perfect aim over many shots is worth a look
    if (s.shots >= 80 && s.hits / s.shots > 0.97) out.push("aim_rate");
    if (s.end === "time") out.push("long_run");
    if (events.length > 6000) out.push("input_flood");
    return out;
  },
};

const curling: Entry<CurlingState> = {
  game: FrostCurling,
  hash: hashCurling,
  flags(s, events) {
    const out: string[] = [];
    // a timing bot that never misses lands about 30 points an end; a run of near-perfect ends is worth a look
    if (s.endScores.length >= 3 && s.endScores.every((x) => x >= 40)) out.push("perfect_ends");
    if (events.length > 6000) out.push("input_flood");
    return out;
  },
};

// Cobble Kart: a finish faster than these (ms) is beyond what a line-following bot reaches; hold it for review.
const KART_PAR: Record<string, number> = { square: 41000, canal: 49000, clock: 50500 };
const kart = (key: string): Entry<KartState> => ({
  game: makeKart(key),
  hash: hashKart,
  flags(s, events) {
    const out: string[] = [];
    if (s.finished && SCORE_CAP_MS - makeKart(key).score(s) < KART_PAR[key]) out.push("fast_finish");
    if (events.length > 4000) out.push("input_flood");
    return out;
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const REGISTRY: Record<string, Entry<any>> = {
  "coin-stack": coinStack,
  "hood-dash": hoodDash,
  "bullseye-wind": bullseye,
  "vine-swing": vineSwing,
  "reef-dive": reefDive,
  "dune-skimmer": dune,
  "harbor-brawl": brawl,
  "drone-range": drones,
  "frost-curling": curling,
  "kart-square": kart("square"),
  "kart-canal": kart("canal"),
  "kart-clock": kart("clock"),
};
