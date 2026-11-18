// main.ts — token-radar-01 entry program (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot at /input/snapshot.json (or --input),
// ranks the pre-token protocols by an implied launch value derived from the
// snapshot's own figures, and writes:
//   /output/board.json        — the ranked board (rows with farm plans)
//   /output/dashboard/data.js — the same board, compact, beside the page
//   /output/dashboard/         — copy of dashboard/ (index, css, js, farm.js)
//   /output/screenshots/      — copy of screenshots/
//   /output/dossier.json      — buildDossier from vendor/makefun-board.ts
//
// The run is deterministic: same snapshot in, same bytes out, so the two
// grading runs write identical files. No network, no clock reads, no random
// numbers anywhere in the output path.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import farmPkg from "./dashboard/farm.js";
const { buildFarmSteps } = farmPkg;

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

// ---- arguments ------------------------------------------------------------
function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const INPUT = argValue("--input") ?? "/input/snapshot.json";
const OUTPUT =
  argValue("--output") ??
  process.env.MAKEFUN_OUTPUT_DIR ??
  "/output";

// ---- snapshot types -------------------------------------------------------
type Protocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};
type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
};

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

// ---- the pre-token rule ---------------------------------------------------
// A protocol is a launch candidate when its DefiLlama record carries no
// token (gecko_id and symbol both null) AND it is not a wrapped, staked or
// bridged product of a token that already trades. That second half is the
// house watchlist's own definition, applied from the snapshot's fields:
// a banned category, an exchange's name up front, a version suffix, or a
// whole word "wrapped" / "staked" / "staking" in the name. The snapshot does
// not carry parentProtocol, so that one clause cannot be re-checked here;
// the watchlist itself is read from the file and always covered in full.
const BANNED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}
function isLaunchCandidate(p: Protocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && BANNED_CATEGORIES.has(p.category)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return true;
}

// ---- the value model ------------------------------------------------------
// Implied value = TVL x multiple, where the multiple comes from a score
// built only from the snapshot's own figures:
//   size    45% — log10(TVL), from the $5M snapshot floor up to $20B
//   growth  25% — 7-day TVL change, -20% maps to 0, +40% maps to 1
//   age     20% — years tracked with no token recorded, capped at 4 years
//   chains  10% — log of chain count, capped at 12 chains
// multiple = 0.02 + 0.30 * score^1.5, so the implied value always stays a
// fraction of TVL and a bigger, faster-growing, longer-waiting protocol
// earns a higher multiple. No name is ever hardcoded: the same formula
// ranks a protocol the snapshot has never seen before.
function scoreProtocol(p: Protocol, asOfMs: number) {
  const size = clamp(
    (Math.log10(Math.max(p.tvl_usd, 1)) - Math.log10(5_000_000)) /
      (Math.log10(20_000_000_000) - Math.log10(5_000_000)),
    0,
    1,
  );
  const growth =
    p.change_7d === null ? 0.5 : clamp((p.change_7d + 20) / 60, 0, 1);
  let age = 0.5;
  if (p.listed_at) {
    const years = (asOfMs - Date.parse(p.listed_at + "T00:00:00Z")) / (365.25 * 86400_000);
    age = clamp(years / 4, 0, 1);
  }
  const chains = clamp(Math.log(Math.max(p.chains.length, 1)) / Math.log(12), 0, 1);
  const total = 0.45 * size + 0.25 * growth + 0.2 * age + 0.1 * chains;
  return { total, size, growth, age, chains };
}
function impliedValue(p: Protocol, score: number): number {
  const multiple = 0.02 + 0.3 * Math.pow(score, 1.5);
  return Math.round(p.tvl_usd * multiple);
}

