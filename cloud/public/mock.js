/*
 * mock.js — an in-browser stand-in for the store-ops Worker API.
 *
 * WHY THIS EXISTS
 *   The dashboard talks to the documented REST API (see src/api/README.md) via
 *   `fetch(API_BASE + path, { headers: { "X-User-Email": ... } })`. When a real
 *   Worker URL is configured in config.js (window.STORE_OPS.API_BASE), every call
 *   hits it for real. When it is NOT configured — i.e. you open the static Pages
 *   build with no backend yet — this module intercepts the SAME fetch calls so a
 *   judge can click the whole product end-to-end offline.
 *
 * It is NOT the backend. It returns data in the EXACT shapes the engine produces
 *   (AgentResult / Rank / ScoredKeyword / ProposedCopy / PushCommand) so swapping
 *   in the real Worker is a no-op for the UI. The char limits, keyword formula,
 *   bucket map and approval-gate behaviour all mirror src/engine.
 *
 * State lives in localStorage so connect → run → approve persists across reloads.
 */
(function () {
  "use strict";

  // ── load-bearing constants (mirror src/engine/constants.ts) ──────────────
  var CHAR_LIMITS = { name: 30, subtitle: 30, keywords: 100, promo: 170, description: 4000 };
  var KEYWORD_WEIGHTS = { volume: 0.4, difficulty: 0.3, relevance: 0.3 };
  var BUCKET_TO_FIELD = { Primary: "name", Secondary: "subtitle", "Long-tail": "keywords", Aspirational: null };

  function uid() { return "x" + Math.random().toString(36).slice(2, 10); }
  function nowISO() { return new Date().toISOString(); }

  // ── persistence ──────────────────────────────────────────────────────────
  var KEY = "store-ops:mockdb:v1";
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
  function dbFor(email) {
    var all = load();
    if (!all[email]) all[email] = { apps: {}, runs: {} };
    return { all: all, db: all[email], commit: function () { save(all); } };
  }

  // ── canned per-keyword scoring seeds (deterministic from keyword text) ────
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function seedKw(keyword, i) {
    var h = hash(keyword);
    return {
      keyword: keyword,
      volume: 35 + (h % 60),
      difficulty: 20 + ((h >> 3) % 65),
      relevance: 55 + ((h >> 6) % 45),
    };
  }
  function scoreKeyword(k) {
    var raw = k.volume * KEYWORD_WEIGHTS.volume + (100 - k.difficulty) * KEYWORD_WEIGHTS.difficulty + k.relevance * KEYWORD_WEIGHTS.relevance;
    return Math.round(raw * 100) / 100;
  }
  // bucketize: rank by score → 1 Primary, 1 Secondary, rest Long-tail above floor, else Aspirational
  function bucketize(inputs) {
    var scored = inputs.map(function (k) { return Object.assign({}, k, { score: scoreKeyword(k) }); });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.map(function (k, i) {
      var bucket;
      if (i === 0) bucket = "Primary";
      else if (i === 1) bucket = "Secondary";
      else if (k.score >= 45) bucket = "Long-tail";
      else bucket = "Aspirational";
      return Object.assign({}, k, { bucket: bucket, field: BUCKET_TO_FIELD[bucket] });
    });
  }

  // ── keyword field builder (comma-joined, NO spaces, ≤100, no dupes) ───────
  function buildKeywordField(terms, blocked) {
    var seen = {};
    (blocked || []).forEach(function (w) { seen[w.toLowerCase()] = 1; });
    var out = [], joined = "";
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i].toLowerCase().replace(/\s+/g, " ").trim();
      var parts = t.split(" ").filter(function (w) { return !seen[w]; });
      if (!parts.length) continue;
      var term = parts.join(" ").replace(/\s+/g, "");
      var next = joined ? joined + "," + term : term;
      if (next.length > CHAR_LIMITS.keywords) continue;
      joined = next; out.push(term);
      parts.forEach(function (w) { seen[w] = 1; });
    }
    return joined;
  }

  function fieldCheck(field, value) {
    var limit = CHAR_LIMITS[field];
    var issues = [];
    if (value.length > limit) issues.push("over limit by " + (value.length - limit));
    if (field === "keywords" && /\s/.test(value)) issues.push("keyword field must not contain spaces");
    return { field: field, value: value, count: value.length, limit: limit, ok: issues.length === 0, issues: issues };
  }

  // ── run the agent loop for an app, produce the full AgentResult shape ─────
  function runAgentMock(app) {
    var seedTerms = app.keywords && app.keywords.length ? app.keywords : defaultKeywords(app.name);
    var kwInputs = seedTerms.map(seedKw);
    var reasoning = bucketize(kwInputs);

    // ranks: deterministic, with one strong #1 hit and a couple deep/none
    var ranks = seedTerms.map(function (kw, i) {
      var h = hash(kw + app.bundleId);
      var present = (h % 5) !== 0; // 1-in-5 not in top 200
      var rank = present ? 1 + (h % 60) : null;
      if (i === 0) rank = 1 + (h % 6); // lead term ranks well
      return { keyword: kw, rank: rank, foundName: app.name, total: 180 + (h % 21), limit: 200, error: "" };
    });

    // proposed copy from buckets
    var primary = reasoning.find(function (k) { return k.bucket === "Primary"; });
    var secondary = reasoning.find(function (k) { return k.bucket === "Secondary"; });
    var longtail = reasoning.filter(function (k) { return k.bucket === "Long-tail"; }).map(function (k) { return k.keyword; });

    var name = cap((app.name + " · " + title(primary ? primary.keyword : "")).trim(), CHAR_LIMITS.name);
    var subtitle = cap(title(secondary ? secondary.keyword : "Fast, private, on your terms"), CHAR_LIMITS.subtitle);
    var blocked = (name + " " + subtitle).toLowerCase().split(/\W+/).filter(Boolean);
    var keywords = buildKeywordField(longtail, blocked);
    var promo = cap("New: " + (primary ? title(primary.keyword) : "smarter") + " just got faster. Updated weekly by an autonomous agent.", CHAR_LIMITS.promo);

    var checks = [fieldCheck("name", name), fieldCheck("subtitle", subtitle), fieldCheck("keywords", keywords), fieldCheck("promo", promo)];
    var proposedCopy = { name: name, subtitle: subtitle, keywords: keywords, promo: promo, validation: { pass: checks.every(function (c) { return c.ok; }), checks: checks } };

    // competitor read
    var compNames = app.competitors && app.competitors.length ? app.competitors : defaultCompetitors(app.name);
    var prev = app._prevCompetitors || {};
    var listings = compNames.map(function (nm, i) {
      var h = hash(nm);
      return { key: "id:" + (300000000 + (h % 700000000)), name: nm, subtitle: "", version: (1 + (h % 9)) + "." + (h % 10) + "." + (h % 5), price: (h % 3 === 0) ? "0" : "2.99", rating: (3.6 + (h % 14) / 10).toFixed(1), genres: ["Productivity"] };
    });
    var changes = listings.map(function (l) {
      var p = prev[l.key];
      if (!p) return { key: l.key, status: "new", name: l.name };
      if (p.version !== l.version) return { key: l.key, status: "changed", name: l.name, fields: { version: { from: p.version, to: l.version } } };
      return { key: l.key, status: "same", name: l.name };
    });
    var newCount = changes.filter(function (c) { return c.status === "new"; }).length;
    var chgCount = changes.filter(function (c) { return c.status === "changed"; }).length;
    var digest = newCount + " new competitor" + (newCount === 1 ? "" : "s") + " tracked, " + chgCount + " changed since last week";

    // screenshot audit
    var h2 = hash(app.bundleId);
    var iphoneCount = 3 + (h2 % 6);
    var ipadCount = (h2 % 2) ? 0 : 2 + (h2 % 4);
    var sc = scoreShots(app.name, iphoneCount, ipadCount);

    // push commands (GENERATED, not executed) — mirrors buildPushCommands()
    var esc = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
    var pushCommands = [
      { store: "appstore", tool: "asc", description: "Stage App Store name + subtitle + keyword field (review-gated).",
        command: "asc metadata set --bundle " + app.bundleId + " --name " + esc(name) + " --subtitle " + esc(subtitle) + " --keywords " + esc(keywords) },
      { store: "appstore", tool: "asc", description: "Stage promotional text (editable without resubmission).",
        command: "asc metadata set --bundle " + app.bundleId + " --promo " + esc(promo) },
      { store: "googleplay", tool: "gplay", description: "Stage Play Store title + short description (no keyword field on Play).",
        command: "gplay listing update --package " + app.bundleId + " --title " + esc(name) + " --short-description " + esc(subtitle) },
    ];

    return {
      audit: { app: app.name, bundleId: app.bundleId, screenshots: sc, liveName: app.name },
      ranks: ranks,
      competitors: { listings: listings, changes: changes, digest: digest },
      reasoning: reasoning,
      proposedCopy: proposedCopy,
      pushCommands: pushCommands,
      _listingsSnapshot: listings.reduce(function (m, l) { m[l.key] = { version: l.version }; return m; }, {}),
    };
  }

  function scoreShots(app, iphone, ipad) {
    var score = 0, findings = [];
    if (iphone === 0) { findings.push("No iPhone screenshots — cannot convert."); }
    else if (iphone < 4) { score += 20; findings.push("Only " + iphone + " iPhone shots; add up to 4–6 for full coverage."); }
    else if (iphone >= 6) { score += 50; findings.push(iphone + " iPhone shots — strong slot coverage."); }
    else { score += 40; findings.push(iphone + " iPhone shots — solid; 6 is ideal."); }
    if (ipad > 0) { score += 15; findings.push(ipad + " iPad shots — tablet coverage present."); }
    else { score += 5; findings.push("No iPad screenshots — iPad search ignores this listing's visuals."); }
    score += 20; findings.push("Tall 1290×2796 aspect detected — optimal for modern iPhones.");
    score += 8;
    score = Math.min(100, score);
    var grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : score >= 30 ? "D" : "F";
    return { app: app, iphoneCount: iphone, ipadCount: ipad, score: score, grade: grade, findings: findings, aspectHint: "1290x2796" };
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  function cap(s, n) { return s.length <= n ? s : s.slice(0, n).replace(/[\s,]+\S*$/, "").slice(0, n) || s.slice(0, n); }
  function title(s) { return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function defaultKeywords(name) {
    var base = name.toLowerCase().split(/\s+/)[0] || "app";
    return [base + " tracker", "habit tracker", "daily planner", "focus timer", "budget app", "mood journal", "minimal todo"];
  }
  function defaultCompetitors(name) { return ["Streaks", "Habitica", "Way of Life", "Productive"]; }

  // ── rank trend history (synthetic time-series for the sparkline) ──────────
  function rankHistory(app) {
    var lead = (app.keywords && app.keywords[0]) || defaultKeywords(app.name)[0];
    var h = hash(lead + app.bundleId);
    var pts = [], cur = 40 + (h % 30);
    for (var w = 7; w >= 0; w--) {
      cur = Math.max(1, cur - 1 - ((h >> w) % 6) + (w % 2 ? 0 : 1)); // trending up (lower rank #)
      var d = new Date(); d.setDate(d.getDate() - w * 7);
      pts.push({ checked_at: d.toISOString().slice(0, 10), keyword: lead, rank: cur, total: 200 });
    }
    return { keyword: lead, points: pts };
  }

  // ── the router: parse method+path and return a Response ──────────────────
  function appSummary(app) {
    var r = app.latestRun ? app.runs && app.runs : null;
    return {
      id: app.id, bundle_id: app.bundleId, name: app.name, country: app.country || "US",
      created_at: app.created_at,
      latest_run: app.latestRunSummary || null,
      rank_summary: app.rankSummary || null,
    };
  }

  function handle(method, path, body, email) {
    var ctx = dbFor(email);
    var db = ctx.db;
    var m;

    // POST /apps  — connect an app
    if (method === "POST" && path === "/apps") {
      var id = uid();
      var app = {
        id: id, bundleId: (body.bundle_id || "").trim(), name: (body.name || "").trim() || body.bundle_id,
        country: body.country || "US", created_at: nowISO(),
        keywords: body.keywords || null, competitors: body.competitors || null,
        runs: [], latestRunSummary: null, rankSummary: null,
      };
      if (!app.bundleId) return json(400, { error: "bundle_id required" });
      db.apps[id] = app; ctx.commit();
      return json(201, { id: id });
    }

    // GET /apps — list apps + latest run status
    if (method === "GET" && path === "/apps") {
      var list = Object.keys(db.apps).map(function (k) { return appSummary(db.apps[k]); });
      list.sort(function (a, b) { return (b.created_at || "").localeCompare(a.created_at || ""); });
      return json(200, { apps: list });
    }

    // POST /apps/:id/run — trigger the loop
    if (method === "POST" && (m = path.match(/^\/apps\/([^/]+)\/run$/))) {
      var app = db.apps[m[1]];
      if (!app) return json(404, { error: "app not found" });
      var result = runAgentMock(app);
      app._prevCompetitors = result._listingsSnapshot;
      var runId = uid();
      var run = {
        id: runId, app_id: app.id, status: "awaiting_approval", created_at: nowISO(),
        result: result,
      };
      delete result._listingsSnapshot;
      db.runs[runId] = run;
      app.runs.unshift(runId);
      app.latestRunSummary = { id: runId, status: "awaiting_approval", created_at: run.created_at };
      var lead = result.ranks[0];
      var hits = result.ranks.filter(function (r) { return r.rank && r.rank <= 10; }).length;
      app.rankSummary = { tracked: result.ranks.length, top10: hits, lead_keyword: lead ? lead.keyword : "", lead_rank: lead ? lead.rank : null };
      ctx.commit();
      return json(200, { id: runId });
    }

    // GET /apps/:id — app detail
    if (method === "GET" && (m = path.match(/^\/apps\/([^/]+)$/))) {
      var app = db.apps[m[1]];
      if (!app) return json(404, { error: "app not found" });
      var runs = app.runs.map(function (rid) { var r = db.runs[rid]; return { id: r.id, status: r.status, created_at: r.created_at }; });
      return json(200, { app: appSummary(app), runs: runs });
    }

    // GET /apps/:id/ranks — rank trend time-series for the sparkline
    if (method === "GET" && (m = path.match(/^\/apps\/([^/]+)\/ranks$/))) {
      var app = db.apps[m[1]];
      if (!app) return json(404, { error: "app not found" });
      return json(200, rankHistory(app));
    }

    // GET /runs/:id — full run detail (reasoning + proposals + commands).
    // Mirrors the Worker API's approval gate: pushCommands are withheld until
    // the run is approved/shipped.
    if (method === "GET" && (m = path.match(/^\/runs\/([^/]+)$/))) {
      var run = db.runs[m[1]];
      if (!run) return json(404, { error: "run not found" });
      var approved = run.status === "approved" || run.status === "shipped";
      var result = Object.assign({}, run.result, { pushCommands: approved ? run.result.pushCommands : [] });
      var pub = { id: run.id, app_id: run.app_id, status: run.status, created_at: run.created_at, result: result };
      return json(200, pub);
    }

    // POST /runs/:id/approve | /reject — the human approval gate
    if (method === "POST" && (m = path.match(/^\/runs\/([^/]+)\/(approve|reject)$/))) {
      var run = db.runs[m[1]];
      if (!run) return json(404, { error: "run not found" });
      run.status = m[2] === "approve" ? "approved" : "rejected";
      run.decided_at = nowISO();
      var app = db.apps[run.app_id];
      if (app && app.latestRunSummary && app.latestRunSummary.id === run.id) app.latestRunSummary.status = run.status;
      ctx.commit();
      return json(200, { id: run.id, status: run.status });
    }

    // GET /runs/:id/push-commands — handoff (only after 'approved')
    if (method === "GET" && (m = path.match(/^\/runs\/([^/]+)\/push-commands$/))) {
      var run = db.runs[m[1]];
      if (!run) return json(404, { error: "run not found" });
      if (run.status !== "approved" && run.status !== "shipped") return json(403, { error: "approval required", status: run.status });
      return json(200, { commands: run.result.pushCommands });
    }

    return json(404, { error: "no route", path: path });
  }

  function json(status, obj) {
    return new Response(JSON.stringify(obj), { status: status, headers: { "content-type": "application/json" } });
  }

  // expose to the API client in app.js
  window.STORE_OPS_MOCK = { handle: handle };
})();
