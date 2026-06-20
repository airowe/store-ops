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
    if (!API_BASE) { session = { authed: true, via: "demo", email: email() }; return session; }
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

  // Wire pagination onto a freshly-rendered candidate picker: a paginator + a
  // scroll sentinel (IntersectionObserver) + a "Show more" button, both calling
  // the same loadMore() (the paginator guards against double-fetch). `fetchNext`
  // returns the raw next-page response ({candidates,hasMore,offset}); `renderRows`
  // appends its candidates as picker rows. Shared by the logged-out preview and
  // the authenticated connect pickers.
  function attachPager(container, term, first, fetchNext, renderRows) {
    var oldPager = container.querySelector(".pager");
    if (oldPager) oldPager.remove();
    if (!(first && first.hasMore && term)) {
      if (((first && first.candidates) || []).length > 1) {
        container.appendChild(el("div", { class: "pager faint", style: "font-size:12px;margin-top:6px" }, ["That's everything matching — refine the name if your app isn't here."]));
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
        else { if (io) io.disconnect(); moreBtn.remove(); sentinel.remove(); container.appendChild(el("div", { class: "pager faint", style: "font-size:12px;margin-top:6px" }, ["That's everything matching — refine the name if your app isn't here."])); }
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

    // The next tier up from where they are (free→launch→autopilot→fleet).
    var NEXT_TIER = { current: "launch", free: "launch", launch: "autopilot", autopilot: "fleet", fleet: "fleet" };
    var targetTier = NEXT_TIER[info.tier] || "launch";
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
  // NOTE: the `shipped` enum is set on APPROVAL, before any push to App Store
  // Connect — so the label must NOT claim "Shipped" (nothing has reached Apple
  // yet). It reads "Approved · ready to push" until a real verified push exists.
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

  /* ════════════════════════ VIEW: dashboard ════════════════════════════════ */
  async function viewDashboard() {
    loading("Loading your apps…");
    var data;
    try { data = await api("GET", "/apps"); } catch (e) { return errorBox(e); }
    var apps = data.apps || [];

    var c = root(); clear(c);

    // agent status line
    c.appendChild(el("div", { class: "agentline" }, [
      el("span", { class: "live-dot" }), null,
      el("span", { html: "Autonomous agent <b style='color:var(--txt)'>active</b> — re-checks ranks &amp; watches competitors every Monday 09:00 UTC. It prepares every move; <b style='color:var(--txt)'>you approve the push.</b>" }),
    ]));

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

    // Connect a chosen app by exact bundle id, then run the first audit.
    function connect(bundleId, displayName) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spin"></span> Connecting…';
      api("POST", "/apps", { bundle_id: bundleId, name: displayName })
        .then(function (r) {
          toast("App connected — running first audit…");
          return api("POST", "/apps/" + r.id + "/run").then(function () { go("#/"); viewDashboard(); });
        })
        .catch(function (e) {
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
      }, appendCandidateRows);
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
    var card = el("div", { class: "card appcard", onclick: function () { go("#/apps/" + a.id); } }, [
      row1,
      el("div", { class: "bundle" }, [a.bundle_id]),
      el("div", { class: "meta" }, [
        el("div", {}, [el("div", { class: "k" }, ["Latest run"]), el("div", { class: "v", style: "font-size:13px" }, [run ? statusBadge(run.status) : el("span", { class: "faint" }, ["—"])])]),
        el("div", {}, [el("div", { class: "k" }, ["Lead rank"]), el("div", { class: "v" }, [rs ? rankText(rs.lead_rank) : "—"])]),
        el("div", {}, [el("div", { class: "k" }, ["Top-10 kw"]), el("div", { class: "v" }, [rs ? String(rs.top10) + "/" + rs.tracked : "—"])]),
      ]),
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

    // rank trend mini-chart
    c.appendChild(el("div", { class: "card" }, [
      el("h3", {}, ["Rank trend — “" + esc(ranks.keyword) + "”"]),
      sparkline(ranks.points || []),
      el("div", { class: "faint", style: "font-size:12px;margin-top:8px" }, ["Lower is better. 8-week organic position from the iTunes Search API."]),
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
            el("button", { class: "btn ghost", onclick: function () { go(backHash || "#/"); } }, ["← Back"]),
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

  function triggerRun(appId, btn) {
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Agent running…';
    var inter = runInterstitial(RUN_STEPS);
    api("POST", "/apps/" + appId + "/run")
      .then(function (r) { inter.settle(); toast("Agent finished — review the proposal."); go("#/runs/" + r.id); })
      .catch(function (e) { btn.disabled = false; btn.textContent = "▶ Run agent now"; inter.fail(e.message || "The agent run failed.", function () { triggerRun(appId, btn); }, "#/apps/" + appId); });
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
    var issuer = el("input", { class: "txt mono", type: "text", placeholder: "Issuer ID (UUID)", autocomplete: "off", spellcheck: "false" });
    var keyId = el("input", { class: "txt mono", type: "text", placeholder: "Key ID (e.g. ABC123DEFG)", autocomplete: "off", spellcheck: "false" });
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
      .then(function (r) { inter.settle(); toast("Read your live listing — review the proposal."); go("#/runs/" + r.id); })
      .catch(function (e) { btn.disabled = false; btn.textContent = "▶ Run with ASC read"; inter.fail(e.message || "The App Store Connect run failed.", function () { triggerRunAsc(appId, btn, creds); }, "#/apps/" + appId); });
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
    c.appendChild(el("p", { class: "lead" }, ["The agent ran the full ASO loop on real data and prepared the change below. Read its reasoning, then approve or reject. Approving reveals the exact commands — we never run them for you."]));

    // 1) THE LISTING AUDIT — the findings, instructive first. Explains *why* the
    //    proposed changes below, so it reads first: audit → diff → reasoning → gate.
    c.appendChild(listingAuditCard(R, run.app_id));

    // 1b) EXPAND TO MORE MARKETS — PRD 04 localization expansion. Renders directly
    //     below the findings card when the run computed locale recommendations
    //     (a Mode-A/ASC run); the locale_single finding above is the headline, this
    //     is the workbench. Absent → nothing renders.
    var locCard = localizationExpansionCard(R, run.app_id);
    if (locCard) c.appendChild(locCard);

    // 2) THE DIFF — lead with current → proposed, like a PR review (devs).
    c.appendChild(diffCard(R.currentCopy || {}, R.proposedCopy || {}));

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
    c.appendChild(keywordCard(R.reasoning || []));

    // 5) THE APPROVAL GATE + commands
    c.appendChild(gateCard(run, R));
  }

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

  // A finding's "fix path" — so no finding is a dead end. Returns DOM children
  // (links/notes) for findings that have an actionable external path, or null.
  // Curated, honest: real tools we'd recommend + the exact App Store Connect spot.
  function fixLinkFor(id) {
    var ASC = "https://appstoreconnect.apple.com";
    var SHOTS_SKILL = "https://github.com/ParthJadhav/app-store-screenshots";
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

  function listingAuditCard(R, appId) {
    var findings = R.findings || [];
    var summary = R.findingsSummary || null;

    var head = el("div", { class: "audit-head" }, [
      el("h3", { style: "margin:0" }, ["Listing audit"]),
      el("span", { class: "audit-summary" }, [summary ? summary.label : (findings.length + " finding" + (findings.length === 1 ? "" : "s"))]),
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
    // Metadata coverage gauge (PRD 03) — a budget-efficiency read, ABOVE the
    // findings. Separate visual section; the findings card logic is untouched.
    var cov = coverageSection(R.coverage);
    if (cov) children.push(cov);
    children.push(body);
    // No-key run → render the unlock CTA below the findings (PRD 04). Driven by the
    // asc_unlock finding (data hook from PRD 01); absent on key-bearing runs.
    var unlock = findings.filter(function (f) { return f.id === "asc_unlock"; })[0];
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
  function coverageSection(cov) {
    if (!cov || typeof cov.coverageScore !== "number") return null;
    var score = Math.round(cov.coverageScore);
    var band = coverageBand(score);
    var used = cov.usedChars || { name: 0, subtitle: 0, keywords: 0 };
    var workingChars = Math.round((cov.coverageScore / 100) * 160);

    // radial gauge via conic-gradient (no SVG dep); center shows the score.
    var deg = Math.round((score / 100) * 360);
    var gauge = el("div", { class: "cov-gauge " + band.cls,
      style: "background:conic-gradient(currentColor " + deg + "deg, rgba(127,127,127,.18) " + deg + "deg)" }, [
      el("div", { class: "cov-gauge-inner" }, [
        el("span", { class: "cov-score" }, [String(score)]),
        el("span", { class: "cov-pct" }, ["%"]),
      ]),
    ]);

    var meta = el("div", { class: "cov-meta" }, [
      el("div", { class: "cov-title" }, ["Metadata coverage"]),
      el("div", { class: "cov-sub" }, [workingChars + " of 160 chars working"]),
      el("div", { class: "cov-note faint" }, [band.note]),
      el("div", { class: "cov-frame faint" }, ["A budget-efficiency heuristic — how hard your metadata works, not a rank score."]),
      el("div", { class: "cov-fields faint" }, [
        "Name " + used.name + "/30 · Subtitle " + used.subtitle + "/30 · Keywords " + used.keywords + "/100" +
        " · " + (cov.distinctTerms || 0) + " distinct term" + ((cov.distinctTerms === 1) ? "" : "s"),
      ]),
    ]);

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
      kids.push(el("div", { class: "cov-clean faint" }, ["No wasted budget — no duplicates, brand repeats, or filler detected."]));
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
    steps.push({ cls: "", ico: "◎", t: "Watched competitors", d: comp.digest || "No competitor movement detected." });
    var rsn = R.reasoning || [];
    var prim = rsn.find(function (k) { return k.bucket === "Primary"; });
    var sec = rsn.find(function (k) { return k.bucket === "Secondary"; });
    var lt = rsn.filter(function (k) { return k.bucket === "Long-tail"; }).length;
    steps.push({ cls: "", ico: "✦", t: "Scored & bucketed keywords", d: "Best term “" + (prim ? prim.keyword : "") + "” (score " + (prim ? prim.score : "?") + ") anchors the title; “" + (sec ? sec.keyword : "") + "” takes the subtitle; " + lt + " long-tail terms feed the keyword field." });
    var v = (R.proposedCopy && R.proposedCopy.validation) || {};
    steps.push({ cls: v.pass ? "ok" : "warn", ico: v.pass ? "✓" : "!", t: "Drafted copy within hard char limits", d: v.pass ? "All fields validated under Apple's limits (name 30, subtitle 30, keywords 100, promo 170). No over-limit copy emitted." : "One or more fields need attention." });
    steps.push({ cls: "warn", ico: "⏸", t: "Stopped at the approval gate", d: "Generated the asc/gplay push commands but did NOT run them. The irreversible store push is yours to approve." });

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
  function diffCard(current, proposed) {
    var order = [["name", "App name"], ["subtitle", "Subtitle"], ["keywords", "Keyword field"], ["promo", "Promotional text"]];
    // Stagger index for the text-reveal animation — counts only changed rows so
    // the proposed values ease in one after another (CSS reads it as --i).
    var revealIndex = 0;
    var rows = order.map(function (o) {
      var field = o[0], label = o[1];
      var was = current[field], now = proposed[field];
      // Skip fields the proposal didn't touch AND we have no 'before' for.
      if ((now == null || now === "") && (was == null || was === "")) return null;
      var limit = LIMITS[field];
      var changed = (was || "") !== (now || "");
      var emptyWas = was == null || was === "";
      var emptyNow = now == null || now === "";

      function side(kind, val, isEmpty) {
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

      var rowAttrs = { class: "diffrow" + (changed ? " is-changed" : " is-same") };
      if (changed) rowAttrs.style = "--i:" + revealIndex++;
      return el("div", rowAttrs, [
        el("div", { class: "dfield" }, [
          el("span", { class: "fname" }, [label]),
          el("span", { class: "dtag " + (changed ? (emptyWas ? "added" : "modified") : "unchanged") },
            [changed ? (emptyWas ? "added" : "changed") : "unchanged"]),
        ]),
        el("div", { class: "diffcols" }, [
          side("was", was, emptyWas),
          el("div", { class: "darrow" }, ["→"]),
          side("now", now, emptyNow),
        ]),
      ]);
    }).filter(Boolean);

    if (!rows.length) rows = [el("div", { class: "faint" }, ["No copy changes proposed."])];

    var changedCount = order.filter(function (o) {
      var was = current[o[0]], now = proposed[o[0]];
      return (now != null && now !== "") && ((was || "") !== (now || ""));
    }).length;

    return el("div", { class: "card" }, [
      el("div", { class: "diffhead" }, [
        el("h3", { style: "margin:0" }, ["Proposed changes"]),
        el("span", { class: "diffsummary" }, [changedCount + " field" + (changedCount === 1 ? "" : "s") + " changed"]),
      ]),
      el("p", { class: "faint", style: "margin:4px 0 14px;font-size:13px" },
        ["Your live listing on the left, the agent's proposal on the right. Review it like a PR — then approve below."]),
      el("div", { class: "difflist" }, rows),
      el("div", { class: "faint", style: "font-size:12px;margin-top:10px" }, ["Keyword field is comma-joined with no spaces and shares no words with the title/subtitle — Apple's rules, enforced in code."]),
    ]);
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
  var DRIVER_META = [
    { key: "volume", label: "Volume" },
    { key: "distance", label: "Distance" },
    { key: "competitorWeakness", label: "Weak field" },
    { key: "momentum", label: "Momentum" },
  ];

  function opportunityCard(opportunities) {
    var head = el("div", { class: "audit-head" }, [
      el("h3", { style: "margin:0" }, ["Where to push next"]),
      el("span", { class: "audit-summary" }, ["ranked by winnability, not just volume"]),
    ]);

    if (!opportunities.length) {
      return el("div", { class: "card opp-card" }, [head, el("div", { class: "faint", style: "margin-top:10px" }, [
        "No opportunities scored yet — run the agent to rank your keywords by reachability.",
      ])]);
    }

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
      list.appendChild(el("div", { class: "opp flip-in", style: "--i:" + i }, [
        el("div", { class: "opp-rowtop" }, [
          el("span", { class: "opp-kw" }, [o.keyword]),
          el("span", { class: "opp-score", title: "Opportunity score (0–100)" }, [String(Math.round(o.opportunityScore))]),
          el("span", { class: "reach-chip " + reach.cls }, [reach.label]),
        ]),
        el("div", { class: "opp-why" }, [o.why || ""]),
        bars,
      ]));
    });

    return el("div", { class: "card opp-card" }, [
      head,
      el("div", { class: "faint", style: "font-size:12px;margin:6px 0 12px" }, [
        "Winnability = volume·0.4 + distance-to-top·0.3 + competitor-weakness·0.2 + momentum·0.1. A heuristic for the most reachable next move — not a guarantee. “Now”/“Soon” terms feed the optimizer's targets.",
      ]),
      list,
    ]);
  }

  function keywordCard(reasoning) {
    var tbl = el("table", { class: "kw" }, [
      el("thead", {}, [el("tr", {}, ["Keyword", "Vol", "Diff", "Rel", "Score", "Placement"].map(function (h) { return el("th", {}, [h]); }))]),
    ]);
    var tb = el("tbody", {});
    reasoning.forEach(function (k) {
      var bcls = "bucket " + (k.bucket || "").replace(/[^A-Za-z-]/g, "");
      tb.appendChild(el("tr", {}, [
        el("td", { style: "font-weight:600" }, [k.keyword]),
        el("td", {}, [String(k.volume)]),
        el("td", {}, [String(k.difficulty)]),
        el("td", {}, [String(k.relevance)]),
        el("td", { class: "score" }, [String(k.score)]),
        el("td", {}, [el("span", { class: bcls }, [k.bucket])]),
      ]));
    });
    tbl.appendChild(tb);
    return el("div", { class: "card" }, [
      el("h3", {}, ["Keyword reasoning"]),
      el("div", { class: "faint", style: "font-size:12px;margin-bottom:10px" }, ["score = volume·0.4 + (100−difficulty)·0.3 + relevance·0.3 → Primary anchors the title, Secondary the subtitle, Long-tail the keyword field, Aspirational tracked only."]),
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

    // The selected set: start from what the seeded payload used, else all available.
    var selected = {};
    var seedNames = (initial && initial.competitors) || available;
    seedNames.forEach(function (n) { selected[n] = true; });

    var gridWrap = el("div", { class: "war-grid-wrap" });

    function renderGrid(data) {
      clear(gridWrap);
      var rows = (data && data.warRoom) || [];
      var cols = (data && data.competitors) || [];
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
      rows.forEach(function (r) {
        var tr = el("tr", { class: r.winning ? "winning" : "" }, []);
        tr.appendChild(el("td", { class: "war-kw" }, [r.keyword]));
        tr.appendChild(el("td", {}, [el("span", { class: "pos " + rankClass(r.you) }, [rankText(r.you)])]));
        (r.competitors || []).forEach(function (cc) {
          tr.appendChild(el("td", {}, [el("span", { class: "pos " + rankClass(cc.rank) }, [rankText(cc.rank)])]));
        });
        // Gap: red when you're behind (positive gap), green when you're winning.
        var gapCell;
        if (r.gapToBest == null) {
          gapCell = el("span", { class: "war-gap " + (r.winning ? "good" : "neutral") }, [r.winning ? "winning" : "—"]);
        } else {
          gapCell = el("span", { class: "war-gap bad", title: "Your rank minus the closest competitor's — the gap to close" }, ["+" + r.gapToBest]);
        }
        tr.appendChild(el("td", {}, [gapCell]));
        var tm = WAR_TREND[r.trend] || WAR_TREND.flat;
        tr.appendChild(el("td", {}, [el("span", { class: "war-trend " + tm.cls }, [tm.txt])]));
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

    // Seed from the run payload immediately (no flash), then it's selector-driven.
    if (initial && initial.warRoom) renderGrid(initial);
    else refresh();
    return card;
  }

  function gateCard(run, R) {
    var card = el("div", { class: "card", style: "border-color:var(--brand-dim)" });
    card.appendChild(el("h3", {}, ["The approval gate"]));

    if (run.status === "awaiting_approval" || run.status === "detected" || run.status === "researching") {
      card.appendChild(el("p", { class: "muted", style: "margin-top:0" }, ["The push is the one irreversible step. The agent stopped here and is waiting on you."]));
      var approve = el("button", { class: "btn ok", onclick: function () { decide(run.id, "approve", card, approve); } }, ["✓ Approve & reveal commands"]);
      var reject = el("button", { class: "btn bad", onclick: function () { decide(run.id, "reject", card, reject); } }, ["✕ Reject"]);
      card.appendChild(el("div", { class: "btn-row" }, [approve, reject]));
      card.appendChild(commandsLocked());
    } else if (run.status === "rejected") {
      card.appendChild(el("div", { class: "locked" }, [el("span", { class: "lock" }, ["✕"]), "You rejected this proposal. Nothing was pushed."]));
      // Let them re-run immediately from here — no need to navigate back to the app.
      card.appendChild(el("div", { class: "btn-row", style: "margin-top:12px" }, [
        el("button", { class: "btn primary", onclick: function () { go("#/apps/" + run.app_id); } }, ["▶ Run the agent again"]),
      ]));
    } else {
      // approved or shipped → reveal the handoff
      card.appendChild(el("p", { class: "muted", style: "margin-top:0" }, ["Approved. Hand the metadata to your build pipeline (recommended) — that path is credential-free. Or upload straight to App Store Connect below; ShipASO uses your key once and never stores it."]));
      card.appendChild(ascPushCta(run.id));
      card.appendChild(commandsBox(R.pushCommands || [], run.id, R.proposedCopy || {}, R.currentCopy || {}));
    }
    return card;
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
      el("span", { class: "desc" }, ["Drops into your repo as a ", el("code", {}, ["fastlane/metadata/"]), " tree — your CI runs ", el("code", {}, ["deliver"]), " / ", el("code", {}, ["supply"]), " with the credentials it already holds."]),
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

    // ── opt-in: verify App Store Connect credentials (the .p8 path) ──
    wrap.appendChild(ascVerifyPanel(runId));
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
    var creds = function () { return { issuerId: issuer.value, keyId: keyId.value, p8: p8.value }; };
    var pushBtn = el("button", { class: "btn primary", onclick: function () { pushAsc(runId, creds(), pushBtn, status); } }, ["↥ Upload to App Store Connect"]);
    sec.appendChild(el("label", { class: "fld", style: "margin-top:12px" }, [el("span", { class: "lab" }, ["Issuer ID"]), issuer]));
    sec.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Key ID"]), keyId]));
    sec.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, [".p8 private key"]), p8]));
    sec.appendChild(el("div", { class: "btn-row", style: "margin-top:12px;align-items:center;gap:12px;flex-wrap:wrap" }, [pushBtn, status]));
    sec.appendChild(el("p", { class: "faint", style: "font-size:12px;margin:10px 0 0" }, [
      el("b", { style: "color:var(--warn)" }, ["This writes to your live App Store version"]),
      " (the editable one in App Store Connect). Your .p8 is used once and never stored.",
    ]));
    return sec;
  }

  // Opt-in App Store Connect credential check. Collapsed by default — the
  // credential-free Fastlane path above stays the recommended default. The .p8
  // is sent once to verify and is NOT stored by ShipASO.
  function ascVerifyPanel(runId) {
    var det = el("details", { class: "rawcmds asc-verify", style: "margin-top:16px" });
    det.appendChild(el("summary", {}, ["Or connect App Store Connect directly (advanced)"]));
    det.appendChild(el("p", { class: "faint", style: "font-size:12.5px;margin:8px 0 12px" }, [
      "Verify your App Store Connect API key, or push the approved metadata straight to your editable App Store version. ",
      el("b", { style: "color:var(--dim)" }, ["Your .p8 is used once and never stored."]),
      " Most teams should use the credential-free Fastlane handoff above instead.",
    ]));
    var issuer = el("input", { class: "txt mono", type: "text", placeholder: "Issuer ID (e.g. 57246542-96fe-…)", autocomplete: "off", spellcheck: "false" });
    var keyId = el("input", { class: "txt mono", type: "text", placeholder: "Key ID (e.g. ABC123DEFG)", autocomplete: "off", spellcheck: "false" });
    var p8 = el("textarea", { class: "txt mono", rows: "4", placeholder: "-----BEGIN PRIVATE KEY-----\n…paste your .p8 contents…\n-----END PRIVATE KEY-----", autocomplete: "off", spellcheck: "false" });
    var status = el("span", { class: "faint", style: "font-size:12.5px" }, []);
    var creds = function () { return { issuerId: issuer.value, keyId: keyId.value, p8: p8.value }; };
    var btn = el("button", { class: "btn", onclick: function () { verifyAsc(runId, creds(), btn, status); } }, ["Verify credential"]);
    var pushBtn = el("button", { class: "btn primary", onclick: function () { pushAsc(runId, creds(), pushBtn, status); } }, ["↥ Push to App Store Connect"]);
    det.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Issuer ID"]), issuer]));
    det.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Key ID"]), keyId]));
    det.appendChild(el("label", { class: "fld" }, [el("span", { class: "lab" }, [".p8 private key"]), p8]));
    det.appendChild(p8FileInput(p8, keyId));
    det.appendChild(el("div", { class: "btn-row", style: "align-items:center;gap:12px;flex-wrap:wrap" }, [btn, pushBtn, status]));
    det.appendChild(el("p", { class: "faint", style: "font-size:12px;margin:10px 0 0" }, [
      el("b", { style: "color:var(--warn)" }, ["Push writes to your live App Store version"]),
      " (the editable one in App Store Connect). Verify first. Your .p8 is used once and never stored.",
    ]));
    return det;
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

  async function verifyAsc(runId, creds, btn, status) {
    if (!creds.issuerId.trim() || !creds.keyId.trim() || !creds.p8.trim()) {
      status.textContent = "Fill in issuer id, key id, and the .p8."; status.style.color = "var(--warn)"; return;
    }
    if (!(API_BASE && liveMode)) {
      status.textContent = "Live API required — connect the dashboard to api.shipaso.com to verify."; status.style.color = "var(--warn)"; return;
    }
    btn.disabled = true; status.textContent = "Verifying…"; status.style.color = "var(--dim)";
    try {
      var res = await fetch(API_BASE + "/runs/" + runId + "/asc/verify", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(creds),
      });
      var out = await res.json();
      if (out.ok) {
        status.textContent = "✓ Credential works — " + (out.appsVisible || 0) + " app(s) visible.";
        status.style.color = "var(--signal)";
      } else {
        status.textContent = "✕ " + (out.reason || out.error || "Verification failed.");
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
    var android = "fastlane/metadata/android/" + locale;
    add(android + "/title.txt", copy.name);
    add(android + "/short_description.txt", copy.subtitle);
    add(android + "/full_description.txt", copy.description);
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

    // field key → { label, fastlane path(s) }. Order mirrors fastlane.ts.
    var FIELDS = [
      { key: "name", label: "App name", ios: "name.txt", android: "title.txt" },
      { key: "subtitle", label: "Subtitle", ios: "subtitle.txt", android: "short_description.txt" },
      { key: "keywords", label: "Keywords", ios: "keywords.txt", android: null },
      { key: "promo", label: "Promotional text", ios: "promotional_text.txt", android: null },
      { key: "description", label: "Description", ios: "description.txt", android: "full_description.txt" },
    ];
    var isSet = function (v) { return v !== undefined && v !== null && String(v).trim() !== ""; };
    var iosDir = "fastlane/metadata/" + locale;
    var androidDir = "fastlane/metadata/android/" + locale;

    var lines = [];
    lines.push("Update my fastlane metadata files accordingly; change nothing not listed.");
    lines.push("");
    lines.push("These are App Store / Google Play listing fields. For each field below, write the");
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
      if (f.android) paths.push(androidDir + "/" + f.android);
      lines.push("");
      lines.push("### " + f.label);
      lines.push("- fastlane file" + (paths.length > 1 ? "s" : "") + ": " + paths.join(", "));
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

  function decide(runId, action, card, clicked) {
    // Disable both buttons, but show in-flight feedback on the one clicked so the
    // action never reads as a frozen UI (the busy-cursor-with-no-activity bug).
    var btns = card.querySelectorAll("button"); btns.forEach(function (b) { b.disabled = true; });
    var label = clicked && clicked.textContent;
    if (clicked) clicked.innerHTML = '<span class="spin"></span> ' + (action === "approve" ? "Approving…" : "Rejecting…");
    api("POST", "/runs/" + runId + "/" + action)
      .then(function () { toast(action === "approve" ? "Approved — commands revealed." : "Rejected — nothing pushed."); route(); })
      .catch(function (e) { btns.forEach(function (b) { b.disabled = false; }); if (clicked && label) clicked.textContent = label; toast(e.message || "Failed"); });
  }

  /* ════════════════════════ rank sparkline (inline SVG) ════════════════════ */
  function sparkline(points) {
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
      }, appendCandidateRows);
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
  function route() {
    // Logged-out + live backend → the try-before-signup preview (NOT a cold
    // login wall). Signup is gated at "Connect & run", after they've seen value.
    if (API_BASE && session && session.authed === false) return previewView();
    var h = location.hash.replace(/^#/, "") || "/";
    var m;
    // #/apps/:id (optionally ?asc=1 → scroll to + flash the ASC run panel, PRD 04).
    if ((m = h.match(/^\/apps\/([^/?]+)(?:\?(.*))?$/))) return viewApp(m[1], parseQuery(m[2]));
    if ((m = h.match(/^\/runs\/([^/]+)$/))) return viewRun(m[1]);
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

  // Reflect auth state in the header (see headerState):
  //   signedIn → email + Sign out (apps auto-load); hide the demo stub + label
  //   signIn   → a "Sign in" button (→ magic link); hide the demo stub + label
  //   demoStub → keep the editable "acting as…" field (local/demo only)
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
      return;
    }

    // Live backend: the editable stub never shows (it can't auth on prod).
    if (input) input.style.display = "none";
    if (label) label.style.display = "none";

    if (st.mode === "signedIn") {
      var span = el("span", { id: "authState", class: "faint", style: "display:flex;gap:8px;align-items:center" }, [
        el("span", {}, [st.email || ""]),
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
