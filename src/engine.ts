// Deterministic game core shared by the browser and the Worker.
// The browser plays a run and records its inputs; the Worker replays the same inputs from the same seed
// and only accepts the score it computes itself. Games use integers only (no Math.sin, no float drift),
// so V8 in Chrome, JavaScriptCore in Safari and workerd all reach the same state frame by frame.

export const FPS = 60;

/** xorshift32 over a uint32 state. Same sequence on every JS engine. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x;
  }
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + (this.next() % (hi - lo + 1));
  }
  get state(): number {
    return this.s;
  }
}

/** One input: the frame it applies to and an action code the game defines. */
export type InputEvent = readonly [frame: number, action: number];

export interface Game<S> {
  id: string;
  /** Hard stop so a replay can never run forever. */
  maxFrames: number;
  /** Action codes this game accepts. Anything else rejects the run. */
  actions: readonly number[];
  /** For games whose actions carry a value (a shot at a screen point): accepts codes beyond `actions`. */
  isAction?(a: number): boolean;
  init(seed: number): S;
  /** Advance one frame. `actions` are the inputs recorded for this frame, in order. */
  step(s: S, actions: readonly number[]): void;
  over(s: S): boolean;
  score(s: S): number;
}

export type ReplayResult<S = unknown> =
  | { ok: true; score: number; frames: number; hash: number; state: S }
  | { ok: false; reason: string };

/** Cheap rolling hash of a run's final numbers, logged with the score to spot client/server drift. */
export function mix(h: number, v: number): number {
  h ^= v >>> 0;
  h = Math.imul(h, 0x01000193) >>> 0;
  return h;
}

/**
 * Replays a run. Events must be sorted by frame, inside [0, maxFrames), use known actions,
 * and stop at the frame the game ended (no inputs after game over).
 */
export function replay<S>(
  game: Game<S>,
  seed: number,
  events: readonly InputEvent[],
  hashState?: (s: S) => number,
): ReplayResult<S> {
  if (events.length > game.maxFrames) return { ok: false, reason: "too_many_inputs" };
  let prev = -1;
  for (const ev of events) {
    if (!Array.isArray(ev) || ev.length !== 2) return { ok: false, reason: "bad_event" };
    const [f, a] = ev;
    if (!Number.isInteger(f) || f < 0 || f >= game.maxFrames) return { ok: false, reason: "bad_frame" };
    if (f < prev) return { ok: false, reason: "unsorted" };
    if (!(game.isAction ? game.isAction(a) : game.actions.includes(a))) return { ok: false, reason: "bad_action" };
    prev = f;
  }
  const s = game.init(seed);
  let i = 0;
  let frame = 0;
  const now: number[] = [];
  while (frame < game.maxFrames && !game.over(s)) {
    now.length = 0;
    while (i < events.length && events[i][0] === frame) now.push(events[i++][1]);
    game.step(s, now);
    frame++;
  }
  if (i < events.length) return { ok: false, reason: "inputs_after_end" };
  return { ok: true, score: game.score(s), frames: frame, hash: hashState ? hashState(s) : 0, state: s };
}

/** Records inputs during live play, in the exact shape `replay` expects. */
export class Recorder {
  readonly events: InputEvent[] = [];
  push(frame: number, action: number) {
    this.events.push([frame, action]);
  }
}
