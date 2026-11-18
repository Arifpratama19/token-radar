// farm.js — farm-plan generator shared by main.ts (board.json) and the
// dashboard (app.js), so the steps a reader sees are byte-for-byte the steps
// the board carries. Pure functions, no DOM, no network.
//
// Every plan has 5 steps. Each step names the protocol, its main chain and a
// concrete amount band derived from its TVL, plus what it costs in gas/fees
// and how long it takes. Nothing here names a token: the board only ranks
// protocols whose DefiLlama record carries no token (gecko_id and symbol
// both null), and the copy says "records no token", never "has no token".

// Amount band from TVL: bigger protocols get a bigger suggested position,
// because a farm that is too small to matter wastes the gas it costs.
function bandFor(tvlUsd) {
  if (tvlUsd >= 1000000000) return { deposit: "$200–$500", gas: "$2–$8", tx: "$5–$15" };
  if (tvlUsd >= 100000000) return { deposit: "$100–$250", gas: "$1–$5", tx: "$3–$10" };
  return { deposit: "$25–$100", gas: "$0.50–$3", tx: "$1–$5" };
}

// Category families. A protocol's DefiLlama category picks the family; the
// default family covers anything uncategorised. The family decides what the
// farm actually does: lend, swap, stake LP, mint, bridge or curate.
const FAMILIES = {
  lending: ["Lending", "CDP", "CDP Manager", "Collateral Markets", "Uncollateralized Lending"],
  dex: ["Dexs", "Derivatives", "Options Vault", "Basis Trading"],
  yield: ["Yield", "Yield Aggregator", "Leveraged Farming", "Farm", "Liquidity Manager", "Interest Rate Derivatives"],
  rwa: ["RWA", "Onchain Capital Allocator", "Risk Curators", "CeDeFi", "OTC Marketplace"],
  stake: ["Liquid Staking", "Liquid Restaking", "Restaking", "Staking Pool", "Restaked BTC", "Anchor BTC", "Decentralized BTC"],
  move: ["Bridge", "Canonical Bridge", "Cross Chain Bridge", "Chain", "Payments", "Stablecoin Wrapper", "Dual-Token Stablecoin"],
};

function familyFor(category) {
  if (!category) return "general";
  for (const [fam, cats] of Object.entries(FAMILIES)) {
    if (cats.includes(category)) return fam;
  }
  return "general";
}

