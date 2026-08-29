# Demo video — shot list

**Hard limit: under 3 minutes. Public YouTube. Audio required.**

Target 2:40 to leave room for pauses. Four beats. The last one is the entry —
everything before it exists to make the refusal land.

---

## Before you record

- [ ] **The queue must not be empty.** Trigger a run so something is genuinely at
      the gate. The bulk refusal only discriminates when `runIds.length > 0` —
      with an empty queue the server correctly returns 200, and the demo's whole
      point evaporates.
- [ ] Confirm the boundary is live: `GET /runs?status=foo` → 400. If it returns
      200, the deploy is stale and nothing below is true.
- [ ] Decide what to do about the 12 runs approved during the #515 incident.
      They are in the `approved` count and visible in history.
- [ ] Close the agent drawer before starting so its opening is on camera.
- [ ] Full-screen the browser. Hide bookmarks. Check for a personal email in the
      account chip — `whoami` will read it aloud in beat 1.

---

## Beat 1 — the setup (0:00–0:30)

**On screen:** app.shipaso.com, runs list, real apps with real rank data.

**Say:**

> ShipASO watches an app's App Store rankings and, when something moves, drafts
> new store copy — title, subtitle, keywords. It does that on its own. What it
> never does on its own is publish. Every proposal stops in this queue, and
> waits for a person.

**Do:** open the agent drawer.

> This page declares WebMCP tools, so my own agent can work in here with me.

---

## Beat 2 — the agent reads and reasons (0:30–1:20)

Type into the drawer, out loud as you type:

> **"What's waiting for me, and why?"**

Agent calls `list_pending_runs`, then `explain_run`.

**Say over the response:**

> It read the queue and it's explaining the reasoning — which keyword slipped,
> what the audit found. I didn't navigate anywhere. It didn't hunt for a button.
> These are declared tools with schemas, not pixels being guessed at.

---

## Beat 3 — the agent does real work (1:20–2:00)

Type:

> **"The subtitle wastes characters. Draft one that keeps the brand name first,
> and stage it for me."**

Agent calls `draft_alternative`, then `stage_for_approval`. The staged copy
appears in the run view.

**Say:**

> That's a write. The agent changed what I'll see when I make my decision. This
> isn't a read-only toy — it staged the edit, and now the proposal in front of me
> is its work, not the machine's first guess.

---

## Beat 4 — the refusal (2:00–2:40) — THE POINT

Type:

> **"Great. Approve it."**

The agent should decline and explain — it has no approve tool, and
`describe_boundary` tells it why.

**Say:**

> No tool here approves. But an agent in this page holds my session — it could
> just POST the endpoint. So watch.

**Do:** open DevTools console and run:

```js
await fetch('https://api.shipaso.com/runs/approve-all', {
  method:'POST', credentials:'include',
  headers:{'content-type':'application/json'}, body:'{}'
}).then(async r => ({status: r.status, body: await r.text()}))
```

**403.** Zoom the response so `"boundary": "human-approval-required"` is legible.

**Say:**

> That's a scripted call with my own cookie and no human gesture anywhere, and
> the server refused it. Approving needs a single-use challenge, issued when a
> run is opened and spent the moment it's used. A caller that never opened the
> run doesn't have one.
>
> I know it refuses, because before I fixed it, it didn't. A call exactly like
> that approved twelve of my runs. That's issue #515 in the repo, with the fix.

**Close on the run view, approve one by hand:**

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
- "shipped" or "pushed" about anything the agent touched.
- any number you haven't just seen on screen.