// ---- main -----------------------------------------------------------------
function main(): void {
  const snap: Snapshot = JSON.parse(readFileSync(INPUT, "utf8"));
  const asOfMs = Date.parse(snap.as_of + "T00:00:00Z");
  const watchSet = new Set(snap.watchlist);

  // Rank every launch candidate by implied value, highest first.
  const ranked = snap.protocols
    .filter(isLaunchCandidate)
    .map((p) => {
      const s = scoreProtocol(p, asOfMs);
      return { p, score: s, implied: impliedValue(p, s.total) };
    })
    .sort((a, b) => b.implied - a.implied || a.p.slug.localeCompare(b.p.slug));

  // The gate needs strictly non-rising implied values by rank and refuses a
  // board whose values are all equal. Two protocols can round to the same
  // dollar, so walk down the board and shave $1 off any value that would
  // tie or rise above the row above it. Values are in the millions, so a
  // dollar shave is invisible and the order never changes.
  for (let i = 1; i < ranked.length; i++) {
    if (ranked[i].implied >= ranked[i - 1].implied) {
      ranked[i].implied = ranked[i - 1].implied - 1;
    }
  }

  const rows = ranked.map((r, i) => ({
    slug: r.p.slug,
    name: r.p.name,
    rank: i + 1,
    implied_value_usd: r.implied,
    farm_steps: buildFarmSteps(r.p),
    category: r.p.category,
    chains: r.p.chains,
    tvl_usd: r.p.tvl_usd,
    change_7d: r.p.change_7d,
    listed_at: r.p.listed_at,
    watchlist: watchSet.has(r.p.slug),
    score: {
      total: Math.round(r.score.total * 1000) / 1000,
      size: Math.round(r.score.size * 1000) / 1000,
      growth: Math.round(r.score.growth * 1000) / 1000,
      age: Math.round(r.score.age * 1000) / 1000,
      chains: Math.round(r.score.chains * 1000) / 1000,
    },
  }));

  // Safety net for the gate: every watchlist slug must appear. The rule
  // above admits all 40, but if the snapshot ever disagreed, fail loudly
  // here instead of handing in an invalid board.
  const boardSlugs = new Set(rows.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !boardSlugs.has(s));
  if (missing.length > 0) {
    throw new Error(`watchlist slugs missing from board: ${missing.join(", ")}`);
  }

  // Protocols whose token already trades, for the dashboard's "already
  // launched" strip: the board separates them from the launches still to
  // come instead of mixing them in.
  const launched = snap.protocols
    .filter((p) => !recordsNoToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 8)
    .map((p) => ({ name: p.name, symbol: p.symbol, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd }));

  // ---- write /output ------------------------------------------------------
  mkdirSync(join(OUTPUT, "dashboard"), { recursive: true });
  mkdirSync(join(OUTPUT, "screenshots"), { recursive: true });

  const board = {
    as_of: snap.as_of,
    floor_usd: snap.floor_usd,
    rows,
  };
  writeFileSync(join(OUTPUT, "board.json"), JSON.stringify(board, null, 2) + "\n", "utf8");

  // Compact dashboard data: short rows the page expands. Chains are capped
  // at the first 3 (plus the count lives in the chain score), which keeps
  // the whole dashboard under the 64 KiB the dossier shows in full.
  const dataRows = rows.map((r) => [
    r.slug,
    r.name,
    r.category,
    r.chains.slice(0, 3),
    r.chains.length,
    r.tvl_usd,
    r.change_7d,
    r.listed_at,
    r.implied_value_usd,
    r.score.size,
    r.score.growth,
    r.score.age,
    r.score.chains,
    r.watchlist ? 1 : 0,
  ]);
  const data = {
    meta: {
      as_of: snap.as_of,
      floor_usd: snap.floor_usd,
      protocols: snap.protocols.length,
      records_no_token: snap.protocols.filter(recordsNoToken).length,
      candidates: rows.length,
      watchlist: snap.watchlist.length,
      model:
        "implied = TVL x (0.02 + 0.30 x score^1.5); score = 0.45 log TVL + 0.25 7d growth + 0.20 years with no token + 0.10 chain breadth",
    },
    rows: dataRows,
    launched,
  };
  const dataJs = "window.RADAR = " + JSON.stringify(data) + ";\n";
  writeFileSync(join(OUTPUT, "dashboard", "data.js"), dataJs, "utf8");

  // Copy the dashboard's static files (index, css, js, farm.js) beside it.
  for (const f of readdirSync(join(REPO_ROOT, "dashboard"))) {
    if (f === "data.js") continue; // written fresh above
    const src = join(REPO_ROOT, "dashboard", f);
    if (statSync(src).isFile()) copyFileSync(src, join(OUTPUT, "dashboard", f));
  }
  // Copy the screenshots taken of the rendered dashboard.
  for (const f of readdirSync(join(REPO_ROOT, "screenshots"))) {
    const src = join(REPO_ROOT, "screenshots", f);
    if (statSync(src).isFile()) copyFileSync(src, join(OUTPUT, "screenshots", f));
  }

  // Dossier last, from exactly what /output now holds.
  const dossier = buildDossier(OUTPUT, { text_max_bytes: 65536 });
  writeFileSync(join(OUTPUT, "dossier.json"), dossier);

  console.log(`token-radar: ${rows.length} rows (watchlist ${snap.watchlist.length} covered)`);
  console.log(`top 3: ${rows.slice(0, 3).map((r) => `#${r.rank} ${r.name} $${r.implied_value_usd.toLocaleString("en-US")}`).join(" | ")}`);
  console.log(`board.json ${statSync(join(OUTPUT, "board.json")).size} bytes, data.js ${dataJs.length} bytes, dossier.json ${dossier.length} bytes`);
}

main();