// One template set per family. {n} = protocol name, {c} = main chain,
// {d} = deposit band, {g} = gas band, {t} = per-transaction band.
// Steps are written to stay inside 20–600 characters once rendered.
const STEPS = {
  lending: [
    "Open {n} on {c} and connect a fresh wallet you use only for farming; fund it with {d} of a major stablecoin plus {g} of the chain gas token for fees (about 10 minutes to set up).",
    "Supply {d} into {n}'s main lending market on {c} and keep the receipt token in the same wallet — supplied capital is usually the first thing a future distribution counts (one transaction, about {t}, 5 minutes).",
    "Borrow 30–40% of your supplied value in a stablecoin and re-supply it once, so the position shows both sides of the market; keep health factor above 2.0 so a dip cannot liquidate you (about {t} per leg, 15 minutes).",
    "Return every 7 days for 4–8 weeks: top the supply back up if it drifted, claim any points or incentives shown in the app, and log the dates — regular activity beats one big deposit (10 minutes a week, about {g} in gas each visit).",
    "Before any token announcement, withdraw the borrow first, then the supply, in two transactions; never leave a borrow open after you stop watching it (about {t}, 10 minutes).",
  ],
  dex: [
    "Open {n} on {c} with a fresh farming wallet holding {d} in a major asset plus {g} of gas token; check the pool list for the deepest pair first (about 10 minutes).",
    "Swap half of your {d} into the pool's second asset and add both sides as liquidity in the highest-volume pool, keeping the LP receipt in the farming wallet (two transactions, about {t} each, 15 minutes).",
    "Place one small limit or range order if the app offers it, so the position also shows trading activity, not only passive liquidity; size it at 10–20% of the deposit (one transaction, about {t}, 10 minutes).",
    "Return weekly for 4–8 weeks: collect fees, re-balance the range if one side ran out, and note volume and fee totals — steady LP weeks count more than a single deposit (15 minutes a week, about {g} in gas).",
    "Unwind by removing liquidity in one transaction and swapping back to a stablecoin only when you are done farming; keep the LP history and screenshots of the position (about {t}, 10 minutes).",
  ],
  yield: [
    "Open {n} on {c} with a fresh farming wallet funded with {d} plus {g} of gas token, and read the vault's strategy line so you know what the yield comes from (about 10 minutes).",
    "Deposit {d} into the vault with the longest track record on {c} and hold the vault receipt token in the same wallet — the receipt is the proof of the position (one transaction, about {t}, 5 minutes).",
    "If the vault offers a lock or a boost, take the shortest lock available first; a long lock you cannot exit is worse than a smaller boost (one transaction, about {t}, 10 minutes).",
    "Compound or top up once a week for 4–8 weeks and record each deposit date and amount; regular deposits build a longer activity history than one lump sum (10 minutes a week, about {g} in gas each time).",
    "Exit by redeeming the vault receipt in one transaction when you stop farming, and keep the deposit receipts; never leave funds in a vault you have stopped checking (about {t}, 10 minutes).",
  ],
  rwa: [
    "Open {n} on {c} with a fresh farming wallet holding {d} plus {g} of gas token, and read the asset backing page: know what real-world asset the product holds before depositing (about 15 minutes).",
    "Allocate {d} across the product's main offering on {c} — one position, one wallet, so the whole history sits in one place (one transaction, about {t}, 10 minutes).",
    "If the product pays yield or points, claim or restake them weekly for 4–8 weeks and keep a simple log of dates and amounts; the log is what you will check against any later distribution (10 minutes a week, about {g} in gas).",
    "Watch the protocol's announcements channel once a week for eligibility rules or snapshots; a snapshot can be announced with days of notice and you want to be in before it (5 minutes a week).",
    "Redeem in one transaction when you stop farming and move proceeds to a stablecoin; keep the allocation receipts and the announcement dates (about {t}, 10 minutes).",
  ],
  stake: [
    "Open {n} on {c} with a fresh farming wallet holding {d} of the stakeable asset plus {g} of gas token; confirm the staking receipt token and its unstaking delay first (about 10 minutes).",
    "Stake {d} in one transaction and hold the receipt token in the farming wallet — the receipt, not the deposit transaction, is the position (about {t}, 5 minutes).",
    "If the receipt can be used in a lending market, supply at most half of it and keep the rest untouched, so an unstaking delay never traps the whole position (one transaction, about {t}, 15 minutes).",
    "Check the position weekly for 4–8 weeks, claim any staking rewards shown, and note the reward rate each time; steady staking weeks build the history (10 minutes a week, about {g} in gas).",
    "Unstake in one transaction when you stop farming and wait out the delay before moving funds; never unstake the day a snapshot is rumoured — queues can be long (about {t}, 10 minutes plus the delay).",
  ],
  move: [
    "Open {n} on {c} with a fresh farming wallet holding {d} plus {g} of gas token, and test the route with a $5 transfer first so a failed route costs almost nothing (about {t}, 10 minutes).",
    "Move {d} through {n}'s main route on {c} in one transaction and keep the receipt in the farming wallet; the completed transfer is the farmable action (about {t}, 10 minutes).",
    "Repeat the route in the other direction a week later with a similar amount, so the wallet shows two-way usage rather than a single one-off transfer (about {t}, 10 minutes).",
    "Use the route once a week for 4–8 weeks with varied amounts inside your {d} band and keep a log of dates, amounts and fees; regular bridge weeks matter more than volume spikes (10 minutes a week, about {g} in gas).",
    "Stop by moving funds back to your main chain in one final transaction and keep the transfer log; a wallet that only ever bridges one way looks like a passer-by (about {t}, 10 minutes).",
  ],
  general: [
    "Open {n} on {c} with a fresh farming wallet holding {d} plus {g} of gas token, and read the app's main page so you know which action the protocol actually rewards (about 10 minutes).",
    "Make the protocol's core action once with {d} — the main deposit, position or interaction on {c} — and keep any receipt token in the farming wallet (one transaction, about {t}, 10 minutes).",
    "Use the app a second way if it offers one, such as a second pool, market or feature, with 10–20% of the deposit, so the wallet shows more than a single click (one transaction, about {t}, 15 minutes).",
    "Return weekly for 4–8 weeks: repeat the core action, claim anything the app shows, and log dates and amounts — a history of weeks beats one big day (10 minutes a week, about {g} in gas).",
    "Wind the position down in one or two transactions when you stop farming and keep the receipts and the log; never leave funds in an app you have stopped watching (about {t}, 10 minutes).",
  ],
};

// Render the 5 steps for one protocol. p: {name, category, chains, tvl_usd}.
function buildFarmSteps(p) {
  const fam = familyFor(p.category);
  const chain = (p.chains && p.chains.length ? p.chains[0] : "Ethereum");
  const band = bandFor(p.tvl_usd);
  return STEPS[fam].map((tpl) =>
    tpl
      .replaceAll("{n}", p.name)
      .replaceAll("{c}", chain)
      .replaceAll("{d}", band.deposit)
      .replaceAll("{g}", band.gas)
      .replaceAll("{t}", band.tx),
  );
}

// Dual load: a classic <script> in the dashboard (function declarations land
// on the global object, so app.js calls buildFarmSteps directly) and a
// CommonJS module for main.ts, which imports this file and reads
// module.exports. No `export` keyword: a classic script cannot parse one.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { bandFor, familyFor, buildFarmSteps };
}
