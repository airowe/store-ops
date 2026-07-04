# Phase 4 — UI: per-market review lane

Depends on: Phases 1–2 (generation + approve); Phase 3 optional (the push
column only renders when ASC writes are enabled).

## Where

The existing localization-expansion card on the run page (post-approval only —
generation sources the approved copy). Each recommended market row grows:

```
de-DE  German — Large storefront …            [Generate draft]
```

→ after generation, the row expands into the SAME editable diff surface the
en-US proposal uses (char bars, client-side validation mirror, reset button),
plus:

- the verbatim honesty label ("draft — machine-translated, review before
  shipping") and per-field "trimmed to fit" notices,
- `[Approve for handoff]` → `POST /runs/:id/localize/approve` → row shows an
  "in handoff" chip; `[Remove]` un-approves,
- (flag-gated) the per-locale ASC actions from Phase 3, reusing the #34
  credential + create-then-push pattern.

A free-pick input ("any ASC locale") sits under the recommendations — the
recommendation list is a starting point, not a fence.

## Honest empty/degrade states

- No AI binding → the Generate button is replaced by the honest unavailable
  note (no dead click).
- Generation failure → the provider error verbatim + retry; never a silent
  en-US body in the editor.
- The handoff section lists included locales (Phase 2 copy).

## Mock + e2e

- mock.js mirrors `/runs/:id/localize` (+approve/delete) with a deterministic
  pseudo-translation (e.g. reversed-cased tokens + locale tag) so e2e can pin:
  generate → edit → approve → the fastlane preview contains the locale tree;
  unapproved drafts never reach the handoff; the honesty label renders; the
  brand token survives in the mock draft.
- Screens verified at phone + iPad widths per the session's responsive
  standard if/when the mobile app grows this surface (NOT in v1 — web only;
  mobile parity is a follow-up decision).
