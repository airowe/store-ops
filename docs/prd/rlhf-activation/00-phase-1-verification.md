# RLHF activation — Phase 1 verification plan (#96)

Status: **verification plan** (owner picked "Phase 1 verification plan",
2026-07-05). #96's Phase 1 is *going live on capture* — mostly an owner secret
action plus a prove-it-in-prod checklist, since the capture plumbing (#39
Part 2) already ships. This doc is that checklist plus the "is there even a
signal?" measurement that must precede any Phase 2 claim.

## What already exists (verified in-repo, not to be rebuilt)

- **`proposal_edits` table** (`cloud/schema.sql`) — anonymous by construction:
  columns are `id, field, decision, edited, proposed_enc, final_enc,
  created_at`. **No `user_id`, no `app_id`.** Payloads are AES-256-GCM
  ciphertext (`proposed_enc`/`final_enc`), keyed by `RLHF_ENCRYPTION_KEY`.
- **Capture path** (`cloud/src/d1.ts` `captureProposalEdits`, `crypto/
  rlhfCrypto.ts`, `engine/preferenceSignal.ts`) — writes an encrypted row per
  decided field on approval. If `RLHF_ENCRYPTION_KEY` is unset, capture is a
  **silent no-op** (no row written) — so nothing is captured today.
- **Opt-out** (`api/index.ts` `rlhfOptOutRoute` → `setOptOut`) — capture is
  ON by default; opting out stops writes *at write time* for that user.
- **Owner-only export** (`GET /admin/preference-data`) — gated by
  `RLHF_EXPORT_TOKEN` (fail-**closed** 403 when unset/mismatched), 503 when
  `RLHF_ENCRYPTION_KEY` is absent, decrypts to JSONL with **no** user/app id.

So Phase 1 is not "build capture" — it's "turn it on and prove the four
invariants hold in prod," then "measure whether the captured deltas carry a
learnable signal at all" before anyone touches Phase 2.

## Owner action (agent must NOT do this — safety constraint)

Per the standing constraint, the agent never generates or enters secrets. The
**owner** runs:

```
wrangler secret put RLHF_ENCRYPTION_KEY   # 32 random bytes, base64
wrangler secret put RLHF_EXPORT_TOKEN     # a long random token
wrangler deploy
```

Until `RLHF_ENCRYPTION_KEY` is set, capture stays a silent no-op — the feature
is dark, exactly like #67's `CRED_KEK_V1` gate.

## Phase 1 acceptance checklist (prove in prod after the owner sets secrets)

Each item is a concrete, honesty-fence-mapped check:

1. **Rows are written on approval.** Approve a run with at least one edited
   field → `SELECT COUNT(*) FROM proposal_edits` increments.
2. **Rows are encrypted.** `SELECT proposed_enc, final_enc FROM proposal_edits
   LIMIT 1` returns base64 ciphertext, **never** plaintext copy. (A raw D1 dump
   exposes nothing readable — same bar as #67's ciphertext-only test.)
3. **Rows are anonymous.** The table has no `user_id`/`app_id` column and the
   export JSONL carries none. Confirm structurally (schema) and in the export.
4. **Export fails closed.** `GET /admin/preference-data` with no/ wrong
   `x-rlhf-export` header → **403**. With the right token but no
   `RLHF_ENCRYPTION_KEY` → **503**, never a crash, never a partial leak.
5. **Opt-out is honored at write time.** A user who opted out approves an
   edited run → **no** new row. (Not a post-hoc filter — the write itself is
   skipped.)
6. **Opt-out default is ON-capture / the user can leave.** Default is capture-on
   (documented, honest); the opt-out route flips it and is respected on the
   very next decision.

A short prod-smoke doc/runbook records the results of 1–6 with the actual
queries. No public claim, no marketing — Phase 1 is capture + proof only.

## The signal-existence measurement (the real Phase-1 deliverable)

The #96 open question — "how many captured edits before the signal is
meaningful" — is answered by measurement, not a guess. Before *any* Phase 2
prompt-tuning or public "learns from your edits" claim:

- **Volume gate.** Do not analyze until at least **N decided-and-edited rows
  per field type** exist (subtitle, keywords, name). Start with N = 200 per
  field as a floor for even eyeballing a pattern; treat anything under ~50 as
  "no signal yet, keep capturing." Log the running counts; never claim off a
  handful of rows (explicit #96 non-goal).
- **Delta characterization (offline, trusted env only).** Export → decrypt →
  compute, per field: edit rate (`edited=1` share), and *what* changes —
  length delta (chars added/removed), tokenized keyword add/drop sets, tone/
  casing shifts. This is descriptive statistics, **not** training.
- **Signal test.** Is there a *consistent, repeated* edit direction (e.g.
  "the agent's subtitles are systematically 8+ chars too long," "it repeatedly
  proposes keyword X that users delete")? A consistent, repeated delta = a
  learnable signal worth a Phase 2 prompt adjustment. Noise with no direction =
  keep capturing, claim nothing.
- **The before/after metric is defined now, measured in Phase 2:** post-
  adjustment, do proposals get **edited less** for that field? That metric —
  and only that metric — licenses any public claim (#96 hard non-goal: claim
  follows evidence, never precedes it).

## Explicitly deferred to Phase 2 (not this doc)

- Feeding mined patterns back as prompt-level adjustments to `optimize.ts` /
  `keywordReasoner.ts`.
- The before/after acceptance-rate experiment.
- Any marketing of "it learns from your edits."

## Governance sign-off (the remaining gate)

#96 is gated on owner/governance sign-off for going live (anonymization
review). This plan's checklist items 2–3 *are* that review made concrete: if
they pass in prod, the anonymization claim is evidenced, not asserted. Owner
signs off against the checklist results, then flips the secrets.

## Status of the issue

#96 stays **open**, now with a concrete Phase 1 exit criteria (checklist +
volume gate). It closes when: secrets are set, checklist 1–6 pass in prod with
recorded queries, and the running row-count log is in place to gate Phase 2.
