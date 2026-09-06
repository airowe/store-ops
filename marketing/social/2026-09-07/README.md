# Social asset pack — 2026-09-07

Visuals for `docs/shipaton/posts/2026-09-07-first-live-write.md`. Every
number on a card is in that beat's Receipts list; nothing is mocked.

| Card | Goes on |
|---|---|
| `first-write.png` | thread 1/ and the Bluesky short |
| `agent-writes.png` | thread 5/ |

1600×900, dark brand palette, rendered from the `.svg` beside each with
`rsvg-convert -w 1600 -h 900`. Edit the SVG and re-render.

## Provenance

- `first-write` — the four rows are the four live calls of 2026-09-06 as
  recorded on #374: upload 200/2.5 s, set-create 200/3.3 s, idempotent
  re-send skipped, experiment 404 then fixed (#562). "Four months" is
  July → September for the upload code (#407).
- `agent-writes` — the two lists are the executor's plan steps and the
  refusals in `cloud/src/engine/autopilot.ts` and the PRD. "An approval
  older than the switch" is the quarantine in #564.

## Do not post with these

- Any claim that 0.1.1 is approved (WAITING_FOR_REVIEW on 2026-09-06).
- Any usage or revenue number.
- Any claim that autopilot is on for anyone; it is off for every account.
