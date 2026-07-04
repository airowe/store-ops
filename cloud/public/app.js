/*
 * app.js — the store-ops dashboard SPA.
 *
 * No framework, no build step. A tiny hash router + four views:
 *   #/            connect-app + dashboard (apps as cards)
 *   #/apps/:id    app detail (rank trend sparkline, run history)
 *   #/runs/:id    THE money screen: reasoning, proposed copy w/ char counts,
 *                 competitor read, rank trend, generated push commands, gate.
 *
 * API CONTRACT — every backend call goes through api() which does:
 *     fetch(API_BASE + path, { method, headers: { "X-User-Email": <stub auth> }, body })
 *   API_BASE comes from window.STORE_OPS.API_BASE (config.js). If it's empty, or
 *   the Worker is unreachable, we fall back to the in-browser mock (mock.js) that
 *   returns the SAME shapes — so the product is clickable with or without a backend.
 */
(function () {
  "use strict";

  var CFG = window.STORE_OPS || {};
  var API_BASE = (CFG.API_BASE || "").replace(/\/$/, "");
  var LIMITS = { name: 30, subtitle: 30, keywords: 100, promo: 170, description: 4000 };
  // The fields a human may edit on the run page (#39 Part 1) — mirrors the diff
  // card + the server's EDITABLE_FIELDS. description/whatsNew are out of scope.
  var EDITABLE_FIELDS = ["name", "subtitle", "keywords", "promo"];

  // ── client mirror of the engine's validateCopy (src/engine/optimize.ts) ─────
  // ADVISORY ONLY: gives the user instant red/green before they approve. The
  // server re-runs the REAL validateCopy at the gate and is authoritative — an
  // invalid edit can never be staged regardless of what this says. Kept a thin
  // 1:1 port so the two never disagree on the cases that matter.
  function kwWords(s) {
    return String(s == null ? "" : s).toLowerCase().split(/\s+/)
      .map(function (w) { return w.replace(/[^a-z0-9]/g, ""); })
      .filter(Boolean);
  }
  function clientFieldCheck(field, copy) {
    var value = String(copy[field] == null ? "" : copy[field]);
    var limit = LIMITS[field];
    var issues = [];
    if (value.length > limit) issues.push("over limit by " + (value.length - limit) + " (" + value.length + "/" + limit + ")");
    if (field === "keywords") {
      if (/,\s/.test(value) || /\s,/.test(value)) issues.push("keyword field must be comma-separated with NO spaces around commas");
      var banned = {};
      kwWords(copy.name).concat(kwWords(copy.subtitle)).forEach(function (w) { banned[w] = 1; });
      var terms = value.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
      var dupes = terms.filter(function (t) { return kwWords(t).some(function (w) { return banned[w]; }); });
      if (dupes.length) issues.push("keyword field duplicates title/subtitle word(s): " + dupes.join(", "));
    }
    return { field: field, value: value, count: value.length, limit: limit, ok: issues.length === 0, issues: issues };
  }
  // Validate only the editable fields the proposal actually carries (never
  // fabricate an unseen field into a check).
  function clientValidateCopy(copy) {
    var checks = EDITABLE_FIELDS
      .filter(function (f) { return copy[f] !== undefined; })
      .map(function (f) { return clientFieldCheck(f, copy); });
    return { pass: checks.every(function (c) { return c.ok; }), checks: checks };
  }

  // A per-run edit buffer shared between the diff card (the inputs) and the gate
  // card (Approve enablement + handoff render). Only fields the agent actually
  // proposed AND could SEE are editable — editing can never fabricate an unseen
  // field into existence (honesty guard #39 §6.1). subtitle/keywords are unseen on
  // a no-key run: the proposal carries them as "" but the live value is unknown
  // (absent from currentCopy), so we must NOT expose them as editable inputs.
  function makeEditState(proposed, current) {
    var p = proposed || {};
    var cur = current || {};
    // name + promo are always authored by the agent; subtitle/keywords are only
    // genuinely proposed when the run could READ the live value (currentCopy carries
    // the field). Otherwise they're unseen and stay non-editable.
    var seen = function (f) {
      if (p[f] === undefined) return false;
      if (f === "subtitle" || f === "keywords") return cur[f] !== undefined;
      return true;
    };
    var buffer = {};
    EDITABLE_FIELDS.forEach(function (f) { if (seen(f)) buffer[f] = p[f]; });
    var subs = [];
    return {
      buffer: buffer,
      original: p,
      editable: function (f) { return seen(f); },
      set: function (f, v) { buffer[f] = v; this.notify(); },
      reset: function (f) { buffer[f] = p[f]; this.notify(); },
      isDirty: function (f) { return String(buffer[f] == null ? "" : buffer[f]) !== String(p[f] == null ? "" : p[f]); },
      validation: function () { return clientValidateCopy(buffer); },
      isValid: function () { return this.validation().pass; },
      subscribe: function (fn) { subs.push(fn); },
      notify: function () { subs.forEach(function (fn) { fn(); }); },
    };
  }

  // The bundle the browser actually executed. In the deployed dist/ this is
  // app.<hash>.js (content-hashed by scripts/stampAssets.mjs); in local/public
  // (un-hashed, no build step) it's app.js. document.currentScript is the
  // running <script>'s element at top-level IIFE execution time — app.js is a
  // classic (non-module) script (index.html:40) so this is available here.
  // Used by the SPA-freshness check (#54) to tell which bundle is live.
  // CFG.SELF_SCRIPT is a test-only seam (E2E simulates a hashed deploy against
  // the un-hashed local public/); config.js never sets it in prod, so the real
  // running bundle's URL is the source of truth.
  var SELF_SCRIPT = CFG.SELF_SCRIPT || (document.currentScript && document.currentScript.src) || "";

  // ── auth ──────────────────────────────────────────────────────────────────
  // Real path: a signed-in session cookie (magic-link). Demo path (when the
  // backend runs APP_ENV=demo): an email in localStorage sent as X-User-Email.
  // `session` is loaded from GET /auth/me on boot; null until then.
  var session = null; // { authed, via:"session"|"demo", email } | { authed:false }
  function email() { return (session && session.email) || localStorage.getItem("store-ops:email") || "demo@store-ops.dev"; }

  // Has the user DELIBERATELY opted into the demo (typed an email into the
  // "acting as" field)? We only send X-User-Email then — never the silent
  // default — so a fresh visitor with no session falls through to the login
  // screen instead of being auto-logged-in as the demo user.
  function explicitDemoEmail() { return localStorage.getItem("store-ops:email") || null; }

  // Ask the backend who we are. Never throws — returns {authed:false} on any failure.
  async function loadSession() {
    if (!API_BASE) {
      // Offline/demo backend: read the boot check (incl. the per-user pause flag,
      // #51) from the mock so the dashboard banner reflects real state.
      try {
        var mr = window.STORE_OPS_MOCK.handle("GET", "/auth/me", null, email());
        session = await mr.json();
      } catch (e2) { session = { authed: true, via: "demo", email: email() }; }
      return session;
    }
    try {
      var headers = {};
      var demo = explicitDemoEmail();
      if (demo) headers["X-User-Email"] = demo; // only when explicitly chosen
      var res = await fetch(API_BASE + "/auth/me", { credentials: "include", headers: headers });
      session = await res.json();
    } catch (e) { session = { authed: false }; }
    return session;
  }

  // Decide what the header should render — tested spec in scripts/headerState.mjs
  // (keep in sync). "signedIn" (live + real session cookie) → email + Sign out +
  // auto-loaded apps; "signIn" (live, logged out / loading / demo-stub) → a Sign
  // in button (the X-User-Email stub can't auth on prod and is misleading);
  // "demoStub" (no API_BASE) → keep the editable field for local dev.
  function headerState() {
    if (!API_BASE) return { mode: "demoStub", email: (session && session.email) || null };
    if (session && session.authed === true && session.via === "session") return { mode: "signedIn", email: session.email || null };
    return { mode: "signIn", email: null };
  }

  // ── API client ────────────────────────────────────────────────────────────
  var liveMode = !!API_BASE; // becomes false if the live Worker errors out
  // Ephemeral ASC credentials from the current session's READ — held ONLY in JS
  // memory so the PUSH step (same run, minutes later) doesn't re-prompt for the
  // key the user just entered. NEVER persisted to disk/localStorage/server, and
  // cleared on every route() so it can't linger across apps. Honors the standing
  // "never store the .p8" rule while killing the same-run double-entry friction.
  var ascCredsMemory = null; // { issuerId, keyId, p8 } | null
  var connectInFlight = false; // #77: re-entry guard so a connect can't double-fire
  async function api(method, path, body) {
    var headers = {};
    // Session cookie is the real auth; only add the demo header when the user
    // explicitly opted into the demo (and there's no real session).
    var demo = explicitDemoEmail();
    if (demo && !(session && session.via === "session")) headers["X-User-Email"] = demo;
    if (body) headers["content-type"] = "application/json";
    // credentials:include sends the session cookie cross-origin (app.shipaso.com
    // → api.shipaso.com). Requires the API to echo a concrete Origin + allow
    // credentials (it does), and the cookie to be SameSite=None + Domain-scoped.
    var init = { method: method, headers: headers, credentials: "include" };
    if (body) init.body = JSON.stringify(body);

    if (API_BASE && liveMode) {
      try {
        var res = await fetch(API_BASE + path, init);
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data: data });
        return data;
      } catch (err) {
        if (err.status) throw err; // a real API error (404/403) — surface it
        // transport failure → fall back to the mock for the rest of the session
        liveMode = false;
        setEnvPill();
        toast("Worker unreachable — running on the offline demo backend.");
      }
    }
    // mock transport (same routes/shapes as the Worker API)
    var r = window.STORE_OPS_MOCK.handle(method, path, body || null, email());
    var d = await r.json();
    if (r.status >= 400) throw Object.assign(new Error(d.error || "error"), { status: r.status, data: d });
    return d;
  }

  // ── tiny DOM helpers ───────────────────────────────────────────────────────
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    // A <button> with no explicit type defaults to type="submit" per the HTML
    // spec — so a button placed anywhere inside a <form> submits it on click,
    // triggering a FULL PAGE RELOAD (wiping SPA state + entered credentials and
    // jumping to the top). Default every button to type="button"; the few real
    // submit buttons (Search / Send link / Preview) set type="submit" explicitly.
    if (tag === "button" && !(attrs && attrs.type)) n.setAttribute("type", "button");
    if (attrs) for (var k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c == null) return; n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function root() { return document.getElementById("view"); }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function go(hash) { location.hash = hash; }
  // Parse a hash query string ("asc=1&x=2") into a plain object. Empty → {}.
  function parseQuery(q) {
    var out = {};
    if (!q) return out;
    q.split("&").forEach(function (pair) {
      if (!pair) return;
      var kv = pair.split("=");
      out[decodeURIComponent(kv[0])] = kv.length > 1 ? decodeURIComponent(kv[1]) : "";
    });
    return out;
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  async function copyText(s, label) {
    try { await navigator.clipboard.writeText(s); toast((label || "Copied") + " ✓"); }
    catch (e) { toast("Copy failed — select & ⌘C"); }
  }

  // ── SPA freshness (#54) ─────────────────────────────────────────────────────
  // A tab left open across a deploy keeps running the OLD app.<hash>.js — the
  // hash router re-renders #view in place and never re-requests app.js. We
  // detect a newer deploy by re-fetching the always-no-cache /index.html
  // (_headers:13-14) and comparing the app bundle it references against the
  // bundle the browser actually ran (SELF_SCRIPT). On a difference we show a
  // gentle, dismissible banner — we NEVER auto-reload (an at-the-wrong-moment
  // reload could drop an in-flight approval or the in-memory .p8). The two pure
  // functions below MIRROR scripts/freshness.mjs (tested spec) — keep in sync.
  var FRESHNESS_POLL_MS = 15 * 60 * 1000; // backstop for an always-foreground tab

  // Extract the referenced app bundle (app.<hash>.js or bare app.js) from an
  // index.html string; null if none. Scoped to app.* so config/mock/styles can
  // never match. Mirrors bundleRefFromHtml in scripts/freshness.mjs.
  function bundleRefFromHtml(html) {
    if (!html) return null;
    var m = String(html).match(/src="(app(?:\.[0-9a-f]+)?\.js)"/);
    return m ? m[1] : null;
  }
  function freshnessBasename(url) {
    if (!url) return "";
    var s = String(url).split("?")[0].split("#")[0];
    var slash = s.lastIndexOf("/");
    return slash >= 0 ? s.slice(slash + 1) : s;
  }
  // Is the running bundle older than what /index.html now references? Honest
  // "don't know" → false (never nag): unknown self, failed fetch (null ref), or
  // an un-hashed local/E2E bundle (bare app.js) all return false. Compares
  // basenames only (origin-independent). Mirrors isStale in scripts/freshness.mjs.
  function isStale(selfScriptUrl, liveBundleRef) {
    if (!selfScriptUrl || !liveBundleRef) return false;
    var self = freshnessBasename(selfScriptUrl);
    var live = freshnessBasename(liveBundleRef);
    if (!self || !live) return false;
    if (self === "app.js") return false; // un-hashed dev bundle → dormant
    return self !== live;
  }

  var freshnessBannerShown = false; // once shown, stop polling (state is monotonic)
  var freshnessTimer = null;

  // Re-fetch the no-cache /index.html and diff its bundle ref against SELF_SCRIPT.
  // Deliberately uses its OWN fetch (NOT api()) so a probe failure can never flip
  // the app into mock mode (liveMode) or toast an error — it must fail silently.
  async function checkFreshness() {
    if (freshnessBannerShown) return;
    try {
      var res = await fetch("/index.html", { cache: "no-store" });
      if (!res || !res.ok) return; // silent: an unreachable probe is "don't know"
      var html = await res.text();
      if (isStale(SELF_SCRIPT, bundleRefFromHtml(html))) showFreshnessBanner();
    } catch (e) { /* offline / parse error → silent, never nag, never flip mode */ }
  }

  function dismissFreshnessBanner() {
    var bar = document.getElementById("freshness");
    if (bar) bar.classList.remove("show");
    // Keep freshnessBannerShown = true: we don't re-nag the SAME detected
    // version this session. A FURTHER deploy can show it again — but we've also
    // stopped polling, which is fine: a returning user gets a fresh index.html
    // (and the latest bundle) on their next real reload anyway.
  }

  function showFreshnessBanner() {
    if (freshnessBannerShown) return;
    freshnessBannerShown = true;
    if (freshnessTimer != null) { clearInterval(freshnessTimer); freshnessTimer = null; }
    var bar = document.getElementById("freshness");
    if (!bar) return;
    clear(bar);
    bar.appendChild(el("span", { class: "fresh-msg" }, ["A new version of ShipASO is available — refresh to update."]));
    bar.appendChild(el("button", { class: "btn", id: "freshnessReload", onclick: function () { location.reload(); } }, ["Refresh"]));
    bar.appendChild(el("button", { class: "fresh-x", id: "freshnessDismiss", "aria-label": "Dismiss", onclick: dismissFreshnessBanner }, ["×"]));
    bar.classList.add("show");
  }

  // Start freshness detection — focus (cheapest, highest-signal: user returned
  // to the tab) + a 15-min interval backstop. Gated to PROD-only: API_BASE set
  // AND a hashed bundle (SELF_SCRIPT !== app.js), so it's inert in local/demo/E2E
  // unless a test explicitly drives it. No route-change trigger (focus already
  // covers "came back to the tab" without a network hop per hash navigation).
  function startFreshnessChecks() {
    if (!API_BASE) return;
    if (freshnessBasename(SELF_SCRIPT) === "app.js") return; // un-hashed → dormant
    window.addEventListener("focus", checkFreshness);
    freshnessTimer = setInterval(checkFreshness, FRESHNESS_POLL_MS);
  }

  // Debounced, race-safe auto-search controller for the app-search boxes — the
  // tested spec lives in scripts/searchController.mjs (keep in sync). Typing 3+
  // chars fires a de-duped query after `delayMs`; an out-of-order response is
  // dropped (the `seq` guard) so a slow earlier search can't clobber a newer one.
  function createSearchController(o) {
    var timer = null, lastFed = "", lastQueried = "", seq = 0, clearCb = null;
    function cancel() { if (timer != null) { clearTimeout(timer); timer = null; } }
    function fire(q) {
      cancel();
      if (q.length < o.minChars) return;
      if (q === lastQueried) return;       // already shown — don't refetch
      lastQueried = q;
      var mine = ++seq;
      Promise.resolve(o.fetcher(q)).then(function (result) {
        if (mine !== seq) return;          // superseded by a newer search → drop
        o.onResult(result, q);
      });
    }
    return {
      input: function (value) {
        var q = (value || "").trim(); lastFed = q; cancel();
        if (q.length === 0) { lastQueried = ""; seq++; if (clearCb) clearCb(); return; }
        if (q.length < o.minChars) return;
        if (q === lastQueried) return;
        timer = setTimeout(function () { timer = null; fire(q); }, o.delayMs);
      },
      submit: function () { fire(lastFed); },
      onClear: function (fn) { clearCb = fn; },
    };
  }

  // Pagination controller for the candidate picker — tested spec in
  // scripts/paginator.mjs (keep in sync). Owns offset/hasMore/in-flight so BOTH
  // the "Show more" button and scroll-to-load can call loadMore() without
  // double-fetching or paging past the end. Lets a lower-ranked app under a
  // generic term (e.g. "Mangia - Recipe Manager" under "Mangia") be reached.
  function createPaginator(o) {
    var offset = o.initialOffset, pageSize = o.pageSize, more = o.initialHasMore, inFlight = false;
    function loadMore() {
      if (!more || inFlight) return;
      inFlight = true;
      var next = offset + pageSize;
      Promise.resolve(o.fetchPage(next)).then(function (page) {
        inFlight = false;
        var cands = (page && page.candidates) || [];
        offset = next;
        more = !!(page && page.hasMore);
        o.onPage(cands, page);
      }, function () { inFlight = false; });  // failed page → retry same offset next call
    }
    return {
      loadMore: loadMore,
      hasMore: function () { return more; },
      isLoading: function () { return inFlight; },
      offset: function () { return offset; },
    };
  }

  // Mirror of the server resolver's classifyQuery (src/engine/resolveApp.ts): is
  // this raw query a NAME search? A URL, a numeric App Store id, or a dotted
  // bundle/package id all resolve EXACTLY, so they're not name searches. Anything
  // else (a plain name like "Mangia") is — and a name search can miss a
  // lower-ranked app entirely, which is what the end-of-results nudge addresses.
  var BUNDLE_RE = /^[A-Za-z][\w-]*(\.[A-Za-z0-9][\w-]*)+$/;
  function isNameSearch(raw) {
    var q = (raw || "").trim();
    if (!q) return false;
    if (/^https?:\/\//i.test(q)) return false; // App Store / Play link → exact lookup
    if (/^\d+$/.test(q)) return false;          // numeric App Store track id
    if (BUNDLE_RE.test(q)) return false;        // bundle / package id
    return true;
  }

  // The end-of-results footer ("That's everything matching…"), plus — for NAME
  // searches only — a gentle nudge to paste an exact App Store link or bundle id.
  // Search can miss an app that doesn't yet rank for a common term (the live
  // "Mangia" case), so we offer the exact path; the "App Store link or bundle id"
  // phrase is actionable and focuses the search box. We never show the nudge for
  // queries that already resolved exactly (link / id / bundle), and stay
  // conservative — no rank claims from a single search.
  function appendEndOfResults(container, term, focusSearch) {
    var footer = el("div", { class: "pager faint", style: "font-size:12px;margin-top:6px" }, [
      "That's everything matching — refine the name if your app isn't here.",
    ]);
    if (isNameSearch(term)) {
      var link = el("a", { class: "find-exact-link", href: "#", role: "button", style: "font-weight:600;text-decoration:underline;cursor:pointer" }, ["App Store link or bundle id"]);
      link.addEventListener("click", function (ev) {
        ev.preventDefault();
        if (typeof focusSearch === "function") focusSearch();
      });
      footer.appendChild(el("div", { class: "find-exact-nudge", style: "margin-top:6px" }, [
        "Don't see your app? Paste your ", link,
        " to find it exactly — search can miss apps that don't yet rank for a common term.",
      ]));
    }
    container.appendChild(footer);
  }

  // Wire pagination onto a freshly-rendered candidate picker: a paginator + a
  // scroll sentinel (IntersectionObserver) + a "Show more" button, both calling
  // the same loadMore() (the paginator guards against double-fetch). `fetchNext`
  // returns the raw next-page response ({candidates,hasMore,offset}); `renderRows`
  // appends its candidates as picker rows. `focusSearch` (optional) focuses the
  // picker's search input — wired to the end-of-results "paste exact id" nudge.
  // Shared by the logged-out preview and the authenticated connect pickers.
  function attachPager(container, term, first, fetchNext, renderRows, focusSearch) {
    var oldPager = container.querySelector(".pager");
    if (oldPager) oldPager.remove();
    if (!(first && first.hasMore && term)) {
      if (((first && first.candidates) || []).length > 1) {
        appendEndOfResults(container, term, focusSearch);
      }
      return;
    }
    var moreBtn = el("button", { class: "btn ghost more-btn" }, ["Show more results ↓"]);
    var sentinel = el("div", { class: "pager-sentinel", style: "height:1px" });
    var pager = el("div", { class: "pager", style: "margin-top:4px" }, [moreBtn, sentinel]);
    container.appendChild(pager);

    var io = null;
    var paginator = createPaginator({
      term: term, pageSize: ((first.candidates || []).length || 12), initialOffset: first.offset || 0, initialHasMore: !!first.hasMore,
      fetchPage: function (nextOffset) {
        moreBtn.disabled = true; moreBtn.innerHTML = '<span class="spin"></span> Loading…';
        return Promise.resolve(fetchNext(nextOffset)).catch(function () { moreBtn.disabled = false; moreBtn.textContent = "Show more results ↓"; toast("Couldn't load more — try again."); return { candidates: [], hasMore: true }; });
      },
      onPage: function (cands) {
        renderRows(cands);
        container.appendChild(pager); // keep the controls at the bottom
        if (paginator.hasMore()) { moreBtn.disabled = false; moreBtn.textContent = "Show more results ↓"; }
        else { if (io) io.disconnect(); moreBtn.remove(); sentinel.remove(); appendEndOfResults(container, term, focusSearch); }
      },
    });
    moreBtn.addEventListener("click", function () { paginator.loadMore(); });
    // Scroll-to-load: fetch the next page as the sentinel nears the viewport.
    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) paginator.loadMore();
      }, { rootMargin: "200px" });
      io.observe(sentinel);
    }
  }
  // Trigger a client-side file download of `text` as `filename`.
  function downloadText(text, filename, label) {
    var blob = new Blob([text], { type: "text/x-shellscript" });
    downloadBlob(blob, filename, label);
  }
  // Trigger a client-side download of an arbitrary Blob (png/svg/etc.).
  function downloadBlob(blob, filename, label) {
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    if (label !== false) toast((label || "Downloaded") + " ✓");
  }
  function loading(msg) { clear(root()); root().appendChild(el("div", { class: "empty" }, [el("div", { class: "spin" }), " " + (msg || "Loading…")])); }

  // ── tier-limit paywall (#27) ────────────────────────────────────────────────
  // A 402 from POST /apps means the user hit their plan's connected-app cap. The
  // backend sends a friendly message ("your free plan allows 1 connected app.
  // Upgrade to connect more."); we parse the tier + limit out of it (the live
  // Worker only ships `error`; the mock also includes structured tier/limit) and
  // render a prominent, blocking upsell dialog instead of a silent toast.
  function parseTierLimit(e) {
    var data = (e && e.data) || {};
    var msg = (e && e.message) || "";
    var tier = data.tier;
    var limit = data.limit;
    if (tier == null) { var mt = msg.match(/your\s+(\w+)\s+plan/i); if (mt) tier = mt[1]; }
    if (limit == null) { var ml = msg.match(/allows\s+(\d+)\s+connected app/i); if (ml) limit = parseInt(ml[1], 10); }
    return { tier: tier || "current", limit: (limit != null ? limit : null) };
  }

  function showTierLimitModal(e) {
    // Only ever one open at a time.
    var prior = document.querySelector(".tier-limit-modal");
    if (prior) prior.remove();

    var info = parseTierLimit(e);
    var appsLabel = info.limit != null ? (info.limit + " app" + (info.limit === 1 ? "" : "s") + " max") : "your plan's limit";
    var body = "You're on the " + info.tier + " plan — " + appsLabel + ". Upgrade your plan to connect additional apps.";

    var overlay = el("div", { class: "tier-limit-modal", role: "dialog", "aria-modal": "true", "aria-label": "Upgrade to connect more" });
    function dismiss() { overlay.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(ev) { if (ev.key === "Escape") dismiss(); }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", function (ev) { if (ev.target === overlay) dismiss(); });

    // The next tier up from where they are (free→indie→startup→scale).
    var NEXT_TIER = { current: "indie", free: "indie", indie: "startup", startup: "scale", scale: "scale" };
    var targetTier = NEXT_TIER[info.tier] || "indie";
    var upgradeBtn = el("button", { class: "btn primary", onclick: function () {
      // Mint a real Stripe Checkout Session and send the browser there. On failure
      // we keep the modal open with an inline message — never a silent dead end.
      upgradeBtn.disabled = true; upgradeBtn.innerHTML = '<span class="spin"></span> Opening checkout…';
      api("POST", "/billing/checkout", { tier: targetTier })
        .then(function (r) {
          if (r && r.url) { window.location.href = r.url; }
          else { throw new Error("no checkout url"); }
        })
        .catch(function (err) {
          upgradeBtn.disabled = false; upgradeBtn.textContent = "Upgrade plan";
          toast(err.message === "no checkout url" ? "Couldn't open checkout — try again." : (err.message || "Couldn't open checkout — try again."));
        });
    } }, ["Upgrade to " + targetTier]);
    var dismissBtn = el("button", { class: "btn ghost", onclick: dismiss }, ["Got it"]);

    overlay.appendChild(el("div", { class: "tier-limit-card card" }, [
      el("div", { class: "tlm-badge" }, ["⚡"]),
      el("h2", { style: "margin:8px 0 6px" }, ["Upgrade to connect more"]),
      el("p", { class: "tlm-body" }, [body]),
      el("div", { class: "btn-row", style: "margin-top:16px;justify-content:flex-end" }, [dismissBtn, upgradeBtn]),
    ]));
    document.body.appendChild(overlay);
    upgradeBtn.focus();
  }

  function setEnvPill() {
    var p = document.getElementById("envpill");
    if (!p) return;
    var live = API_BASE && liveMode;
    p.className = "env-pill " + (live ? "live" : "demo");
    p.textContent = live ? "live · " + API_BASE.replace(/^https?:\/\//, "") : "demo backend";
    p.title = live ? "Calling the deployed Worker API" : "No API_BASE set in config.js — using the in-browser demo backend (mock.js)";
  }

  // ── status helpers ──────────────────────────────────────────────────────────
  function statusBadge(s) { return el("span", { class: "badge " + s }, [labelFor(s)]); }
  // NOTE: approval moves a run to `approved` and only REVEALS the push commands —
  // nothing has reached App Store Connect yet, so the label must NOT claim
  // "Shipped". Legacy `shipped` rows predate this split and likewise only mean
  // "approved" (no verified push), so they read the same honest copy. A truthful
  // "Shipped" is reserved for a confirmed push.
  function labelFor(s) { return ({ detected: "Detected", researching: "Researching", awaiting_approval: "Awaiting approval", approved: "Approved · ready to push", rejected: "Rejected", shipped: "Approved · ready to push" })[s] || s; }
  function rankClass(r) { return r == null ? "none" : r <= 10 ? "good" : r <= 50 ? "mid" : ""; }
  function rankText(r) { return r == null ? "—" : "#" + r; }
  // Plain-English meaning of an audit grade (matches the engine's A≥85…F bands).
  function gradeMeaning(g) {
    return ({ A: "excellent — your listing is dialed in", B: "good, with room to sharpen", C: "average — a few clear wins available", D: "weak — leaving installs on the table", F: "needs work — big opportunity here", "?": "couldn't read your screenshots from public data — connect App Store Connect to grade them" })[g] || "";
  }

  // ── motion: tween an element's text from one rank number to another ──────────
  // Honors prefers-reduced-motion (jumps straight to the final value). `from`/`to`
  // may be null (unranked) — a null endpoint renders "—" and skips the count.
  var REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function countUpRank(node, from, to, delayMs) {
    if (to == null) { node.textContent = "—"; return; }
    if (from == null || REDUCED_MOTION) { node.textContent = "#" + to; return; }
    var dur = 650, start = 0, done = false, delay = delayMs || 0;
    node.textContent = "#" + from;
    function settle() { if (!done) { done = true; node.textContent = "#" + to; } }
    function step(ts) {
      if (done) return;
      if (!start) start = ts;
      var t = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      node.textContent = "#" + Math.round(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step); else settle();
    }
    setTimeout(function () { requestAnimationFrame(step); }, delay);
    // Safety net: rAF is throttled in background tabs and can stall mid-tween.
    // Force the exact final value after the animation window so the displayed
    // number can never be left stranded between `from` and `to`.
    setTimeout(settle, delay + dur + 80);
  }

  // The pause flag the dashboard renders from. Sourced from /auth/me on boot;
  // updated from the pause/resume endpoint's RETURNED state (never an optimistic
  // guess) so the banner can't drift from the server (#51).
  function agentPaused() { return !!(session && session.paused); }

  // Toggle the weekly autonomous sweep. Calls the canonical endpoint, adopts the
  // returned `paused`, and re-renders the dashboard so the banner + button update
  // without a full reload.
  function toggleAgentPause(btn) {
    var goingToPause = !agentPaused();
    if (btn) { btn.disabled = true; btn.textContent = goingToPause ? "Pausing…" : "Resuming…"; }
    api("POST", goingToPause ? "/agent/pause" : "/agent/resume")
      .then(function (r) {
        if (session) session.paused = !!r.paused;
        toast(r.paused ? "Autonomous agent paused — no new weekly checks until you resume." : "Autonomous agent resumed — back to the Monday sweep.");
        viewDashboard();
      })
      .catch(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = goingToPause ? "Pause agent" : "Resume agent"; }
        toast((e && e.message) || "Failed to update agent state.");
      });
  }

  // The dashboard's agent status banner — REAL state, never a hard-coded "active"
  // (the bug #51 fixes). Paused copy never implies a fresh measurement happened.
  function agentBanner() {
    var paused = agentPaused();
    var line = el("div", { class: "agentline" });
    var toggle = el("button", { class: "btn ghost", style: "margin-left:auto", onclick: function () { toggleAgentPause(toggle); } }, [paused ? "Resume agent" : "Pause agent"]);
    line.appendChild(el("span", { class: "live-dot", style: paused ? "background:var(--muted,#888);box-shadow:none" : "" }));
    line.appendChild(
      paused
        ? el("span", { html: "Autonomous agent <b style='color:var(--txt)'>paused</b> — the Monday sweep is off, so there are no new rank/listing checks and no weekly emails until you resume. Your manual runs still work." })
        : el("span", { html: "Autonomous agent <b style='color:var(--txt)'>active</b> — re-checks your ranks &amp; listing every Monday 09:00 UTC (and any competitors you add). It prepares every move; <b style='color:var(--txt)'>you approve the push.</b>" }),
    );
    line.appendChild(toggle);
    return line;
  }

  /* ════════════════════════ VIEW: dashboard ════════════════════════════════ */
  async function viewDashboard() {
    loading("Loading your apps…");
    var data;
    try { data = await api("GET", "/apps"); } catch (e) { return errorBox(e); }
    var apps = data.apps || [];

    var c = root(); clear(c);

    // agent status line — state-driven (#51): reflects the REAL pause flag, never
    // a hard-coded "active". A toggle pauses/resumes the weekly sweep.
    c.appendChild(agentBanner());

    // connect-app card
    c.appendChild(connectCard());

    c.appendChild(el("h2", {}, ["Your apps"]));
    if (!apps.length) {
      c.appendChild(el("div", { class: "empty" }, [
        el("div", { class: "big" }, ["🛰️"]),
        el("div", {}, ["No apps connected yet."]),
        el("div", { class: "faint", html: "Connect one above — the agent runs an audit, ranks it on real iTunes data, and drafts optimized copy." }),
      ]));
      return;
    }

    var grid = el("div", { class: "grid" });
    apps.forEach(function (a, i) { var c = appCard(a); c.classList.add("flip-in"); c.style.setProperty("--i", i); grid.appendChild(c); });
    c.appendChild(grid);
  }

  function connectCard() {
    var queryInput, results, submitBtn;

    // Connect a chosen app by exact bundle id, then land on the app page so the
    // user can run a KEYED (ASC-read) pass for a real result.
    function connect(bundleId, displayName) {
      // #77: guard against repeat clicks. The candidate rows (not submitBtn) call
      // this, and a silent landing used to make users click again — spawning
      // duplicate apps + blind runs. Block re-entry while a connect is in flight.
      if (connectInFlight) return;
      connectInFlight = true;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spin"></span> Connecting…';
      api("POST", "/apps", { bundle_id: bundleId, name: displayName })
        .then(function (r) {
          // #77: route to the APP PAGE (not a silent dashboard bounce, and NOT an
          // auto-blind-run that produces low-quality name-token keywords). The app
          // page's primary CTA is the ASC read — the user runs keyed for a real
          // result, or opts into the blind run explicitly.
          toast("App connected — run a read to audit it.");
          connectInFlight = false;
          go("#/apps/" + r.id);
        })
        .catch(function (e) {
          connectInFlight = false;
          submitBtn.disabled = false; submitBtn.textContent = "Search";
          // A 402 is the tier-limit paywall — surface it loudly (a friendly upsell
          // dialog), not as a below-the-fold toast that's easy to miss (#27).
          if (e && e.status === 402) { showTierLimitModal(e); return; }
          toast(e.message || "Failed");
        });
    }

    // Append resolver candidates as clickable connect rows.
    function appendCandidateRows(cands) {
      cands.forEach(function (c) {
        var meta = [c.publisher, (c.genres && c.genres.length ? c.genres[0] : null)].filter(Boolean).join(" · ");
        results.appendChild(el("div", { class: "card appcard", style: "padding:10px 12px;margin-bottom:6px", onclick: function () { connect(c.bundle_id, c.name); } }, [
          el("div", { class: "row1" }, [
            c.icon_url ? el("img", { src: c.icon_url, width: "28", height: "28", style: "border-radius:6px;margin-right:8px;vertical-align:middle" }) : null,
            el("span", { class: "name" }, [c.name || c.bundle_id]),
          ]),
          el("div", { class: "bundle" }, [c.bundle_id + (meta ? "  ·  " + meta : "")]),
        ]));
      });
    }

    // Render the resolver's candidate picker from the first /resolve response.
    // Later pages stream in via the shared paginator (scroll sentinel + button).
    function renderCandidates(r, term) {
      clear(results);
      var cands = (r && r.candidates) || [];
      if (!cands.length) { results.appendChild(el("div", { class: "faint", style: "font-size:12.5px" }, ["No apps found. Try a different name, an App Store / Play link, or a bundle id."])); return; }
      results.appendChild(el("div", { class: "faint", style: "font-size:12.5px;margin:2px 0 6px" }, [cands.length === 1 ? "Found it — click to connect:" : "Pick your app:"]));
      appendCandidateRows(cands);
      attachPager(results, term, r, function (nextOffset) {
        return api("POST", "/resolve", { query: term, offset: nextOffset });
      }, appendCandidateRows, function () { if (queryInput) queryInput.focus(); });
    }

    // Search → render, shared by auto-search (debounced) and Search/Enter.
    // Resolves so the controller's race guard can drop a stale response.
    function runSearch(q) {
      submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spin"></span> Searching…';
      return api("POST", "/resolve", { query: q })
        .then(function (r) { return { ok: true, q: q, r: r }; })
        .catch(function (e) { return { ok: false, q: q, e: e }; });
    }
    function renderSearch(res) {
      submitBtn.disabled = false; submitBtn.textContent = "Search";
      if (!res.ok) { toast((res.e && res.e.message) || "Search failed"); return; }
      var r = res.r, q = res.q;
      // An auto-search never auto-connects (it would yank the user to a run on a
      // keystroke); only an explicit submit may collapse a lone exact hit.
      if (res.viaSubmit && r.kind === "resolved" && r.candidates.length === 1) {
        connect(r.candidates[0].bundle_id, r.candidates[0].name); return;
      }
      renderCandidates(r, q);
    }

    var search = createSearchController({
      minChars: 3,
      delayMs: 280,
      fetcher: runSearch,
      onResult: function (res) { renderSearch(res); },
    });
    search.onClear(function () { clear(results); submitBtn.disabled = false; submitBtn.textContent = "Search"; });

    function submit(ev) {
      ev.preventDefault();
      var q = queryInput.value.trim();
      if (!q) { toast("Enter an app name, link, or bundle id"); queryInput.focus(); return; }
      // Fire immediately, and tag this run as a submit so a lone exact hit may
      // auto-connect (auto-search results never do).
      submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spin"></span> Searching…';
      clear(results);
      runSearch(q).then(function (res) { res.viaSubmit = true; renderSearch(res); });
    }

    queryInput = el("input", { class: "txt", placeholder: "App name, App Store / Play link, or bundle id", autocomplete: "off", oninput: function () { search.input(queryInput.value); } });
    submitBtn = el("button", { class: "btn primary", type: "submit" }, ["Search"]);
    results = el("div", { style: "margin-top:10px" });
    return el("div", { class: "card" }, [
      el("h3", {}, ["Connect an app"]),
      el("form", { onsubmit: submit }, [
        el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Search by name, link, or bundle id"]), queryInput]),
        el("div", { class: "btn-row" }, [submitBtn]),
      ]),
      results,
      el("div", { class: "faint", style: "font-size:12.5px;margin-top:4px" }, ["Paste a name like “Calm”, an App Store / Play link, or a bundle id. The agent then audits the live listing, checks organic ranks, and drafts copy. Nothing is pushed until you’re ready."]),
    ]);
  }

  // Dashboard finding-count badge (PRD 04): advertise value before a run is opened.
  // Derived purely from the per-app findings_summary (counts only) — never raw data.
  // No run / no summary → null (the card stays clean). Zero actionable findings →
  // a green "Looking good"; otherwise "N fixes available" (red tint if any critical).
  function findingBadge(fs) {
    if (!fs || fs.total == null) return null;
    var fixes = (fs.critical || 0) + (fs.warn || 0);
    if (fixes === 0) {
      return el("span", { class: "finding-badge looking-good", title: "No actionable fixes found" }, ["✓ Looking good"]);
    }
    var label = fixes + " fix" + (fixes === 1 ? "" : "es") + " available";
    if (fs.critical > 0) label = fs.critical + " critical · " + label;
    var cls = "finding-badge" + (fs.critical > 0 ? " has-critical" : "");
    return el("span", { class: cls, title: "Findings from the latest run" }, [label]);
  }

  function appCard(a) {
    var run = a.latest_run, rs = a.rank_summary;
    var row1 = el("div", { class: "row1" }, [
      el("span", { class: "name" }, [a.name || a.bundle_id]),
    ]);
    var badge = findingBadge(a.findings_summary);
    if (badge) row1.appendChild(badge);
    // #50: a card-level "Run now" so the dashboard's "agent active" line has an
    // adjacent control. This is the BLIND (public-data) run — it never reads ASC
    // and never pushes; it ends in awaiting_approval at the human gate. The
    // handler stopPropagation()s so the click doesn't bubble to the card's
    // navigate-to-detail onclick below. The helper copy stays honest: read+prepare
    // only, you still approve, and the ASC read lives on the app page.
    var runNowBtn = el("button", {
      class: "btn small run-now",
      onclick: function (ev) {
        ev.stopPropagation();
        triggerRun(a.id, this, { label: "▶ Run now", backHash: "#/" });
      },
    }, ["▶ Run now"]);
    var runNowFoot = el("div", { class: "appcard-foot", onclick: function (ev) { ev.stopPropagation(); } }, [
      runNowBtn,
      el("span", { class: "faint run-now-note" }, ["Re-checks ranks & drafts changes on public data — you still approve before anything ships. Connect App Store Connect (on the app page) to also read your subtitle & keywords."]),
    ]);

    var card = el("div", { class: "card appcard", onclick: function () { go("#/apps/" + a.id); } }, [
      row1,
      el("div", { class: "bundle" }, [a.bundle_id]),
      el("div", { class: "meta" }, [
        el("div", {}, [el("div", { class: "k" }, ["Latest run"]), el("div", { class: "v", style: "font-size:13px" }, [run ? statusBadge(run.status) : el("span", { class: "faint" }, ["—"])])]),
        el("div", {}, [el("div", { class: "k" }, ["Lead rank"]), el("div", { class: "v" }, [rs ? rankText(rs.lead_rank) : "—"])]),
        el("div", {}, [el("div", { class: "k" }, ["Top-10 kw"]), el("div", { class: "v" }, [rs ? String(rs.top10) + "/" + rs.tracked : "—"])]),
      ]),
      runNowFoot,
    ]);
    return card;
  }

  /* ════════════════════════ VIEW: app detail ═══════════════════════════════ */
  async function viewApp(id, query) {
    query = query || {};
    loading("Loading app…");
    var data, ranks, deltas;
    try {
      data = await api("GET", "/apps/" + id);
      ranks = await api("GET", "/apps/" + id + "/ranks");
      deltas = await api("GET", "/apps/" + id + "/deltas");
    }
    catch (e) { return errorBox(e); }
    var app = data.app, runs = data.runs || [];

    var c = root(); clear(c);
    c.appendChild(backlink("#/", "All apps"));
    c.appendChild(el("h1", {}, [app.name || app.bundle_id]));
    c.appendChild(el("p", { class: "lead mono", style: "font-family:ui-monospace,Menlo,monospace;font-size:13px" }, [app.bundle_id + " · " + (app.country || "US")]));

    // rank movement this week — animated prev→cur per keyword (the headline)
    c.appendChild(rankMovementCard(deltas || {}, app.id));

    // rank trend mini-chart (+ #62 what-changed markers when history carries any)
    var annos = ranks.annotations || [];
    c.appendChild(el("div", { class: "card" }, [
      el("h3", {}, ["Rank trend — “" + esc(ranks.keyword) + "”"]),
      sparkline(ranks.points || [], annos),
      el("div", { class: "faint", style: "font-size:12px;margin-top:8px" }, ["Lower is better. 8-week organic position from the iTunes Search API."]),
      annos.length
        ? el("div", { class: "faint anno-legend", style: "font-size:12px;margin-top:4px" }, [
            "▲ your approved pushes · ◆ competitor visible changes (name/version/rating — their keyword fields aren't public). Correlation, not causation; history starts when tracking started.",
          ])
        : null,
    ]));

    // run an agent loop on demand — the App Store Connect read-and-improve pass
    // is the primary CTA; the blind run is demoted to an opt-out inside ascRunPanel.
    var ascPanel = ascRunPanel(app.id);
    c.appendChild(el("div", { class: "card" }, [
      el("h3", {}, ["Agent runs"]),
      el("p", { class: "faint", style: "font-size:12.5px;margin:0 0 14px" }, ["Reads ranks + your live listing. With an App Store Connect key, the agent improves your subtitle & keywords. Without one, it leaves them untouched."]),
      ascPanel,
      runList(runs),
    ]));

    // Competitors (#72) — the watch list behind "watched competitors": discovery
    // suggests, the human confirms, only confirmed rows are watched.
    c.appendChild(el("div", { class: "card" }, [
      el("h3", {}, ["Competitors"]),
      el("p", { class: "faint", style: "font-size:12.5px;margin:0 0 10px" }, [
        "The weekly sweep diffs each watched competitor's visible listing (name, version, price, rating) and flags moves. Discovery suggests apps ranking for your tracked keywords — nothing is watched until you confirm it.",
      ]),
      competitorsPanel(app.id),
    ]));

    // Agent triggers (#53) — what opens a run for approval. Never changes what
    // the agent measures; snapshots record every sweep regardless.
    c.appendChild(el("div", { class: "card" }, [
      el("h3", {}, ["Agent triggers"]),
      el("p", { class: "faint", style: "font-size:12.5px;margin:0 0 10px" }, [
        "Tune what opens a run for your approval. The agent still measures everything every sweep — these only decide when it asks for your attention.",
      ]),
      thresholdsPanel(app.id),
    ]));

    // Google Play audit — the Play parallel of the ASC read (own-app, via the Play
    // Developer API; the service account is sent once and never stored).
    c.appendChild(el("div", { class: "card" }, [
      el("h3", {}, ["Google Play audit"]),
      el("p", { class: "faint", style: "font-size:12.5px;margin:0 0 14px" }, ["Audit your own Google Play listing via the Play Developer API. Play has no keyword field — this grades your title, short & long description, and screenshots."]),
      playAuditPanel(app.id),
    ]));

    // disconnect (irreversible — two-click confirm, no blocking dialog)
    c.appendChild(disconnectRow(app));

    // PRD 04: arrived from a no-key run's unlock CTA → scroll to the primary ASC
    // run panel and flash it so the user lands on the credential surface to unlock.
    if (query.asc) flashAscPanel(ascPanel);
  }

  // Scroll the primary ASC run panel into view and pulse it (the "unlock" reward
  // landing). Synchronous class add so tests/render see .asc-flash immediately; the
  // pulse self-clears after the animation. Respects prefers-reduced-motion via CSS.
  function flashAscPanel(panel) {
    if (!panel) return;
    panel.classList.add("asc-flash");
    if (panel.scrollIntoView) panel.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(function () { panel.classList.remove("asc-flash"); }, 2400);
  }

  // Rank movement card: per-keyword "previous → current" with a count-up tween,
  // a direction-tinted delta chip, and an arrow. Biggest mover renders first
  // (the API already orders entries by movement weight). Single-snapshot keywords
  // come back direction:"new" / previous:null and animate as a clean reveal.
  var DIR_GLYPH = { up: "▲", down: "▼", "new": "✦", lost: "▽", same: "•" };

  // Mirror the server's pickShareWin: only a real climb or a strong new entry
  // (top-50) is brag-worthy. Used to decide whether to show the share button —
  // the SVG itself is always rendered server-side (single source of truth).
  function hasShareWin(deltas) {
    var entries = deltas.entries || [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.direction === "up" && e.current != null) return true;
      if (e.direction === "new" && e.current != null && e.current <= 50) return true;
    }
    return false;
  }

  // Fetch the branded share-card SVG from the API, rasterize it to a PNG via an
  // off-screen canvas (the data-URI SVG is same-origin-safe, so the canvas is not
  // tainted), and download it. Falls back to a direct SVG download if the canvas
  // path is unavailable. Mock/demo mode has no server route → guides the user.
  function generateShareCard(appId, size, btn) {
    if (!(API_BASE && liveMode)) { toast("Connect a real app to generate a shareable win."); return; }
    var label = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Building…';
    var url = API_BASE + "/apps/" + appId + "/share-card.svg?size=" + size;
    fetch(url, { credentials: "include" })
      .then(function (r) { if (!r.ok) throw new Error(r.status === 404 ? "No rank win to share yet." : "Couldn’t build the card."); return r.text(); })
      .then(function (svgText) {
        var W = size === "square" ? 1080 : 1200, H = size === "square" ? 1080 : 630;
        var img = new Image();
        var blobUrl = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
        img.onload = function () {
          try {
            var canvas = document.createElement("canvas");
            canvas.width = W; canvas.height = H;
            canvas.getContext("2d").drawImage(img, 0, 0, W, H);
            canvas.toBlob(function (blob) {
              URL.revokeObjectURL(blobUrl);
              if (!blob) { downloadBlob(new Blob([svgText], { type: "image/svg+xml" }), "shipaso-win.svg", "Saved SVG"); return; }
              downloadBlob(blob, "shipaso-win-" + size + ".png", "Saved your win ✓");
            }, "image/png");
          } catch (e) { URL.revokeObjectURL(blobUrl); downloadBlob(new Blob([svgText], { type: "image/svg+xml" }), "shipaso-win.svg", "Saved SVG"); }
          btn.disabled = false; btn.textContent = label;
        };
        img.onerror = function () { URL.revokeObjectURL(blobUrl); btn.disabled = false; btn.textContent = label; toast("Couldn’t render the card."); };
        img.src = blobUrl;
      })
      .catch(function (e) { btn.disabled = false; btn.textContent = label; toast(e.message || "Couldn’t build the card."); });
  }

  function rankMovementCard(deltas, appId) {
    var entries = (deltas.entries || []);
    var box = el("div", { class: "deltalist" });
    if (!entries.length) {
      box.appendChild(el("div", { class: "faint" }, ["No rank history yet — run the agent to start tracking weekly movement."]));
    }
    entries.forEach(function (e, i) {
      var dir = e.direction || "same";
      var prevEl = el("span", { class: "dprev" }, [rankText(e.previous)]);
      var curEl = el("span", { class: "dcur rank-pop " + (dir === "up" ? "good" : ""), style: "--i:" + i }, [rankText(e.current)]);
      // tween the current number from previous → current (staggered with the pop)
      countUpRank(curEl, e.previous, e.current, 120 + i * 60);

      var chipText = dir === "up" ? "↑ " + Math.abs(e.delta) :
                     dir === "down" ? "↓ " + Math.abs(e.delta) :
                     dir === "new" ? "new" :
                     dir === "lost" ? "dropped" : "held";
      var chip = el("span", { class: "dchip " + dir, style: "--i:" + i }, [DIR_GLYPH[dir] + " ", chipText]);

      box.appendChild(el("div", { class: "deltarow flip-in", style: "--i:" + i }, [
        el("span", { class: "dkw" }, [e.keyword]),
        el("span", { class: "dmove" }, [prevEl, el("span", { class: "darrow" }, ["→"]), curEl]),
        chip,
      ]));

      // PRD 02 attribution line: when this move is (correlationally) linked to a
      // push that added the keyword, show "↳ after you added 'x' (Jun 12)" under
      // the row, clickable through to that run. The copy is correlational only —
      // it states the time order, never a cause. `linked` reads solid; the lighter
      // `coincident` style is reserved for the rare case where the overlay carries
      // a note without a full link.
      var attr = e.attributedChange;
      if (attr && attr.note) {
        var conf = e.confidence === "linked" ? "linked" : "coincident";
        var line = el("a", {
          class: "dattr " + conf,
          href: "#/runs/" + attr.runId,
          title: "See the push this followed",
        }, ["↳ " + attr.note]);
        box.appendChild(el("div", { class: "dattr-row", style: "--i:" + i }, [line]));
      }
    });
    var sub = entries.length
      ? (deltas.anyMovement ? "Week-over-week organic position. Lower is better — green means you climbed." : "All tracked keywords held steady this week.")
      : "";

    // Share-a-win: only offered when there's a real win (matches the server gate).
    var shareRow = null;
    if (appId && hasShareWin(deltas)) {
      var wideBtn = el("button", { class: "btn sharebtn", onclick: function () { generateShareCard(appId, "wide", wideBtn); } }, ["⤳ Share this win"]);
      var sqBtn = el("button", { class: "btn ghost sharebtn", onclick: function () { generateShareCard(appId, "square", sqBtn); } }, ["square"]);
      shareRow = el("div", { class: "share-row" }, [
        wideBtn, sqBtn,
        el("span", { class: "faint", style: "font-size:12px;align-self:center" }, ["Branded image of your best move — post it."]),
      ]);
    }

    return el("div", { class: "card" }, [
      el("h3", {}, ["Rank movement this week"]),
      sub ? el("div", { class: "faint", style: "font-size:12.5px;margin-bottom:12px" }, [sub]) : null,
      box,
      shareRow,
    ]);
  }

  // Inline two-click disconnect: first click arms, second confirms. Avoids a
  // blocking confirm() dialog while still guarding the irreversible delete.
  function disconnectRow(app) {
    var armed = false;
    var btn = el("button", { class: "btn bad", onclick: function () {
      if (!armed) { armed = true; btn.textContent = "Click again to confirm — this deletes its runs & history"; setTimeout(function () { if (armed) { armed = false; btn.textContent = "Disconnect app"; } }, 4000); return; }
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Disconnecting…';
      api("DELETE", "/apps/" + app.id)
        .then(function () { toast("Disconnected " + (app.name || "the app")); go("#/"); route(); })
        .catch(function (e) { btn.disabled = false; btn.textContent = "Disconnect app"; armed = false; toast(e.message || "Failed to disconnect"); });
    } }, ["Disconnect app"]);
    return el("div", { style: "margin-top:18px;text-align:right" }, [btn]);
  }

  function runList(runs) {
    if (!runs.length) return el("div", { class: "faint" }, ["No runs yet — trigger one above."]);
    var box = el("div", {});
    runs.forEach(function (r) {
      box.appendChild(el("div", { class: "comp", style: "cursor:pointer", onclick: function () { go("#/runs/" + r.id); } }, [
        statusBadge(r.status),
        el("span", { class: "muted" }, [new Date(r.created_at).toLocaleString()]),
        el("span", { class: "cdetail" }, ["view →"]),
      ]));
    });
    return box;
  }

  // A full-view interstitial shown WHILE a run is in flight, so the wait reads as
  // progress (the agent is doing real work) instead of a frozen button. The steps
  // advance on a timer purely for feel; settle() jumps to done when the API
  // returns. Returns { settle } so the caller can finish it on success/failure.
  function runInterstitial(steps) {
    var c = root(); clear(c);
    var bar = el("i", { style: "width:6%" });
    var stepList = el("div", { class: "run-steps" });
    var nodes = steps.map(function (s, i) {
      var n = el("div", { class: "run-step", style: "--i:" + i }, [
        el("span", { class: "rs-ico" }, ["○"]),
        el("span", { class: "rs-t" }, [s]),
      ]);
      stepList.appendChild(n);
      return n;
    });
    c.appendChild(el("div", { class: "run-loading card" }, [
      el("div", { class: "rl-head" }, [el("span", { class: "spin" }), el("b", {}, ["Running the ASO loop on real data…"])]),
      el("div", { class: "rl-bar" }, [bar]),
      stepList,
      el("div", { class: "faint", style: "font-size:12.5px;margin-top:12px" }, ["This usually takes 10–30 seconds — it's auditing, rank-checking, and scoring keywords live."]),
    ]));

    var i = 0, done = false;
    function activate(n) {
      if (n > 0 && nodes[n - 1]) { nodes[n - 1].classList.remove("active"); nodes[n - 1].classList.add("done"); nodes[n - 1].firstChild.textContent = "✓"; }
      if (nodes[n]) { nodes[n].classList.add("active"); nodes[n].firstChild.textContent = "◔"; }
      var pct = Math.min(92, 6 + Math.round((n / steps.length) * 86));
      bar.style.width = pct + "%";
    }
    activate(0);
    var timer = setInterval(function () {
      if (done) return;
      if (i < steps.length - 1) { i++; activate(i); }
    }, 2600);

    return {
      settle: function () {
        done = true; clearInterval(timer);
        nodes.forEach(function (n) { n.classList.remove("active"); n.classList.add("done"); n.firstChild.textContent = "✓"; });
        bar.style.width = "100%";
      },
      // On failure, replace the loader with a recoverable error card (retry / back)
      // — never strand the user on a frozen progress screen or dump them silently.
      fail: function (message, onRetry, backHash) {
        done = true; clearInterval(timer);
        var card = root(); clear(card);
        card.appendChild(el("div", { class: "run-loading card" }, [
          el("div", { class: "rl-head" }, [el("span", { style: "color:var(--bad);font-size:18px" }, ["✗"]), el("b", {}, ["The run didn't finish"])]),
          el("div", { class: "faint", style: "margin:8px 0 16px" }, [message || "Something went wrong running the agent."]),
          el("div", { class: "btn-row" }, [
            el("button", { class: "btn primary", onclick: function () { if (onRetry) onRetry(); } }, ["↻ Try again"]),
            // "Back" returns to backHash. When that hash equals the current one
            // (e.g. a dashboard "Run now" fails while we're still at #/), setting
            // location.hash is a no-op that wouldn't re-fire the router — so call
            // route() directly to rebuild the view we replaced with this card.
            el("button", { class: "btn ghost", onclick: function () {
              var target = backHash || "#/";
              if (location.hash === target || (!location.hash && target === "#/")) route();
              else go(target);
            } }, ["← Back"]),
          ]),
        ]));
      },
    };
  }

  var RUN_STEPS = [
    "Auditing the live listing & screenshots",
    "Checking organic rank across keywords",
    "Reading competitor listings",
    "Scoring & bucketing keywords",
    "Drafting copy within Apple's char limits",
    "Preparing the change for your review",
  ];

  // The blind (public-data) run. Reused from two call sites: the app-detail
  // opt-out button and the dashboard card's "Run now" (#50). `opts` lets each
  // caller restore its own idle label on error and choose where the error card's
  // "Back" returns to. Defaults reproduce the app-detail caller's behavior, so
  // existing callers can keep passing nothing.
  function triggerRun(appId, btn, opts) {
    opts = opts || {};
    var label = opts.label || "▶ Run agent now";
    var backHash = opts.backHash || ("#/apps/" + appId);
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Agent running…';
    var inter = runInterstitial(RUN_STEPS);
    api("POST", "/apps/" + appId + "/run")
      .then(function (r) { inter.settle(); toast("Agent finished — review the proposal."); go("#/runs/" + r.id); })
      .catch(function (e) { btn.disabled = false; btn.textContent = label; inter.fail(e.message || "The agent run failed.", function () { triggerRun(appId, btn, opts); }, backHash); });
  }

  // Read a .p8 file client-side and fill the textarea (paste stays a fallback).
  // The file is read in-memory via FileReader, never uploaded and never logged.
  // If the filename matches AuthKey_<KEYID>.p8, the Key ID field is auto-filled.
  function p8FileInput(p8TextArea, keyIdInput) {
    var input = el("input", { type: "file", accept: ".p8", class: "p8-file" });
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        // Never log the contents — only assign to the in-memory field.
        p8TextArea.value = String(reader.result || "");
        var m = /^AuthKey_([A-Za-z0-9]+)\.p8$/i.exec(file.name);
        if (m && keyIdInput && !keyIdInput.value.trim()) keyIdInput.value = m[1];
        toast("Loaded .p8 — used once, never stored.");
      };
      reader.onerror = function () { toast("Couldn't read that file — paste the .p8 instead."); };
      reader.readAsText(file);
    });
    return el("label", { class: "fld" }, [
      el("span", { class: "lab" }, ["Or upload .p8 file"]),
      input,
    ]);
  }

  // PRIMARY run: read with an App Store Connect key so the agent READS your live
  // subtitle + keywords and improves them. The .p8 is sent once for this run and
  // never stored (same as the push path). The blind "Run agent now" pass — which
  // leaves subtitle/keywords untouched — is demoted to an opt-out checkbox: it
  // only appears once the visitor admits they have no ASC key.
  function ascRunPanel(appId) {
    var panel = el("div", { class: "asc-run-panel" });
    panel.appendChild(el("div", { class: "faint", style: "font-size:12.5px;margin:0 0 12px" }, [
      "ShipASO can't see your subtitle/keywords from public data. Provide a read key and the agent reads them, then proposes improvements. ",
      el("b", { style: "color:var(--dim)" }, ["Your .p8 is used once for this run and never stored."]),
    ]));
    // #67 (launch half): in-app step-by-step to MINT the key — acquisition
    // friction is the real blocker, and the exact ASC path is unguessable.
    // Custody unchanged: per-run use only, never stored.
    var guideBody = el("ol", { class: "key-guide-steps", style: "margin:8px 0 4px;padding-left:20px;font-size:12.5px;line-height:1.7" }, [
      el("li", {}, [el("span", { html: "In App Store Connect, open <b>Users&nbsp;and&nbsp;Access → Integrations → App&nbsp;Store&nbsp;Connect&nbsp;API</b> (you need the Account Holder or Admin role to see it)." })]),
      el("li", {}, [el("span", { html: "Under <b>Team Keys</b>, click <b>＋</b> to generate a key. Name it (e.g. “ShipASO read”) and pick the <b>Developer</b> role — enough to read your listing and stage metadata; don't grant Admin." })]),
      el("li", {}, [el("span", { html: "Download the <b>.p8</b> file — Apple offers it <b>once</b>; keep it somewhere safe." })]),
      el("li", {}, [el("span", { html: "Copy the <b>Key ID</b> from the key's row, and the <b>Issuer ID</b> from the top of the same page (a UUID shared by all your keys)." })]),
    ]);
    var guideNote = el("div", { class: "faint", style: "font-size:12px;margin:2px 0 6px" }, [
      "ShipASO uses the key once per run and never stores it — you can revoke it in the same screen at any time.",
    ]);
    var guideWrap = el("div", { class: "key-guide", style: "display:none" }, [guideBody, guideNote]);
    var guideToggle = el("a", { href: "#", id: "keyGuideToggle", style: "font-size:12.5px", onclick: function (e) {
      e.preventDefault();
      var open = guideWrap.style.display !== "none";
      guideWrap.style.display = open ? "none" : "";
      guideToggle.textContent = open ? "Where do I get these? Mint a key in 2 minutes →" : "Hide the walkthrough";
    } }, ["Where do I get these? Mint a key in 2 minutes →"]);
    panel.appendChild(el("div", { style: "margin:0 0 10px" }, [guideToggle, guideWrap]));

    var issuer = el("input", { class: "txt mono", type: "text", placeholder: "Issuer ID — the UUID at the top of the Integrations page", autocomplete: "off", spellcheck: "false" });
    var keyId = el("input", { class: "txt mono", type: "text", placeholder: "Key ID — 10 characters, on the key's row (e.g. ABC123DEFG)", autocomplete: "off", spellcheck: "false" });
    var p8 = el("textarea", { class: "txt mono", rows: "4", placeholder: "-----BEGIN PRIVATE KEY-----\n…paste your .p8 contents…\n-----END PRIVATE KEY-----", autocomplete: "off", spellcheck: "false" });
    panel.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Issuer ID"]), issuer]));
    panel.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Key ID"]), keyId]));
    panel.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, [".p8 private key"]), p8]));
    panel.appendChild(p8FileInput(p8, keyId));
    var ascBtn = el("button", { class: "btn primary", onclick: function () {
      var creds = { issuerId: issuer.value.trim(), keyId: keyId.value.trim(), p8: p8.value };
      if (!creds.issuerId || !creds.keyId || !creds.p8.trim()) { toast("Issuer ID, Key ID, and .p8 are all required."); return; }
      triggerRunAsc(appId, ascBtn, creds);
    } }, ["▶ Run with ASC read"]);
    panel.appendChild(el("div", { class: "btn-row", style: "margin-top:4px" }, [ascBtn]));

    // Opt-out: no ASC key → reveal the blind run (leaves subtitle/keywords as-is).
    var cbId = "no-asc-key-" + appId;
    var noKey = el("input", { type: "checkbox", id: cbId });
    panel.appendChild(el("div", { class: "checkbox-row" }, [
      noKey,
      el("label", { "for": cbId }, ["I don't have an ASC key — run name/description only"]),
    ]));
    var blindBtn = el("button", { class: "btn", onclick: function () { triggerRun(appId, blindBtn); } }, ["▶ Run agent now"]);
    var blindRow = el("div", { class: "btn-row blind-run", style: "display:none" }, [
      blindBtn,
      el("span", { class: "faint", style: "align-self:center;font-size:12px" }, ["Without a key, the agent leaves your subtitle & keywords untouched."]),
    ]);
    noKey.addEventListener("change", function () { blindRow.style.display = noKey.checked ? "" : "none"; });
    panel.appendChild(blindRow);
    return panel;
  }

  function triggerRunAsc(appId, btn, creds) {
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Reading your listing & running…';
    var inter = runInterstitial(["Reading your live subtitle & keywords from App Store Connect"].concat(RUN_STEPS.slice(1)));
    api("POST", "/apps/" + appId + "/run-asc", creds)
      .then(function (r) {
        // Remember the creds in-memory for THIS session so the push step doesn't
        // re-prompt (never persisted; cleared on the next route()).
        ascCredsMemory = { issuerId: creds.issuerId, keyId: creds.keyId, p8: creds.p8 };
        inter.settle(); toast("Read your live listing — review the proposal."); go("#/runs/" + r.id);
      })
      .catch(function (e) { btn.disabled = false; btn.textContent = "▶ Run with ASC read"; inter.fail(e.message || "The App Store Connect run failed.", function () { triggerRunAsc(appId, btn, creds); }, "#/apps/" + appId); });
  }

  // Read a service-account .json client-side and fill the textarea (paste stays a
  // fallback). Read in-memory via FileReader, never logged. Mirrors p8FileInput.
  function saFileInput(jsonTextArea) {
    var input = el("input", { type: "file", accept: ".json,application/json", class: "p8-file" });
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        jsonTextArea.value = String(reader.result || "");
        toast("Loaded service account — used once, never stored.");
      };
      reader.onerror = function () { toast("Couldn't read that file — paste the JSON instead."); };
      reader.readAsText(file);
    });
    return el("label", { class: "fld" }, [
      el("span", { class: "lab" }, ["Or upload service-account .json"]),
      input,
    ]);
  }

  // Google Play audit panel — the Play parallel of ascRunPanel. The user pastes or
  // uploads their Play Developer API SERVICE-ACCOUNT JSON + their package id; the
  // creds are sent once (to /play/verify or /apps/:id/audit-play) and NEVER stored,
  // same posture as the .p8. Play has no keyword field, so this reads the title,
  // short + long description, screenshots, and grades them.
  // ── Agent triggers panel (#53) ──────────────────────────────────────────────
  // What opens an awaiting_approval run. Honest framing baked into the copy:
  // thresholds gate what NAGS the human — never what the agent measures.
  function thresholdsPanel(appId) {
    var panel = el("div", { id: "thresholdsPanel" });
    var note = el("div", { class: "faint", style: "font-size:12px;margin-top:8px" });

    var unrankedCb = el("input", { type: "checkbox", id: "thUnranked" });
    var compCb = el("input", { type: "checkbox", id: "thCompetitors" });
    var notifyCb = el("input", { type: "checkbox", id: "thNotifyOnly" });
    var dropIn = el("input", { class: "txt", id: "thRankDrop", type: "number", min: "1", max: "200", placeholder: "off", style: "width:80px" });
    var mutedKwIn = el("input", { class: "txt", id: "thMutedKw", type: "text", placeholder: "e.g. recipe, pantry (never trigger)", autocomplete: "off" });

    function rowCb(cb, label) {
      return el("label", { style: "display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13.5px;cursor:pointer" }, [cb, label]);
    }

    function fill(t) {
      unrankedCb.checked = !!t.unranked;
      compCb.checked = !!t.competitorChanges;
      notifyCb.checked = !!t.notifyOnly;
      dropIn.value = t.rankDropAtLeast == null ? "" : String(t.rankDropAtLeast);
      mutedKwIn.value = (t.mutedKeywords || []).join(", ");
    }

    api("GET", "/apps/" + appId + "/thresholds")
      .then(function (r) { fill(r.thresholds || {}); })
      .catch(function () { /* fail-open — defaults render unchecked-state below */ });

    var saveBtn = el("button", { class: "btn", id: "thSave", onclick: function () {
      var drop = dropIn.value.trim();
      var body = {
        unranked: unrankedCb.checked,
        competitorChanges: compCb.checked,
        notifyOnly: notifyCb.checked,
        rankDropAtLeast: drop === "" ? null : Number(drop),
        mutedKeywords: mutedKwIn.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
      };
      saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spin"></span> Saving…';
      api("POST", "/apps/" + appId + "/thresholds", body)
        .then(function (r) {
          saveBtn.disabled = false; saveBtn.textContent = "Save triggers";
          fill(r.thresholds || {}); // reconcile from the server's answer
          note.textContent = "Saved. Snapshots are still recorded every sweep — these only change what opens a run.";
        })
        .catch(function (e) {
          saveBtn.disabled = false; saveBtn.textContent = "Save triggers";
          toast(e && e.message ? e.message : "Couldn't save.");
        });
    } }, ["Save triggers"]);

    panel.appendChild(rowCb(unrankedCb, "Open a run when a targeted keyword is unranked"));
    panel.appendChild(rowCb(compCb, "Open a run when a watched competitor's listing changes"));
    panel.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13.5px" }, [
      "Open a run when a rank drops ≥", dropIn, "places week-over-week",
    ]));
    panel.appendChild(el("label", { class: "fld", style: "margin-top:6px" }, [el("span", { class: "lab" }, ["Muted keywords (never trigger)"]), mutedKwIn]));
    panel.appendChild(rowCb(notifyCb, "Notify only — report crossings but never open a run"));
    panel.appendChild(el("div", { class: "btn-row", style: "margin-top:8px" }, [saveBtn]));
    panel.appendChild(note);
    return panel;
  }

  // ── Competitors panel (#72-C) ───────────────────────────────────────────────
  // The app's watch list: auto-discovered SUGGESTIONS (from real iTunes searches
  // of the app's tracked keywords) + user-added entries. Only what the user
  // CONFIRMS is watched — a suggestion is never silently tracked, so the weekly
  // "watched competitors" claim stays honest.
  function competitorsPanel(appId) {
    var panel = el("div", { id: "competitorsPanel" });
    var listBox = el("div", { class: "comp-list" });
    var note = el("div", { class: "faint", style: "font-size:12px;margin-top:8px" });

    function chip(text, cls) {
      return el("span", { class: "tag " + cls, style: "margin-left:8px" }, [text]);
    }

    function render(rows) {
      clear(listBox);
      if (!rows.length) {
        listBox.appendChild(el("div", { class: "faint", style: "padding:6px 0" }, [
          "No competitors yet — discover candidates from your tracked keywords, or add one by name.",
        ]));
        return;
      }
      rows.forEach(function (r) {
        var actions = [];
        if (r.status === "suggested") {
          actions.push(el("button", { class: "btn small", onclick: function () { act("POST", "/competitors/" + encodeURIComponent(r.key) + "/confirm", this); } }, ["Watch"]));
          actions.push(el("button", { class: "btn small ghost", onclick: function () { act("DELETE", "/competitors/" + encodeURIComponent(r.key), this); } }, ["Dismiss"]));
        } else {
          actions.push(el("button", { class: "btn small ghost", onclick: function () { act("DELETE", "/competitors/" + encodeURIComponent(r.key), this); } }, ["Remove"]));
        }
        listBox.appendChild(el("div", { class: "comp comp-row" }, [
          el("span", { class: "cname" }, [r.name || r.key]),
          chip(r.status === "confirmed" ? "watched" : "suggested", r.status === "confirmed" ? "new" : "same"),
          el("span", { style: "flex:1" }),
          el("span", { class: "btn-row" }, actions),
        ]));
      });
    }

    function act(method, path, btn) {
      if (btn) btn.disabled = true;
      api(method, "/apps/" + appId + path)
        .then(function (r) { render(r.competitors || []); })
        .catch(function (e) { toast(e && e.message ? e.message : "Something went wrong."); if (btn) btn.disabled = false; });
    }

    function refresh() {
      api("GET", "/apps/" + appId + "/competitors")
        .then(function (r) { render(r.competitors || []); })
        .catch(function () { render([]); });
    }

    var addInput = el("input", { class: "txt", type: "text", placeholder: "Add by App Store name (e.g. “Paprika Recipe Manager”)", autocomplete: "off" });
    var addBtn = el("button", { class: "btn", onclick: function () {
      var name = addInput.value.trim();
      if (!name) { toast("Enter the competitor's App Store name."); return; }
      addBtn.disabled = true; addBtn.innerHTML = '<span class="spin"></span> Adding…';
      api("POST", "/apps/" + appId + "/competitors", { name: name })
        .then(function (r) {
          addBtn.disabled = false; addBtn.textContent = "Add";
          addInput.value = "";
          render(r.competitors || []);
        })
        .catch(function (e) {
          addBtn.disabled = false; addBtn.textContent = "Add";
          toast(e && e.message ? e.message : "Couldn't add that app.");
        });
    } }, ["Add"]);

    var discoverBtn = el("button", { class: "btn primary", id: "discoverCompetitors", onclick: function () {
      discoverBtn.disabled = true; discoverBtn.innerHTML = '<span class="spin"></span> Searching…';
      api("POST", "/apps/" + appId + "/competitors/discover")
        .then(function (r) {
          discoverBtn.disabled = false; discoverBtn.textContent = "Discover competitors";
          render(r.competitors || []);
          note.textContent = r.note
            ? r.note
            : (r.discovered > 0
              ? r.discovered + " candidate" + (r.discovered === 1 ? "" : "s") + " found from your tracked keywords — confirm the real rivals."
              : "No new candidates — your tracked keywords surfaced nothing you aren't already watching.");
        })
        .catch(function (e) {
          discoverBtn.disabled = false; discoverBtn.textContent = "Discover competitors";
          toast(e && e.message ? e.message : "Discovery failed.");
        });
    } }, ["Discover competitors"]);

    panel.appendChild(listBox);
    panel.appendChild(el("div", { class: "btn-row", style: "margin-top:10px;align-items:center;gap:8px" }, [discoverBtn, addInput, addBtn]));
    panel.appendChild(note);
    refresh();
    return panel;
  }

  function playAuditPanel(appId) {
    var panel = el("div", { class: "play-audit-panel" });
    panel.appendChild(el("div", { class: "faint", style: "font-size:12.5px;margin:0 0 12px" }, [
      "Audit your own Google Play listing via the official Play Developer API. Provide your service-account JSON + Play package id. ",
      el("b", { style: "color:var(--dim)" }, ["Your service account is used once and never stored."]),
    ]));
    var pkg = el("input", { class: "txt mono", type: "text", placeholder: "Play package id (e.g. com.foo.bar)", autocomplete: "off", spellcheck: "false" });
    var lang = el("input", { class: "txt mono", type: "text", placeholder: "Listing language (default en-US)", autocomplete: "off", spellcheck: "false" });
    var sa = el("textarea", { class: "txt mono", rows: "4", placeholder: 'Paste your service-account JSON ({ "client_email": …, "private_key": … })', autocomplete: "off", spellcheck: "false" });
    panel.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Play package id"]), pkg]));
    panel.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Service-account JSON"]), sa]));
    panel.appendChild(saFileInput(sa));
    panel.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Language (optional)"]), lang]));

    var result = el("div", { class: "play-audit-result" });
    function body() {
      var b = { serviceAccount: sa.value, packageName: pkg.value.trim() };
      if (lang.value.trim()) b.language = lang.value.trim();
      return b;
    }
    function valid() {
      if (!sa.value.trim()) { toast("Paste or upload your service-account JSON."); return false; }
      if (!pkg.value.trim()) { toast("Enter your Play package id."); return false; }
      return true;
    }
    var auditBtn = el("button", { class: "btn primary", onclick: function () { if (valid()) triggerPlayAudit(appId, auditBtn, body(), result); } }, ["▶ Audit my Play listing"]);
    var verifyBtn = el("button", { class: "btn", onclick: function () { if (valid()) triggerPlayVerify(verifyBtn, body(), result); } }, ["Verify access"]);
    panel.appendChild(el("div", { class: "btn-row", style: "margin-top:4px" }, [auditBtn, verifyBtn]));
    panel.appendChild(result);
    return panel;
  }

  function triggerPlayVerify(btn, body, resultEl) {
    var label = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Verifying…';
    clear(resultEl);
    api("POST", "/play/verify", body)
      .then(function (r) {
        btn.disabled = false; btn.textContent = label;
        if (r && r.ok) {
          resultEl.appendChild(el("div", { class: "play-note ok", style: "margin-top:10px;font-size:13px" }, ["✓ Credential works" + (r.appAccessible ? " — access to this app confirmed." : " (app access not probed).")]));
        } else {
          resultEl.appendChild(el("div", { class: "play-note err", style: "margin-top:10px;font-size:13px" }, ["✗ " + ((r && r.reason) || "Verification failed.")]));
        }
      })
      .catch(function (e) { btn.disabled = false; btn.textContent = label; resultEl.appendChild(el("div", { class: "play-note err", style: "margin-top:10px;font-size:13px" }, ["✗ " + (e.message || "Verification failed.")])); });
  }

  function triggerPlayAudit(appId, btn, body, resultEl) {
    var label = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Auditing your Play listing…';
    clear(resultEl);
    api("POST", "/apps/" + appId + "/audit-play", body)
      .then(function (audit) { btn.disabled = false; btn.textContent = label; renderPlayAudit(resultEl, audit); toast("Audited your Play listing."); })
      .catch(function (e) { btn.disabled = false; btn.textContent = label; resultEl.appendChild(el("div", { class: "play-note err", style: "margin-top:10px;font-size:13px" }, ["✗ " + (e.message || "The Play audit failed.")])); });
  }

  // Compact renderer for a PlayAudit (the /audit-play response). Read-only summary:
  // headline, screenshot grade, coverage score, prioritized findings, locks.
  function renderPlayAudit(resultEl, audit) {
    clear(resultEl);
    audit = audit || {};
    var listing = audit.listing || {}, summary = audit.summary || {}, shots = audit.screenshots || {}, cov = audit.coverage || {};
    var box = el("div", { class: "play-audit-out", style: "margin-top:14px;border-top:1px solid var(--line,#2a2a2a);padding-top:12px" });
    box.appendChild(el("div", { style: "font-weight:600;margin-bottom:6px" }, [listing.title || "Your Play listing"]));
    box.appendChild(el("div", { class: "faint", style: "font-size:12.5px;margin-bottom:8px" }, [summary.label || "Audit complete."]));
    if (shots.grade) box.appendChild(el("div", { style: "font-size:13px;margin:4px 0" }, ["Screenshots: grade " + shots.grade + " · " + (shots.primaryCount || 0) + " phone"]));
    if (typeof cov.coverageScore === "number") box.appendChild(el("div", { style: "font-size:13px;margin:4px 0" }, ["Metadata coverage: " + Math.round(cov.coverageScore) + "/100 (title 30 · short 80 · long 4000)"]));
    var findings = audit.findings || [];
    if (findings.length) {
      var list = el("ul", { class: "play-findings", style: "margin:10px 0 0;padding-left:0;list-style:none" });
      findings.forEach(function (f) {
        list.appendChild(el("li", { style: "margin:0 0 8px" }, [
          el("span", { class: "sev sev-" + f.severity, style: "font-weight:600;text-transform:uppercase;font-size:11px" }, [(f.severity || "") + " · "]),
          el("span", {}, [f.title || ""]),
          f.fix ? el("div", { class: "faint", style: "font-size:12px" }, [f.fix]) : null,
        ]));
      });
      box.appendChild(list);
    }
    var locks = audit.locks || [];
    if (locks.length) box.appendChild(el("div", { class: "faint", style: "font-size:12px;margin-top:10px" }, ["🔒 " + locks.length + " surface" + (locks.length === 1 ? "" : "s") + " need a connection to read."]));
    resultEl.appendChild(box);
  }

  /* ════════════════════ VIEW: run detail (the money screen) ════════════════ */
  async function viewRun(id) {
    loading("Loading the agent's proposal…");
    var run;
    try { run = await api("GET", "/runs/" + id); } catch (e) { return errorBox(e); }
    var R = run.result || {};
    var c = root(); clear(c);

    c.appendChild(backlink("#/apps/" + run.app_id, "Back to app"));
    c.appendChild(el("div", { style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap" }, [
      el("h1", { style: "margin-bottom:0" }, ["Agent proposal"]),
      statusBadge(run.status),
    ]));
    // Header (#56 item 3): a no-key run produces little/no change (subtitle &
    // keywords are unreadable without ASC), so don't promise "prepared the change
    // below." Soften to what it actually did — audited public data, flagged what a
    // connection would unlock.
    var leadText = isNoKeyRun(R)
      ? "The agent ran the ASO loop on public App Store data — auditing what it can see and flagging what an App Store Connect connection would unlock. Read its reasoning below; connect to let it read and improve your subtitle & keywords."
      : "The agent ran the full ASO loop on real data and prepared the change below. Read its reasoning, then approve or reject. Approving reveals the exact commands — we never run them for you.";
    c.appendChild(el("p", { class: "lead" }, [leadText]));

    // 1) THE LISTING AUDIT — the findings, instructive first. Explains *why* the
    //    proposed changes below, so it reads first: audit → diff → reasoning → gate.
    c.appendChild(listingAuditCard(R, run.app_id));

    // 1b) EXPAND TO MORE MARKETS — PRD 04 localization expansion. Renders directly
    //     below the findings card when the run computed locale recommendations
    //     (a Mode-A/ASC run); the locale_single finding above is the headline, this
    //     is the workbench. Absent → nothing renders.
    var locCard = localizationExpansionCard(R, run.app_id);
    if (locCard) c.appendChild(locCard);

    // 2) THE DIFF — lead with current → proposed, like a PR review (devs). The
    //    proposal is now EDITABLE (#39 Part 1): a per-run edit buffer is shared
    //    between the diff card (the inputs) and the gate card (Approve + handoff),
    //    so a tweak flows straight to what ships.
    var edit = makeEditState(R.proposedCopy || {}, R.currentCopy || {});
    c.appendChild(diffCard(R.currentCopy || {}, R.proposedCopy || {}, edit));

    // 2) PLAIN-ENGLISH REASONING (what makes this read as an agent)
    c.appendChild(reasoningCard(R));

    // 3) two-column: competitor read + ranks
    c.appendChild(el("div", { class: "split" }, [competitorCard(R.competitors || {}), rankCard(R.ranks || [])]));

    // 3b) WHERE TO PUSH NEXT — winnability opportunities (PRD 06). The honest
    //     ranker: closest+weakest-field terms first, longshots labeled not hidden.
    c.appendChild(opportunityCard(R.opportunities || []));

    // 3c) keyword opportunities (PRD 01) — gaps competitors use that you don't.
    //     Rendered only when the run computed gaps (omitted gracefully otherwise).
    var gapCard = keywordGapCard(R.keywordGaps || [], run.app_id, R.reasoning || []);
    if (gapCard) c.appendChild(gapCard);

    // 3d) COMPETITOR RANK WAR ROOM — head-to-head per-keyword vs selected
    //     competitors, gap-to-best, trend, sorted by closeable gap (PRD 05).
    c.appendChild(warRoomCard(R.warRoom || null, run.app_id, R.competitors || {}));

    // 4) keyword reasoning table
    c.appendChild(keywordCard(R.reasoning || [], R.ranks || []));

    // 5) THE APPROVAL GATE + commands (reads the shared edit buffer)
    c.appendChild(gateCard(run, R, edit));
  }

  // The make-it tool for the screenshot levers (#55) + the findings linkout. The
  // free MIT app-store-screenshots skill — the agent NEVER generates/pushes assets;
  // this is a linkout for the human to act on. Module-scope so both the findings
  // fix-link AND the improvement panel reuse the same URL.
  var SHOTS_SKILL = "https://github.com/ParthJadhav/app-store-screenshots";

  // The "Listing audit" card: the engine's findings, prioritized (biggest wins
  // first, as returned), each labeled by impact lane with a concrete fix. Findings
  // ONLY — never raw ASC data. Empty list → an honest green "great shape" state.
  var SEV_META = {
    critical: { ico: "✗", label: "Critical" },
    warn:     { ico: "⚠", label: "Warning" },
    good:     { ico: "✓", label: "Good" },
    info:     { ico: "ℹ", label: "Info" },
  };
  // impact lane → { chip class, label }. ranking/conversion are the two levers we
  // surface explicitly; trust/completeness share a neutral chip.
  var IMPACT_META = {
    ranking:      { cls: "rank", label: "Ranking" },
    conversion:   { cls: "conv", label: "Conversion" },
    trust:        { cls: "neutral", label: "Trust" },
    completeness: { cls: "neutral", label: "Completeness" },
  };

  function gradeChip(R) {
    var sc = (R.audit && R.audit.screenshots) || null;
    if (!sc || !sc.grade) return null;
    var g = sc.grade;
    var cls = g === "?" ? "neutral" : (g <= "B" ? "good" : g === "C" ? "warn" : "bad");
    return el("span", { class: "grade-chip " + cls, title: "Screenshot grade" },
      [g === "?" ? "Shots: ?" : "Shots: " + g]);
  }

  // The surfaces a connected ASC key unlocks — listed statically in the CTA so the
  // user sees exactly what a no-key run is missing (PRD 04). Honest, in-context upsell.
  var UNLOCK_SURFACES = [
    "Real screenshot grade",
    "App preview video coverage",
    "Privacy policy & category gaps",
    "Localization & keyword surfaces",
  ];

  // ASC-unlock CTA built from the asc_unlock finding (PRD 01/04). Reuses the
  // existing PRIMARY ASC run panel (#31) on the app page — it does NOT build a new
  // credential surface. Clicking routes to #/apps/:id?asc=1, which scrolls to and
  // flashes the panel (viewApp honors the ?asc flag).
  function ascUnlockCta(fnd, appId) {
    var lis = UNLOCK_SURFACES.map(function (s) { return el("li", {}, [s]); });
    var btn = el("button", { class: "btn primary", onclick: function () {
      go("#/apps/" + appId + "?asc=1");
    } }, ["Connect App Store Connect →"]);
    return el("div", { class: "asc-unlock" }, [
      el("div", { class: "asc-unlock-head" }, [
        el("span", { class: "asc-unlock-ico" }, ["🔓"]),
        el("b", {}, [fnd.title || "Unlock your full audit"]),
      ]),
      el("p", { class: "asc-unlock-copy" }, [
        "Connect App Store Connect to see screenshots, preview video, privacy policy, category, and localization gaps.",
      ]),
      el("ul", { class: "asc-unlock-list" }, lis),
      el("div", { class: "btn-row", style: "margin-top:4px" }, [btn]),
    ]);
  }

  // ── Locked-field upgrade surface (#61) ────────────────────────────────────
  // An inline, honest 🔒 lock for a surface we couldn't READ on a no-key run.
  // "We can't see this without access" — a CAPABILITY gap, never a deficiency,
  // never urgency. Routes to the SAME primary ASC run panel as the unlock CTA
  // (go("#/apps/:id?asc=1") → viewApp flashes it), so it builds NO new credential
  // surface. It deliberately does NOT reuse the .locked class (commandsLocked):
  // THAT lock gates an ACTION (approve to reveal a push command); THIS one marks a
  // READING we can't take. The distinct .field-lock class keeps the two semantics
  // clearly distinguished (the issue's non-negotiable).
  function fieldLock(lock, appId) {
    return el("div", { class: "field-lock", role: "note" }, [
      el("span", { class: "field-lock-ico", "aria-hidden": "true" }, ["🔒"]),
      el("div", { class: "field-lock-body" }, [
        el("div", { class: "field-lock-label" }, [lock.label || "We can't see this without access"]),
        lock.unlockCopy ? el("div", { class: "field-lock-copy faint" }, [lock.unlockCopy]) : null,
        el("a", { class: "field-lock-link", href: "#/apps/" + appId + "?asc=1", onclick: function (e) {
          if (e && e.preventDefault) e.preventDefault();
          go("#/apps/" + appId + "?asc=1");
        } }, ["Connect to unlock →"]),
      ]),
    ]);
  }

  // The surface-lock data the run carries (#61), or a graceful fallback for older
  // stored runs that predate result.locks: synthesize the canonical no-key list
  // from isNoKeyRun(R) (mirrors the fieldFill legacy fallback). A keyed run → [].
  var LEGACY_NO_KEY_LOCKS = [
    { surface: "subtitle",    label: "We can't see your subtitle without access",          unlockCopy: "Connect App Store Connect to read your live subtitle and improve it." },
    { surface: "keywords",    label: "We can't see your keyword field without access",     unlockCopy: "Connect App Store Connect to read your keyword field and improve it." },
    { surface: "screenshots", label: "We can't read your real screenshots without access", unlockCopy: "Connect App Store Connect to grade your real screenshot set and improve it." },
    { surface: "previews",    label: "We can't see your app preview video without access", unlockCopy: "Connect App Store Connect to read your preview coverage and improve it." },
    { surface: "privacy",     label: "We can't see your privacy policy without access",    unlockCopy: "Connect App Store Connect to read your privacy policy and category and improve them." },
    { surface: "category",    label: "We can't see your full category setup without access", unlockCopy: "Connect App Store Connect to read your primary and secondary categories and improve them." },
    { surface: "locales",     label: "We can't see your per-locale keyword surfaces without access", unlockCopy: "Connect App Store Connect to read every locale's keyword surface and improve it." },
  ];
  function locksFor(R) {
    if (R && Array.isArray(R.locks)) return R.locks;
    // Legacy run (no locks field): a no-key run is blind to the same surfaces.
    return isNoKeyRun(R) ? LEGACY_NO_KEY_LOCKS : [];
  }
  function lockForSurface(R, surface) {
    var all = locksFor(R);
    for (var i = 0; i < all.length; i++) { if (all[i].surface === surface) return all[i]; }
    return null;
  }

  // A finding's "fix path" — so no finding is a dead end. Returns DOM children
  // (links/notes) for findings that have an actionable external path, or null.
  // Curated, honest: real tools we'd recommend + the exact App Store Connect spot.
  function fixLinkFor(id) {
    var ASC = "https://appstoreconnect.apple.com";
    var map = {
      screenshots_grade_low: [
        el("a", { href: SHOTS_SKILL, target: "_blank", rel: "noopener" }, ["Generate a better shot deck →"]),
        el("span", { class: "faint" }, [" (free MIT skill) · or edit in "]),
        el("a", { href: ASC, target: "_blank", rel: "noopener" }, ["App Store Connect"]),
      ],
      screenshots_thin: [
        el("a", { href: SHOTS_SKILL, target: "_blank", rel: "noopener" }, ["Build more screenshots →"]),
        el("span", { class: "faint" }, [" (free MIT skill)"]),
      ],
      screenshots_no_ipad: [el("a", { href: ASC, target: "_blank", rel: "noopener" }, ["Add iPad screenshots in App Store Connect →"])],
      preview_missing: [el("a", { href: ASC, target: "_blank", rel: "noopener" }, ["Add a preview video in App Store Connect →"])],
      preview_thin_coverage: [el("a", { href: ASC, target: "_blank", rel: "noopener" }, ["Add device previews in App Store Connect →"])],
      preview_error_state: [el("a", { href: ASC, target: "_blank", rel: "noopener" }, ["Re-upload your preview in App Store Connect →"])],
      privacy_policy_missing: [el("a", { href: ASC, target: "_blank", rel: "noopener" }, ["Add a privacy policy URL in App Store Connect →"])],
      secondary_category_missing: [el("a", { href: ASC, target: "_blank", rel: "noopener" }, ["Set a secondary category in App Store Connect →"])],
      version_no_draft: [el("a", { href: ASC, target: "_blank", rel: "noopener" }, ["Create a new version in App Store Connect →"])],
    };
    return map[id] || null;
  }

  // ── Screenshot gallery (#47, before.click-style) ──────────────────────────
  // Renders the app's REAL App Store screenshots — full-bleed, rounded, softly
  // elevated, side-by-side in App Store order, horizontally scrollable — so the
  // screenshot grade is shown next to WHAT it graded. Honest by construction
  // (#41): only renders when we actually hold real screenshot URLs; the "?"
  // (unreadable) state carries no URLs, so this returns null and the existing
  // "couldn't read — connect App Store Connect" finding/CTA stands alone. Framed
  // as a CONVERSION signal (not ranking), consistent with the impact chips.
  function screenshotGallery(sc) {
    if (!sc) return null;
    var iphone = sc.screenshotUrls || [];
    var ipad = sc.ipadScreenshotUrls || [];
    // Honesty gate: no real URLs → no gallery (never an empty/fake frame).
    if (!iphone.length && !ipad.length) return null;

    var strip = el("div", { class: "shots-strip" });
    iphone.forEach(function (url, i) {
      strip.appendChild(el("div", { class: "shot-frame flip-in", style: "--i:" + i }, [
        el("img", { class: "shot-img", src: url, alt: "App Store screenshot " + (i + 1), loading: "lazy" }),
      ]));
    });
    // iPad set follows the iPhone set, in App Store order, visually tagged.
    ipad.forEach(function (url, i) {
      strip.appendChild(el("div", { class: "shot-frame shot-ipad flip-in", style: "--i:" + (iphone.length + i) }, [
        el("img", { class: "shot-img", src: url, alt: "iPad screenshot " + (i + 1), loading: "lazy" }),
        el("span", { class: "shot-tag" }, ["iPad"]),
      ]));
    });

    var count = iphone.length + (ipad.length ? " iPhone · " + ipad.length + " iPad" : "");
    var head = el("div", { class: "shots-head" }, [
      el("span", { class: "shots-title" }, ["Your live screenshots"]),
      el("span", { class: "shots-count faint" }, [
        ipad.length ? (iphone.length + " iPhone · " + ipad.length + " iPad") : (iphone.length + " screenshot" + (iphone.length === 1 ? "" : "s")),
      ]),
    ]);
    var note = el("div", { class: "shots-note faint" }, [
      "The real shots we graded above — a conversion signal, not ranking. This is what your store visitors see.",
    ]);
    return el("div", { class: "shots-gallery" }, [head, strip, note]);
  }

  // ── Screenshot improvement panel (#55) ─────────────────────────────────────
  // Turns the dead-end grade into a prioritized, quantified worklist: each lever
  // is a single concrete move with its point delta and the grade it would reach
  // ("Add a 6th screenshot → +10 pts · C → B"), sorted biggest-win-first. Honest
  // by construction: the engine emits NO levers for the unreadable "?" set (#41)
  // or an A-grade set (no headroom), so this returns null and no panel renders —
  // never over-selling a finished or unreadable listing. CONVERSION framing only,
  // no ranking claims. The count/aspect levers reuse the existing make-it skill
  // linkout; the agent never generates or pushes assets.
  function improvementPanel(sc) {
    if (!sc) return null;
    var levers = sc.levers || [];
    if (!levers.length) return null; // no headroom / unreadable → no panel

    var head = el("div", { class: "shots-head" }, [
      el("span", { class: "shots-title" }, ["Improve your grade"]),
      el("span", { class: "shots-count faint" }, [
        "Shots: " + (sc.grade || "?") + " · " + levers.length + " lever" + (levers.length === 1 ? "" : "s"),
      ]),
    ]);

    var rows = levers.map(function (lv) {
      var children = [
        el("div", { class: "lever-line" }, [
          el("span", { class: "lever-label" }, [lv.label]),
          el("span", { class: "lever-delta" }, ["+" + lv.delta + " pts"]),
          el("span", { class: "lever-grade" }, [lv.fromGrade + " → " + lv.toGrade]),
        ]),
      ];
      if (lv.detail) children.push(el("div", { class: "lever-detail faint" }, [lv.detail]));
      if (lv.skill) {
        children.push(el("div", { class: "lever-link" }, [
          el("a", { href: SHOTS_SKILL, target: "_blank", rel: "noopener" }, ["Generate the missing shots with this skill →"]),
          el("span", { class: "faint" }, [" (free MIT skill)"]),
        ]));
      }
      return el("div", { class: "lever-row flip-in" }, children);
    });

    var note = el("div", { class: "lever-note faint" }, [
      "Each lever shows the exact points it adds and the grade it reaches — a conversion signal for what store visitors see. Biggest win first.",
    ]);
    return el("div", { class: "shot-levers" }, [head].concat(rows).concat([note]));
  }

  // No-key run detector: a public-data run carries the `asc_unlock` finding and
  // has NO ascContext (only the ASC-read path builds one). On such a run the live
  // subtitle/keywords are UNSEEN — never present them as a measured 0 (#56).
  function isNoKeyRun(R) {
    if (R && R.ascContext) return false;
    var findings = (R && R.findings) || [];
    return findings.some(function (f) { return f.id === "asc_unlock"; });
  }

  function listingAuditCard(R, appId) {
    var summary = R.findingsSummary || null;
    var noKey = isNoKeyRun(R);
    // De-dupe the unlock nudge (#56 item 4): on a no-key run it renders as the big
    // bordered CTA below; keep it OUT of the findings list so it shows exactly once.
    var all = (R.findings || []).filter(function (f) { return f.id !== "asc_unlock"; });
    // #71-C: STATUS/CONTEXT findings (context:true — live version state, pricing,
    // confirmed category…) render in their own compact strip below, never mixed
    // into the actionable fix list where they'd dilute the signal.
    var findings = all.filter(function (f) { return !f.context; });
    var statusFindings = all.filter(function (f) { return !!f.context; });

    var head = el("div", { class: "audit-head" }, [
      el("h3", { style: "margin:0" }, ["Listing audit"]),
      el("span", { class: "audit-summary" }, [(summary && summary.label) ? summary.label : (findings.length + " finding" + (findings.length === 1 ? "" : "s"))]),
    ]);
    var gc = gradeChip(R);
    if (gc) head.appendChild(gc);

    var body;
    if (!findings.length) {
      // Honest green state — a great listing, not a blank card.
      body = el("div", { class: "audit-empty" }, [
        el("span", { class: "audit-empty-ico" }, ["✓"]),
        el("div", {}, [
          el("b", {}, ["Your listing is in great shape — no fixes found"]),
          el("br"),
          el("span", { class: "faint" }, ["We audited every surface and found nothing to fix. Keep shipping."]),
        ]),
      ]);
    } else {
      body = el("div", { class: "findings" });
      findings.forEach(function (fnd, i) {
        var sev = SEV_META[fnd.severity] || SEV_META.info;
        var imp = IMPACT_META[fnd.impact] || IMPACT_META.completeness;
        var meta = el("div", { class: "finding-meta" }, [
          el("span", { class: "impact-chip " + imp.cls }, [imp.label]),
        ]);
        if (fnd.evidence) meta.appendChild(el("span", { class: "finding-evidence" }, [fnd.evidence]));
        var rows = [
          el("div", { class: "finding-title" }, [fnd.title]),
        ];
        if (fnd.detail) rows.push(el("div", { class: "finding-detail" }, [fnd.detail]));
        if (fnd.fix) rows.push(el("div", { class: "finding-fix" }, [el("span", { class: "fix-label" }, ["→ Fix:"]), " " + fnd.fix]));
        var fixLink = fixLinkFor(fnd.id);
        if (fixLink) rows.push(el("div", { class: "finding-link" }, fixLink));
        rows.push(meta);
        body.appendChild(el("div", { class: "finding flip-in " + fnd.severity, style: "--i:" + i }, [
          el("div", { class: "finding-ico", title: sev.label }, [sev.ico]),
          el("div", { class: "finding-body" }, rows),
        ]));
      });
    }

    var children = [head];
    // Screenshot gallery (#47) — the REAL shots we graded, rendered next to the
    // grade chip + findings so "what is being graded" is visible. Null when the
    // set is unreadable ("?"), so the honest empty-state finding stands alone (#41).
    var gallery = screenshotGallery(R.audit && R.audit.screenshots);
    if (gallery) {
      children.push(gallery);
    } else {
      // #61: the gallery is null when we couldn't READ the screenshot set (the "?"
      // grade slot). Render an honest inline 🔒 here so the gap reads as
      // LOCKED-not-bad next to gradeChip's neutral "Shots: ?", routing to the same
      // primary ASC run panel as the unlock CTA. Only on a no-key run that carries
      // a screenshots lock; a keyed run locks nothing, so this stays absent.
      var shotLock = lockForSurface(R, "screenshots");
      if (shotLock) children.push(fieldLock(shotLock, appId));
    }
    // Screenshot improvement panel (#55) — prioritized, quantified C→B→A levers
    // beside the gallery. Null (no panel) when the set is unreadable ("?") or
    // already A-grade (no headroom): the engine's levers gate honesty, the UI just
    // renders. Removing this one push fully reverts the feature.
    var levers = improvementPanel(R.audit && R.audit.screenshots);
    if (levers) children.push(levers);
    // Metadata coverage gauge (PRD 03) — a budget-efficiency read, ABOVE the
    // findings. Separate visual section; the findings card logic is untouched.
    var cov = coverageSection(R.coverage, noKey, R, appId);
    if (cov) children.push(cov);
    children.push(body);
    // #71-C: the "Listing status" strip — compact, factual context rows (live
    // version, pricing, confirmed category…). Separate from the fix list by
    // design: status is what IS, fixes are what to DO.
    if (statusFindings.length) {
      var statusRows = statusFindings.map(function (f) {
        return el("div", { class: "status-row" }, [
          el("span", { class: "status-title" }, [f.title]),
          f.detail ? el("span", { class: "status-detail faint" }, [" — " + f.detail]) : null,
        ]);
      });
      children.push(el("div", { class: "listing-status", id: "listingStatus" }, [
        el("div", { class: "shots-head" }, [
          el("span", { class: "shots-title" }, ["Listing status"]),
          el("span", { class: "shots-count faint" }, [statusFindings.length + " item" + (statusFindings.length === 1 ? "" : "s")]),
        ]),
      ].concat(statusRows)));
    }
    // No-key run → render the unlock CTA below the findings (PRD 04). Driven by the
    // asc_unlock finding (data hook from PRD 01); absent on key-bearing runs. The
    // finding is filtered OUT of the list above so it surfaces only once (#56).
    var unlock = (R.findings || []).filter(function (f) { return f.id === "asc_unlock"; })[0];
    if (unlock) children.push(ascUnlockCta(unlock, appId));

    return el("div", { class: "card audit-card" }, children);
  }

  // ── Metadata coverage gauge + waste breakdown (PRD 03) ─────────────────────
  // "How hard your metadata is working" — a budget-efficiency heuristic, NOT a
  // rank score (the honesty frame). Renders a radial gauge (0–100%), a normative
  // context line, and each waste item as a finding-style row with chars saved.
  var COVERAGE_WASTE_META = {
    duplicate:    { ico: "⧉", label: "Duplicate" },
    brand_repeat: { ico: "®", label: "Brand repeat" },
    filler:       { ico: "·", label: "Filler" },
    unused:       { ico: "∅", label: "Unused" },
  };
  function coverageBand(score) {
    if (score >= 80) return { cls: "good", note: "Excellent — your budget is working hard." };
    if (score >= 60) return { cls: "warn", note: "Strong. A few tweaks would tighten it." };
    if (score >= 20) return { cls: "warn", note: "Typical. Trim the waste below to lift it." };
    return { cls: "bad", note: "Heavy duplication, brand repeats, or filler — see below." };
  }
  // Per-field FILL breakdown (#60) — separate from the efficiency score. Each row
  // shows how much of that field's own 30/30/100 budget is used, with a real fill
  // bar. A field the run couldn't read (seen:false — e.g. a no-key run's subtitle
  // & keywords) is shown as UNSEEN, never a measured "0/limit" (false precision).
  var COV_FIELD_LABEL = { name: "Name", subtitle: "Subtitle", keywords: "Keywords" };
  // #61: on an UNSEEN row, decorate the existing "unseen" tag with an inline
  // "Connect to unlock" link so the honest #60 "unseen" state ALSO reads as the
  // upgrade lever — the same locked-field pattern as the screenshot lock, routing
  // to the same primary ASC run panel. R/appId are optional so legacy/standalone
  // callers keep working (no link when we don't have a run/app to route to).
  function coverageFieldBreakdown(cov, R, appId) {
    var fill = cov && cov.fieldFill;
    // Fallback for older payloads without fieldFill: synthesize seen rows from
    // usedChars (treats every field as seen — only used by legacy data).
    if (!fill || !fill.length) {
      var used = cov && cov.usedChars ? cov.usedChars : { name: 0, subtitle: 0, keywords: 0 };
      var LIM = { name: 30, subtitle: 30, keywords: 100 };
      fill = ["name", "subtitle", "keywords"].map(function (f) {
        return { field: f, limit: LIM[f], used: used[f] || 0, fillPct: Math.min(100, ((used[f] || 0) / LIM[f]) * 100), seen: true };
      });
    }
    var rows = fill.map(function (r) {
      var label = COV_FIELD_LABEL[r.field] || r.field;
      // Three honest states (not two):
      //   • UNSEEN — we couldn't read this field (no ASC key). Unknown, not 0.
      //   • EMPTY  — we READ it and it's blank. A real, unused ranking surface
      //              (an opportunity), NOT "unknown" and NOT "fully used".
      //   • used/limit — read and populated.
      var isEmpty = r.seen && r.used === 0;
      var barFill = r.seen && !isEmpty ? el("span", { class: "cov-bar-fill", style: "width:" + Math.round(r.fillPct) + "%" }) : null;
      var bar = el("div", { class: "cov-bar" + (r.seen ? (isEmpty ? " empty" : "") : " unseen") }, barFill ? [barFill] : []);
      var valueEl;
      var unlockLink = null;
      if (!r.seen) {
        valueEl = el("span", { class: "cov-field-val unseen", title: "Connect App Store Connect to read this field" }, ["unseen"]);
        // #61: the unseen field IS a locked surface — offer the unlock lever inline.
        var lock = appId ? lockForSurface(R, r.field) : null;
        if (lock) {
          unlockLink = el("a", { class: "field-lock-link cov-field-unlock", href: "#/apps/" + appId + "?asc=1",
            title: lock.unlockCopy || "Connect App Store Connect to read this field",
            onclick: function (e) { if (e && e.preventDefault) e.preventDefault(); go("#/apps/" + appId + "?asc=1"); } },
            ["🔒 Connect to unlock →"]);
        }
      } else if (isEmpty) {
        valueEl = el("span", { class: "cov-field-val empty", title: "We read this field and it's empty — an unused ranking surface you can claim" }, ["empty · 0/" + r.limit]);
      } else {
        valueEl = el("span", { class: "cov-field-val" }, [r.used + "/" + r.limit]);
      }
      return el("div", { class: "cov-field-row" }, [
        el("span", { class: "cov-field-name" }, [label]),
        bar,
        valueEl,
        unlockLink,
      ]);
    });
    return el("div", { class: "cov-fields-list" }, rows);
  }
  function coverageSection(cov, noKey, R, appId) {
    if (!cov || typeof cov.coverageScore !== "number") return null;
    var score = Math.round(cov.coverageScore);
    var band = coverageBand(score);
    var used = cov.usedChars || { name: 0, subtitle: 0, keywords: 0 };
    var workingChars = Math.round((cov.coverageScore / 100) * 160);
    // No-key run (#56 item 1): the score is computed only on the NAME — the live
    // subtitle/keywords are UNSEEN, not a measured 0. Claiming "100% Excellent /
    // budget working hard" reads as "you're optimized" when the agent simply can't
    // see two of three fields. So we drop the normative band note + the "of 160
    // working" gauge framing, and flag the unseen fields plainly instead.
    var coverageBlind = noKey === true;

    // radial gauge via conic-gradient (no SVG dep); center shows the score. On a
    // no-key run the score reflects ONLY the name, so we render a neutral partial
    // ring (not a green "100% / excellent" full ring that implies optimization).
    var deg = Math.round((score / 100) * 360);
    var gaugeCls = coverageBlind ? "neutral" : band.cls;
    var gauge = el("div", { class: "cov-gauge " + gaugeCls,
      style: "background:conic-gradient(currentColor " + deg + "deg, rgba(127,127,127,.18) " + deg + "deg)" }, [
      el("div", { class: "cov-gauge-inner" }, [
        el("span", { class: "cov-score" }, [String(score)]),
        el("span", { class: "cov-pct" }, ["%"]),
      ]),
    ]);

    var metaKids = [
      el("div", { class: "cov-title" }, ["Metadata coverage"]),
    ];
    if (coverageBlind) {
      // Honest framing: only the public name was seen; subtitle/keywords are unseen.
      metaKids.push(el("div", { class: "cov-sub" }, ["Name only — subtitle & keywords unseen"]));
      metaKids.push(el("div", { class: "cov-note faint" }, [
        "Scored on your app name alone. Connect App Store Connect to grade your live subtitle & keyword field.",
      ]));
      metaKids.push(el("div", { class: "cov-frame faint" }, ["A budget-efficiency heuristic — how hard your metadata works, not a rank score."]));
      // FILL breakdown — per-field, with subtitle/keywords shown as UNSEEN.
      metaKids.push(coverageFieldBreakdown(cov, R, appId));
      metaKids.push(el("div", { class: "cov-fields faint" }, [
        (cov.distinctTerms || 0) + " distinct term" + ((cov.distinctTerms === 1) ? "" : "s") + " in the name",
      ]));
    } else {
      // Count read-but-EMPTY surfaces — a high efficiency score on near-empty
      // metadata ("Excellent" while subtitle+keywords are blank) is the mixed
      // signal we avoid: efficiency ≠ fill. When fields were READ and are empty,
      // lead with the opportunity, not a normative "Excellent" band.
      var emptySurfaces = (cov.fieldFill || []).filter(function (f) { return f.seen && f.used === 0; });
      if (emptySurfaces.length) {
        var names = emptySurfaces.map(function (f) { return COV_FIELD_LABEL[f.field] || f.field; });
        metaKids.push(el("div", { class: "cov-sub" }, [
          names.join(" & ") + (emptySurfaces.length === 1 ? " is" : " are") + " empty — unused ranking surface" + (emptySurfaces.length === 1 ? "" : "s"),
        ]));
        metaKids.push(el("div", { class: "cov-note faint" }, [
          "You're using " + (used.name || 0) + " of your name's chars; " + names.join(" & ").toLowerCase() + " " + (emptySurfaces.length === 1 ? "sits" : "sit") + " empty. Filling " + (emptySurfaces.length === 1 ? "it" : "them") + " is your biggest available gain.",
        ]));
      } else {
        metaKids.push(el("div", { class: "cov-sub" }, [workingChars + " of 160 chars working"]));
        metaKids.push(el("div", { class: "cov-note faint" }, [band.note]));
      }
      metaKids.push(el("div", { class: "cov-frame faint" }, ["A budget-efficiency heuristic — how hard your metadata works, not a rank score."]));
      // FILL breakdown — per-field used/limit with real bars (separate from the
      // efficiency score above; a near-empty field reads low here even at 100%).
      metaKids.push(coverageFieldBreakdown(cov, R, appId));
      metaKids.push(el("div", { class: "cov-fields faint" }, [
        (cov.distinctTerms || 0) + " distinct term" + ((cov.distinctTerms === 1) ? "" : "s"),
      ]));
    }
    var meta = el("div", { class: "cov-meta" }, metaKids);

    var head = el("div", { class: "cov-head" }, [gauge, meta]);
    var kids = [head];

    var waste = cov.waste || [];
    if (waste.length) {
      var list = el("div", { class: "cov-waste" });
      waste.forEach(function (w, i) {
        var m = COVERAGE_WASTE_META[w.kind] || { ico: "·", label: w.kind };
        list.appendChild(el("div", { class: "cov-waste-item flip-in", style: "--i:" + i }, [
          el("div", { class: "cov-waste-ico", title: m.label }, [m.ico]),
          el("div", { class: "cov-waste-body" }, [
            el("div", { class: "cov-waste-detail" }, [w.detail]),
            el("div", { class: "cov-waste-meta" }, [
              el("span", { class: "impact-chip neutral" }, [m.label]),
              el("span", { class: "finding-evidence" }, [w.chars + " char" + (w.chars === 1 ? "" : "s")]),
            ]),
          ]),
        ]));
      });
      kids.push(list);
    } else {
      // On a no-key run we only scanned the name — don't imply the whole listing
      // is clean when subtitle/keywords were never read (#56).
      kids.push(el("div", { class: "cov-clean faint" }, [coverageBlind
        ? "No waste in the name. Your subtitle & keywords weren't read — connect App Store Connect to scan them."
        : "No wasted budget — no duplicates, brand repeats, or filler detected."]));
    }
    return el("div", { class: "cov-card" }, kids);
  }

  // ── "Expand to more markets" card (PRD 04 localization expansion) ──────────
  // Renders the engine's ROI-sorted locale recommendations. Each App Store locale
  // is a separate keyword surface; this card is the workbench the locale_single
  // finding points at. Honest by construction: the rationale text comes straight
  // from the engine (market/language descriptors, NO install numbers), and the
  // effort badge is the engine's own honest "translate" vs "new". We show the top
  // 3–5; the post-MVP "Draft this locale's metadata" button routes to the ASC run
  // panel (reusing the existing credential surface — no new one).
  var TIER_BADGE = {
    "large":     { cls: "good",    label: "Large market" },
    "mid":       { cls: "neutral", label: "Mid market" },
    "long-tail": { cls: "neutral", label: "Emerging market" },
  };
  // A small static label map so a raw code reads as a language to the user. Falls
  // back to the bare code when unknown (never fabricated).
  var LOCALE_LANG = {
    "es-MX": "Spanish (Mexico)", "es-ES": "Spanish (Spain)", "de-DE": "German",
    "fr-FR": "French", "fr-CA": "French (Canada)", "ja-JP": "Japanese", "ko-KR": "Korean",
    "pt-BR": "Portuguese (Brazil)", "pt-PT": "Portuguese", "it-IT": "Italian",
    "ru-RU": "Russian", "zh-Hans-CN": "Simplified Chinese", "zh-Hant-TW": "Traditional Chinese",
    "nl-NL": "Dutch", "sv-SE": "Swedish", "pl-PL": "Polish", "tr-TR": "Turkish",
    "ar-SA": "Arabic", "th-TH": "Thai", "id-ID": "Indonesian", "vi-VN": "Vietnamese",
    "hi-IN": "Hindi", "en-GB": "English (UK)", "en-AU": "English (Australia)",
  };

  function localizationExpansionCard(R, appId) {
    var recs = (R && R.localizationExpansion) || [];
    if (!recs.length) return null; // no recommendations → no card

    var head = el("div", { class: "audit-head" }, [
      el("h3", { style: "margin:0" }, ["Expand to more markets"]),
      el("span", { class: "audit-summary" }, [
        recs.length + " high-opportunity locale" + (recs.length === 1 ? "" : "s"),
      ]),
    ]);

    var body = el("div", { class: "loc-recs" });
    // UI shows the top 5 (engine already returns ≤7, ROI-sorted).
    recs.slice(0, 5).forEach(function (r, i) {
      var tier = TIER_BADGE[r.storefrontTier] || TIER_BADGE["mid"];
      var lang = LOCALE_LANG[r.locale] || r.locale;
      var effortLabel = r.effort === "translate" ? "Translate" : "New";
      var effortTitle = r.effort === "translate"
        ? "You have copy to translate into this storefront"
        : "Net-new metadata for this storefront";

      var meta = el("div", { class: "loc-rec-meta" }, [
        el("span", { class: "impact-chip " + tier.cls }, [tier.label]),
        el("span", { class: "loc-effort-badge " + r.effort, title: effortTitle }, [effortLabel]),
      ]);
      // Honest label: a per-locale draft flow doesn't exist yet, so this routes to
      // the ASC run panel (which runs the full read-and-improve). Say what it does.
      var draftBtn = el("button", {
        class: "btn small", title: "Run a read-and-improve pass with your App Store Connect key",
        onclick: function () { go("#/apps/" + appId + "?asc=1"); },
      }, ["Run with App Store Connect →"]);

      body.appendChild(el("div", { class: "loc-rec flip-in", style: "--i:" + i }, [
        el("div", { class: "loc-rec-head" }, [
          el("span", { class: "loc-rec-code" }, [r.locale]),
          el("span", { class: "loc-rec-lang faint" }, [lang]),
        ]),
        el("div", { class: "loc-rec-rationale" }, [r.rationale]),
        meta,
        el("div", { class: "btn-row", style: "margin-top:2px" }, [draftBtn]),
      ]));
    });

    var note = el("p", { class: "faint loc-rec-note" }, [
      "Each locale is a separate ranking surface. Opportunity is ranked by a static market-size heuristic — not live install data.",
    ]);

    return el("div", { class: "card loc-card" }, [head, body, note]);
  }

  function reasoningCard(R) {
    var steps = [];
    var au = R.audit || {}, sc = au.screenshots;
    if (sc && sc.grade === "?") {
      // #41: screenshots unreadable from public data — honest, not a false F.
      steps.push({ cls: "", ico: "?", t: "Audited the live listing", d: (sc.findings && sc.findings[0]) ? sc.findings[0] : "Couldn't read your screenshots from public App Store data." });
    } else if (sc) {
      steps.push({ cls: sc.grade <= "B" ? "ok" : "warn", ico: sc.grade, t: "Audited the live listing", d: "Screenshots score " + sc.score + "/100 (grade " + sc.grade + "): " + (sc.findings && sc.findings[0] ? sc.findings[0] : "") });
    }
    var ranks = R.ranks || [];
    var top10 = ranks.filter(function (r) { return r.rank && r.rank <= 10; }).length;
    var none = ranks.filter(function (r) { return r.rank == null; }).length;
    var lead = ranks[0];
    steps.push({ cls: "ok", ico: "↑", t: "Checked organic rank on " + ranks.length + " keywords", d: (lead ? "Leads with “" + lead.keyword + "” at " + rankText(lead.rank) + ". " : "") + top10 + " in the top 10, " + none + " not yet in the top 200 — clear room to climb." });
    var comp = R.competitors || {};
    // Honest competitor step: only claim we "watched" competitors when some were
    // actually tracked. The backend emits a hollow digest ("no changes") even with
    // ZERO competitors, so a digest string is NOT evidence of tracking — require
    // real changes or listings. With an empty set, "No movement detected" falsely
    // implies we watched and found nothing, when really none were added. (#72)
    var compTracked = (comp.changes && comp.changes.length) || (comp.listings && comp.listings.length);
    if (compTracked) {
      steps.push({ cls: "", ico: "◎", t: "Watched competitors", d: comp.digest || "No competitor movement this week." });
    } else {
      steps.push({ cls: "faint", ico: "○", t: "Competitor watch", d: "No competitors watched yet — discover or add them in the Competitors card on the app page." });
    }
    var rsn = R.reasoning || [];
    var prim = rsn.find(function (k) { return k.bucket === "Primary"; });
    var sec = rsn.find(function (k) { return k.bucket === "Secondary"; });
    var lt = rsn.filter(function (k) { return k.bucket === "Long-tail"; }).length;
    // No-key run (#56 item 2): the agent can't read OR write the subtitle/keyword
    // fields without an ASC connection, so the diff is empty. Narrate that honestly
    // instead of describing subtitle/keyword work the output never reflects.
    if (isNoKeyRun(R)) {
      steps.push({ cls: "", ico: "✦", t: "Scored & bucketed keywords",
        d: "Best term “" + (prim ? prim.keyword : "") + "” (score " + (prim ? prim.score : "?") +
           ") anchors the title. Without an App Store Connect connection the agent can't read or write your subtitle & keyword field, so it couldn't propose changes to them — connect App Store Connect to let it improve those." });
    } else {
      steps.push({ cls: "", ico: "✦", t: "Scored & bucketed keywords", d: "Best term “" + (prim ? prim.keyword : "") + "” (score " + (prim ? prim.score : "?") + ") anchors the title; “" + (sec ? sec.keyword : "") + "” takes the subtitle; " + lt + " long-tail terms feed the keyword field." });
    }
    var v = (R.proposedCopy && R.proposedCopy.validation) || {};
    steps.push({ cls: v.pass ? "ok" : "warn", ico: v.pass ? "✓" : "!", t: "Drafted copy within hard char limits", d: v.pass ? "All fields validated under Apple's limits (name 30, subtitle 30, keywords 100, promo 170). No over-limit copy emitted." : "One or more fields need attention." });
    steps.push({ cls: "warn", ico: "⏸", t: "Stopped at the approval gate", d: "Generated the App Store push commands but did NOT run them. The irreversible store push is yours to approve." });

    var list = el("div", { class: "reasoning" });
    steps.forEach(function (s, i) {
      var step = el("div", { class: "step flip-in " + s.cls, style: "--i:" + i }, [
        el("div", { class: "ico" }, [s.ico]),
        el("div", {}, [el("b", {}, [s.t]), el("br"), el("span", {}, [s.d])]),
      ]);
      list.appendChild(step);
    });
    return el("div", { class: "card" }, [el("h3", {}, ["What the agent did"]), list]);
  }

  // PR-style diff: the live store value (before) → the proposed value (after),
  // per field, with char counts. Built for developers — reads like a code review.
  // The "Proposed" side is now EDITABLE (#39 Part 1): each field the agent
  // actually proposed becomes an input bound to the shared edit buffer, with a
  // live char bar, a client-side (advisory) validation mirror, and a per-field
  // "Reset to agent's proposal". Only fields present in the proposal are editable
  // — editing can never fabricate an unseen field into existence (honesty guard).
  function diffCard(current, proposed, edit) {
    var order = [["name", "App name"], ["subtitle", "Subtitle"], ["keywords", "Keyword field"], ["promo", "Promotional text"]];
    var revealIndex = 0;
    var summaryEl = el("span", { class: "diffsummary" }, []);

    // recompute the "N fields changed" summary from the live edit buffer vs the
    // current live copy (the honest diff is the buffer, not the static proposal).
    function changedVsCurrent() {
      var n = 0;
      order.forEach(function (o) {
        var f = o[0];
        if (!edit.editable(f)) return;
        var was = String(current[f] == null ? "" : current[f]);
        var nowv = String(edit.buffer[f] == null ? "" : edit.buffer[f]);
        if (was !== nowv) n++;
      });
      return n;
    }
    function refreshSummary() {
      var n = changedVsCurrent();
      summaryEl.textContent = n + " field" + (n === 1 ? "" : "s") + " changed";
    }

    // build a non-editable row for a field the agent did NOT propose (unseen on a
    // no-key run) but where the diff still wants to show a difference. Rare —
    // mostly the name on a no-key run, which IS proposed. Kept for completeness.
    function readonlySide(kind, val, isEmpty, limit) {
      var count = (val || "").length;
      var pct = Math.min(100, Math.round((count / limit) * 100));
      var barCls = count > limit ? "warn" : pct >= 90 ? "full" : "";
      return el("div", { class: "diffside " + kind }, [
        el("div", { class: "dlabel" }, [kind === "was" ? "Current" : "Proposed",
          el("span", { class: "charcount", style: count > limit ? "color:var(--bad)" : "" }, [count + "/" + limit])]),
        el("div", { class: "dval" }, [isEmpty ? el("span", { class: "faint" }, [kind === "was" ? "(not set)" : "(left unchanged)"]) : val]),
        el("div", { class: "charbar " + barCls }, [el("i", { style: "width:" + pct + "%" })]),
      ]);
    }

    var rows = order.map(function (o) {
      var field = o[0], label = o[1];
      var was = current[field];
      var limit = LIMITS[field];
      var emptyWas = was == null || was === "";

      // The field the agent never proposed (unseen) → keep the honest read-only
      // behavior: only render a row if there's a genuine static change.
      if (!edit.editable(field)) {
        var now = proposed[field];
        var changed = (was || "") !== (now || "");
        if (!changed) return null;
        return el("div", { class: "diffrow is-changed", style: "--i:" + revealIndex++ }, [
          el("div", { class: "dfield" }, [
            el("span", { class: "fname" }, [label]),
            el("span", { class: "dtag " + (emptyWas ? "added" : "modified") }, [emptyWas ? "added" : "changed"]),
          ]),
          el("div", { class: "diffcols" }, [
            readonlySide("was", was, emptyWas, limit),
            el("div", { class: "darrow" }, ["→"]),
            readonlySide("now", now, now == null || now === "", limit),
          ]),
        ]);
      }

      // ── editable proposed field ──────────────────────────────────────────────
      var multiline = field === "keywords" || field === "promo";
      var input = el(multiline ? "textarea" : "input", {
        class: "txt diff-edit" + (multiline ? " mono" : ""),
        rows: multiline ? "2" : null,
        spellcheck: field === "keywords" ? "false" : null,
        "data-field": field,
        "aria-label": label,
        value: multiline ? null : (edit.buffer[field] == null ? "" : edit.buffer[field]),
      });
      if (multiline) input.value = edit.buffer[field] == null ? "" : edit.buffer[field];

      var charcount = el("span", { class: "charcount" }, []);
      var bar = el("i", {});
      var barWrap = el("div", { class: "charbar" }, [bar]);
      var issuesEl = el("div", { class: "diff-issues", style: "display:none" }, []);
      var dtag = el("span", { class: "dtag" }, []);
      var resetBtn = el("button", { class: "btn ghost diff-reset", title: "Reset to the agent's proposal",
        onclick: function () { edit.reset(field); render(); } }, ["↺ Reset"]);

      function render() {
        var val = edit.buffer[field] == null ? "" : edit.buffer[field];
        if (input.value !== val) input.value = val;
        var count = val.length;
        var pct = Math.min(100, Math.round((count / limit) * 100));
        var check = clientFieldCheck(field, edit.buffer);
        var over = count > limit;
        barWrap.className = "charbar " + (over ? "warn" : pct >= 90 ? "full" : "");
        bar.setAttribute("style", "width:" + pct + "%");
        charcount.textContent = count + "/" + limit;
        charcount.setAttribute("style", over ? "color:var(--bad)" : "");
        // validation issues (advisory) — red when the field breaks a rule.
        if (check.ok) {
          issuesEl.style.display = "none";
          issuesEl.textContent = "";
          input.classList.remove("invalid");
        } else {
          issuesEl.style.display = "";
          issuesEl.textContent = check.issues.join(" · ");
          input.classList.add("invalid");
        }
        // changed-vs-current tag + dirty (edited-from-agent) indicator
        var wasStr = String(current[field] == null ? "" : current[field]);
        var changedNow = wasStr !== val;
        dtag.className = "dtag " + (!changedNow ? "same" : emptyWas ? "added" : "modified");
        dtag.textContent = !changedNow ? "no change" : emptyWas ? "added" : "changed";
        resetBtn.style.display = edit.isDirty(field) ? "" : "none";
        refreshSummary();
      }

      input.addEventListener("input", function () { edit.set(field, input.value); render(); });
      // initial paint
      render();

      var nowSide = el("div", { class: "diffside now" }, [
        el("div", { class: "dlabel" }, [
          "Proposed",
          el("span", { class: "edited-flag", style: "display:none" }, []),
          charcount,
        ]),
        el("div", { class: "dval dval-edit" }, [input]),
        barWrap,
        issuesEl,
      ]);

      return el("div", { class: "diffrow is-changed is-editable", style: "--i:" + revealIndex++ }, [
        el("div", { class: "dfield" }, [
          el("span", { class: "fname" }, [label]),
          dtag,
          resetBtn,
        ]),
        el("div", { class: "diffcols" }, [
          readonlySide("was", was, emptyWas, limit),
          el("div", { class: "darrow" }, ["→"]),
          nowSide,
        ]),
      ]);
    }).filter(Boolean);

    // No editable proposed fields AND nothing changed → honest "connect ASC" hint.
    if (!rows.length) {
      rows = [el("div", { class: "faint", style: "padding:6px 0" }, [
        "No metadata changes proposed — connect App Store Connect to let the agent read + improve your subtitle/keywords.",
      ])];
    }

    refreshSummary();
    // #59: the engine's name-fill note — spare title chars + a scored target
    // that genuinely fits. A SUGGESTION line, not an applied change: the name
    // is the user's brand line, so the agent never rewrites it silently.
    var fill = proposed && proposed.optimization && proposed.optimization.nameFill;
    var fillHint = fill
      ? el("div", { class: "faint", id: "nameFillHint", style: "font-size:12px;margin-top:10px" }, [
          "Your name has " + fill.spare + " unused characters — the strongest ranking surface. " +
          "A relevant target that fits: “" + fill.proposedName + "”. If you adopt it, drop “" +
          fill.term + "” from your keyword field (Apple ignores repeats).",
        ])
      : null;
    return el("div", { class: "card" }, [
      el("div", { class: "diffhead" }, [
        el("h3", { style: "margin:0" }, ["Proposed changes"]),
        summaryEl,
      ]),
      el("p", { class: "faint", style: "margin:4px 0 14px;font-size:13px" },
        ["Your live listing on the left, the agent's proposal on the right — edit any field before you ship. We re-check Apple's limits on the server, so an invalid edit can't be staged."]),
      el("div", { class: "difflist" }, rows),
      el("div", { class: "faint", style: "font-size:12px;margin-top:10px" }, ["Keyword field is comma-joined with no spaces and shares no words with the title/subtitle — Apple's rules, enforced in code."]),
    ].concat(fillHint ? [fillHint] : []));
  }


  function competitorCard(comp) {
    var changes = comp.changes || [];
    var box = el("div", {});
    if (!changes.length) box.appendChild(el("div", { class: "faint" }, ["No competitors tracked."]));
    changes.forEach(function (ch) {
      var detail = ch.status === "changed" && ch.fields
        ? Object.keys(ch.fields).map(function (f) { return f + " " + ch.fields[f].from + "→" + ch.fields[f].to; }).join(", ")
        : ch.status === "new" ? "now tracking" : "no change";
      box.appendChild(el("div", { class: "comp" }, [
        el("span", { class: "tag " + (ch.status === "changed" ? "changed" : ch.status === "new" ? "new" : "same") }, [ch.status]),
        el("span", { class: "cname" }, [ch.name]),
        el("span", { class: "cdetail" }, [detail]),
      ]));
    });
    return el("div", { class: "card" }, [
      el("h3", {}, ["Competitor read"]),
      el("div", { class: "muted", style: "font-size:13px;margin-bottom:8px" }, [comp.digest || ""]),
      box,
    ]);
  }

  function rankCard(ranks) {
    var box = el("div", { class: "ranklist" });
    ranks.forEach(function (r, i) {
      var q = rankClass(r.rank); // good | mid | none
      var pos = el("span", { class: "pos rank-pop " + q, style: "--i:" + i }, [rankText(r.rank)]);
      var children = [el("span", { class: "kw" }, [r.keyword]), pos];
      // a top-10 rank gets an up-arrow flourish (the "you're winning here" cue)
      if (r.rank != null && r.rank <= 10) children.push(el("span", { class: "rank-arrow up", style: "--i:" + i }, ["▲"]));
      box.appendChild(el("div", { class: "rankrow" }, children));
    });
    return el("div", { class: "card" }, [el("h3", {}, ["Organic ranks (real iTunes data)"]), box]);
  }

  // "Where to push next" — the winnability ranker (PRD 06). Top opportunities by
  // opportunityScore, each with a reachability chip (now/soon/longshot) + why +
  // driver bars. The "now"/"soon" terms are the optimizer's target set; longshots
  // are LABELED, never hidden — the honest hedge. Curated copy only (no ASC data).
  var REACH_META = {
    now:      { cls: "now",      label: "Now" },
    soon:     { cls: "soon",     label: "Soon" },
    longshot: { cls: "longshot", label: "Longshot" },
  };
  // Only MEASURED drivers (#65) — each derived from real organic rank. No
  // "Volume" bar: we have no measured search-volume source, so we never show one.
  var DRIVER_META = [
    { key: "distance", label: "Distance to top" },
    { key: "competitorWeakness", label: "Weak field" },
    { key: "momentum", label: "Momentum" },
  ];

  function opportunityCard(opportunities) {
    var head = el("div", { class: "audit-head" }, [
      el("h3", { style: "margin:0" }, ["Where to push next"]),
      el("span", { class: "audit-summary" }, ["ranked by reachability, from your real rank data"]),
    ]);

    if (!opportunities.length) {
      return el("div", { class: "card opp-card" }, [head, el("div", { class: "faint", style: "margin-top:10px" }, [
        "No opportunities scored yet — run the agent to rank your keywords by reachability.",
      ])]);
    }

    // A numeric score is only meaningful when it DIFFERENTIATES keywords. Early on,
    // every driver is a default (distance 0 = unranked, competitorWeakness 100 =
    // no competitor data, momentum 50 = no history), so every keyword scores
    // identically — and an identical number across all rows is false precision.
    // Hide the number until real signals (rank movement / competitor data) spread
    // the scores; the qualitative reachability chip ("Soon") still carries honest
    // signal. The number returns the moment the scores actually differ.
    var scores = opportunities.map(function (o) { return Math.round(o.opportunityScore); });
    var differentiated = new Set(scores).size > 1;

    var list = el("div", { class: "opps" });
    opportunities.slice(0, 5).forEach(function (o, i) {
      var reach = REACH_META[o.reachability] || REACH_META.longshot;
      var bars = el("div", { class: "opp-drivers" });
      DRIVER_META.forEach(function (d) {
        var v = Math.round((o.drivers && o.drivers[d.key]) || 0);
        bars.appendChild(el("div", { class: "opp-driver", title: d.label + ": " + v + "/100" }, [
          el("span", { class: "opp-driver-label" }, [d.label]),
          el("span", { class: "opp-bar" }, [el("span", { class: "opp-bar-fill", style: "width:" + v + "%" })]),
        ]));
      });
      var rowtop = [el("span", { class: "opp-kw" }, [o.keyword])];
      // Only render the numeric score when it differentiates keywords (#73-followup).
      if (differentiated) {
        rowtop.push(el("span", { class: "opp-score", title: "Opportunity score (0–100)" }, [String(Math.round(o.opportunityScore))]));
      }
      rowtop.push(el("span", { class: "reach-chip " + reach.cls }, [reach.label]));
      list.appendChild(el("div", { class: "opp flip-in", style: "--i:" + i }, [
        el("div", { class: "opp-rowtop" }, rowtop),
        el("div", { class: "opp-why" }, [o.why || ""]),
        bars,
      ]));
    });

    var notes = [
      el("div", { class: "faint", style: "font-size:12px;margin:6px 0 12px" }, [
        "Reachability = distance-to-top·0.5 + competitor-weakness·0.35 + momentum·0.15 — all from your measured organic rank (no estimated search volume). A heuristic for the most reachable next move, not a guarantee. “Now”/“Soon” terms feed the optimizer's targets.",
      ]),
    ];
    // When scores haven't differentiated yet, say so plainly instead of showing a
    // wall of identical numbers that reads as broken/fake.
    if (!differentiated) {
      notes.push(el("div", { class: "faint", style: "font-size:12px;margin:-6px 0 12px;color:var(--warn)" }, [
        "These are all equally reachable right now — there isn't enough signal to rank them yet. As your ranks move (and competitors are added), the most winnable ones rise to the top.",
      ]));
    }

    return el("div", { class: "card opp-card" }, [head].concat(notes, [list]));
  }

  // Keyword table — MEASURED columns only (#65). We show each target keyword's
  // real organic rank + competition count (from R.ranks) and the agent's
  // qualitative placement. We deliberately DON'T show "volume/difficulty/
  // relevance" numbers: we have no measured source for them, so displaying them
  // would be fabricated precision dressed as data.
  function keywordCard(reasoning, ranks) {
    // Join the agent's target keywords to the real rank data by keyword.
    var rankByKw = {};
    (ranks || []).forEach(function (r) { rankByKw[r.keyword] = r; });

    var tbl = el("table", { class: "kw" }, [
      el("thead", {}, [el("tr", {}, ["Keyword", "Your rank", "Competing", "Placement"].map(function (h) { return el("th", {}, [h]); }))]),
    ]);
    var tb = el("tbody", {});
    reasoning.forEach(function (k) {
      var bcls = "bucket " + (k.bucket || "").replace(/[^A-Za-z-]/g, "");
      var r = rankByKw[k.keyword];
      var rankCell = r && r.rank != null ? ("#" + r.rank) : (r ? "not in top 200" : "—");
      var compCell = r && r.total ? String(r.total) : "—";
      tb.appendChild(el("tr", {}, [
        el("td", { style: "font-weight:600" }, [k.keyword]),
        el("td", { class: r && r.rank != null ? "" : "faint" }, [rankCell]),
        el("td", { class: "faint" }, [compCell]),
        el("td", {}, [el("span", { class: bcls }, [k.bucket])]),
      ]));
    });
    tbl.appendChild(tb);
    return el("div", { class: "card" }, [
      el("h3", {}, ["Keyword targeting"]),
      el("div", { class: "faint", style: "font-size:12px;margin-bottom:10px" }, ["Your real organic rank + how many apps compete for each term. Placement = where the agent uses it: Primary anchors the title, Secondary the subtitle, Long-tail the keyword field, Aspirational tracked only."]),
      tbl,
    ]);
  }

  // "Keyword opportunities" card (PRD 01): terms tracked competitors VISIBLY use
  // that you don't target and don't rank top-50 for, ranked by winnability. Each
  // row shows the score bar, competitor badges, your current rank, and a budget
  // flag. "Add to next run" feeds the term into the optimizer's target set.
  //
  // HONESTY (load-bearing copy — do not soften into causation): we infer term
  // usage from a competitor's VISIBLE listing, never from their ranking algorithm.
  // The card says "competitors use this term", NEVER "they rank #1 because of it".
  // `fitsBudget` is advisory; the optimizer still enforces the 100-char limit.
  function keywordGapCard(gaps, appId, reasoning) {
    if (!gaps || !gaps.length) return null; // graceful omit — no gaps, no card
    var TOP_N = 8;
    var shown = gaps.slice(0, TOP_N);

    var rows = el("div", { class: "gaplist" });
    shown.forEach(function (g, i) {
      var pct = Math.max(0, Math.min(100, Math.round(g.score)));
      var badges = el("div", { class: "gap-comps" }, (g.competitorsUsing || []).map(function (nm) {
        return el("span", { class: "gap-comp" }, [nm]);
      }));
      var rankLabel = g.youRank == null ? "Unranked" : "Rank #" + g.youRank;
      var budget = g.fitsBudget
        ? el("span", { class: "gap-budget ok", title: "Fits your remaining keyword-field budget (advisory)" }, ["✓ fits budget"])
        : el("span", { class: "gap-budget warn", title: "Won't fit your remaining keyword chars (advisory — optimizer enforces the limit)" }, ["⚠ tight budget"]);

      var addBtn = el("button", { class: "btn small", onclick: function () { feedGapToRun(appId, g.keyword, reasoning, addBtn); } }, ["+ Add to next run"]);

      rows.appendChild(el("div", { class: "gap flip-in", style: "--i:" + i }, [
        el("div", { class: "gap-head" }, [
          el("span", { class: "gap-kw" }, [g.keyword]),
          el("span", { class: "gap-score", title: "Winnability score (0–100)" }, [String(pct)]),
        ]),
        el("div", { class: "gap-bar" }, [el("i", { style: "width:" + pct + "%" })]),
        el("div", { class: "gap-meta" }, [
          badges,
          el("span", { class: "gap-rank " + (g.youRank == null ? "none" : g.youRank <= 50 ? "mid" : "") }, [rankLabel]),
          budget,
        ]),
        el("div", { class: "gap-actions" }, [addBtn]),
      ]));
    });

    var moreNote = gaps.length > TOP_N
      ? el("div", { class: "faint", style: "font-size:12px;margin-top:8px" }, ["Showing top " + TOP_N + " of " + gaps.length + " gaps by winnability."])
      : null;

    var children = [
      el("div", { class: "audit-head" }, [
        el("h3", { style: "margin:0" }, ["Keyword opportunities"]),
        el("span", { class: "audit-summary" }, [gaps.length + " gap" + (gaps.length === 1 ? "" : "s")]),
      ]),
      el("p", { class: "faint", style: "margin:4px 0 14px;font-size:13px" },
        ["Terms competitors use that you don't target. Based on competitors' visible listing — we can't see their keyword field or why they rank. These fit your metadata budget where flagged."]),
      rows,
    ];
    if (moreNote) children.push(moreNote);
    return el("div", { class: "card gap-card" }, children);
  }

  // Feed a gap keyword into the next run's target set: re-run the agent with the
  // existing seed keywords PLUS this term. The human still approves the result —
  // this only proposes a new target, it never pushes anything.
  function feedGapToRun(appId, keyword, reasoning, btn) {
    var seeds = (reasoning || []).map(function (k) { return k.keyword; });
    if (seeds.indexOf(keyword) === -1) seeds.push(keyword);
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Queuing…';
    api("POST", "/apps/" + appId + "/run", { keywords: seeds })
      .then(function (r) { toast("Added “" + keyword + "” — running the agent with it."); go("#/runs/" + r.id); })
      .catch(function (e) { btn.disabled = false; btn.textContent = "+ Add to next run"; toast(e.message || "Failed"); });
  }

  // ── Competitor Rank War Room (PRD 05, absorbs the #25 selector) ────────────
  // Head-to-head per-keyword grid: You vs each SELECTED competitor, with the gap
  // to the best competitor and your trend, sorted so the most CLOSEABLE gaps lead
  // (winnability over vanity). A multi-select of tracked competitor names drives
  // the grid; toggling re-fetches /apps/:id/war-room?competitors=… so the cells
  // recompute live. Unknown competitor rank = "—" — honest "we didn't check",
  // never a guessed number. Correlation only: we show the gap + trend side by
  // side, never "you beat them BECAUSE X".
  var WAR_TREND = {
    gaining: { cls: "good", txt: "gaining ↑" },
    losing:  { cls: "bad",  txt: "losing ↓" },
    flat:    { cls: "neutral", txt: "flat =" },
    "new":   { cls: "good", txt: "new ✨" },
    lost:    { cls: "bad",  txt: "lost ✗" },
  };

  function warRoomCard(initial, appId, comp) {
    // Available competitors = the tracked listing names (the captured set the
    // selector is allowed to offer — no hand-typed arbitrary names).
    var available = (comp.listings || []).map(function (l) { return l.name; }).filter(Boolean);
    var card = el("div", { class: "card war-room" }, [
      el("h3", {}, ["Competitor rank war room"]),
      el("div", { class: "muted", style: "font-size:13px;margin-bottom:10px" }, [
        "Head-to-head per keyword. The gap to the closest competitor and your trend, side by side — sorted by the gap you can actually close. ",
        el("b", {}, ["—"]), " means we haven't checked that competitor on that keyword (never a guess).",
      ]),
    ]);

    // The selected set: start from what the seeded payload used; else default to
    // the TOP MOVERS — the competitors that are ahead of you on the most/widest
    // keywords (largest summed closeable gap), capped at MAX (#25 "defaulting to
    // the top movers"). Deterministic name tie-break to match the builder.
    var MAX_WAR_ROOM_COMPETITORS = 4;
    var selected = {};
    var seedNames = (initial && initial.competitors && initial.competitors.length)
      ? initial.competitors
      : topMovers((initial && initial.warRoom) || [], available, MAX_WAR_ROOM_COMPETITORS);
    seedNames.forEach(function (n) { selected[n] = true; });

    // Rank available competitors by how much movement there is to chase: sum the
    // positive gap (their rank ahead of yours) across keywords. Pure + deterministic.
    function topMovers(rows, names, cap) {
      if (!names.length) return [];
      var score = {};
      names.forEach(function (n) { score[n] = 0; });
      (rows || []).forEach(function (r) {
        if (r.you == null) return;
        (r.competitors || []).forEach(function (cc) {
          if (cc.rank == null || score[cc.name] == null) return;
          var gap = r.you - cc.rank; // positive = competitor ahead of you
          if (gap > 0) score[cc.name] += gap;
        });
      });
      return names.slice().sort(function (a, b) {
        if (score[b] !== score[a]) return score[b] - score[a]; // most movement first
        return a < b ? -1 : a > b ? 1 : 0; // stable name tie-break
      }).slice(0, cap);
    }

    var gridWrap = el("div", { class: "war-grid-wrap" });
    var asOf = el("div", { class: "war-asof faint" });

    function renderGrid(data) {
      clear(gridWrap);
      var rows = (data && data.warRoom) || [];
      var cols = (data && data.competitors) || [];
      // Honest provenance: the live-checked competitor numbers are a point-in-time
      // snapshot, not continuous tracking — stamp them with the endpoint's "as of".
      clear(asOf);
      if (data && data.checkedAt) {
        asOf.appendChild(document.createTextNode("Competitor ranks live-checked as of " + (data.checkedAt || "").slice(0, 10) + "."));
      }
      if (!rows.length) {
        gridWrap.appendChild(el("div", { class: "faint" }, [
          cols.length ? "No tracked keywords to compare yet — run the loop to capture ranks." : "Select a competitor to open the head-to-head.",
        ]));
        return;
      }
      var head = el("tr", {}, [el("th", {}, ["Keyword"]), el("th", {}, ["You"])]
        .concat(cols.map(function (n) { return el("th", {}, [n]); }))
        .concat([el("th", {}, ["Gap"]), el("th", {}, ["Trend"])]));
      var tb = el("tbody", {});
      rows.forEach(function (r, i) {
        var tr = el("tr", { class: "war-row flip-in" + (r.winning ? " winning" : ""), style: "--i:" + i }, []);
        tr.appendChild(el("td", { class: "war-kw" }, [r.keyword]));
        // YOUR cell: animate your prev → cur count-up, pulsing green when you're
        // gaining and red when you're losing/lost. youPrevious === null (single
        // snapshot) → countUpRank skips the tween and just shows the current rank
        // — no fabricated movement. prefers-reduced-motion jumps to final (handled
        // inside countUpRank). The pulse class tracks YOUR trend, not the gap.
        var trendPulse = (r.trend === "gaining" || r.trend === "new") ? " good"
          : (r.trend === "losing" || r.trend === "lost") ? " bad" : "";
        var youEl = el("span", { class: "pos rank-pop " + rankClass(r.you) + trendPulse, style: "--i:" + i }, [rankText(r.you)]);
        countUpRank(youEl, r.youPrevious, r.you, 120 + i * 60);
        tr.appendChild(el("td", {}, [youEl]));
        // Competitor cells stay static honest current ranks ("—" when unchecked).
        // We have no historical competitor rank to count up from (Track A), so we
        // never animate a competitor — that would imply unmeasured movement.
        (r.competitors || []).forEach(function (cc) {
          tr.appendChild(el("td", {}, [el("span", { class: "pos " + rankClass(cc.rank) }, [rankText(cc.rank)])]));
        });
        // Gap: directional tint by YOUR trend so a closing gap reads as momentum.
        var gapCell;
        if (r.gapToBest == null) {
          gapCell = el("span", { class: "war-gap rank-pop " + (r.winning ? "good" : "neutral"), style: "--i:" + i }, [r.winning ? "winning" : "—"]);
        } else {
          var gapTint = r.trend === "gaining" ? " good" : " bad";
          gapCell = el("span", { class: "war-gap rank-pop" + gapTint, style: "--i:" + i, title: "Your rank minus the closest competitor's — the gap to close" }, ["+" + r.gapToBest]);
        }
        tr.appendChild(el("td", {}, [gapCell]));
        var tm = WAR_TREND[r.trend] || WAR_TREND.flat;
        tr.appendChild(el("td", {}, [el("span", { class: "war-trend rank-pop " + tm.cls, style: "--i:" + i }, [tm.txt])]));
        tb.appendChild(tr);
      });
      gridWrap.appendChild(el("table", { class: "war-grid" }, [el("thead", {}, [head]), tb]));
    }

    async function refresh() {
      var picked = Object.keys(selected).filter(function (n) { return selected[n]; });
      try {
        var data = await api("GET", "/apps/" + appId + "/war-room?competitors=" + encodeURIComponent(picked.join(",")));
        renderGrid(data);
      } catch (e) {
        renderGrid({ warRoom: [], competitors: picked });
      }
    }

    // Selector: a chip per available competitor; click toggles + re-fetches.
    if (available.length) {
      var chips = el("div", { class: "war-selector" }, [el("span", { class: "war-selector-label" }, ["Compare against:"])]);
      available.forEach(function (name) {
        var chip = el("button", {
          class: "war-chip" + (selected[name] ? " on" : ""),
          onclick: function () {
            selected[name] = !selected[name];
            chip.className = "war-chip" + (selected[name] ? " on" : "");
            refresh();
          },
        }, [name]);
        chips.appendChild(chip);
      });
      card.appendChild(chips);
    }
    card.appendChild(gridWrap);
    card.appendChild(asOf);

    // Seed from the run payload immediately (no flash), then it's selector-driven.
    if (initial && initial.warRoom) renderGrid(initial);
    else refresh();
    return card;
  }

  function gateCard(run, R, edit) {
    // Tolerate older callers without an edit buffer (re-render fallbacks) by
    // synthesizing one from the proposal — keeps the gate honest about scope.
    if (!edit) edit = makeEditState(R.proposedCopy || {}, R.currentCopy || {});
    var card = el("div", { class: "card", style: "border-color:var(--brand-dim)" });
    card.appendChild(el("h3", {}, ["The approval gate"]));

    if (run.status === "awaiting_approval" || run.status === "detected" || run.status === "researching") {
      card.appendChild(el("p", { class: "muted", style: "margin-top:0" }, ["The push is the one irreversible step. The agent stopped here and is waiting on you."]));
      var approve = el("button", { class: "btn ok", onclick: function () { decide(run.id, "approve", card, approve, run, R, edit); } }, ["✓ Approve & reveal commands"]);
      var reject = el("button", { class: "btn bad", onclick: function () { decide(run.id, "reject", card, reject, run, R, edit); } }, ["✕ Reject"]);
      // Block Approve while the client validator (advisory) reports any edited
      // field invalid — the server re-checks and is authoritative, but we never
      // let the user fire an approval we already know it will reject.
      var invalidMsg = el("div", { class: "diff-invalid-msg", style: "display:none;margin-top:10px" }, []);
      function syncApprove() {
        var v = edit.validation();
        if (v.pass) {
          approve.disabled = false;
          approve.title = "";
          invalidMsg.style.display = "none";
          invalidMsg.textContent = "";
        } else {
          approve.disabled = true;
          approve.title = "Fix the edited fields above before approving";
          invalidMsg.style.display = "";
          var bad = v.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.field; });
          invalidMsg.textContent = "Can't approve yet — fix " + bad.join(", ") + " above (over a limit or breaks Apple's keyword rules).";
        }
      }
      edit.subscribe(syncApprove);
      syncApprove();
      card.appendChild(el("div", { class: "btn-row" }, [approve, reject]));
      card.appendChild(invalidMsg);
      card.appendChild(commandsLocked());
    } else if (run.status === "rejected") {
      card.appendChild(el("div", { class: "locked" }, [el("span", { class: "lock" }, ["✕"]), "You rejected this proposal. Nothing was pushed."]));
      // Let them re-run immediately from here — no need to navigate back to the app.
      card.appendChild(el("div", { class: "btn-row", style: "margin-top:12px" }, [
        el("button", { class: "btn primary", onclick: function () { go("#/apps/" + run.app_id); } }, ["▶ Run the agent again"]),
      ]));
    } else if (isNoOpProposal(R.currentCopy || {}, edit.buffer || R.proposedCopy || {})) {
      // #76: the (possibly edited) copy doesn't actually change anything vs live
      // (or differs only by case/whitespace). Compare against the edit BUFFER so an
      // edit back to the live value is honestly reported as a no-op, not a "change."
      // Don't present a "push this" handoff for metadata that's already live.
      card.appendChild(el("div", { class: "locked", style: "margin-top:4px" }, [
        el("span", { class: "lock" }, ["✓"]),
        "Your metadata is already well-optimized — the agent found no changes worth pushing. Nothing to upload.",
      ]));
      card.appendChild(el("div", { class: "btn-row", style: "margin-top:12px" }, [
        el("button", { class: "btn", onclick: function () { go("#/apps/" + run.app_id); } }, ["← Back to app"]),
      ]));
    } else {
      // approved or shipped → reveal the handoff. After approval the server has
      // staged the (possibly edited) copy + re-derived commands onto R, so the
      // panels render the EDITED values that actually ship — not the agent's
      // original proposal.
      card.appendChild(el("p", { class: "muted", style: "margin-top:0" }, ["Approved. Hand the metadata to your build pipeline (recommended) — that path is credential-free. Or upload straight to App Store Connect below; ShipASO uses your key once and never stores it."]));
      card.appendChild(ascPushCta(run.id));
      card.appendChild(commandsBox(R.pushCommands || [], run.id, R.proposedCopy || {}, R.currentCopy || {}));
    }
    return card;
  }

  // #76: true when the proposal changes NOTHING the user would care about vs the
  // current live copy — every field equal ignoring case + surrounding whitespace.
  // (App Store keyword matching is case-insensitive, so a lone "MRI"→"mri" fold is
  // not a real change and must not be presented as one.) Compares only fields the
  // push would write: name, subtitle, keywords, promo.
  function isNoOpProposal(current, proposed) {
    var fields = ["name", "subtitle", "keywords", "promo"];
    var norm = function (v) { return String(v == null ? "" : v).toLowerCase().replace(/\s+/g, " ").trim(); };
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      // Only compare a field the proposal actually carries (an unread field is
      // absent, not "changed").
      if (proposed[f] === undefined) continue;
      if (norm(current[f]) !== norm(proposed[f])) return false;
    }
    return true;
  }

  function commandsLocked() {
    return el("div", { class: "locked", style: "margin-top:14px" }, [el("span", { class: "lock" }, ["🔒"]), "Generated push commands are hidden until you approve."]);
  }

  function commandsBox(cmds, runId, copy, current) {
    var wrap = el("div", { class: "cmds", style: "margin-top:14px" });

    // ── primary handoff: Fastlane metadata that drops into their pipeline ──
    var handoff = el("div", { class: "handoff" });
    handoff.appendChild(el("div", { class: "handoff-h" }, [
      el("span", { class: "store-tag appstore" }, ["fastlane"]),
      el("span", { class: "desc" }, ["Drops into your repo as a ", el("code", {}, ["fastlane/metadata/"]), " tree — your CI runs ", el("code", {}, ["deliver"]), " with the credentials it already holds."]),
    ]));
    var prBtn = el("button", { class: "btn", onclick: function () { openGithubPr(runId, prBtn, prStatus); } }, ["⌥ Open a PR in your repo"]);
    var prStatus = el("span", { class: "faint", style: "align-self:center;font-size:12.5px" }, []);
    handoff.appendChild(el("div", { class: "btn-row", style: "margin-top:12px;align-items:center;gap:12px;flex-wrap:wrap" }, [
      el("button", { class: "btn primary", onclick: function () { downloadFastlane(runId, copy); } }, ["↓ Download Fastlane metadata"]),
      prBtn, prStatus,
    ]));
    handoff.appendChild(el("p", { class: "faint", style: "font-size:12.5px;margin:10px 0 0" }, [
      "Commit the tree (or merge the PR), then your pipeline pushes it. This path needs no credentials from you.",
    ]));
    // ── export the proposal as a ready-to-paste prompt for a coding agent ──
    handoff.appendChild(el("div", { class: "btn-row", style: "margin-top:12px;align-items:center;gap:12px;flex-wrap:wrap" }, [
      el("button", { class: "btn ghost", onclick: function () { copyText(buildAgentPrompt(current || {}, copy || {}), "Agent prompt copied"); } }, ["⚙ Copy as agent prompt"]),
      el("span", { class: "faint", style: "font-size:12px" }, ["paste into Claude Code / Cursor to update your fastlane files"]),
    ]));
    wrap.appendChild(handoff);
    // hide the PR button unless the GitHub App is configured for this deployment
    maybeShowPrButton(prBtn, prStatus);

    // ── secondary: the raw commands, for manual operators ──
    var all = cmds.map(function (c) { return c.command; }).join("\n");
    var det = el("details", { class: "rawcmds", style: "margin-top:16px" });
    det.appendChild(el("summary", {}, ["Or run the commands manually"]));
    cmds.forEach(function (c) {
      det.appendChild(el("div", { class: "cmd" }, [
        el("div", { class: "cmd-h" }, [
          el("span", { class: "store-tag " + c.store }, [c.tool]),
          el("span", { class: "desc" }, [c.description]),
          el("button", { class: "btn ghost copy-btn", onclick: function () { copyText(c.command, "Command copied"); } }, ["Copy"]),
        ]),
        el("pre", {}, [c.command]),
      ]));
    });
    det.appendChild(el("div", { class: "btn-row", style: "margin-top:4px" }, [
      el("button", { class: "btn", onclick: function () { copyText(all, "All commands copied"); } }, ["Copy all"]),
    ]));
    wrap.appendChild(det);

    return wrap;
  }

  // Post-approval "Upload to App Store Connect" CTA. This surfaces the existing
  // push path (pushAsc → POST /runs/:id/asc/push) as a clear, prominent action
  // at the approval moment. No key was stored for the run, so we prompt for the
  // .p8 / keyId / issuerId here — they're ephemeral (held only in these DOM
  // inputs, sent once on click, and NEVER persisted). The credential-free
  // Fastlane handoff below remains the recommended default for most teams.
  function ascPushCta(runId) {
    var sec = el("div", { class: "handoff asc-cta", style: "margin-top:14px;border-color:var(--brand-dim)" });
    sec.appendChild(el("div", { class: "handoff-h" }, [
      el("span", { class: "store-tag appstore" }, ["App Store Connect"]),
      el("span", { class: "desc" }, ["Upload the approved metadata straight to your editable App Store version. Enter your API key once — it's used for this push and never stored."]),
    ]));
    var issuer = el("input", { class: "txt mono", type: "text", placeholder: "Issuer ID (e.g. 57246542-96fe-…)", autocomplete: "off", spellcheck: "false" });
    var keyId = el("input", { class: "txt mono", type: "text", placeholder: "Key ID (e.g. ABC123DEFG)", autocomplete: "off", spellcheck: "false" });
    var p8 = el("textarea", { class: "txt mono", rows: "4", placeholder: "-----BEGIN PRIVATE KEY-----\n…paste your .p8 contents…\n-----END PRIVATE KEY-----", autocomplete: "off", spellcheck: "false" });
    var status = el("span", { class: "faint", style: "font-size:12.5px" }, []);
    // Reuse the key the user entered for THIS session's read so they don't re-type
    // it minutes later (#76 friction). In-memory only, never persisted.
    if (ascCredsMemory) {
      issuer.value = ascCredsMemory.issuerId || "";
      keyId.value = ascCredsMemory.keyId || "";
      p8.value = ascCredsMemory.p8 || "";
      status.textContent = "Using the key from your read — never stored.";
    }
    var creds = function () { return { issuerId: issuer.value, keyId: keyId.value, p8: p8.value }; };
    var pushBtn = el("button", { class: "btn primary", onclick: function () { pushAsc(runId, creds(), pushBtn, status); } }, ["↥ Upload to App Store Connect"]);
    sec.appendChild(el("label", { class: "fld", style: "margin-top:12px" }, [el("span", { class: "lab" }, ["Issuer ID"]), issuer]));
    sec.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Key ID"]), keyId]));
    sec.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, [".p8 private key"]), p8]));
    // Drop-a-.p8 convenience (#33): fills the textarea + auto-fills Key ID from the
    // AuthKey_<KEYID>.p8 filename. The file is read in-browser only, never uploaded.
    sec.appendChild(p8FileInput(p8, keyId));
    sec.appendChild(el("div", { class: "btn-row", style: "margin-top:12px;align-items:center;gap:12px;flex-wrap:wrap" }, [pushBtn, status]));
    sec.appendChild(el("p", { class: "faint", style: "font-size:12px;margin:10px 0 0" }, [
      el("b", { style: "color:var(--warn)" }, ["This writes to your live App Store version"]),
      " (the editable one in App Store Connect). Your .p8 is used once and never stored.",
    ]));
    return sec;
  }

  async function pushAsc(runId, creds, btn, status) {
    if (!creds.issuerId.trim() || !creds.keyId.trim() || !creds.p8.trim()) {
      status.textContent = "Fill in issuer id, key id, and the .p8."; status.style.color = "var(--warn)"; return;
    }
    if (!(API_BASE && liveMode)) {
      status.textContent = "Live API required to push."; status.style.color = "var(--warn)"; return;
    }
    btn.disabled = true; status.textContent = "Pushing to App Store Connect…"; status.style.color = "var(--dim)";
    try {
      var res = await fetch(API_BASE + "/runs/" + runId + "/asc/push", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(creds),
      });
      if (res.status === 403) {
        status.textContent = "Direct push isn't enabled — use the Fastlane handoff above.";
        status.style.color = "var(--warn)"; return;
      }
      var out = await res.json();
      if (out.ok) {
        status.textContent = "✓ Pushed " + (out.fieldsPushed || []).length + " field(s) to the editable version.";
        status.style.color = "var(--signal)";
      } else {
        status.textContent = "✕ " + (out.reason || out.error || "Push failed.");
        status.style.color = "var(--bad)";
      }
    } catch (e) {
      status.textContent = "✕ " + (e.message || "Request failed."); status.style.color = "var(--bad)";
    } finally { btn.disabled = false; }
  }

  // Download the Fastlane metadata bundle. Live: stream the zip from the Worker
  // (real archive, cookie-authed). Mock/no-API: build the file tree client-side
  // and download it as a single readable .txt preview (no zip lib in the browser).
  async function downloadFastlane(runId, copy) {
    if (API_BASE && liveMode) {
      try {
        var res = await fetch(API_BASE + "/runs/" + runId + "/fastlane.zip", { credentials: "include" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        var blob = await res.blob();
        var url = URL.createObjectURL(blob);
        var a = el("a", { href: url, download: "fastlane-metadata.zip" });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 0);
        toast("Fastlane metadata downloaded ✓");
        return;
      } catch (e) { toast("Download failed — " + (e.message || "try again")); return; }
    }
    // mock preview: concatenate the tree into one annotated file
    var files = buildFastlaneFiles(copy);
    var preview = files.map(function (f) { return "# ===== " + f.path + " =====\n" + f.content; }).join("\n\n");
    downloadText(preview, "fastlane-metadata.txt", "Fastlane metadata (preview) downloaded");
  }

  // Show the "Open a PR" button only when the GitHub App is configured for this
  // deployment (otherwise the credential-free Fastlane download stands alone).
  function maybeShowPrButton(btn, status) {
    btn.style.display = "none";
    if (!(API_BASE && liveMode)) return;
    fetch(API_BASE + "/github/status", { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (!s.appConfigured) return; // stays hidden
        btn.style.display = "";
        if (s.connected) { status.textContent = "→ " + s.repo; }
        else { status.textContent = "connect a repo first"; }
      })
      .catch(function () {});
  }

  // Open a PR with the metadata tree. If not connected to a repo yet, prompt for
  // it inline, save the connection, then open the PR.
  async function openGithubPr(runId, btn, status) {
    btn.disabled = true; status.textContent = "Checking…"; status.style.color = "var(--dim)";
    try {
      var st = await fetch(API_BASE + "/github/status", { credentials: "include" }).then(function (r) { return r.json(); });
      if (!st.connected) {
        var repo = window.prompt("Your GitHub repo (owner/name) — install the ShipASO app on it first:", "");
        if (!repo) { btn.disabled = false; status.textContent = "connect a repo first"; status.style.color = "var(--faint)"; return; }
        var inst = window.prompt("Your ShipASO app installation id (from the app's install URL):", "");
        if (!inst) { btn.disabled = false; status.textContent = "installation id required"; status.style.color = "var(--faint)"; return; }
        // Surface a connect failure explicitly — don't fall through to a cryptic PR error.
        var connectRes = await fetch(API_BASE + "/github/connect", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo: repo, installation_id: inst }) });
        if (!connectRes.ok) {
          var ce = await connectRes.json().catch(function () { return {}; });
          status.textContent = "✕ Couldn't connect that repo — " + (ce.error || "check the repo + installation id and try again.");
          status.style.color = "var(--bad)"; btn.disabled = false; return;
        }
      }
      status.textContent = "Opening a PR…";
      var res = await fetch(API_BASE + "/runs/" + runId + "/github/pr", { method: "POST", credentials: "include" });
      if (res.status === 403) { status.textContent = "GitHub PR not enabled — use the download."; status.style.color = "var(--warn)"; btn.disabled = false; return; }
      var out = await res.json();
      if (out.ok) {
        status.innerHTML = "✓ PR #" + out.number + " opened — ";
        status.appendChild(el("a", { href: out.url, target: "_blank", style: "color:var(--signal)" }, ["view"]));
        status.style.color = "var(--signal)";
      } else {
        status.textContent = "✕ " + (out.reason || out.error || "Failed."); status.style.color = "var(--bad)";
      }
    } catch (e) {
      status.textContent = "✕ " + (e.message || "Request failed."); status.style.color = "var(--bad)";
    } finally { btn.disabled = false; }
  }

  // Client mirror of cloud/src/engine/fastlane.ts (that module is the tested
  // source of truth). Maps proposed copy → the fastlane/metadata file tree.
  function buildFastlaneFiles(copy, locale) {
    locale = locale || "en-US";
    var files = [];
    var add = function (p, v) { if (v !== undefined && v !== null && v !== "") files.push({ path: p, content: v }); };
    var ios = "fastlane/metadata/" + locale;
    add(ios + "/name.txt", copy.name);
    add(ios + "/subtitle.txt", copy.subtitle);
    add(ios + "/keywords.txt", copy.keywords);
    add(ios + "/promotional_text.txt", copy.promo);
    add(ios + "/description.txt", copy.description);
    // iOS-only: no metadata/android (Google Play) tree — mirrors fastlane.ts.
    return files;
  }

  // Format the approved proposal as a ready-to-paste prompt for a coding agent
  // (Claude Code, Cursor, etc.). It lists the current listing, the proposed
  // values keyed by their EXACT fastlane/ASC field names (same mapping as
  // buildFastlaneFiles — fastlane.ts is the source of truth), and a tight
  // instruction so the agent only touches what we list. Pure, deterministic
  // formatting over CopyFields — no credentials, no network, nothing persisted.
  function buildAgentPrompt(current, proposed, locale) {
    current = current || {};
    proposed = proposed || {};
    locale = locale || "en-US";

    // field key → { label, fastlane path }. Order mirrors fastlane.ts. iOS-only.
    var FIELDS = [
      { key: "name", label: "App name", ios: "name.txt" },
      { key: "subtitle", label: "Subtitle", ios: "subtitle.txt" },
      { key: "keywords", label: "Keywords", ios: "keywords.txt" },
      { key: "promo", label: "Promotional text", ios: "promotional_text.txt" },
      { key: "description", label: "Description", ios: "description.txt" },
    ];
    var isSet = function (v) { return v !== undefined && v !== null && String(v).trim() !== ""; };
    var iosDir = "fastlane/metadata/" + locale;

    var lines = [];
    lines.push("Update my fastlane metadata files accordingly; change nothing not listed.");
    lines.push("");
    lines.push("These are App Store listing fields. For each field below, write the");
    lines.push("PROPOSED value verbatim into the named fastlane file (overwrite its contents). Do not");
    lines.push("touch any file not named here. Do not reformat, trim, or re-wrap the values.");
    lines.push("");

    // ── current listing ──
    lines.push("## Current listing");
    FIELDS.forEach(function (f) {
      var cur = isSet(current[f.key]) ? String(current[f.key]) : "(empty)";
      lines.push("- " + f.label + ": " + cur);
    });
    lines.push("");

    // ── proposed changes, keyed by exact field names ──
    lines.push("## Proposed metadata (only these fields change)");
    var changed = 0;
    FIELDS.forEach(function (f) {
      if (!isSet(proposed[f.key])) return; // a field we didn't propose → leave it alone (#30/#29)
      changed++;
      var paths = [iosDir + "/" + f.ios];
      lines.push("");
      lines.push("### " + f.label);
      lines.push("- fastlane file: " + paths.join(", "));
      lines.push("- value:");
      lines.push(String(proposed[f.key]));
    });
    if (changed === 0) {
      lines.push("");
      lines.push("(No fields proposed — nothing to change.)");
    }
    lines.push("");
    lines.push("Note: the keywords field (App Store Connect \"Keywords\") is a single");
    lines.push("comma-separated list with NO spaces after commas — keep it exactly as given.");

    return lines.join("\n");
  }

  function decide(runId, action, card, clicked, run, R, edit) {
    // Disable both buttons, but show in-flight feedback on the one clicked so the
    // action never reads as a frozen UI (the busy-cursor-with-no-activity bug).
    var btns = card.querySelectorAll("button"); btns.forEach(function (b) { b.disabled = true; });
    var label = clicked && clicked.textContent;
    if (clicked) clicked.innerHTML = '<span class="spin"></span> ' + (action === "approve" ? "Approving…" : "Rejecting…");
    // On approve, send the human edit buffer so the edited copy is what ships.
    // The server re-validates with the engine's validateCopy and is authoritative;
    // an invalid edit returns 400 and no gate row is written.
    var body = action === "approve"
      ? { decision: "approve", editedCopy: (edit && edit.buffer) || {} }
      : { decision: "reject" };
    api("POST", "/runs/" + runId + "/" + action, body)
      .then(function (res) {
        toast(action === "approve" ? "Approved — commands revealed." : "Rejected — nothing pushed.");
        // The server returns the FINALIZED (edited) copy + re-derived commands on
        // approval — fold them into R so the handoff panels render what actually
        // ships, not the agent's original proposal.
        if (action === "approve" && res) {
          if (res.proposedCopy) R.proposedCopy = res.proposedCopy;
          if (res.pushCommands) R.pushCommands = res.pushCommands;
        }
        // Update the gate card IN PLACE rather than re-routing. A full route()
        // re-render scrolled the page to the top AND wiped any in-progress input
        // (e.g. a half-entered .p8 in the push panel) — a bad experience right at
        // the approval moment. We have run + R already, so rebuild just this card
        // with the new status and swap it, preserving scroll position.
        if (run && R && card.parentNode) {
          run.status = action === "approve" ? "approved" : "rejected";
          var fresh = gateCard(run, R, edit);
          card.parentNode.replaceChild(fresh, card);
          // Keep the header status badge in sync (it lives outside the gate card).
          var badge = document.querySelector("#view .badge");
          if (badge) { var nb = statusBadge(run.status); badge.parentNode.replaceChild(nb, badge); }
        } else {
          route(); // fallback (older callers without run/R) — keeps behavior safe
        }
      })
      .catch(function (e) { btns.forEach(function (b) { b.disabled = false; }); if (clicked && label) clicked.textContent = label; toast(e.message || "Failed"); });
  }

  /* ════════════════════════ rank sparkline (inline SVG) ════════════════════ */
  // #62: `annotations` (optional) overlays observed-change markers on the
  // trajectory — ▲ your approved pushes, ◆ competitor VISIBLE changes. Markers
  // outside the charted window are skipped (never squeezed in dishonestly).
  function sparkline(points, annotations) {
    var W = 600, H = 140, pad = 24;
    if (!points.length) return el("div", { class: "faint" }, ["No rank history yet."]);
    var ranks = points.map(function (p) { return p.rank == null ? 200 : p.rank; });
    var minR = Math.min.apply(null, ranks), maxR = Math.max.apply(null, ranks);
    var lo = Math.max(1, minR - 3), hi = maxR + 3;
    // rank is inverted: rank 1 at top
    function x(i) { return pad + (i / (points.length - 1)) * (W - pad * 2); }
    function y(r) { return pad + ((r - lo) / (hi - lo || 1)) * (H - pad * 2); }
    var dLine = points.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + "," + y(p.rank == null ? 200 : p.rank).toFixed(1); }).join(" ");
    var dArea = dLine + " L" + x(points.length - 1).toFixed(1) + "," + (H - pad) + " L" + x(0).toFixed(1) + "," + (H - pad) + " Z";

    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "spark"); svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("preserveAspectRatio", "none");
    svg.innerHTML =
      '<defs><linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#34d399" stop-opacity="0.35"/>' +
      '<stop offset="100%" stop-color="#34d399" stop-opacity="0"/></linearGradient></defs>' +
      '<line class="axis" x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) + '" y2="' + (H - pad) + '"/>' +
      '<path class="area" d="' + dArea + '"/>' +
      '<path class="line" d="' + dLine + '"/>';
    // endpoint dot + labels
    points.forEach(function (p, i) {
      if (i !== 0 && i !== points.length - 1) return;
      var cx = x(i), cy = y(p.rank == null ? 200 : p.rank);
      var dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("class", "dot"); dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("r", "3.5");
      svg.appendChild(dot);
      var lbl = document.createElementNS(svgNS, "text");
      lbl.setAttribute("class", "lbl"); lbl.setAttribute("x", i === 0 ? cx + 4 : cx - 4); lbl.setAttribute("y", cy - 8);
      lbl.setAttribute("text-anchor", i === 0 ? "start" : "end");
      lbl.textContent = "#" + (p.rank == null ? "200+" : p.rank);
      svg.appendChild(lbl);
    });

    // #62: annotation markers — a dashed vertical at the observed-change time,
    // with a glyph on top and a hover <title> carrying the honest label. The
    // x-position interpolates by DATE between charted snapshots; anything
    // outside the window is skipped.
    var t0 = Date.parse(points[0].checked_at);
    var t1 = Date.parse(points[points.length - 1].checked_at);
    (annotations || []).forEach(function (a) {
      var t = Date.parse(a.at);
      if (isNaN(t) || isNaN(t0) || isNaN(t1) || t1 <= t0 || t < t0 || t > t1) return;
      var ax = pad + ((t - t0) / (t1 - t0)) * (W - pad * 2);
      var g = document.createElementNS(svgNS, "g");
      g.setAttribute("class", "anno anno-" + a.kind);
      var line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", ax); line.setAttribute("x2", ax);
      line.setAttribute("y1", pad - 6); line.setAttribute("y2", H - pad);
      line.setAttribute("class", "anno-line");
      g.appendChild(line);
      var glyph = document.createElementNS(svgNS, "text");
      glyph.setAttribute("class", "anno-glyph");
      glyph.setAttribute("x", ax); glyph.setAttribute("y", pad - 9);
      glyph.setAttribute("text-anchor", "middle");
      glyph.textContent = a.kind === "push" ? "▲" : "◆";
      g.appendChild(glyph);
      var tip = document.createElementNS(svgNS, "title");
      tip.textContent = a.label + " · " + a.at.slice(0, 10);
      g.appendChild(tip);
      svg.appendChild(g);
    });
    return svg;
  }

  /* ════════════════════════ chrome ════════════════════════════════════════ */
  function backlink(hash, label) { return el("div", { class: "backlink", onclick: function () { go(hash); } }, ["← " + label]); }
  function errorBox(e) {
    clear(root());
    root().appendChild(el("div", { class: "empty" }, [el("div", { class: "big" }, ["⚠️"]), el("div", {}, [e.message || "Something went wrong"]), e.status ? el("div", { class: "faint" }, ["HTTP " + e.status]) : null]));
  }

  /* ════════════════════════ login ═════════════════════════════════════════ */
  // The magic-link sign-in screen. Shown when there's a live backend and no
  // session. Posts to /auth/request; the emailed link's callback sets the cookie
  // and redirects back here, after which /auth/me reports the session.
  function loginView(ctx) {
    ctx = ctx || {};
    var c = root(); clear(c);
    var input, btn;
    function submit(ev) {
      ev.preventDefault();
      var e = input.value.trim();
      if (!e || e.indexOf("@") < 0) { toast("Enter your email"); input.focus(); return; }
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Sending…';
      fetch(API_BASE + "/auth/request", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: e }),
      }).then(function () {
        clear(c);
        c.appendChild(el("div", { class: "card", style: "max-width:440px;margin:64px auto;text-align:center" }, [
          el("h2", {}, ["Check your email"]),
          el("p", { class: "faint" }, ["If " + e + " has access, a sign-in link is on its way. Click it to continue — the link expires in 15 minutes."]),
        ]));
      }).catch(function () {
        btn.disabled = false; btn.textContent = "Send sign-in link";
        toast("Couldn't reach the server — try again.");
      });
    }
    input = el("input", { class: "txt", type: "email", placeholder: "you@example.com", autocomplete: "email", spellcheck: "false" });
    btn = el("button", { class: "btn primary", type: "submit" }, ["Send sign-in link"]);
    var card = el("div", { class: "card", style: "max-width:440px;margin:64px auto" }, [
      el("h2", {}, [ctx.heading || "Sign in to ShipASO"]),
      el("p", { class: "faint", style: "margin-top:0" }, [ctx.sub || "Passwordless — we email you a one-time sign-in link."]),
      ctx.backTo ? el("div", { class: "backlink", onclick: function () { previewView(); } }, ["← back to preview"]) : null,
      el("form", { onsubmit: submit }, [
        el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Email"]), input]),
        el("div", { class: "btn-row", style: "margin-top:10px" }, [btn]),
      ]),
    ]);
    c.appendChild(card);
  }

  /* ═══════════════════ try-before-signup (logged-out preview) ═══════════════ */
  function previewView() {
    var c = root(); clear(c);
    var queryInput, results, submitBtn;

    // Render a candidate picker from the first /preview response `r`
    // ({ candidates, hasMore, offset, query }). Later pages stream in via a
    // paginator that BOTH a "Show more" button and a scroll sentinel drive — so a
    // lower-ranked app under a generic term ("Mangia - Recipe Manager" under
    // "Mangia") is reachable by scrolling, not just an exact name.
    function appendCandidateRows(cands) {
      cands.forEach(function (c2) {
        var meta = [c2.publisher, (c2.genres && c2.genres.length ? c2.genres[0] : null)].filter(Boolean).join(" · ");
        results.appendChild(el("div", { class: "card appcard", style: "padding:10px 12px;margin-bottom:6px", onclick: function () { runPreview({ bundle_id: c2.bundle_id }, c2.name); } }, [
          el("div", { class: "row1" }, [
            c2.icon_url ? el("img", { src: c2.icon_url, width: "28", height: "28", style: "border-radius:6px;margin-right:8px;vertical-align:middle" }) : null,
            el("span", { class: "name" }, [c2.name || c2.bundle_id]),
          ]),
          el("div", { class: "bundle" }, [c2.bundle_id + (meta ? "  ·  " + meta : "")]),
        ]));
      });
    }

    function showCandidates(r, term) {
      clear(results);
      var cands = (r && r.candidates) || [];
      if (!cands.length) {
        results.appendChild(el("div", { class: "faint", style: "font-size:12.5px" }, ["No apps found. Try a different name, an App Store / Play link, or a bundle id."]));
        return;
      }
      results.appendChild(el("div", { class: "faint", style: "font-size:12.5px;margin:2px 0 6px" }, [cands.length === 1 ? "Found it — click to preview:" : "Pick your app:"]));
      appendCandidateRows(cands);
      attachPager(results, term, r, function (nextOffset) {
        return fetch(API_BASE + "/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: term, offset: nextOffset }) }).then(function (x) { return x.json(); });
      }, appendCandidateRows, function () { if (queryInput) queryInput.focus(); });
    }

    function runPreview(payload, displayName) {
      clear(results);
      results.appendChild(el("div", { class: "empty", style: "padding:24px" }, [el("span", { class: "spin" }), " Auditing " + (displayName || "the app") + " on live data…"]));
      fetch(API_BASE + "/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (r.needsChoice) { showCandidates(r, payload.query); return; }
          if (!r.preview) { clear(results); results.appendChild(el("div", { class: "faint" }, [r.error || "Couldn't preview that app."])); return; }
          showPreviewResult(r.preview, displayName, r.bundleId);
        })
        .catch(function () { clear(results); results.appendChild(el("div", { class: "faint" }, ["Couldn't reach the server — try again."])); });
    }

    function showPreviewResult(p, displayName, bundleId) {
      clear(results);
      var grade = p.auditGrade || "—";
      var lead = p.leadRank != null ? ("#" + p.leadRank + " for “" + p.leadKeyword + "”") : "not in the top 200 yet";
      var card = el("div", { class: "card", style: "border-color:var(--signal-dim)" }, [
        el("div", { class: "row1", style: "margin-bottom:12px" }, [
          el("span", { class: "name", style: "font-size:18px" }, [p.appName || displayName || "Your app"]),
          el("span", { class: "tip", tabindex: "0", style: "margin-left:auto;display:inline-flex;align-items:center" }, [
            el("span", { class: "grade " + grade }, [grade]),
            el("span", { class: "tip-q" }, ["?"]),
            el("div", { class: "tip-body", html: "<b>Listing audit grade (A–F).</b> How well your App Store listing is set up to convert — scored from your screenshot set (count, captions, polish). <b>" + (grade === "—" ? "Not graded yet." : grade + "</b> = " + gradeMeaning(grade) + ".") }),
          ]),
        ]),
        el("div", { class: "meta", style: "display:flex;gap:22px;margin-bottom:14px" }, [
          el("div", {}, [el("div", { class: "k" }, ["LEAD RANK"]), el("div", { class: "v" }, [lead])]),
          el("div", {}, [el("div", { class: "k" }, ["KEYWORDS"]), el("div", { class: "v" }, [String(p.keywordsChecked)])]),
          el("div", {}, [el("div", { class: "k" }, ["IN TOP 10"]), el("div", { class: "v" }, [p.inTop10 + " / " + p.keywordsChecked])]),
        ]),
        el("div", { class: "locked", style: "margin:6px 0 16px" }, [
          el("span", { class: "lock" }, ["🔒"]),
          "Your optimized title, subtitle & keyword field — plus the exact push commands — are ready. Sign up to connect this app and run the full agent.",
        ]),
        el("button", { class: "btn primary", style: "width:100%;justify-content:center", onclick: function () {
          // Carry the previewed app THROUGH signup so we auto-connect it after
          // the magic-link round-trip — the gate promised "we connect the app".
          if (bundleId) {
            try { localStorage.setItem("store-ops:pendingApp", JSON.stringify({ bundle_id: bundleId, name: p.appName || displayName || "" })); } catch (e) {}
          }
          loginView({ heading: "Sign up to connect " + (p.appName || "your app"), sub: "We email you a one-time link. Then we connect the app, run the full agent, and prepare the push — you approve it.", backTo: true });
        } }, ["Connect & run the agent →"]),
      ]);
      results.appendChild(card);
    }

    // The actual search → render. Shared by auto-search (debounced) and the
    // Preview button / Enter (immediate). Resolves so the controller's race
    // guard can drop a stale response before it touches the DOM.
    function runSearch(q) {
      submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spin"></span> Searching…';
      return fetch(API_BASE + "/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })
        .then(function (r) { return r.json(); })
        .then(function (r) { return { ok: true, q: q, r: r }; })
        .catch(function () { return { ok: false, q: q }; });
    }
    function renderSearch(res) {
      submitBtn.disabled = false; submitBtn.textContent = "Preview";
      if (!res.ok) { toast("Search failed — try again."); return; }
      var r = res.r, q = res.q;
      if (r.needsChoice) { showCandidates(r, q); return; }
      if (r.preview) { showPreviewResult(r.preview, q, r.bundleId); return; }
      showCandidates(r, q);
    }

    var search = createSearchController({
      minChars: 3,
      delayMs: 280,
      fetcher: runSearch,
      onResult: renderSearch,
    });
    search.onClear(function () { clear(results); submitBtn.disabled = false; submitBtn.textContent = "Preview"; });

    function submit(ev) {
      ev.preventDefault();
      var q = queryInput.value.trim();
      if (!q) { toast("Enter an app name, link, or bundle id"); queryInput.focus(); return; }
      // Keep the controller's value in sync, then fire immediately (no debounce).
      search.input(queryInput.value);
      search.submit();
    }

    queryInput = el("input", { class: "txt", placeholder: "App name, App Store / Play link, or bundle id", autocomplete: "off", oninput: function () { search.input(queryInput.value); } });
    submitBtn = el("button", { class: "btn primary", type: "submit" }, ["Preview"]);
    results = el("div", { style: "margin-top:12px" });

    c.appendChild(el("div", { class: "agentline", style: "margin-top:26px" }, [
      el("span", { class: "live-dot" }), null,
      el("span", { html: "Try it free — <b style='color:var(--txt)'>paste your app, get a real audit + rank baseline.</b> No account needed to look." }),
    ]));
    c.appendChild(el("div", { class: "card" }, [
      el("h2", { style: "margin-top:4px", html: "See where your app <em>really</em> ranks" }),
      el("p", { class: "lead" }, ["Paste your app — ShipASO audits the live listing and checks your organic rank on real iTunes data. Free, no sign-up to preview."]),
      el("form", { onsubmit: submit }, [
        el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Your app"]), queryInput]),
        el("div", { class: "btn-row" }, [submitBtn]),
      ]),
      results,
    ]));
  }

  /* ════════════════════════ router ════════════════════════════════════════ */
  // ── #/settings — the settings page (comms-prefs Phase 3). ──────────────────
  // Communications block: digest on/off + rank-check cadence + an honest
  // read-only push line (web has no push — no fake toggle). Copy states the
  // honesty rule verbatim: prefs change what we SEND, never what the agent does.
  async function viewSettings() {
    loading("Loading settings…");
    var me;
    try { me = await api("GET", "/auth/me"); } catch (e) { return errorBox(e); }
    var c = root(); clear(c);
    c.appendChild(backlink("#/", "Back to dashboard"));
    c.appendChild(el("h2", {}, ["Settings"]));
    c.appendChild(commsSettingsCard(me));
  }

  function commsSettingsCard(me) {
    var card = el("div", { class: "card" }, [el("h3", {}, ["Communications"])]);

    // Weekly digest toggle — reconcile from the server response; a failed POST
    // restores the visible state (no lying UI).
    var digestOn = (me.email_digest || "weekly") === "weekly";
    var digestBtn = el("button", { class: "btn ghost", id: "digestToggle" }, [digestOn ? "On" : "Off"]);
    digestBtn.onclick = function () {
      var next = digestOn ? "off" : "weekly";
      digestBtn.disabled = true;
      api("POST", "/account/notifications", { email_digest: next })
        .then(function (r) {
          digestOn = (r.email_digest || "weekly") === "weekly";
          digestBtn.textContent = digestOn ? "On" : "Off";
        })
        .catch(function (e) { toast(e.message || "Couldn't update the digest setting."); })
        .then(function () { digestBtn.disabled = false; });
    };
    card.appendChild(el("div", { class: "settings-row", style: "display:flex;gap:12px;align-items:center;justify-content:space-between;margin-top:10px" }, [
      el("div", {}, [
        el("div", {}, ["Weekly digest email"]),
        el("div", { class: "faint", style: "font-size:12px" }, ["Stops the weekly digest email for every app on this account — the agent keeps working and runs keep opening."]),
      ]),
      digestBtn,
    ]));

    // Rank-check cadence — labeled as what it IS (data collection frequency).
    var cadence = me.rank_cadence || "weekly";
    var weeklyBtn = el("button", { class: "btn ghost", id: "cadenceWeekly" }, ["Weekly"]);
    var dailyBtn = el("button", { class: "btn ghost", id: "cadenceDaily" }, ["Daily"]);
    function paintCadence() {
      weeklyBtn.style.opacity = cadence === "weekly" ? "1" : "0.5";
      dailyBtn.style.opacity = cadence === "daily" ? "1" : "0.5";
    }
    function setCadence(next) {
      if (next === cadence) return;
      weeklyBtn.disabled = dailyBtn.disabled = true;
      api("POST", "/account/rank-cadence", { cadence: next })
        .then(function (r) { cadence = r.rank_cadence || cadence; paintCadence(); })
        .catch(function (e) { toast(e.message || "Couldn't update the cadence."); paintCadence(); })
        .then(function () { weeklyBtn.disabled = dailyBtn.disabled = false; });
    }
    weeklyBtn.onclick = function () { setCadence("weekly"); };
    dailyBtn.onclick = function () { setCadence("daily"); };
    paintCadence();
    card.appendChild(el("div", { class: "settings-row", style: "display:flex;gap:12px;align-items:center;justify-content:space-between;margin-top:14px" }, [
      el("div", {}, [
        el("div", {}, ["Rank checks"]),
        el("div", { class: "faint", style: "font-size:12px" }, ["How often we snapshot your keyword ranks. This is data collection — not email frequency."]),
      ]),
      el("span", { style: "display:flex;gap:6px" }, [weeklyBtn, dailyBtn]),
    ]));

    // Push — informational only; the web can't honor a toggle it doesn't have.
    card.appendChild(el("div", { class: "settings-row", style: "margin-top:14px" }, [
      el("div", {}, ["Run-ready push"]),
      el("div", { class: "faint", style: "font-size:12px" }, ["Managed in the mobile app."]),
    ]));

    return card;
  }

  function route() {
    // Logged-out + live backend → the try-before-signup preview (NOT a cold
    // login wall). Signup is gated at "Connect & run", after they've seen value.
    if (API_BASE && session && session.authed === false) return previewView();
    var h = location.hash.replace(/^#/, "") || "/";
    var m;
    // #/apps/:id (optionally ?asc=1 → scroll to + flash the ASC run panel, PRD 04).
    if ((m = h.match(/^\/apps\/([^/?]+)(?:\?(.*))?$/))) { ascCredsMemory = null; return viewApp(m[1], parseQuery(m[2])); }
    if ((m = h.match(/^\/runs\/([^/]+)$/))) return viewRun(m[1]);
    if (h === "/settings") { ascCredsMemory = null; return viewSettings(); }
    ascCredsMemory = null; // leaving the read→run→push flow → drop the in-memory key
    return viewDashboard();
  }

  window.addEventListener("hashchange", route);
  window.addEventListener("DOMContentLoaded", function () {
    document.getElementById("logo").addEventListener("click", function () { go("#/"); });
    // wire the demo "acting as" field. Typing an email opts into the demo path
    // (only works when the backend runs APP_ENV=demo); clearing it logs out of
    // demo and falls back to the real login screen. Empty by default — we never
    // silently act as a demo user.
    var input = document.getElementById("emailInput");
    if (input) {
      input.value = explicitDemoEmail() || "";
      input.placeholder = "demo: act as…";
      input.addEventListener("change", function () {
        var v = input.value.trim();
        if (v) localStorage.setItem("store-ops:email", v);
        else localStorage.removeItem("store-ops:email");
        loadSession().then(function () { applyAuthHeader(); setEnvPill(); route(); });
      });
    }
    // Load the session FIRST, then render — so a logged-out visitor sees login,
    // not a flash of the app acting as the demo user.
    loadSession().then(function () {
      if (input) input.value = explicitDemoEmail() || "";
      applyAuthHeader();
      setEnvPill();
      // Just signed in from the preview gate? Auto-connect the app they previewed
      // (the gate promised "we connect the app") and drop them into the run.
      if (session && session.authed === true) {
        var pending = takePendingApp();
        if (pending && pending.bundle_id) return connectPendingApp(pending);
      }
      route();
    });
    // SPA freshness (#54): nudge a long-open tab to reload after a deploy. Gated
    // prod-only (API_BASE + hashed bundle) inside startFreshnessChecks → inert
    // in local/demo/E2E by default.
    startFreshnessChecks();
  });

  // Pull + clear the pending-app intent stashed at the preview gate.
  function takePendingApp() {
    try {
      var raw = localStorage.getItem("store-ops:pendingApp");
      if (!raw) return null;
      localStorage.removeItem("store-ops:pendingApp");
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  // Auto-connect + run the previewed app right after signup, then land on its run.
  function connectPendingApp(pending) {
    loading("Connecting " + (pending.name || "your app") + " — running the full agent…");
    api("POST", "/apps", { bundle_id: pending.bundle_id, name: pending.name })
      .then(function (r) {
        toast("Connected — running the agent…");
        return api("POST", "/apps/" + r.id + "/run").then(function () { go("#/apps/" + r.id); route(); });
      })
      .catch(function (e) {
        // Fall back to the dashboard; the connect card is right there.
        toast(e.message || "Couldn't auto-connect — connect it below.");
        go("#/"); route();
      });
  }

  // RLHF opt-out toggle (#39 Part 2). Capture is ON by default; this lets a
  // signed-in user opt OUT. Mirrors the agent-pause toggle pattern: read the live
  // state from /auth/me (session.rlhf_opt_out), POST the flip, reflect it back.
  // The disclosure line states the honest, anonymized + encrypted design.
  function privacyToggle() {
    var optedOut = !!(session && session.rlhf_opt_out);
    var wrap = el("span", { id: "rlhfToggle", style: "display:flex;gap:6px;align-items:center" });
    var link = el("a", {
      href: "#", id: "rlhfToggleLink",
      title: "We use anonymized, encrypted edits to improve ShipASO's suggestions. No account or app identifiers are stored. Toggle off to opt out.",
      style: "color:inherit;text-decoration:underline;cursor:pointer",
    }, [optedOut ? "Improve ShipASO: off" : "Improve ShipASO: on"]);
    // When the session object didn't carry the flag (e.g. demo/local boot), pull
    // the live value from the backend so the label reflects persisted state.
    if (!(session && typeof session.rlhf_opt_out === "boolean")) {
      api("GET", "/auth/me").then(function (me) {
        if (me && typeof me.rlhf_opt_out === "boolean") {
          optedOut = me.rlhf_opt_out;
          if (session) session.rlhf_opt_out = optedOut;
          link.textContent = optedOut ? "Improve ShipASO: off" : "Improve ShipASO: on";
        }
      }).catch(function () {});
    }
    link.onclick = function (e) {
      e.preventDefault();
      var next = !optedOut; // next opt-OUT state
      link.style.pointerEvents = "none";
      api("POST", "/account/rlhf-optout", { optOut: next })
        .then(function (out) {
          var v = !!out.rlhf_opt_out;
          if (session) session.rlhf_opt_out = v;
          link.textContent = v ? "Improve ShipASO: off" : "Improve ShipASO: on";
          toast(v
            ? "Opted out — your edits won't be used to improve ShipASO."
            : "Thanks — anonymized, encrypted edits help improve ShipASO.");
        })
        .catch(function () { toast("Couldn't update that — try again."); })
        .finally(function () { link.style.pointerEvents = ""; applyAuthHeader(); });
    };
    wrap.appendChild(link);
    return wrap;
  }

  // Reflect auth state in the header (see headerState):
  //   signedIn → email + Sign out (apps auto-load); hide the demo stub + label
  //   signIn   → a "Sign in" button (→ magic link); hide the demo stub + label
  //   demoStub → keep the editable "acting as…" field (local/demo only)
  /** Header link to the settings page (comms-prefs Phase 3). */
  function settingsLink() {
    return el("a", { id: "settingsLink", href: "#/settings", style: "color:inherit;text-decoration:underline;cursor:pointer", onclick: function (e) {
      e.preventDefault(); go("#/settings");
    } }, ["Settings"]);
  }

  function applyAuthHeader() {
    var who = document.querySelector(".who");
    if (!who) return;
    var input = document.getElementById("emailInput");
    var label = who.querySelector(".faint"); // the static "acting as" caption
    var st = headerState();

    // Tear down any prior injected control.
    var existing = document.getElementById("authState");
    if (existing) existing.remove();

    if (st.mode === "demoStub") {
      if (input) input.style.display = "";
      if (label) { label.style.display = ""; label.textContent = "acting as"; }
      // Surface the RLHF opt-out toggle in local/demo dev too (it routes through
      // the mock backend), so the privacy control is exercisable end-to-end.
      var demoSpan = el("span", { id: "authState", class: "faint", style: "display:flex;gap:8px;align-items:center" }, [
        settingsLink(),
        privacyToggle(),
      ]);
      who.insertBefore(demoSpan, document.getElementById("envpill"));
      return;
    }

    // Live backend: the editable stub never shows (it can't auth on prod).
    if (input) input.style.display = "none";
    if (label) label.style.display = "none";

    if (st.mode === "signedIn") {
      var span = el("span", { id: "authState", class: "faint", style: "display:flex;gap:8px;align-items:center" }, [
        el("span", {}, [st.email || ""]),
        settingsLink(),
        privacyToggle(),
        el("a", { href: "#", style: "color:inherit;text-decoration:underline;cursor:pointer", onclick: function (e) {
          e.preventDefault();
          fetch(API_BASE + "/auth/logout", { method: "POST", credentials: "include" })
            .then(function () { session = { authed: false }; applyAuthHeader(); route(); });
        } }, ["Sign out"]),
      ]);
      who.insertBefore(span, document.getElementById("envpill"));
      return;
    }

    // signIn: a real "Sign in" button → the magic-link login screen.
    var btn = el("button", { id: "authState", class: "btn ghost", style: "padding:5px 12px;font-size:13px", onclick: function () {
      loginView({ heading: "Sign in", sub: "We email you a one-time link — no password. Then your connected apps load automatically." });
    } }, ["Sign in"]);
    who.insertBefore(btn, document.getElementById("envpill"));
  }
})();
