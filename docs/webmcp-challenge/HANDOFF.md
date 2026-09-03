# WebMCP Challenge — handoff and release record

Last updated: 2026-09-03

## Code and deployment

- Commit `706b61d8` adds browser-native WebMCP registration verification,
  untrusted-content hints, and a clear stage receipt.  It is intended for
  production through the guarded `main` deployment workflow.
- The expected `/runs` tool set is five tools: `whoami`, `describe_boundary`,
  `list_pending_runs`, `explain_run`, and `request_notification`.
- A run-detail page (`/runs/<run-id>`) correctly exposes seven tools.  Its two
  additional, page-scoped tools are `get_run`, `draft_alternative`, and
  `stage_for_approval`.
- The safety boundary is unchanged: there is no approve, publish, ship, or
  push WebMCP tool.  Staging changes what a person reviews, never whether it
  is approved; App Store publishing remains separate.

## Verification already completed

- `pnpm --dir cloud/web typecheck` passed.
- Focused WebMCP tests passed (78 tests): registry, hook, panel, and handlers.
- HyperFrames project validation passed with no lint, runtime, layout, motion,
  or WCAG contrast failures.

## Submission material

- Submission draft: `docs/webmcp-challenge/submission.md`.
- The deadline is recorded as **2026-09-03, 5:00pm PT**, confirmed against the
  Devpost submission countdown.
- Editable demo: `docs/webmcp-challenge/hyperframes-polish/`.
- Superseded render (do not upload):
  `docs/webmcp-challenge/hyperframes-polish/renders/hyperframes-polish_2026-09-02_22-47-45.mp4`.
- Final, upload-ready render:
  `docs/webmcp-challenge/hyperframes-polish/renders/shipaso-webmcp-webmcp-challenge-final.mp4`
  (44.0 seconds, 1920×1080, 30fps, H.264/AAC, 25.4 MB).
- The final render was inspected at its end card.  The personal-email account
  region is fully masked; the panel reports browser verification of seven
  run-detail tools and uses the current truthful boundary language.

## Superseded render — do not upload

Two public-facing problems must be fixed before upload:

1. The bottom-left account chip exposes a partially legible personal email.
2. It contains a stale, inaccurate statement that approval requires a “real
   click” and the server rejects approval otherwise.  The actual, defensible
   guarantee is the absence of any approval/publishing WebMCP tool and the
   explicit human approval boundary.  Do not represent a client-side click as
   a server-enforced proof of human intent.

The seven-tool count in that footage is **not** a problem: the captured route
is a run detail page, where seven tools are expected.  The submission’s
five-tool count refers specifically to `/runs`.

## Remaining submission steps

1. Upload the final render to public YouTube with audio, add its URL to
   `submission.md`, and submit through Devpost.
