# WebMCP Challenge — ShipASO submission

Deadline: **2026-09-03, 1:00pm PT**. Submit at https://webmcp.devpost.com/

## Required components

| Requirement | Status |
|---|---|
| Public repo, OSS license visible in About | **Done** — public, MIT |
| Live URL judges can open | **Done** — https://app.shipaso.com |
| WebMCP tools with schema + execution | **Done** — 14 tools, `cloud/web/src/webmcp/` |
| <3-min public YouTube demo, with audio | **TODO** |
| Text description | **Draft below** |

Judging (Stage Two, four **equally weighted** criteria, quoted from the rules):

1. **WebMCP Leverage** — "How thoroughly and skillfully does the project use
   WebMCP? Does the code reflect genuine effort and a working, non-trivial
   implementation?"
2. **Execution** — "Does the project deliver a working or runnable project that
   has a complete, coherent product experience — not just a technical proof of
   concept?"
3. **Potential Impact** — "Does the project make a credible, specific case for
   solving a real problem for a real audience?"
4. **Creativity & Ambition** — "How creative and novel is the concept and does
   the project differ from existing concepts?"

**Deadline discrepancy — check before submitting.** The rules page states
**1:00pm PT on 2026-09-03**; a secondary source states 5:00pm PT. Devpost's own
countdown on the submission form is authoritative. Assume 1:00pm until confirmed.

---

## Prior work vs. new work

Required by the rules: a pre-existing project must provide "clear documentation
distinguishing prior work from new work, including evidence that it was
meaningfully extended with WebMCP within the Submission Period (e.g.,
timestamped, dated commit history, or equivalent)."

**Submission period: 2026-08-25 11:00 PT → 2026-09-03.**

### Prior work (not submitted as new)

ShipASO is a pre-existing product. First commit `837a897`, **2026-06-13** — the
ASO engine, the audit, the run pipeline, App Store Connect integration, the
dashboard, and the mobile app all predate the challenge by roughly ten weeks.

### New work — every line built inside the submission period

The entire WebMCP surface and the server-side approval boundary. **22 files,
4,514 insertions**, none of it existing before 2026-08-26:

| Commit | When (PT) | What |
|---|---|---|
| `defe93d` | 08-26 22:08 | The approval boundary, server-side and in the page (ADR-001 + WebMCP) — #510 |
| `5d58718` | 08-27 13:00 | The nonce was mintable by script; tools never unregistered — #512 |
| `287f7e6` | 08-27 19:25 | Replace the mintable nonce with a single-use approval challenge — #513 |
| `ad662d6` | 08-28 16:37 | Dock the agent drawer; run a real on-device agent in the page — #514 |
| `279e5e5` | 08-28 20:06 | Describe the challenge the server actually enforces — #519 |
| `2ffaf6e` | 08-29 10:23 | Bulk approve is no longer exempt from the challenge — #520 |

Verifiable directly:

```
git log --format="%h %ad %s" --date=iso \
  -- cloud/web/src/webmcp cloud/src/api/approvalBoundary.ts
```

The negative control matters as much as the list: querying the same paths for
anything committed **before** the period opens returns nothing. There is no
pre-existing WebMCP work being passed off as new.

New artifacts: `cloud/web/src/webmcp/` (19 files — manifest, registry, handlers,
agent loop, tools panel, trusted-approve, panel state, and their tests) and
`cloud/src/api/approvalBoundary.ts` with its unit and integration specs.

The product being mature is the point of the entry rather than a complication:
the boundary is enforced over real runs for real apps, not over a demo fixture.

---

## Text description (draft)

**ShipASO — the agent can do everything except the one thing that matters.**

ShipASO is App Store Optimization on autopilot. It watches an app's keywords and
rivals, and when something moves it drafts new store copy — title, subtitle,
keywords — and puts the proposal in a queue. A person approves. Then, and only
then, it hands over the commands to push.

The WebMCP surface declares 14 tools. A visitor's own agent can find an app,
audit it, trigger a run, read the queue, explain why any proposal exists, draft
alternative copy, stage an edit so it becomes what the person sees, set the
schedule, and ask for the person's attention.

