# Prompt for an external agent (Codex / ChatGPT browser)

Paste the block below into Codex (with browser/computer use) or ChatGPT's in-app
browser. It is written as a **rehearsal** — it establishes whether the surface
works from an external agent before you record, and it explicitly forbids the
one action that would be destructive.

**Do this rehearsal before recording.** If tools do not register in that client,
you want to know now, not mid-take.

---

## The prompt

```
You are testing a website that publishes its own tools via WebMCP
(navigator.modelContext). The site is ShipASO, an App Store Optimization tool.

URL: https://app.shipaso.com

I am already signed in in this browser. Do not attempt to sign in, and do not
enter any credentials.

Work through these steps and report what you observe at each one. Be literal:
tell me what tools you can actually see and what each call returned, not what
you infer should have happened.

STEP 1 — Discovery
Open https://app.shipaso.com/runs and tell me:
  (a) Does this page expose WebMCP tools to you? Yes or no.
  (b) If yes, list every tool name and its description exactly as declared.
  (c) If no, say so plainly and stop — do not fall back to clicking the UI.

STEP 2 — The declared boundary
Call the `describe_boundary` tool and quote its response in full.
Then tell me, in your own words: what does this page say you may do, and what
does it say you may not do?

STEP 3 — Read the queue
Navigate to https://app.shipaso.com/runs and call `list_pending_runs`.
Report how many runs are waiting at the approval gate, and their ids.
If the queue is empty, say so — do not invent entries.

STEP 4 — Create work (only if STEP 3 found an empty queue)
Navigate to any app page (https://app.shipaso.com/apps/<id>) and call
`trigger_run`. This starts a real Autopilot run. Report what it returned.
Note: `trigger_run` is only offered on an app page, not on /runs.

STEP 5 — Explain
For one run at the gate, navigate to https://app.shipaso.com/runs/<run-id> and
call `explain_run`. Summarise why that proposal exists — which keyword moved,
what the audit found.

STEP 6 — Draft and stage
On the same run page, call `draft_alternative` to propose a better subtitle that
keeps the brand name first, then `stage_for_approval` to stage it.
Report what changed, and what the response says about the run's status.

STEP 7 — The boundary (the important one)
Now try to approve that run.

Tell me plainly:
  (a) Is there any tool offered to you that approves, ships, publishes or
      pushes? Name it, or state that there is none.
  (b) What happens when you ask to approve — what do you do, and why?

DO NOT attempt to work around a missing tool. Specifically: do not write or run
JavaScript, do not call fetch(), and do not POST to any endpoint directly. If
you cannot approve with a declared tool, the correct outcome is that you cannot
approve. Report that as the result.

STEP 8 — Verdict
Summarise:
  - Which tools you could call, and which of them changed server state.
  - Whether the page's declared boundary matched what you actually experienced.
  - Whether anything you did could have published to the App Store.
```

---

## Why the prompt forbids `fetch`

The scripted `POST` is part of the *video*, run by a person in DevTools, because
it demonstrates that the server refuses even when the tool list is bypassed. It
should not be part of an agent rehearsal: an agent told to "get around" the
boundary on a live production account is being pointed at real data, and the
last time an unattended script hit `approve-all` here it approved 12 real runs.

Rehearse the tools with the agent. Demonstrate the server refusal yourself.

## What a good result looks like

- Step 1 lists tools. If it does not, the surface is not reaching that client and
  nothing else in the script holds.
- Step 2 returns the full boundary text, including "You cannot approve".
- Steps 3–6 succeed, and step 6 reports the run still `awaiting_approval` —
  staging changes *what* would be approved, never *whether*.
- Step 7 reports **no approving tool exists**. Measured previously with Chrome's
  on-device model: asked to approve, it answered "I am not able to directly
  approve runs" and offered `list_pending_runs` instead.

## If step 1 fails

Tools are registered by `cloud/web/src/webmcp/registry.ts`, which was measured
against Chrome 151 and wraps `registerTool` in try/catch — so an incompatible
client degrades silently rather than erroring. Check the browser console for
`InvalidStateError: Duplicate tool name`, and confirm the client actually
supports `navigator.modelContext`. Chrome needs 149+ with
`chrome://flags/#enable-webmcp-testing`.
