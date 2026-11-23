// Golden replays: fixed seeds and inputs must keep producing the same score, frame count and state hash.
// If a game's rules change on purpose, regenerate the fixtures in the same commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replay } from "../src/engine.ts";
import { REGISTRY } from "../src/games/index.ts";

type Fixture = { game?: string; seed: number; events: [number, number][]; expect: { score: number; frames: number; hash: number } };
const golden: Record<string, Fixture> = JSON.parse(readFileSync(new URL("../fixtures/golden.json", import.meta.url), "utf8"));
const played: Fixture = JSON.parse(readFileSync(new URL("../fixtures/coin-stack.json", import.meta.url), "utf8"));

for (const [id, f] of Object.entries(golden)) {
  test(`golden replay: ${id}`, () => {
    const e = REGISTRY[id];
    const r = replay(e.game, f.seed, f.events, e.hash);
    assert.ok(r.ok);
    assert.deepEqual({ score: r.score, frames: r.frames, hash: r.hash >>> 0 }, f.expect);
  });
}

test("a run played on the site replays to its stored result", () => {
  const e = REGISTRY[played.game!];
  const r = replay(e.game, played.seed >>> 0, played.events, e.hash);
  assert.ok(r.ok);
  assert.deepEqual({ score: r.score, frames: r.frames, hash: r.hash >>> 0 }, played.expect);
});

test("bad inputs are refused", () => {
  const e = REGISTRY["coin-stack"];
  assert.equal(replay(e.game, 1, [[10, 99]]).ok, false); // unknown action
  assert.equal(replay(e.game, 1, [[20, 1], [10, 1]]).ok, false); // unsorted
  assert.equal(replay(e.game, 1, [[-1, 1]]).ok, false); // bad frame
});

test("replay is pure: same input, same hash, twice", () => {
  for (const [id, f] of Object.entries(golden)) {
    const e = REGISTRY[id];
    const a = replay(e.game, f.seed, f.events, e.hash);
    const b = replay(e.game, f.seed, f.events, e.hash);
    assert.ok(a.ok && b.ok && a.hash === b.hash, id);
  }
});
