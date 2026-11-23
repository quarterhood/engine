# quarterhood-engine

The game code behind [Quarterhood](https://quarterhood.com), a skill arcade on Robinhood Chain, and a verifier
for any scored run.

Quarterhood never trusts a score from a browser. When a run starts, the server deals a random seed. The browser
records inputs only: the frame each press landed on and an action code. When the run ends, the server replays
those inputs from the seed with this exact code and stores the score it computes, with the frame count and a hash
of the final state. This repository is that code, so you can do the same replay yourself.

## Verify a run

Every scored run's seed and inputs are public. Take a run id from a board's "Watch" link or a replay page:

```
git clone <this repository> && cd quarterhood-engine
node bin/verify.ts 704d726d9eee9bf0e00729265344f54c
```

```
run     704d726d… · coin-stack · ranked · week of 2026-11-23
seed    9e6f529f · 7 inputs
replay  score 110 · frames 728 · hash 94b79f1e
server  score 110 · frames 728 · hash 94b79f1e
MATCH
```

Node 23.6 or later runs the TypeScript directly; there are no dependencies. Exit code 0 means match.

The same data over HTTP:

- `GET https://quarterhood.com/api/run/<id>`: game, mode, week, seed, score, frames, hash, player
- `GET https://quarterhood.com/api/run/<id>/inputs`: `{ "seed": n, "events": [[frame, action], …] }`

Or in a browser: `https://quarterhood.com/verify?r=<id>`.

## What is in here

- `src/engine.ts`: the deterministic core. `Rng` (xorshift32), the `Game` interface, `replay()` and the state hash.
- `src/games/*.ts`: one simulation per game (Coin Stack, Hood Dash, Bullseye Wind, Vine Swing, Reef Dive,
  Dune Skimmer, Harbor Brawl, Drone Range, Frost Curling, Cobble Kart). `index.ts` maps a game id to its code.
- `bin/verify.ts`: the verifier.

Every simulation uses integers only: no `Math.sin`, no floating-point state. That is what lets V8, JavaScriptCore
and workerd reach the same state on the same frame.

## What is not in here

Rendering, sound, the website and the server's secrets. The `flags()` checks in `src/games/index.ts` are public:
they mark runs that look scripted, and those runs wait for a person to review them before they reach a board.
Ranked top-3 scores from players with fewer than 5 scored runs also wait for review.

## Tests

```
node --test test/
```

Golden replays (`fixtures/golden.json`) pin the score, frame count and state hash of fixed inputs for every game,
and `fixtures/coin-stack.json` is a run played on the site. A rule change that alters any result fails the tests,
so it can only land on purpose, with new fixtures in the same commit.

## License

MIT
