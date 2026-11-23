#!/usr/bin/env node
// Verify a Quarterhood run without trusting the website: fetch its public seed and inputs, replay them with this
// repository's game code, and compare the score, frames and hash with what the server stored.
//
//   node bin/verify.ts <run id | replay link>           (Node 23.6+ runs TypeScript directly)
//   node bin/verify.ts --file inputs.json --game coin-stack
//
// Exit code 0 = match, 1 = mismatch or error.
import { readFileSync } from "node:fs";
import { replay } from "../src/engine.ts";
import { REGISTRY } from "../src/games/index.ts";

const API = process.env.QUARTERHOOD_API ?? "https://quarterhood.com/api";
const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
const args = process.argv.slice(2);

async function getJson(url: string) {
  const r = await fetch(url, { headers: { "user-agent": "quarterhood-verify" } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

async function main() {
  let game: string;
  let seed: number;
  let events: [number, number][];
  let stored: { score: number; frames: number; hash: number } | null = null;

  if (args[0] === "--file") {
    const inp = JSON.parse(readFileSync(args[1], "utf8"));
    game = args[args.indexOf("--game") + 1];
    seed = inp.seed;
    events = inp.events;
  } else {
    const id = (args[0] ?? "").match(/[0-9a-f]{32}/i)?.[0]?.toLowerCase();
    if (!id) throw new Error("usage: node bin/verify.ts <run id | replay link>");
    const [run, inp] = await Promise.all([getJson(`${API}/run/${id}`), getJson(`${API}/run/${id}/inputs`)]);
    game = run.game;
    seed = inp.seed;
    events = inp.events;
    stored = { score: run.score, frames: run.frames, hash: run.hash };
    console.log(`run     ${id} · ${game} · ${run.mode} · week of ${run.week}`);
  }
  const entry = REGISTRY[game];
  if (!entry) throw new Error(`unknown game "${game}"`);
  const r = replay(entry.game, seed >>> 0, events, entry.hash);
  if (!r.ok) {
    console.log(`replay  failed: ${r.reason}`);
    process.exit(1);
  }
  console.log(`seed    ${hex(seed)} · ${events.length} inputs`);
  console.log(`replay  score ${r.score} · frames ${r.frames} · hash ${hex(r.hash)}`);
  if (!stored) return;
  console.log(`server  score ${stored.score} · frames ${stored.frames} · hash ${hex(stored.hash)}`);
  const ok = r.score === stored.score && r.frames === stored.frames && r.hash >>> 0 === stored.hash >>> 0;
  console.log(ok ? "MATCH" : "MISMATCH");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
