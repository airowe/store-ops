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

  // Per-tier connected-app limit. MUST mirror src/billing.ts appLimitForTier() so
  // the offline backend trips the SAME 402 paywall the real Worker enforces.
  function appLimitForTier(tier) {
    switch (tier) {
      case "launch": return 1;
      case "autopilot": return 3;
      case "fleet": return 50;
      case "free":
      default: return 1;
    }
  }

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
    if (!all[email]) all[email] = { apps: {}, runs: {}, tier: "free" };
    // Back-compat: partitions persisted before tier tracking default to "free".
    if (!all[email].tier) all[email].tier = "free";
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
    value = String(value == null ? "" : value);
    if (value.length > limit) issues.push("over limit by " + (value.length - limit) + " (" + value.length + "/" + limit + ")");
    // keyword field rules mirror the engine's validateCopy (src/engine/optimize.ts)
    // AND the client mirror: comma-separated, NO spaces around commas, no
    // title/subtitle word dupes. (A space INSIDE a multi-word term is allowed.)
    if (field === "keywords") {
      if (/,\s/.test(value) || /\s,/.test(value)) issues.push("keyword field must be comma-separated with NO spaces around commas");
    }
    return { field: field, value: value, count: value.length, limit: limit, ok: issues.length === 0, issues: issues };
  }

  // ── run the agent loop for an app, produce the full AgentResult shape ─────
  function runAgentMock(app, ascRead) {
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
    // #30: only propose subtitle/keywords when an ASC read happened (we can see
    // the live values). Without it, leave them empty — never a blind overwrite.
    var subtitle = ascRead ? cap(title(secondary ? secondary.keyword : "Fast, private, on your terms"), CHAR_LIMITS.subtitle) : "";
    var blocked = (name + " " + subtitle).toLowerCase().split(/\W+/).filter(Boolean);
    var keywords = ascRead ? buildKeywordField(longtail, blocked) : "";
    var promo = cap("New: " + (primary ? title(primary.keyword) : "smarter") + " just got faster. Updated weekly by an autonomous agent.", CHAR_LIMITS.promo);

    var checks = [fieldCheck("name", name), fieldCheck("subtitle", subtitle), fieldCheck("keywords", keywords), fieldCheck("promo", promo)];
    var proposedCopy = { name: name, subtitle: subtitle, keywords: keywords, promo: promo, validation: { pass: checks.every(function (c) { return c.ok; }), checks: checks } };

    // currentCopy: the "before" the run page diffs against. With an ASC read we
    // know the live subtitle/keywords; without it they're unknown (omit them).
    // The baseline is a GENERIC live listing (not the agent's proposal) so the
    // diff reflects a real improvement — and so PRD-02 attribution has genuine
    // term additions to (correlationally) link a later rank move to.
    var currentCopy = { name: app.name };
    if (ascRead) {
      // With an ASC read we KNOW the live subtitle/keywords. Honor an explicitly
      // EMPTY live value ("") as read-but-empty — never swallow it with a default
      // (mirrors the runAppWithAsc coalesce). Only fall back to a sample value
      // when the field was never set on the seeded app (undefined).
      currentCopy.subtitle = (app._liveSubtitle !== undefined && app._liveSubtitle !== null)
        ? app._liveSubtitle : cap("Your daily companion", CHAR_LIMITS.subtitle);
      currentCopy.keywords = (app._liveKeywords !== undefined && app._liveKeywords !== null)
        ? app._liveKeywords : "daily,simple,calm,everyday";
    }

    // competitor read
    var compNames = app.competitors && app.competitors.length ? app.competitors : defaultCompetitors(app.name);
    var prev = app._prevCompetitors || {};
    // Canned, descriptive subtitle pool so the keyword-gap finder (PRD 01) has
    // real competitor terms to mine. Deterministic per competitor (hash-indexed).
    var COMP_SUBTITLES = [
      "Meditation and Sleep Sounds",
      "Habit Tracker and Daily Goals",
      "Focus Timer for Deep Work",
      "Guided Breathing and Calm",
      "Budget Planner and Money",
      "Mood Journal and Wellness",
    ];
    var listings = compNames.map(function (nm, i) {
      var h = hash(nm);
      return { key: "id:" + (300000000 + (h % 700000000)), name: nm, subtitle: COMP_SUBTITLES[h % COMP_SUBTITLES.length], version: (1 + (h % 9)) + "." + (h % 10) + "." + (h % 5), price: (h % 3 === 0) ? "0" : "2.99", rating: (3.6 + (h % 14) / 10).toFixed(1), genres: ["Productivity"] };
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

    // screenshot audit. Public (no-key) data is UNRELIABLE for screenshots (#41):
    // a bundle flagged "unreadable" (or one the public API returned no shots for)
    // grades "?" with NO gallery; otherwise we have the real shots to render (#47).
    var h2 = hash(app.bundleId);
    var publicUnreadable = !ascRead && /unreadable|noshots/i.test(app.bundleId);
    var iphoneCount = publicUnreadable ? 0 : 3 + (h2 % 6);
    var ipadCount = publicUnreadable ? 0 : ((h2 % 2) ? 0 : 2 + (h2 % 4));
    // ASC reads are reliable; public reads are not (drives the "?" honesty path).
    var sc = scoreShots(app.name, iphoneCount, ipadCount, ascRead ? true : false);

    // ASC findings — the "Listing audit" card payload (PRD 02/03). Findings only;
    // never raw ASC data. A slim ascContext carries just the display values the
    // findings reference (no pricing/locale/policy text).
    var cppCount = 2 + (h2 % 3);
    var ascContext = {
      category: "Productivity", secondaryCategory: null, ageRating: "4+",
      versionState: ascRead ? "READY_FOR_SALE" : null, localeCount: 1,
      previewDeviceCount: 0, cppCount: cppCount,
    };
    var findings = buildFindings(app, sc, ascRead, { category: ascContext.category, cppCount: cppCount });
    var findingsSummary = summarizeFindings(findings);

    // PRD 06: winnability opportunities — "where to push next." Mirrors the pure
    // rankOpportunities() engine. Deterministic competitor ranks per keyword (from
    // the same hash) so a far/strong-incumbent term reads as a "longshot" honestly.
    var keywordScores = {};
    reasoning.forEach(function (k) { keywordScores[k.keyword] = k.score; });
    var compRanks = [{ name: compNames[0] || "Rival", ranks: ranks.map(function (r) {
      var hc = hash(r.keyword + "comp");
      // strong incumbent on the lead/high-volume term; weaker/deeper elsewhere.
      var cr = ((keywordScores[r.keyword] || 50) >= 70) ? 1 + (hc % 5) : 30 + (hc % 160);
      return { keyword: r.keyword, rank: cr, total: 200, checked_at: "2026-01-01 00:00:00" };
    }) }];
    var opportunities = rankOpportunities({
      ranks: ranks.map(function (r) { return { keyword: r.keyword, rank: r.rank, total: r.total, checked_at: "2026-01-15 00:00:00" }; }),
      competitorRanks: compRanks,
    });

    // Keyword gaps (PRD 01): terms competitors VISIBLY use that you don't target
    // or rank top-50 for. Same shape + logic as src/engine/keywordGap.ts — the UI
    // renders this identically whether it came from the mock or the real Worker.
    var yourCopy = { name: currentCopy.name, subtitle: currentCopy.subtitle, keywords: currentCopy.keywords };
    var keywordGaps = buildKeywordGaps(yourCopy, ranks, listings);

    // metadata coverage (PRD 03) — off the current copy. The brand is the first
    // word of the app name (so a brand repeat in the subtitle is flagged, #42).
    var coverage = buildCoverage(currentCopy, (app.name || "").split(/\s+/)[0]);

    // war room (PRD 05): head-to-head vs the tracked competitors, for the run
    // page grid. The live route recomputes on selector change; this seeds it.
    var warRoom = warRoomMock(app, compNames);

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

    var out = {
      audit: { app: app.name, bundleId: app.bundleId, screenshots: sc, liveName: app.name },
      findings: findings,
      findingsSummary: findingsSummary,
      opportunities: opportunities,
      coverage: coverage,
      ranks: ranks,
      warRoom: warRoom,
      competitors: { listings: listings, changes: changes, digest: digest },
      reasoning: reasoning,
      currentCopy: currentCopy,
      proposedCopy: proposedCopy,
      pushCommands: pushCommands,
      keywordGaps: keywordGaps,
      _listingsSnapshot: listings.reduce(function (m, l) { m[l.key] = { version: l.version }; return m; }, {}),
    };
    // ascContext only exists on an ASC (Mode-A) run — counts + labels, never raw
    // pricing/locale/policy text (the privacy boundary).
    if (ascRead) {
      out.ascContext = {
        category: "Productivity",
        secondaryCategory: "Utilities",
        ageRating: "FOUR_PLUS",
        versionState: "READY_FOR_SALE",
        localeCount: 1 + (h2 % 3),
        previewDeviceCount: h2 % 2,
      };
      // PRD 04 — localization expansion. ROI-sorted locales to add (STATIC
      // heuristic; honest market/language descriptors, NEVER fabricated install
      // numbers). Mirrors recommendLocales(): the run is single-locale here, so
      // every rec is effort:"translate".
      out.localizationExpansion = buildLocalizationExpansion("Productivity");
    }
    return out;
  }


  // ── ASC findings (PRD 01/05 model, emitted for the run-page audit card) ────
  // Mirrors auditFindings(): each surface yields zero+ Findings of the shape
  // { id, surface, severity, impact, title, detail, fix, evidence? }. The mock
  // derives a representative mix (a critical + warnings + good + info across both
  // impact lanes) from the same audit data the run already produced, so the
  // "Listing audit" card renders end-to-end with no key. Sorted biggest-win-first.
  var SEV_ORDER = { critical: 0, warn: 1, good: 2, info: 3 };
  var IMPACT_ORDER = { ranking: 0, conversion: 1, trust: 2, completeness: 3 };

  function buildFindings(app, sc, ascRead, ctx) {
    var f = [];
    // screenshots — "unknown" only when we genuinely couldn't read the set (#41);
    // otherwise the real grade (public shots ARE often available to render, #47).
    if (sc.grade === "?") {
      f.push({ id: "screenshots_unknown", surface: "screenshots", severity: "info", impact: "conversion",
        title: "Couldn't read screenshots from public data",
        detail: "Public App Store data doesn't expose your screenshot set reliably.",
        fix: "Connect App Store Connect for a real screenshot grade." });
    } else if (sc.grade === "D" || sc.grade === "F") {
      f.push({ id: "screenshots_grade_low", surface: "screenshots", severity: "critical", impact: "conversion",
        title: "Screenshots are hurting conversion (grade " + sc.grade + ")",
        detail: "Your screenshot set scored " + sc.score + "/100 — the first 2–3 carry most installs.",
        fix: "Add 4+ tall-phone screenshots; lead with your strongest value props.",
        evidence: sc.iphoneCount + " iPhone shots" });
    } else if (sc.iphoneCount < 4) {
      f.push({ id: "screenshots_thin", surface: "screenshots", severity: "warn", impact: "conversion",
        title: "Only " + sc.iphoneCount + " screenshots",
        detail: "You're leaving slots empty — the first 2–3 convert hardest.",
        fix: "Use more screenshot slots to sell the app before the fold.",
        evidence: sc.iphoneCount + " of 10 slots" });
    }
    // These derive from the ASC snapshot — only emit them on a keyed (Mode-A) run.
    // Without a key we can't see appInfo/previews/locales, so we must NOT assert
    // about them (the #30/#41 principle: never claim about a field you can't read).
    if (ascRead) {
      // appInfo — privacy policy is a critical completeness gap (and a trust signal).
      f.push({ id: "privacy_policy_missing", surface: "appInfo", severity: "critical", impact: "completeness",
        title: "No privacy policy URL",
        detail: "Apple can reject without one, and it's a trust signal to users.",
        fix: "Add a privacy policy URL in App Store Connect." });
      f.push({ id: "secondary_category_missing", surface: "appInfo", severity: "warn", impact: "ranking",
        title: "No secondary category set",
        detail: "A secondary category is a free second ranking surface.",
        fix: "Pick your most relevant secondary category in App Store Connect." });
      // previews — no preview video is a conversion warning.
      f.push({ id: "preview_missing", surface: "previews", severity: "warn", impact: "conversion",
        title: "No app preview video",
        detail: "Previews lift conversion — a short demo earns trust before the install.",
        fix: "Add a 15–30s preview for your primary device." });
      // locales — single-locale is a ranking warning.
      f.push({ id: "locale_single", surface: "locales", severity: "warn", impact: "ranking",
        title: "Live in 1 locale",
        detail: "Each localization is a new keyword surface + audience.",
        fix: "Start with the top locales for your category.",
        evidence: "1 locale" });
      // good signal — CPPs present (so the card shows a green row too).
      f.push({ id: "cpp_present", surface: "customProductPages", severity: "good", impact: "conversion",
        title: ((ctx && ctx.cppCount) || 2) + " Custom Product Pages",
        detail: "CPPs tailor your store page per ad/audience.",
        fix: "Nice — you're using CPPs." });
      // info — category context (a ranking framing note).
      f.push({ id: "primary_category_context", surface: "appInfo", severity: "info", impact: "ranking",
        title: "Category: " + ((ctx && ctx.category) || "Productivity"),
        detail: "This is the primary surface you compete in.",
        fix: "Confirm it matches the keywords you're targeting." });
    }
    // meta — no-key runs get the unlock nudge (PRD 04 renders the CTA).
    if (!ascRead) {
      f.push({ id: "asc_unlock", surface: "meta", severity: "info", impact: "completeness",
        title: "Unlock your full audit",
        detail: "A connected key audits screenshots, preview video, privacy policy, category, and localization gaps.",
        fix: "Connect App Store Connect to fill in the rest." });
    }
    // sort biggest-win-first: severity, then impact lane, stable otherwise.
    f.sort(function (a, b) {
      var s = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
      if (s !== 0) return s;
      return IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact];
    });
    return f;
  }

  function summarizeFindings(findings) {
    var c = { total: findings.length, critical: 0, warn: 0, good: 0, info: 0 };
    findings.forEach(function (x) { if (c[x.severity] != null) c[x.severity] += 1; });
    var parts = [];
    var fixes = c.critical + c.warn;
    if (fixes > 0) parts.push(fixes + " fix" + (fixes === 1 ? "" : "es") + " available");
    if (c.critical > 0) parts.push(c.critical + " critical");
    c.label = parts.length ? parts.join(" · ") : "No fixes found";
    return c;
  }

  // ── keyword gaps (PRD 01) — mirrors src/engine/keywordGap.ts ──────────────
  // A gap = a term a competitor VISIBLY uses (name/subtitle) that you don't have
  // in your metadata AND don't rank top-50 for. Names-only attribution (never the
  // raw competitor listing). Sorted not-in-metadata first, then score desc, then
  // reachability (winnability) — a term you already sit near outranks one you're
  // nowhere on at equal score. Honesty: "competitors use this", never "they rank".
  var GAP_STOPWORDS = { the: 1, and: 1, for: 1, with: 1, your: 1, you: 1, our: 1,
    app: 1, apps: 1, best: 1, free: 1, pro: 1, plus: 1, "new": 1, now: 1, all: 1,
    any: 1, more: 1, get: 1, to: 1, of: 1, "in": 1, on: 1, a: 1, an: 1, by: 1,
    or: 1, is: 1, it: 1, my: 1, me: 1, we: 1, everyone: 1, daily: 1, guided: 1 };
  var GAP_KEYWORD_LIMIT = 100;
  var GAP_TOP_CUTOFF = 50;

  function gapTokens(text) {
    return String(text || "").toLowerCase().split(/[^a-z0-9]+/i)
      .filter(function (w) { return w.length >= 3 && !GAP_STOPWORDS[w]; });
  }

  function buildKeywordGaps(yourCopy, ranks, listings) {
    var mine = {};
    gapTokens([yourCopy.name || "", yourCopy.subtitle || "", yourCopy.keywords || ""].join(" "))
      .forEach(function (t) { mine[t] = 1; });
    var rankByKw = {};
    (ranks || []).forEach(function (r) { rankByKw[r.keyword.toLowerCase()] = r.rank; });

    // term → set of competitor names that use it (brand-only tokens excluded).
    var usage = {};
    (listings || []).forEach(function (c) {
      if (!c || c.error || (!c.name && !c.subtitle)) return;
      var nameToks = gapTokens(c.name || "");
      var brand = {}; nameToks.forEach(function (t) { brand[t] = 1; });
      var terms = {};
      nameToks.concat(gapTokens(c.subtitle || "")).forEach(function (t) { terms[t] = 1; });
      Object.keys(terms).forEach(function (term) {
        if (brand[term] && nameToks.length <= 1) return; // pure brand word
        if (!usage[term]) usage[term] = {};
        usage[term][c.name] = 1;
      });
    });

    var remaining = Math.max(0, GAP_KEYWORD_LIMIT - String(yourCopy.keywords || "").length);
    var gaps = [];
    Object.keys(usage).forEach(function (keyword) {
      var inMeta = !!mine[keyword];
      var youRank = (keyword in rankByKw) ? rankByKw[keyword] : null;
      var ranksTop = youRank != null && youRank <= GAP_TOP_CUTOFF;
      if (inMeta || ranksTop) return;
      var competitorsUsing = Object.keys(usage[keyword]).sort();
      var volume = Math.min(100, 40 + competitorsUsing.length * 20);
      var base = scoreKeyword({ volume: volume, difficulty: 50, relevance: 60 });
      var cost = keyword.length + (yourCopy.keywords ? 1 : 0);
      gaps.push({
        keyword: keyword,
        competitorsUsing: competitorsUsing,
        youRank: youRank,
        inYourMetadata: inMeta,
        score: Math.round(base * 100) / 100,
        fitsBudget: cost <= remaining,
        _reach: youRank == null ? 0 : 10 / (youRank + 1),
      });
    });
    gaps.sort(function (a, b) {
      if (a.inYourMetadata !== b.inYourMetadata) return a.inYourMetadata ? 1 : -1;
      if (a.score !== b.score) return b.score - a.score;
      if (a._reach !== b._reach) return b._reach - a._reach;
      return a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0;
    });
    return gaps.map(function (g) {
      return { keyword: g.keyword, competitorsUsing: g.competitorsUsing, youRank: g.youRank,
        inYourMetadata: g.inYourMetadata, score: g.score, fitsBudget: g.fitsBudget };
    });
  }

  // ── metadata coverage (PRD 03) — mirrors src/engine/metadataCoverage.ts ────
  // Budget-efficiency over the 30/30/100 name/subtitle/keyword field, with
  // itemized waste (duplicate / brand_repeat / filler). Curated counts + copy
  // only — no raw ASC. Unused space is NOT waste; coverage = (budget - waste)/budget.
  var COVERAGE_BUDGET = CHAR_LIMITS.name + CHAR_LIMITS.subtitle + CHAR_LIMITS.keywords;
  var FILLER_FLOOR = 20;
  var FILLER_TERMS = { the:1,a:1,an:1,of:1,to:1,for:1,and:1,or:1,"in":1,on:1,at:1,by:1,
    "with":1,your:1,you:1,is:1,it:1,"this":1,that:1,best:1,"super":1,great:1,
    amazing:1,easy:1,pro:1,plus:1,now:1,get:1 };

  function covTokens(s) {
    if (!s) return [];
    return String(s).toLowerCase().split(/[^a-z0-9]+/).filter(function (t) { return t.length > 0; });
  }
  function covTermScore(term) {
    if (FILLER_TERMS[term]) return scoreKeyword({ keyword: term, volume: 5, difficulty: 95, relevance: 10 });
    if (term.length <= 2) return scoreKeyword({ keyword: term, volume: 8, difficulty: 90, relevance: 12 });
    var relevance = Math.min(80, 40 + term.length * 4);
    return scoreKeyword({ keyword: term, volume: 50, difficulty: 50, relevance: relevance });
  }
  function buildCoverage(copy, brand) {
    copy = copy || {};
    var usedChars = {
      name: (copy.name || "").length,
      subtitle: (copy.subtitle || "").length,
      keywords: (copy.keywords || "").length,
    };
    // Per-field FILL (#60) — used/limit per field, with `seen` from whether the
    // input was a string at all. An UNSEEN field (undefined, e.g. a no-key run)
    // carries no fabricated fill: used + fillPct stay 0 so the UI shows UNKNOWN,
    // never a measured "0/limit". Mirrors src/engine/metadataCoverage.ts.
    var fieldFill = ["name", "subtitle", "keywords"].map(function (field) {
      var raw = copy[field];
      var seen = raw !== undefined && raw !== null;
      var used = seen ? String(raw).length : 0;
      var limit = CHAR_LIMITS[field];
      var fillPct = seen ? Math.max(0, Math.min(100, (used / limit) * 100)) : 0;
      return { field: field, limit: limit, used: used, fillPct: fillPct, seen: seen };
    });
    var brandToks = {};
    covTokens(brand).forEach(function (t) { brandToks[t] = 1; });
    function nonBrand(s) { return covTokens(s).filter(function (t) { return !brandToks[t]; }); }
    var nameT = nonBrand(copy.name), subT = nonBrand(copy.subtitle), kwT = nonBrand(copy.keywords);
    var waste = [];
    // brand_repeat — a brand word in the subtitle (#42)
    var subRaw = {}; covTokens(copy.subtitle).forEach(function (t) { subRaw[t] = 1; });
    Object.keys(brandToks).forEach(function (bt) {
      if (subRaw[bt]) waste.push({ kind: "brand_repeat",
        detail: 'Your brand name "' + bt + '" repeats in the subtitle — ' + bt.length +
          " chars Apple already indexes from the title. Move them to a fresh keyword (double-check variant spellings yourself).",
        chars: bt.length });
    });
    // duplicate — a non-brand term in 2+ fields
    var sets = [setOf(nameT), setOf(subT), setOf(kwT)];
    var all = {};
    nameT.concat(subT, kwT).forEach(function (t) { all[t] = 1; });
    Object.keys(all).forEach(function (term) {
      var inN = sets.filter(function (s) { return s[term]; }).length;
      if (inN >= 2) waste.push({ kind: "duplicate",
        detail: "'" + term + "' repeats across " + inN + " fields — Apple counts it once, so " +
          term.length + " chars are doing nothing. Consolidate to one field and reclaim the space.",
        chars: term.length });
    });
    // filler — low-value terms (advisory, not "remove")
    var seen = {};
    Object.keys(all).forEach(function (term) {
      if (seen[term]) return; seen[term] = 1;
      if (covTermScore(term) < FILLER_FLOOR) waste.push({ kind: "filler",
        detail: "'" + term + "' is a low-relevance filler term (low keyword value) — " + term.length +
          " chars that likely aren't pulling ranking weight. Consider a higher-value keyword; your call.",
        chars: term.length });
    });
    waste = waste.filter(function (w) { return w.chars > 0; });
    var distinctTerms = Object.keys(all).length;
    var totalWaste = waste.reduce(function (s, w) { return s + w.chars; }, 0);
    var coverageScore = distinctTerms === 0 ? 0
      : Math.max(0, Math.min(100, ((COVERAGE_BUDGET - totalWaste) / COVERAGE_BUDGET) * 100));
    return { coverageScore: coverageScore, usedChars: usedChars, fieldFill: fieldFill, distinctTerms: distinctTerms, waste: waste };
  }
  function setOf(arr) { var m = {}; arr.forEach(function (t) { m[t] = 1; }); return m; }

  // ── localization expansion (PRD 04, emitted on a Mode-A run) ───────────────
  // Mirrors recommendLocales(): { locale, rationale, storefrontTier, alreadyLive,
  // effort } sorted by ROI (tier × category fit × effort). Static descriptors —
  // no install numbers, no causal claims. effort:"translate" for a single-locale
  // app (one body of copy to translate into the new storefront).
  function buildLocalizationExpansion(category) {
    return [
      { locale: "es-MX", storefrontTier: "large", alreadyLive: false, effort: "translate",
        rationale: "Large storefront — Spanish-speaking Latin American audiences; your existing copy can be translated to claim it." },
      { locale: "de-DE", storefrontTier: "large", alreadyLive: false, effort: "translate",
        rationale: "Large storefront — German-speaking audiences across DACH; strong fit for your " + category + " category; your existing copy can be translated to claim it." },
      { locale: "ja-JP", storefrontTier: "large", alreadyLive: false, effort: "translate",
        rationale: "Large storefront — Japanese-speaking audiences; strong fit for your " + category + " category; your existing copy can be translated to claim it." },
      { locale: "fr-FR", storefrontTier: "large", alreadyLive: false, effort: "translate",
        rationale: "Large storefront — French-speaking audiences; your existing copy can be translated to claim it." },
      { locale: "pt-BR", storefrontTier: "large", alreadyLive: false, effort: "translate",
        rationale: "Large storefront — Portuguese-speaking Brazilian audiences; your existing copy can be translated to claim it." },
    ];
  }

  // ── competitor rank war room (PRD 05) ─────────────────────────────────────
  // A faithful JS port of src/engine/rankWarRoom.ts buildWarRoom(): per-keyword
  // head-to-head, gapToBest, trend, winning, sorted by SMALLEST closeable gap
  // first (winnability over vanity). Inputs mirror the engine: your normalized
  // RankSnapshot[] + per-competitor RankSnapshot[]. Unknown competitor rank =
  // null (rendered "—"), never a guess.
  function buildWarRoomMock(yourRanks, competitorRanks) {
    function bucket(rows) {
      var m = {};
      rows.forEach(function (r, idx) { (m[r.keyword] = m[r.keyword] || []).push({ s: r, idx: idx }); });
      Object.keys(m).forEach(function (k) {
        m[k].sort(function (a, b) { return a.s.checked_at !== b.s.checked_at ? (a.s.checked_at < b.s.checked_at ? -1 : 1) : a.idx - b.idx; });
        m[k] = m[k].map(function (x) { return x.s; });
      });
      return m;
    }
    function lastTwoDistinct(b) {
      if (!b || !b.length) return { current: null, previous: null };
      var newest = b[b.length - 1], previous = null;
      for (var i = b.length - 2; i >= 0; i--) { if (b[i].checked_at !== newest.checked_at) { previous = b[i].rank; break; } }
      return { current: newest.rank, previous: previous };
    }
    function trendOf(prev, cur) {
      if (prev === null && cur === null) return "flat";
      if (prev === null) return "new";
      if (cur === null) return "lost";
      if (cur < prev) return "gaining";
      if (cur > prev) return "losing";
      return "flat";
    }
    var yourB = bucket(yourRanks);
    var compB = competitorRanks.map(function (c) { return { name: c.name, by: bucket(c.ranks) }; });
    var rows = Object.keys(yourB).map(function (kw) {
      var tt = lastTwoDistinct(yourB[kw]);
      var you = tt.current;
      var competitors = compB.map(function (c) {
        var b = c.by[kw];
        return { name: c.name, rank: b && b.length ? b[b.length - 1].rank : null };
      });
      var known = competitors.map(function (c) { return c.rank; }).filter(function (r) { return r !== null; });
      var best = known.length ? Math.min.apply(null, known) : null;
      var winning = you !== null && known.length > 0 && known.every(function (r) { return you <= r; });
      var gapToBest = null;
      if (you !== null && best !== null) { var g = you - best; gapToBest = g > 0 ? g : null; }
      return { keyword: kw, you: you, competitors: competitors, gapToBest: gapToBest, trend: trendOf(tt.previous, you), winning: winning };
    });
    rows.sort(function (a, b) {
      var aHas = a.gapToBest !== null, bHas = b.gapToBest !== null;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && bHas && a.gapToBest !== b.gapToBest) return a.gapToBest - b.gapToBest;
      return a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0;
    });
    return rows;
  }

  // Synthesize a head-to-head for the selected competitors against the app's
  // tracked keywords. Deterministic from (keyword, competitor, bundleId) — and
  // crucially, on ~1-in-4 keywords a competitor was "not checked" → null, so the
  // grid shows honest "—" cells, never a fabricated rank.
  function warRoomMock(app, selected) {
    var kws = (app.keywords && app.keywords.length ? app.keywords : defaultKeywords(app.name)).slice(0, 6);
    var today = new Date().toISOString().slice(0, 10);
    var lastWeek = new Date(); lastWeek.setDate(lastWeek.getDate() - 7);
    var prevDay = lastWeek.toISOString().slice(0, 10);
    // your two-snapshot history (mirrors rankDeltas movement).
    var yourRanks = [];
    kws.forEach(function (kw) {
      var seed = hash(kw + (app.bundleId || ""));
      var prev = 12 + (seed % 60);
      var cur = Math.max(1, prev + (((seed >> 3) % 21) - 9));
      yourRanks.push({ keyword: kw, rank: prev, checked_at: prevDay });
      yourRanks.push({ keyword: kw, rank: cur, checked_at: today });
    });
    var names = (selected && selected.length ? selected : defaultCompetitors(app.name)).slice(0, 4);
    var competitorRanks = names.map(function (nm) {
      var ranks = [];
      kws.forEach(function (kw) {
        var h = hash(nm + "|" + kw + "|" + (app.bundleId || ""));
        if (h % 4 === 0) return; // ~1-in-4 keyword: we never checked this competitor → unknown
        ranks.push({ keyword: kw, rank: 1 + (h % 40), checked_at: today });
      });
      return { name: nm, ranks: ranks };
    });
    var warRoom = buildWarRoomMock(yourRanks, competitorRanks);
    return { appName: app.name, warRoom: warRoom, competitors: names, window: 7, checkedAt: today + "T00:00:00Z" };
  }

  // Build deterministic, real-looking App Store image URLs (the mzstatic size
  // token drives the aspect-ratio read; the gallery just renders the URL). #47.
  function shotUrls(seed, n, dims) {
    var urls = [];
    for (var i = 0; i < n; i++) {
      urls.push("https://is1.mzstatic.com/image/thumb/mock/" + seed + "/" + i + "/" + dims + "bb.png");
    }
    return urls;
  }

  // dataReliable:false + an empty set → the honest "?" (unknown) grade (#41):
  // we couldn't read the real screenshots, so we carry NO urls — never a fake
  // gallery. Mirrors src/engine/screenshotScore.ts's "?" branch.
  function scoreShots(app, iphone, ipad, dataReliable) {
    var iUrls = shotUrls(app + ":iphone", iphone, "1290x2796");
    var pUrls = shotUrls(app + ":ipad", ipad, "2048x2732");
    if (iphone === 0 && dataReliable === false) {
      return {
        app: app, iphoneCount: 0, ipadCount: ipad, score: null, grade: "?",
        findings: ["ℹ Couldn't read your screenshots from public App Store data — connect App Store Connect to audit your real screenshot set."],
        aspectHint: "", screenshotUrls: [], ipadScreenshotUrls: [],
      };
    }
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
    return { app: app, iphoneCount: iphone, ipadCount: ipad, score: score, grade: grade, findings: findings, aspectHint: "1290x2796", screenshotUrls: iUrls, ipadScreenshotUrls: pUrls };
  }

  // ── rank opportunity score (PRD 06) — mirrors src/engine/rankOpportunity.ts ─
  // Pure: scores keywords by WINNABILITY (volume × distance × competitor-weakness ×
  // momentum), with a reachability enum that labels (never hides) longshots.
  var OPP_SCAN_DEPTH = 200;
  // #65: measured drivers only (no fabricated volume), weights sum to 1.0.
  var OPP_WEIGHTS = { distance: 0.5, competitorWeakness: 0.35, momentum: 0.15 };
  function oppClamp(n) { return Math.max(0, Math.min(100, n)); }
  function oppRound2(n) { return Math.round(n * 100) / 100; }

  function rankOpportunities(input) {
    var byKw = {};
    input.ranks.forEach(function (r) {
      (byKw[r.keyword] = byKw[r.keyword] || []).push(r);
    });
    Object.keys(byKw).forEach(function (k) {
      byKw[k].sort(function (a, b) { return a.checked_at < b.checked_at ? -1 : a.checked_at > b.checked_at ? 1 : 0; });
    });

    var out = [];
    Object.keys(byKw).forEach(function (keyword) {
      var rows = byKw[keyword];
      var rank = rows[rows.length - 1].rank;

      // distance: rank 1 ≈ 99.5, rank 200/null → 0
      var distance = rank == null ? 0 : oppClamp(((OPP_SCAN_DEPTH - rank) / OPP_SCAN_DEPTH) * 100);

      // competitor weakness: avg competitor rank on this term (none → 100 open field)
      var crs = [];
      (input.competitorRanks || []).forEach(function (c) {
        var g = c.ranks.filter(function (x) { return x.keyword === keyword && x.rank != null; });
        if (g.length) {
          var latest = g.reduce(function (a, b) { return a.checked_at >= b.checked_at ? a : b; });
          crs.push(latest.rank);
        }
      });
      var weakness = crs.length === 0 ? 100 : oppClamp(((crs.reduce(function (a, b) { return a + b; }, 0) / crs.length) - 1) / OPP_SCAN_DEPTH * 100);

      // momentum from the most recent 2 snapshots (gaining 100 / flat-new 50 / losing 0)
      var momentum = 50;
      if (rows.length >= 2) {
        var p = rows[rows.length - 2].rank == null ? OPP_SCAN_DEPTH + 1 : rows[rows.length - 2].rank;
        var cc = rank == null ? OPP_SCAN_DEPTH + 1 : rank;
        momentum = cc < p ? 100 : cc > p ? 0 : 50;
      }

      var drivers = { distance: oppRound2(distance), competitorWeakness: oppRound2(weakness), momentum: momentum };
      var score = oppRound2(drivers.distance * OPP_WEIGHTS.distance + drivers.competitorWeakness * OPP_WEIGHTS.competitorWeakness + drivers.momentum * OPP_WEIGHTS.momentum);

      // reachability bucketing — the honest hedge (measured signals only, #65)
      var reach;
      if (rank != null && rank <= 10) reach = "now";
      else if (rank != null && rank <= 30 && drivers.distance >= 60 && drivers.competitorWeakness >= 50) reach = "now";
      else if (drivers.distance >= 60 && drivers.competitorWeakness >= 60) reach = "soon";
      else if (rank == null && drivers.competitorWeakness >= 70) reach = "soon";
      else reach = "longshot";

      // correlational why — describes state, never causation (no search-volume claim, #65)
      var parts = [];
      if (rank != null && rank <= 10) parts.push("already top 10");
      else if (rank != null && rank <= 30) parts.push("close to top 10");
      else if (rank != null) parts.push("currently #" + rank);
      else parts.push("not yet ranked");
      if (drivers.competitorWeakness >= 70) parts.push("weak/absent competitors");
      else if (drivers.competitorWeakness <= 30) parts.push("strong incumbents");
      if (drivers.momentum === 100) parts.push("gaining");
      else if (drivers.momentum === 0) parts.push("losing ground");
      var lead = reach === "now" ? "Most winnable next" : reach === "soon" ? "Reachable with a push" : "Longshot";

      out.push({ keyword: keyword, rank: rank, opportunityScore: score, reachability: reach, why: lead + ": " + parts.join(", ") + ".", drivers: drivers });
    });

    out.sort(function (a, b) {
      return b.opportunityScore !== a.opportunityScore ? b.opportunityScore - a.opportunityScore : (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0);
    });
    return out;
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

  // ── per-keyword week-over-week deltas (the animated dashboard payload) ─────
  // Mirrors the Worker's GET /apps/:id/deltas: each tracked keyword gets a
  // previous→current move, ordered biggest-mover-first, with a "same" trailer.
  function rankDeltas(app) {
    var kws = (app.keywords && app.keywords.length ? app.keywords : defaultKeywords(app.name)).slice(0, 6);
    var entries = kws.map(function (kw, i) {
      var seed = hash(kw + (app.bundleId || ""));
      var prev = 12 + (seed % 70);
      var move = ((seed >> 3) % 31) - 8; // mostly improvements, some slips/flat
      var cur = Math.max(1, prev + move);
      var delta = cur - prev; // lower is better; negative = improved
      var direction = delta < 0 ? "up" : delta > 0 ? "down" : "same";
      if (i === kws.length - 1) { cur = prev; delta = 0; direction = "same"; } // a flat trailer
      return { keyword: kw, current: cur, previous: prev, delta: delta, direction: direction };
    });
    function weight(e) {
      if (e.direction === "up") return 1000 + Math.abs(e.delta);
      if (e.direction === "down") return 500 + Math.abs(e.delta);
      if (e.direction === "new") return 400;
      if (e.direction === "lost") return 300;
      return 0;
    }
    attributeDeltas(app, entries); // PRD 02 overlay (correlational, may force a move)
    entries.sort(function (a, b) { return weight(b) - weight(a); });
    return { appName: app.name, entries: entries, anyMovement: entries.some(function (e) { return e.direction !== "same"; }) };
  }

  // ── PRD 02: rank attribution (mirrors src/engine/rankAttribution.ts) ───────
  // For each tracked keyword the app's approved pushes ADDED (present in the
  // proposed keywords/subtitle, absent from the baseline), attach a correlational
  // attributedChange + confidence:"linked" to its delta entry. To make the demo
  // honest end-to-end (connect → run → approve → ranks), a tracked keyword that
  // was just added but is sitting "same"/"down" is nudged to a real climb so the
  // proof line has a move to sit under — exactly what a next-week recheck shows.
  function termsAdded(push) {
    var prevKw = {}; (push.currentKeywords || "").split(",").forEach(function (t) { t = t.trim().toLowerCase(); if (t) prevKw[t] = 1; });
    var prevSub = {}; (push.currentSubtitle || "").toLowerCase().split(/[\s,]+/).forEach(function (w) { w = w.replace(/[^a-z0-9]/g, ""); if (w) prevSub[w] = 1; });
    var added = {};
    (push.proposedKeywords || "").split(",").forEach(function (t) { t = t.trim().toLowerCase(); if (t && !prevKw[t]) added[t] = 1; });
    (push.proposedSubtitle || "").toLowerCase().split(/[\s,]+/).forEach(function (w) { w = w.replace(/[^a-z0-9]/g, ""); if (w && !prevSub[w]) added[w] = 1; });
    return added;
  }
  function shortDate(iso) {
    var M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var d = new Date(iso); return isNaN(d.getTime()) ? iso : M[d.getUTCMonth()] + " " + d.getUTCDate();
  }
  function attributeDeltas(app, entries) {
    var pushes = (app._pushes || []).slice().sort(function (a, b) { return new Date(b.pushedAt) - new Date(a.pushedAt); });
    if (!pushes.length) return;
    entries.forEach(function (e) {
      var kw = (e.keyword || "").trim().toLowerCase();
      if (!kw) return;
      for (var i = 0; i < pushes.length; i++) {
        var added = termsAdded(pushes[i]);
        var parts = kw.split(/\s+/);
        var covered = added[kw] || (parts.length > 1 && parts.every(function (p) { return added[p]; }));
        if (!covered) continue;
        // nudge a non-improving entry into an honest climb so the proof line lands.
        if (e.direction !== "up" && e.direction !== "new") {
          var p = e.previous != null ? e.previous : (e.current != null ? e.current + 14 : 30);
          e.previous = p; e.current = Math.max(1, p - 14); e.delta = e.current - e.previous; e.direction = "up";
        }
        var inKw = (pushes[i].proposedKeywords || "").toLowerCase().split(",").map(function (t) { return t.trim(); }).indexOf(kw) >= 0;
        e.confidence = "linked";
        e.attributedChange = {
          runId: pushes[i].runId, pushedAt: pushes[i].pushedAt, addedTerms: [kw],
          note: "after you added '" + kw + "' to " + (inKw ? "keywords" : "your subtitle") + " (" + shortDate(pushes[i].pushedAt) + ")",
        };
        return;
      }
    });
  }

  // ── the router: parse method+path and return a Response ──────────────────
  function appSummary(app) {
    var r = app.latestRun ? app.runs && app.runs : null;
    return {
      id: app.id, bundle_id: app.bundleId, name: app.name, country: app.country || "US",
      created_at: app.created_at,
      latest_run: app.latestRunSummary || null,
      rank_summary: app.rankSummary || null,
      // findings-only summary for the dashboard badge (PRD 04); null until a run.
      findings_summary: app.findingsSummary || null,
    };
  }

  // A tiny demo catalog so the offline/preview backend can show the search +
  // picker flow without the live iTunes endpoints. The real /resolve queries
  // Apple; this just makes the mock click-through honest.
  var CATALOG = [
    { bundle_id: "app.airowe.clarity", name: "Heathen - Secular Meditation", publisher: "airowe", genres: ["Health & Fitness"], icon_url: null },
    { bundle_id: "com.calm.calmapp", name: "Calm", publisher: "Calm.com, Inc.", genres: ["Health & Fitness"], icon_url: null },
    { bundle_id: "com.getsomeheadspace.headspace", name: "Headspace: Sleep & Meditation", publisher: "Headspace Inc.", genres: ["Health & Fitness"], icon_url: null },
    { bundle_id: "com.hallow.app", name: "Hallow: Prayer & Meditation", publisher: "Hallow", genres: ["Lifestyle"], icon_url: null },
  ];

  var PAGE_SIZE = 12;

  // Mirror the server resolver's classify → resolved | candidates | not-found,
  // now with offset-based paging for name searches (offset defaults to 0).
  function resolveMock(q, offset) {
    offset = offset || 0;
    var raw = q.trim();
    var query;
    var byExact = null;
    if (/^https?:\/\//i.test(raw)) {
      var pm = raw.match(/[?&]id=([^&]+)/);
      if (/play\.google\.com/i.test(raw) && pm) { byExact = decodeURIComponent(pm[1]); query = { kind: "bundle-id", id: byExact }; }
      else { query = { kind: "name", term: raw }; }
    } else if (/^\d+$/.test(raw)) {
      query = { kind: "appstore-id", id: raw };
    } else if (/^[A-Za-z][\w-]*(\.[A-Za-z0-9][\w-]*)+$/.test(raw)) {
      byExact = raw; query = { kind: "bundle-id", id: raw };
    } else {
      query = { kind: "name", term: raw };
    }

    // id / bundle lookups don't paginate.
    if (byExact || query.kind !== "name") {
      var cands;
      if (byExact) {
        var hit = CATALOG.filter(function (c) { return c.bundle_id === byExact; });
        cands = hit.length ? hit : [{ bundle_id: byExact, name: byExact, publisher: null, genres: [], icon_url: null }];
      } else {
        cands = []; // numeric appstore-id has no demo catalog mapping
      }
      var k = cands.length === 0 ? "not-found" : cands.length === 1 ? "resolved" : "candidates";
      return { kind: k, query: query, candidates: cands, offset: 0, hasMore: false };
    }

    // Name search: matching catalog entries, padded with deterministic extras so
    // the demo can exercise "Show more" the way real iTunes results would.
    var needle = raw.toLowerCase();
    var matches = CATALOG.filter(function (c) {
      return c.name.toLowerCase().indexOf(needle) >= 0 || (c.publisher || "").toLowerCase().indexOf(needle) >= 0;
    });
    var all = matches.slice();
    // Only pad to a long list when the search is genuinely AMBIGUOUS (2+ real
    // catalog matches) — a single exact-ish match stays a clean single result so
    // it can still auto-resolve. This lets the demo exercise "Show more" without
    // fabricating a pick-list for an unambiguous query.
    if (matches.length >= 2) {
      var TOTAL = 27; // pretend iTunes returned a long list
      for (var i = all.length; i < TOTAL; i++) {
        all.push({ bundle_id: "com.demo." + needle.replace(/[^a-z0-9]/g, "") + "." + i, name: title(raw) + " — result " + (i + 1), publisher: "Demo Publisher", genres: ["Utilities"], icon_url: null });
      }
    }
    var page = all.slice(offset, offset + PAGE_SIZE);
    var hasMore = offset + PAGE_SIZE < all.length;
    var kind = all.length === 0 ? "not-found" : (page.length === 1 && offset === 0 && !hasMore) ? "resolved" : "candidates";
    return { kind: kind, query: query, candidates: page, offset: offset, hasMore: hasMore };
  }

  function handle(method, path, body, email) {
    var ctx = dbFor(email);
    var db = ctx.db;
    var m;

    // POST /resolve — name / link / id → connectable candidates (demo catalog)
    if (method === "POST" && path === "/resolve") {
      var q = (body.query || "").trim();
      if (!q) return json(400, { error: "query is required" });
      var resolved = resolveMock(q, body.offset || 0);
      return json(200, resolved);
    }

    // POST /apps  — connect an app
    if (method === "POST" && path === "/apps") {
      var id = uid();
      var app = {
        id: id, bundleId: (body.bundle_id || "").trim(), name: (body.name || "").trim() || body.bundle_id,
        country: body.country || "US", created_at: nowISO(),
        keywords: body.keywords || null, competitors: body.competitors || null,
        runs: [], latestRunSummary: null, rankSummary: null,
      };
      // TEST-ONLY fixture hooks: pin the live ASC subtitle/keyword field so a keyed
      // run can simulate read-but-EMPTY ("") vs populated copy. Honored only when
      // explicitly provided (including "") — never invented.
      if (body._liveSubtitle !== undefined) app._liveSubtitle = body._liveSubtitle;
      if (body._liveKeywords !== undefined) app._liveKeywords = body._liveKeywords;
      if (!app.bundleId) return json(400, { error: "bundle_id required" });

      // Tier gate (mirrors src/api/index.ts): enforce the per-tier connected-app
      // limit BEFORE creating. Re-connecting a bundle the user already owns is
      // always allowed (no new slot). New connections past the limit → 402.
      var owns = Object.keys(db.apps).some(function (k) { return db.apps[k].bundleId === app.bundleId; });
      if (!owns) {
        var tier = db.tier || "free";
        var limit = appLimitForTier(tier);
        var count = Object.keys(db.apps).length;
        if (count >= limit) {
          return json(402, {
            error: "your " + tier + " plan allows " + limit + " connected app" +
              (limit === 1 ? "" : "s") + ". Upgrade to connect more.",
            tier: tier,
            limit: limit,
          });
        }
      }

      db.apps[id] = app; ctx.commit();
      return json(201, { id: id });
    }

    // POST /_tier — TEST-ONLY: set the partition's billing tier so E2E can drive
    // the tier-gate paywall deterministically. Not a real Worker route.
    if (method === "POST" && path === "/_tier") {
      db.tier = (body && body.tier) || "free";
      ctx.commit();
      return json(200, { tier: db.tier });
    }

    // GET /apps — list apps + latest run status
    if (method === "GET" && path === "/apps") {
      var list = Object.keys(db.apps).map(function (k) { return appSummary(db.apps[k]); });
      list.sort(function (a, b) { return (b.created_at || "").localeCompare(a.created_at || ""); });
      return json(200, { apps: list });
    }

    // POST /apps/:id/run  and  /apps/:id/run-asc — trigger the loop. The -asc
    // variant requires (and never stores) a .p8 + key/issuer id, and reads the
    // app's live subtitle/keywords so the proposal improves them (#30 Mode A).
    if (method === "POST" && (m = path.match(/^\/apps\/([^/]+)\/run(-asc)?$/))) {
      var app = db.apps[m[1]];
      if (!app) return json(404, { error: "app not found" });
      var ascRead = m[2] === "-asc";
      if (ascRead && !(body && body.p8 && body.keyId && body.issuerId)) {
        return json(400, { error: "p8, keyId, and issuerId are required" });
      }
      var result = runAgentMock(app, ascRead);
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
      // findings-only summary for the dashboard badge (PRD 04) — counts, no raw data.
      app.findingsSummary = result.findingsSummary || null;
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

    // DELETE /apps/:id — disconnect (cascade its runs)
    if (method === "DELETE" && (m = path.match(/^\/apps\/([^/]+)$/))) {
      var app = db.apps[m[1]];
      if (!app) return json(404, { error: "app not found" });
      (app.runs || []).forEach(function (rid) { delete db.runs[rid]; });
      delete db.apps[m[1]];
      save(db);
      return json(200, { deleted: true, id: m[1] });
    }

    // GET /apps/:id/ranks — rank trend time-series for the sparkline
    if (method === "GET" && (m = path.match(/^\/apps\/([^/]+)\/ranks$/))) {
      var app = db.apps[m[1]];
      if (!app) return json(404, { error: "app not found" });
      return json(200, rankHistory(app));
    }

    // GET /apps/:id/deltas — per-keyword week-over-week movement (animated)
    if (method === "GET" && (m = path.match(/^\/apps\/([^/]+)\/deltas$/))) {
      var dApp = db.apps[m[1]];
      if (!dApp) return json(404, { error: "app not found" });
      return json(200, rankDeltas(dApp));
    }

    // GET /apps/:id/war-room?competitors=a,b — head-to-head rank war room (PRD 05)
    if (method === "GET" && (m = path.match(/^\/apps\/([^/]+)\/war-room(\?.*)?$/))) {
      var wApp = db.apps[m[1]];
      if (!wApp) return json(404, { error: "app not found" });
      var qs = (m[2] || "").replace(/^\?/, "");
      var picked = [];
      qs.split("&").forEach(function (kv) {
        var p = kv.split("=");
        if (decodeURIComponent(p[0]) === "competitors" && p[1]) {
          picked = decodeURIComponent(p[1]).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        }
      });
      return json(200, warRoomMock(wApp, picked));
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
      var app = db.apps[run.app_id];

      // Editable proposals (#39 Part 1): on approve with an edit buffer, merge the
      // editable fields over the agent's proposal, RE-VALIDATE (mirror of the
      // engine's validateCopy), and reflect the edited copy back. An invalid edit
      // 400s and the gate is NOT crossed (status stays awaiting_approval) — mirrors
      // the Worker, where server validation is authoritative.
      if (m[2] === "approve" && body && body.editedCopy && Object.keys(body.editedCopy).length) {
        var proposed = (run.result && run.result.proposedCopy) || {};
        var editable = ["name", "subtitle", "keywords", "promo"];
        var finalCopy = {};
        editable.forEach(function (f) { if (proposed[f] !== undefined) finalCopy[f] = proposed[f]; });
        editable.forEach(function (f) {
          if (proposed[f] !== undefined && typeof body.editedCopy[f] === "string") finalCopy[f] = body.editedCopy[f];
        });
        var checks = editable
          .filter(function (f) { return finalCopy[f] !== undefined; })
          .map(function (f) { return fieldCheck(f, finalCopy[f]); });
        var pass = checks.every(function (c) { return c.ok; });
        if (!pass) {
          var bad = checks.filter(function (c) { return !c.ok; })
            .map(function (c) { return c.field + " (" + c.issues.join("; ") + ")"; }).join(", ");
          return json(400, { error: "edited copy fails validation: " + bad });
        }
        // re-derive push commands from the edited copy (mirrors buildPushCommands)
        var bundleId = (app && app.bundleId) || "";
        var esc = function (s) { return "'" + String(s == null ? "" : s).replace(/'/g, "'\\''") + "'"; };
        var newPush = [
          { store: "appstore", tool: "asc", description: "Stage App Store name + subtitle + keyword field (review-gated).",
            command: "asc metadata set --bundle " + bundleId + " --name " + esc(finalCopy.name) + " --subtitle " + esc(finalCopy.subtitle) + " --keywords " + esc(finalCopy.keywords) },
        ];
        if (finalCopy.promo !== undefined) {
          newPush.push({ store: "appstore", tool: "asc", description: "Stage promotional text (editable without resubmission).",
            command: "asc metadata set --bundle " + bundleId + " --promo " + esc(finalCopy.promo) });
        }
        newPush.push({ store: "googleplay", tool: "gplay", description: "Stage Play Store title + short description (no keyword field on Play).",
          command: "gplay listing update --package " + bundleId + " --title " + esc(finalCopy.name) + " --short-description " + esc(finalCopy.subtitle) });
        // stage the edited copy onto the run (every downstream read sees it)
        run.result.proposedCopy = Object.assign({}, proposed, finalCopy, { validation: { pass: true, checks: checks } });
        run.result.pushCommands = newPush;
      }

      run.status = m[2] === "approve" ? "approved" : "rejected";
      run.decided_at = nowISO();
      if (app && app.latestRunSummary && app.latestRunSummary.id === run.id) app.latestRunSummary.status = run.status;
      // PRD 02: on approval, record the push (the terms WE proposed + the baseline
      // + the timestamp) so the next rank-check can (correlationally) attribute a
      // keyword move to it. Mirrors the Worker's derivePushes(): proposed/current
      // copy off the run trace, approval timestamp as pushedAt. No raw ASC data.
      if (app && m[2] === "approve") {
        var pc = run.result && run.result.proposedCopy ? run.result.proposedCopy : {};
        var cc = run.result && run.result.currentCopy ? run.result.currentCopy : {};
        app._pushes = (app._pushes || []).concat([{
          runId: run.id, pushedAt: run.decided_at,
          proposedKeywords: pc.keywords || "", proposedSubtitle: pc.subtitle || "",
          currentKeywords: cc.keywords || "", currentSubtitle: cc.subtitle || "",
        }]);
      }
      ctx.commit();
      // On approve, return the FINALIZED (possibly edited) copy + re-derived
      // commands so the client renders what actually ships (mirrors the Worker).
      if (m[2] === "approve") {
        return json(200, {
          id: run.id, status: run.status,
          proposedCopy: run.result.proposedCopy,
          pushCommands: run.result.pushCommands,
        });
      }
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
