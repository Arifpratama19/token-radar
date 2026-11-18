// app.js — renders the radar board from window.RADAR (data.js, written by
// main.ts from the sealed snapshot). No network: every number on the page
// comes from the bundled data. Farm steps come from buildFarmSteps in
// farm.js — the same function main.ts uses for board.json, so the detail
// view and the board can never disagree.
//
// Deep links (used by the dossier screenshots): ?detail=<slug> opens a
// protocol, ?category=<name> / ?chain=<name> / ?watchlist=1 pre-sets filters.
(function () {
  var D = window.RADAR;
  var meta = D.meta;
  // Expand the compact rows main.ts wrote: [slug,name,cat,chains,nChains,
  // tvl,chg7d,listed,implied,sSize,sGrowth,sAge,sChain,watch].
  var ROWS = D.rows.map(function (r) {
    return { slug: r[0], name: r[1], cat: r[2], chains: r[3], nChains: r[4],
      tvl: r[5], chg: r[6], listed: r[7], implied: r[8],
      s: { size: r[9], growth: r[10], age: r[11], chains: r[12] },
      watch: r[13] === 1 };
  });
  var bySlug = {};
  ROWS.forEach(function (r) { bySlug[r.slug] = r; });
  // True board rank (by implied value), so a filtered view still shows
  // each protocol's place on the full board instead of its filtered index.
  var rankOf = {};
  ROWS.slice().sort(function (a, b) { return b.implied - a.implied; })
    .forEach(function (r, i) { rankOf[r.slug] = i + 1; });

  function money(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
    return "$" + n;
  }
  function ageText(listed) {
    if (!listed) return "unknown";
    var days = Math.floor((Date.parse(meta.as_of + "T00:00:00Z") - Date.parse(listed + "T00:00:00Z")) / 86400000);
    if (days < 365) return Math.floor(days / 30) + " mo";
    var y = Math.floor(days / 365), m = Math.floor((days % 365) / 30);
    return y + "y " + m + "m";
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- header stats -------------------------------------------------------
  document.getElementById("asof").textContent = meta.as_of;
  var top = ROWS[0];
  document.getElementById("stats").innerHTML = [
    [meta.protocols, "protocols tracked"],
    [meta.records_no_token, "record no token"],
    [meta.watchlist, "on the watchlist"],
    [meta.candidates, "ranked on this board"],
    [top ? money(top.implied) : "—", "top implied value · " + (top ? top.name : "")],
  ].map(function (s) {
    return '<div class="stat"><b>' + s[0] + '</b><span>' + esc(s[1]) + '</span></div>';
  }).join("");

  // ---- filter controls ----------------------------------------------------
  var catSel = document.getElementById("cat");
  var chainSel = document.getElementById("chain");
  var cats = [], chains = [];
  ROWS.forEach(function (r) {
    if (r.cat && cats.indexOf(r.cat) < 0) cats.push(r.cat);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort().forEach(function (c) { catSel.add(new Option(c, c)); });
  chains.sort().forEach(function (c) { chainSel.add(new Option(c, c)); });
  document.getElementById("launchedList").innerHTML = D.launched.map(function (p) {
    return '<span class="chip"><b>' + esc(p.name) + '</b> ' + esc(p.symbol || "") +
      ' · mcap ' + money(p.mcap_usd || 0) + '</span>';
  }).join("");

  var els = {
    q: document.getElementById("q"), cat: catSel, chain: chainSel,
    minTvl: document.getElementById("minTvl"), sort: document.getElementById("sort"),
    watchOnly: document.getElementById("watchOnly"),
    rows: document.getElementById("rows"), count: document.getElementById("count"),
    empty: document.getElementById("empty"), detail: document.getElementById("detail"),
  };

  function filtered() {
    var q = els.q.value.trim().toLowerCase();
    var list = ROWS.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (els.cat.value && r.cat !== els.cat.value) return false;
      if (els.chain.value && r.chains.indexOf(els.chain.value) < 0) return false;
      if (+els.minTvl.value && r.tvl < +els.minTvl.value) return false;
      if (els.watchOnly.checked && !r.watch) return false;
      return true;
    });
    var key = els.sort.value;
    list.sort(function (a, b) {
      if (key === "tvl") return b.tvl - a.tvl;
      if (key === "growth") return (b.chg || 0) - (a.chg || 0);
      if (key === "age") return (a.listed || "9999").localeCompare(b.listed || "9999");
      return b.implied - a.implied;
    });
    return list;
  }

  function render() {
    var list = filtered();
    els.count.textContent = list.length + " of " + ROWS.length + " shown";
    els.empty.hidden = list.length > 0;
    els.rows.innerHTML = list.map(function (r, i) {
      var chg = r.chg === null ? "—" :
        '<span class="' + (r.chg >= 0 ? "up" : "down") + '">' + (r.chg >= 0 ? "+" : "") + r.chg.toFixed(1) + "%</span>";
      var score = Math.round((0.45 * r.s.size + 0.25 * r.s.growth + 0.2 * r.s.age + 0.1 * r.s.chains) * 100);
      return '<tr data-slug="' + esc(r.slug) + '">' +
        "<td>" + rankOf[r.slug] + "</td>" +
        '<td><div class="name">' + (r.watch ? '<span class="star">★</span> ' : "") + esc(r.name) + '</div>' +
        '<div class="sub">' + esc(r.slug) + '</div>' +
        (r.cat ? '<span class="cat">' + esc(r.cat) + "</span>" : "") + "</td>" +
        "<td>" + esc(r.chains.join(", ")) + (r.nChains > 3 ? " +" + (r.nChains - 3) : "") + "</td>" +
        '<td class="num">' + money(r.tvl) + "</td>" +
        '<td class="num">' + chg + "</td>" +
        '<td class="num">' + ageText(r.listed) + "</td>" +
        '<td class="num imp">' + money(r.implied) + "</td>" +
        '<td><span class="bar"><i style="width:' + score + '%"></i></span> ' + score + "</td>" +
        "<td>›</td></tr>";
    }).join("");
  }

  // ---- detail view --------------------------------------------------------
  function meter(label, v) {
    var pct = Math.round(v * 100);
    return '<div class="meter"><label><span>' + label + '</span><span>' + pct + "%</span></label>" +
      '<span class="bar"><i style="width:' + pct + '%"></i></span></div>';
  }
  function showDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var steps = buildFarmSteps({ name: r.name, category: r.cat, chains: r.chains, tvl_usd: r.tvl });
    var score = 0.45 * r.s.size + 0.25 * r.s.growth + 0.2 * r.s.age + 0.1 * r.s.chains;
    var rank = ROWS.slice().sort(function (a, b) { return b.implied - a.implied; })
      .findIndex(function (x) { return x.slug === slug; }) + 1;
    els.detail.hidden = false;
    els.detail.innerHTML =
      "<h2>" + (r.watch ? '<span class="star">★</span> ' : "") + esc(r.name) + "</h2>" +
      '<p class="meta">' + esc(r.slug) + " · " + esc(r.cat || "uncategorised") + " · " + esc(r.chains.join(", ")) +
      (r.nChains > 3 ? " +" + (r.nChains - 3) + " more" : "") +
      " · tracked since " + (r.listed || "unknown") + (r.watch ? " · on the $50M watchlist" : "") + "</p>" +
      '<div class="grid">' +
      '<div class="cell"><b>#' + rank + "</b><span>board rank</span></div>" +
      '<div class="cell"><b>' + money(r.implied) + "</b><span>implied value</span></div>" +
      '<div class="cell"><b>' + money(r.tvl) + "</b><span>TVL</span></div>" +
      '<div class="cell"><b>' + (r.chg === null ? "—" : (r.chg >= 0 ? "+" : "") + r.chg.toFixed(1) + "%") + "</b><span>7-day TVL change</span></div>" +
      '<div class="cell"><b>' + ageText(r.listed) + "</b><span>with no token recorded</span></div>" +
      "</div>" +
      meter("Size — log TVL (45%)", r.s.size) +
      meter("Growth — 7-day change (25%)", r.s.growth) +
      meter("Age — years with no token (20%)", r.s.age) +
      meter("Breadth — chain count (10%)", r.s.chains) +
      "<p><b>Score " + score.toFixed(2) + "</b> → multiple " +
      (0.02 + 0.3 * Math.pow(score, 1.5)).toFixed(3) + " × TVL = <b>" + money(r.implied) + "</b> implied value.</p>" +
      "<h3>How to farm it</h3><ol class=\"steps\">" +
      steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
      '<p class="note">This protocol records no token in the snapshot — that is the record, not proof it has none. ' +
      "The implied value is this board's own claim from the snapshot's figures, not a prediction of if or when a token launches.</p>";
    els.detail.scrollIntoView({ behavior: "auto", block: "start" });
    document.querySelectorAll("#rows tr").forEach(function (tr) {
      tr.classList.toggle("sel", tr.getAttribute("data-slug") === slug);
    });
  }

  els.rows.addEventListener("click", function (e) {
    var tr = e.target.closest("tr");
    if (tr) showDetail(tr.getAttribute("data-slug"));
  });
  ["input", "change"].forEach(function (ev) {
    [els.q, els.cat, els.chain, els.minTvl, els.sort, els.watchOnly].forEach(function (el) {
      el.addEventListener(ev, render);
    });
  });

  // ---- deep links for the dossier screenshots -----------------------------
  var params = new URLSearchParams(location.search);
  if (params.get("category")) { els.cat.value = params.get("category"); }
  if (params.get("chain")) { els.chain.value = params.get("chain"); }
  if (params.get("minTvl")) { els.minTvl.value = params.get("minTvl"); }
  if (params.get("watchlist")) { els.watchOnly.checked = true; }
  if (params.get("sort")) { els.sort.value = params.get("sort"); }
  render();
  if (params.get("detail") && bySlug[params.get("detail")]) showDetail(params.get("detail"));
  window.__shotReady = true;
})();
