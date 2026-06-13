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

  // ── stubbed auth: an email in localStorage, sent as X-User-Email ──────────
  function email() { return localStorage.getItem("store-ops:email") || "demo@store-ops.dev"; }
  function setEmail(e) { localStorage.setItem("store-ops:email", e); }

  // ── API client ────────────────────────────────────────────────────────────
  var liveMode = !!API_BASE; // becomes false if the live Worker errors out
  async function api(method, path, body) {
    var headers = { "X-User-Email": email() };
    if (body) headers["content-type"] = "application/json";
    var init = { method: method, headers: headers };
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

  function loading(msg) { clear(root()); root().appendChild(el("div", { class: "empty" }, [el("div", { class: "spin" }), " " + (msg || "Loading…")])); }

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
  function labelFor(s) { return ({ detected: "Detected", researching: "Researching", awaiting_approval: "Awaiting approval", approved: "Approved", rejected: "Rejected", shipped: "Shipped" })[s] || s; }
  function rankClass(r) { return r == null ? "none" : r <= 10 ? "good" : r <= 50 ? "mid" : ""; }
  function rankText(r) { return r == null ? "—" : "#" + r; }

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
    apps.forEach(function (a) { grid.appendChild(appCard(a)); });
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
          toast(e.message || "Failed");
        });
    }

    // Render the resolver's candidate list as a clickable picker.
    function renderCandidates(cands) {
      clear(results);
      if (!cands.length) { results.appendChild(el("div", { class: "faint", style: "font-size:12.5px" }, ["No apps found. Try a different name, an App Store / Play link, or a bundle id."])); return; }
      var heading = cands.length === 1 ? "Found it — click to connect:" : "Pick your app:";
      results.appendChild(el("div", { class: "faint", style: "font-size:12.5px;margin:2px 0 6px" }, [heading]));
      cands.forEach(function (c) {
        var meta = [c.publisher, (c.genres && c.genres.length ? c.genres[0] : null)].filter(Boolean).join(" · ");
        var row = el("div", { class: "card appcard", style: "padding:10px 12px;margin-bottom:6px", onclick: function () { connect(c.bundle_id, c.name); } }, [
          el("div", { class: "row1" }, [
            c.icon_url ? el("img", { src: c.icon_url, width: "28", height: "28", style: "border-radius:6px;margin-right:8px;vertical-align:middle" }) : null,
            el("span", { class: "name" }, [c.name || c.bundle_id]),
          ]),
          el("div", { class: "bundle" }, [c.bundle_id + (meta ? "  ·  " + meta : "")]),
        ]);
        results.appendChild(row);
      });
    }

    function submit(ev) {
      ev.preventDefault();
      var q = queryInput.value.trim();
      if (!q) { toast("Enter an app name, link, or bundle id"); queryInput.focus(); return; }
      submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spin"></span> Searching…';
      clear(results);
      api("POST", "/resolve", { query: q })
        .then(function (r) {
          submitBtn.disabled = false; submitBtn.textContent = "Search";
          // Exact single hit (bundle id / link / unique name) → connect straight away.
          if (r.kind === "resolved" && r.candidates.length === 1) { connect(r.candidates[0].bundle_id, r.candidates[0].name); return; }
          renderCandidates(r.candidates || []);
        })
        .catch(function (e) {
          submitBtn.disabled = false; submitBtn.textContent = "Search";
          toast(e.message || "Search failed");
        });
    }

    queryInput = el("input", { class: "txt", placeholder: "App name, App Store / Play link, or bundle id", autocomplete: "off" });
    submitBtn = el("button", { class: "btn primary", type: "submit" }, ["Search"]);
    results = el("div", { style: "margin-top:10px" });
    return el("div", { class: "card" }, [
      el("h3", {}, ["Connect an app"]),
      el("form", { onsubmit: submit }, [
        el("label", { class: "fld" }, [el("span", { class: "lab" }, ["Search by name, link, or bundle id"]), queryInput]),
        el("div", { class: "btn-row" }, [submitBtn]),
      ]),
      results,
      el("div", { class: "faint", style: "font-size:12.5px;margin-top:4px" }, ["Paste a name like “Calm”, an App Store / Play link, or a bundle id. The agent then audits the live listing, checks organic ranks, and drafts copy. Nothing is pushed."]),
    ]);
  }

  function appCard(a) {
    var run = a.latest_run, rs = a.rank_summary;
    var card = el("div", { class: "card appcard", onclick: function () { go("#/apps/" + a.id); } }, [
      el("div", { class: "row1" }, [
        el("span", { class: "name" }, [a.name || a.bundle_id]),
      ]),
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
  async function viewApp(id) {
    loading("Loading app…");
    var data, ranks;
    try { data = await api("GET", "/apps/" + id); ranks = await api("GET", "/apps/" + id + "/ranks"); }
    catch (e) { return errorBox(e); }
    var app = data.app, runs = data.runs || [];

    var c = root(); clear(c);
    c.appendChild(backlink("#/", "All apps"));
    c.appendChild(el("h1", {}, [app.name || app.bundle_id]));
    c.appendChild(el("p", { class: "lead mono", style: "font-family:ui-monospace,Menlo,monospace;font-size:13px" }, [app.bundle_id + " · " + (app.country || "US")]));

    // rank trend mini-chart
    c.appendChild(el("div", { class: "card" }, [
      el("h3", {}, ["Rank trend — “" + esc(ranks.keyword) + "”"]),
      sparkline(ranks.points || []),
      el("div", { class: "faint", style: "font-size:12px;margin-top:8px" }, ["Lower is better. 8-week organic position from the iTunes Search API."]),
    ]));

    // run an agent loop on demand
    var runBtn = el("button", { class: "btn primary", onclick: function () { triggerRun(app.id, runBtn); } }, ["▶ Run agent now"]);
    c.appendChild(el("div", { class: "card" }, [
      el("h3", {}, ["Agent runs"]),
      el("div", { class: "btn-row", style: "margin-bottom:14px" }, [runBtn, el("span", { class: "faint", style: "align-self:center;font-size:12.5px" }, ["Same code path the weekly cron uses."])]),
      runList(runs),
    ]));
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

  function triggerRun(appId, btn) {
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Agent running…';
    api("POST", "/apps/" + appId + "/run")
      .then(function (r) { toast("Agent finished — review the proposal."); go("#/runs/" + r.id); })
      .catch(function (e) { btn.disabled = false; btn.textContent = "▶ Run agent now"; toast(e.message || "Failed"); });
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

    // 1) PLAIN-ENGLISH REASONING (what makes this read as an agent)
    c.appendChild(reasoningCard(R));

    // 2) PROPOSED COPY with char counts
    c.appendChild(copyCard(R.proposedCopy || {}));

    // 3) two-column: competitor read + ranks
    c.appendChild(el("div", { class: "split" }, [competitorCard(R.competitors || {}), rankCard(R.ranks || [])]));

    // 4) keyword reasoning table
    c.appendChild(keywordCard(R.reasoning || []));

    // 5) THE APPROVAL GATE + commands
    c.appendChild(gateCard(run, R));
  }

  function reasoningCard(R) {
    var steps = [];
    var au = R.audit || {}, sc = au.screenshots;
    if (sc) steps.push({ cls: sc.grade <= "B" ? "ok" : "warn", ico: sc.grade, t: "Audited the live listing", d: "Screenshots score " + sc.score + "/100 (grade " + sc.grade + "): " + (sc.findings && sc.findings[0] ? sc.findings[0] : "") });
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
    steps.forEach(function (s) {
      list.appendChild(el("div", { class: "step " + s.cls }, [
        el("div", { class: "ico" }, [s.ico]),
        el("div", {}, [el("b", {}, [s.t]), el("br"), el("span", {}, [s.d])]),
      ]));
    });
    return el("div", { class: "card" }, [el("h3", {}, ["What the agent did"]), list]);
  }

  function copyCard(copy) {
    var checks = (copy.validation && copy.validation.checks) || [];
    var byField = {}; checks.forEach(function (c) { byField[c.field] = c; });
    var order = [["name", "App name"], ["subtitle", "Subtitle"], ["keywords", "Keyword field"], ["promo", "Promotional text"]];
    var rows = order.filter(function (o) { return copy[o[0]] != null; }).map(function (o) {
      var field = o[0], label = o[1], val = copy[field], limit = LIMITS[field], count = val.length;
      var pct = Math.min(100, Math.round((count / limit) * 100));
      var barCls = count > limit ? "warn" : pct >= 90 ? "full" : "";
      return el("div", { class: "copyfield" }, [
        el("div", { class: "hdr" }, [
          el("span", { class: "fname" }, [label]),
          el("span", { class: "charcount", style: count > limit ? "color:var(--bad)" : "" }, [count + "/" + limit]),
        ]),
        el("div", { class: "val" }, [val || el("span", { class: "faint" }, ["(empty)"])]),
        el("div", { class: "charbar " + barCls }, [el("i", { style: "width:" + pct + "%" })]),
      ]);
    });
    return el("div", { class: "card" }, [
      el("h3", {}, ["Proposed copy"]),
      el("div", {}, rows),
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
    ranks.forEach(function (r) {
      box.appendChild(el("div", { class: "rankrow" }, [
        el("span", { class: "kw" }, [r.keyword]),
        el("span", { class: "pos " + rankClass(r.rank) }, [rankText(r.rank)]),
      ]));
    });
    return el("div", { class: "card" }, [el("h3", {}, ["Organic ranks (real iTunes data)"]), box]);
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

  function gateCard(run, R) {
    var card = el("div", { class: "card", style: "border-color:var(--brand-dim)" });
    card.appendChild(el("h3", {}, ["The approval gate"]));

    if (run.status === "awaiting_approval" || run.status === "detected" || run.status === "researching") {
      card.appendChild(el("p", { class: "muted", style: "margin-top:0" }, ["The push is the one irreversible step. The agent stopped here and is waiting on you."]));
      var approve = el("button", { class: "btn ok", onclick: function () { decide(run.id, "approve", card); } }, ["✓ Approve & reveal commands"]);
      var reject = el("button", { class: "btn bad", onclick: function () { decide(run.id, "reject", card); } }, ["✕ Reject"]);
      card.appendChild(el("div", { class: "btn-row" }, [approve, reject]));
      card.appendChild(commandsLocked());
    } else if (run.status === "rejected") {
      card.appendChild(el("div", { class: "locked" }, [el("span", { class: "lock" }, ["✕"]), "You rejected this proposal. Nothing was pushed. The agent will re-draft on the next data threshold or manual run."]));
    } else {
      // approved or shipped → reveal commands
      card.appendChild(el("p", { class: "muted", style: "margin-top:0" }, ["Approved. Run these from a machine that holds your store credentials — store-ops never does."]));
      card.appendChild(commandsBox(R.pushCommands || []));
    }
    return card;
  }

  function commandsLocked() {
    return el("div", { class: "locked", style: "margin-top:14px" }, [el("span", { class: "lock" }, ["🔒"]), "Generated push commands are hidden until you approve."]);
  }

  function commandsBox(cmds) {
    var wrap = el("div", { class: "cmds", style: "margin-top:14px" });
    var all = cmds.map(function (c) { return c.command; }).join("\n");
    cmds.forEach(function (c) {
      var pre = el("pre", {}, [c.command]);
      wrap.appendChild(el("div", { class: "cmd" }, [
        el("div", { class: "cmd-h" }, [
          el("span", { class: "store-tag " + c.store }, [c.tool]),
          el("span", { class: "desc" }, [c.description]),
          el("button", { class: "btn ghost copy-btn", onclick: function () { copyText(c.command, "Command copied"); } }, ["Copy"]),
        ]),
        pre,
      ]));
    });
    wrap.appendChild(el("div", { class: "btn-row", style: "margin-top:4px" }, [
      el("button", { class: "btn", onclick: function () { copyText(all, "All commands copied"); } }, ["Copy all"]),
    ]));
    return wrap;
  }

  function decide(runId, action, card) {
    var btns = card.querySelectorAll("button"); btns.forEach(function (b) { b.disabled = true; });
    api("POST", "/runs/" + runId + "/" + action)
      .then(function () { toast(action === "approve" ? "Approved — commands revealed." : "Rejected — nothing pushed."); route(); })
      .catch(function (e) { btns.forEach(function (b) { b.disabled = false; }); toast(e.message || "Failed"); });
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
      '<stop offset="0%" stop-color="#5b8cff" stop-opacity="0.35"/>' +
      '<stop offset="100%" stop-color="#5b8cff" stop-opacity="0"/></linearGradient></defs>' +
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

  /* ════════════════════════ router ════════════════════════════════════════ */
  function route() {
    var h = location.hash.replace(/^#/, "") || "/";
    var m;
    if ((m = h.match(/^\/apps\/([^/]+)$/))) return viewApp(m[1]);
    if ((m = h.match(/^\/runs\/([^/]+)$/))) return viewRun(m[1]);
    return viewDashboard();
  }

  window.addEventListener("hashchange", route);
  window.addEventListener("DOMContentLoaded", function () {
    // wire the email field (stubbed auth)
    var input = document.getElementById("emailInput");
    input.value = email();
    input.addEventListener("change", function () { setEmail(input.value.trim() || "demo@store-ops.dev"); toast("Acting as " + email()); route(); });
    document.getElementById("logo").addEventListener("click", function () { go("#/"); });
    setEnvPill();
    route();
  });
})();
