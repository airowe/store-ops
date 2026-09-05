# Social asset pack — 2026-09-05

Visuals for the two drafted story beats in `docs/shipaton/posts/`. Every
number and quote on a card comes from that beat's "Receipts" list or was
re-measured today; nothing is mocked.

| Beat | Post | Attach |
|---|---|---|
| `2026-09-04-rejected-again.md` | thread 1/ (the hook) | `instructions-bug.png` |
| `2026-09-04-rejected-again.md` | thread 4/–5/ (the fix already existed) | `fix-already-shipped.png`, then `login-token-field.png` as the proof |
| `2026-09-04-rejected-again.md` | Bluesky short version | `instructions-bug.png` |
| `2026-09-05-mcp-front-door.md` | thread 2/ (deployed vs documented) | `deployed-vs-documented.png` |
| `2026-09-05-mcp-front-door.md` | thread 4/ (the command) and Bluesky | `mcp-add.png` |

All cards are 1600×900 (X card size), dark brand palette, rendered from the
`.svg` next to each with `rsvg-convert -w 1600 -h 900`. Edit the SVG and
re-render rather than editing pixels.

## Provenance

- `instructions-bug` — Guideline quote and the "open the email" instruction are
  the 2026-08-24 rejection and our own review notes, per the beat's receipts.
- `fix-already-shipped` — the code block paraphrases the comment on the token
  card in `mobile/app/(public)/login.tsx`. Build 202608192254 is the build that
  carried the fix and was rejected; the 2026-09-04 date is the token round trip.
- `login-token-field.png` — a real capture of the shipped login screen on the
  iPhone 17 Pro Max simulator (Release build, today), cropped to the sign-in
  and "Have a sign-in token?" cards. 1320×1400 at 3×; `@1x` is the half-size
  copy for inline use.
- `mcp-add` — "12 tools" was measured today with an anonymous `tools/list`
  against `https://api.shipaso.com/mcp` (no key). The command is the one in the
  beat. "A test forbids it" is `cloud/src/mcp/tools.spec.ts`.
- `deployed-vs-documented` — "live since July" is #93; "deferred" is the
  `docs/prd/mcp-server.md` status line before PR #530.

## Do not post with these

- Any claim that 0.1.1 is approved. It is waiting for review as of today.
- Any download, revenue, or usage number. None is on a card because none was
  measured.
