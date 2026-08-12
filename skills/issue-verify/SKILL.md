---
name: issue-verify
description: Check open GitHub issues against the source before anyone works them, and comment where a claim has gone stale. Catches the specific failure this repo keeps hitting — an issue describing shipped work as missing, so an agent rebuilds something that already exists. Use when the user says "sweep the issues", "verify the backlog", "is this issue still true", "what's actually left to build", or before picking up any issue that asserts something is missing.
---

# issue-verify

An issue is a claim made on a particular day. The code moves; the issue does
not. This sweeps open issues and checks their **concrete, checkable claims**
against the source, then records what it finds.

It exists because this repo keeps hitting one specific failure: an issue says
something is missing, someone believes it, and rebuilds work that already
shipped. In a single sweep, six issues were found describing delivered work as
absent — `#400` (push lane), `#380` (pricing), `#372` (credentials), `#179`
(ASC writes), `#396` (rank tracking), and part of `#436`.

`AGENTS.md` already says *"Verify before you claim."* This is that instruction
with a procedure attached.

## The rule

**Never start work on an issue asserting something is missing without first
checking whether it is.** The check is usually one command and takes seconds;
rebuilding shipped work costs a day.

## What counts as a checkable claim

Sweep these. Everything else is opinion and needs the owner, not a grep.

| Claim shape | How to check |
|---|---|
| "X doesn't exist" | `ls`, or `rg -l "<symbol>"` |
| "no skill covers Y" | `rg -l "Y" skills/` |
| "grep returns zero hits" | run that exact grep again |
| "N skills ship" | `ls skills/ \| wc -l` |
| "the route isn't implemented" | probe it — **401 ≠ 404** (see below) |
| "prices are A/B/C" | `rg` the actual constants and marketing copy |
| "this fails on every deploy" | `gh run list --workflow=deploy.yml` |
| "field Z is dropped" | read the reducer, not its docstring |

## Traps this repo has actually hit

**A NUL byte makes grep skip a whole file, silently.** `cloud/src/api/index.ts`
used one as a composite map key. `grep -in "delta"` returned nothing while the
`/deltas` handler sat at line 3371, and the conclusion drawn — "the route isn't
in this repo" — was reported as fact. Fixed in #477 (U+001F) with a guard in
`packages/docpaths/noNulBytes.test.mjs`, but **any** binary-looking file has
this problem. When a search returns zero, confirm with `awk '/pattern/'` or
`rg --text` before believing it.

**401 is not 404.** A live route behind auth answers 401. That is evidence the
route EXISTS. Do not read an auth failure as absence.

**A doc comment is not behaviour.** `Sparkline.tsx` said *"a null rank is a GAP
not a fabricated point"* while the geometry plotted it at 200 (#475). Read the
implementation, and where cheap, run it.

**An empty result is a claim, not a verdict.** Local D1 with 0 rows says
nothing about production. `wrangler ... --remote` failing with `7403` was
transient, not a permissions wall — the retry succeeded.

## Procedure

```bash
gh issue list --state open --limit 30 --json number,title,createdAt \
  -q '.[] | "#\(.number)\t\(.createdAt[0:10])\t\(.title)"'
```

Oldest first — staleness correlates with age. For each issue:

1. **Extract the checkable claims.** Usually one or two; ignore the reasoning.
2. **Check each against the source**, honouring the traps above.
3. **Record the outcome:**
   - *fully delivered* → close, quoting file:line evidence for every claim
   - *partly stale* → comment naming which parts are now false, and what
     remains. Do not close; the remainder is real work.
   - *still true* → say so explicitly with the evidence. A verified-still-open
     issue is more valuable than an unexamined one.
   - *needs a decision* → surface the question to the owner rather than
     guessing. Pricing, positioning and scope are not greppable.

## Comment like the evidence matters

A closing comment is the record of why. Quote `file:line`, paste the command
and its output, and name what changed since filing. "Already done" without
evidence is just another unverified claim.

Say plainly when an issue was **correct when filed**. The point is not that the
author was wrong — it is that the code moved.

## What this skill will not do

- **It will not close an issue on a decision it cannot make.** Positioning,
  pricing and scope belong to the owner.
- **It will not delete an issue's remaining scope** because part of it shipped.
  Retitle or comment; leave the real work open.
- **It will not treat a passing check as proof.** A guard that cannot fail
  proves nothing — if a claim is "this is broken", reproduce the break before
  agreeing it is fixed.

## Cadence

Worth a sweep before starting any backlog session, and after any stretch of
several merged PRs — that is when issues go stale fastest. It is read-only
apart from issue comments, so it is safe to run often.