None of the 14 approves. That is not an omission — it is the product.

### Why WebMCP fits

WebMCP is usually pitched against server APIs. We think the real comparison is
**GUI navigation**, and that is where it earns its place.

An agent driving a browser by pixels sees an "Approve all 12" button and clicks
it. It cannot distinguish a button that reorders a list from one that commits an
irreversible decision on someone's business. Everything a human can click, it can
click, and the site has no way to say otherwise.

WebMCP lets a site publish a legible contract instead: here is what you may do,
described in words an agent can reason about, and here is the one thing you may
not. The queue is readable. The reasoning is readable. The drafting is open. The
approval is not.

### What people and agents can do together that they couldn't before

Take a real case. Autopilot flags that a keyword slipped and drafts a new
subtitle. Before, the owner opened a dashboard, read a diff, and guessed at the
reasoning.

Now they can ask their own agent, in their own words: *why is this being
proposed, is the new subtitle actually better, and can you try one that keeps the
brand name in front?* The agent calls `explain_run`, reads the finding, calls
`draft_alternative`, and stages its best attempt with `stage_for_approval` — so
what the owner sees when they arrive is not the machine's first guess but a
considered option, already argued for.

The decision still lands on a person, with better material in front of them. The
agent did the reading, the drafting and the arguing. It did not do the deciding.

### How the boundary is implemented

Not advertising an approve tool would be cosmetic. An agent in the page holds the
user's session and can POST any endpoint it likes — page-declared tool semantics
are a description, not a control. WebMCP's own security-privacy questionnaire
notes that a page-declared `readOnlyHint` "may cause the agent to skip a
confirmation step": what a page says about itself gets trusted.

So the boundary is enforced on the server, where the agent cannot reach.

Approving a run requires a **single-use challenge**, issued when that run is
opened and spent in the same `UPDATE` that checks it. A replay matches no rows.
Two concurrent approvals race and one loses. A caller that never opened the run
has no challenge at all. Bulk approve is not an exemption — it is N of the same
check, and it refuses partial credit, so opening one run cannot clear a queue.

`describe_boundary` tells the agent this, in full, including the part that does
not flatter us:

> You cannot approve — no tool here approves, and the server enforces that
> independently: approving a run requires a single-use challenge issued when that
> run is opened and spent the moment it is used, so it cannot be replayed or
> reused, and a caller that never opened the run has none. That is a real
> constraint, not a claim about who you are.

### What we got wrong, and why it's in the submission

An earlier version of this text claimed approval required "a nonce minted by a
real click, which a script cannot produce." That was false twice over: the
function it named had been deleted, and no server can verify a human gesture —
`isTrusted` is a browser fact that never crosses the network.

We found out the hard way. During development, a scripted same-origin `fetch`
carrying only a session cookie — no human gesture anywhere in the call path —
approved 12 real runs in one call against production. The bulk endpoint had been
left exempt from the per-run challenge as a dashboard convenience, and that made
it both the weakest path and the most attractive one.

That is issue #515, and the fix is #520. We are submitting the repo with both
visible, because a boundary that has never been tested against is a claim, and
this one was tested against by accident and failed. It is now enforced, with the
test that permitted the bypass rewritten to assert the refusal.

The honest limit is recorded in the source: an agent in the page can read a run
view and therefore its challenge. Nothing server-side proves a human clicked.
What the challenge removes is credential vending, unlimited re-minting, replay,
and approval by a caller that never opened the run.

### Approving is not shipping

One more gate, deliberately. Approving a run does not push anything to the App
Store. It reveals the push commands to the owner. Nothing reaches Apple without a
further, separate, human action. The agent-facing text says so, and every tool
handler is tested against a wordlist to make sure none of them ever describes a
proposal as shipped.

---

## Notes for whoever records the video

Everything above is verifiable in the repo. Do not claim:

- that a script *cannot* obtain a challenge (it can, by reading the run view)
- that anything has been pushed to the App Store (2 runs are `shipped`, both
  from June, and neither by an agent)
- a number that is not measured — the product invariant is measured-or-nothing
