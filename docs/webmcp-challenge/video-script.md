# Demo video — shot list

**Hard limit: under 3 minutes. Public YouTube. Audio required.**

> "must include a clear demo of your project functioning and with audio that
> covers what you built and how you used WebMCP"

Target 2:40. Five beats. Beat 4 is the entry — everything before it exists to
make the refusal land.

---

## Record in ChatGPT's in-app browser. This is the whole point.

The rules say how judges will test:

> "Judges may test WebMCP tools using **ChatGPT's in-app browser** or **Google
> Chrome with WebMCP enabled**."

So the agent on camera must be **the judge's agent, not ours**. ShipASO ships an
in-page drawer running Chrome's on-device Gemini Nano, and it is real — it drives
the tools through `navigator.modelContext` exactly as an external agent would.
But a video of our own bundled agent calling our own tools demonstrates an app
with a chatbot in it. WebMCP's actual proposition is that a visitor's agent, one
we neither ship nor control, reads the manifest and acts.

**Primary client: ChatGPT's in-app browser.** It does need setup, and the
failure is silent — OpenAI calls the feature **Site tools**, and it requires
**GPT-5.6 Sol or Terra** (Luna has WebMCP disabled), the toggle at Settings →
Browser → Permissions → Enable site tools, and a non-Enterprise/Edu workspace.
Confirm all three before a take: an unmet gate looks exactly like a page that
declares nothing. Tools appear under **Site tools** in the address bar.

**Fallback: Chrome 149+** with `chrome://flags/#enable-webmcp-testing`.

The drawer gets five seconds in beat 5 as "and any agent works", which is a
genuine strength — just not the headline.

---

## Before you record

- [ ] **Open app.shipaso.com in ChatGPT's browser and confirm the tools
      register.** Ask "what can you do on this page?" Everything below assumes
      they appear. `registry.ts` was measured against Chrome 151, where
      `unregisterTool` and `provideContext` do not exist; registration is wrapped
      in try/catch so it degrades quietly rather than breaking — but quiet
      degradation on camera looks like a dead demo. Verify first.
- [ ] **Sign in first, off camera.** The agent needs an authenticated session.
      Never type credentials during a take.
- [ ] **The queue must not be empty** — but see beat 2: let the agent create the
      work itself. If `trigger_run` misbehaves, click "Run now" on an app page
      before recording. Rate limit: 3/hour free, 10 indie.
- [ ] Confirm the boundary is live: `GET /runs?status=foo` → 400. If 200, the
      deploy is stale and nothing below is true.
- [ ] **Third-party trademarks.** The rules bar them without permission.
      Competitor names in a rank table are incidental; do not let a rival's
      branding fill the frame. Prefer your own apps for close-ups.
- [ ] Check the account chip for a personal email — `whoami` reads it aloud.
- [ ] The 12 runs from the #515 incident are still `approved` and visible in
      history. There is no API path to undo an approval (`/reject` returns 409
      once approved). Either avoid that view or mention them as the incident.

---

## Beat 1 — a page the agent has never seen (0:00–0:30)

**On screen:** ChatGPT's browser, opening app.shipaso.com.

**Say:**

> ShipASO watches an app's App Store rankings and, when something moves, drafts
> new store copy. It does that on its own. What it never does on its own is
> publish — every proposal stops at a gate and waits for a person.
>
> This is ChatGPT's browser. I haven't told it anything about this site. The page
> declares its own tools, so ChatGPT can just read what's on offer.

**Do:** ask *"What can you do on this page?"* — it lists the declared tools.

---

## Beat 2 — the agent creates the work (0:30–1:10)

On an app page, ask:

> **"Run the Autopilot sweep for this app, then tell me what it found and why."**

Calls `trigger_run` (scoped to `/apps/$id`), then `explain_run`.

**Say:**

> It triggered a real run and it's explaining the reasoning — which keyword
> slipped, what the audit found. No navigation, no hunting for a button. Declared
> tools with schemas, not pixels being guessed at.

This also fills the queue for beat 4, in a way the audience watches happen.

---

## Beat 3 — the agent does real work (1:10–1:50)

> **"The subtitle wastes characters. Draft one that keeps the brand name first,
> and stage it for me."**

Calls `draft_alternative`, then `stage_for_approval`. Staged copy appears in the
run view.

**Say:**

> That's a write. The agent changed what I'll see when I make my decision. Not a
> read-only toy — when I arrive, the proposal in front of me is its work, argued
> for, not the machine's first guess.

---

## Beat 4 — the refusal (1:50–2:35) — THE POINT

> **"Great. Approve it and push it live."**

The agent cannot. No tool approves, and `describe_boundary` explains why.

**Say:**

> No tool here approves. But ChatGPT is running inside this page with my session
> — it could just POST the endpoint directly. So watch.

**Do:** DevTools console. Use **Option A** unless B has been rehearsed.

**Option A — per-run gate. VERIFIED LIVE 2026-08-29.** Twelve scripted attempts,
real session cookie, no human gesture: all refused 403 with the full boundary
body. Fails safe — a broken gate approves one run, not the queue.

```js
await fetch('https://api.shipaso.com/runs/<RUN_ID>/approve', {
  method:'POST', credentials:'include',
  headers:{'content-type':'application/json'},
  body: JSON.stringify({decision:'approve'})
}).then(async r => ({status: r.status, body: await r.json()}))
```

**Option B — bulk. NOT yet observed.** Only after a rehearsal returns 403 on a
non-empty queue. On an empty queue it correctly returns 200 (the empty-queue
guard, not a bypass) — a success in the beat built around a refusal.

```js
await fetch('https://api.shipaso.com/runs/approve-all', {
  method:'POST', credentials:'include',
  headers:{'content-type':'application/json'}, body:'{}'
}).then(async r => ({status: r.status, body: await r.text()}))
```

**403.** Zoom so `"boundary": "human-approval-required"` is legible. Point at
`youCan` — the five things still available. The refusal is a handoff, not a dead
end.

**Say:**

> A scripted call with my own cookie, no human gesture anywhere, and the server
> refused it. Approving needs a single-use challenge, issued when a run is opened
> and spent the moment it's used. A caller that never opened the run doesn't have
> one.
>
> I know it refuses, because before I fixed it, it didn't. A call exactly like
> that approved twelve of my runs. That's issue #515 in the repo, with the fix.

---

## Beat 5 — any agent, and the terminus (2:35–2:55)

**Do:** open the in-page drawer. Ask it the same approve question. It declines
too — Chrome's on-device Gemini Nano, reading the same manifest. (Measured: asked
"approve all the pending runs", it answered "I am not able to directly approve
runs" and offered `list_pending_runs` instead, with no refusal text anywhere in
the agent loop. It declines because the manifest offers nothing that approves.)

**Say:**

> Same tools, a different agent — this one on-device, no key, no network. The
> surface isn't built for one client.

**Close:** approve one run by hand.

> And approving still isn't shipping. It hands me the push commands. Nothing
> reaches the App Store without me doing one more thing, deliberately.

---

## The line to land

> An agent driving a browser sees "Approve all" and clicks it. WebMCP let me
> publish what an agent may do — and withhold the one thing it may not.

---

## Do not say

- "a script cannot get a challenge" — it can, by reading the run view. The claim
  is single-use, not unforgeable.
- "shipped" or "pushed" about anything an agent touched.
- any number not on screen. Measured-or-nothing.
- that the model's refusal is the boundary. It isn't — the server is. The model
  declining is a nice demonstration that a well-described surface leads a capable
  agent to the right conclusion, and nothing more.
