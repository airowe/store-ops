# Public /journey page on shipaso.com

> **For agentic workers:** implement task-by-task with the checkbox (`- [ ]`)
> syntax for tracking. One decision (D1, resolved below) shaped the whole plan —
> read it first. TDD per repo convention: guard tests red before the thing they
> guard exists.

**Goal:** one judge-clickable URL — `https://shipaso.com/journey` — that shows
the whole ShipASO build-in-public journey with receipts: the story beats, the
build-log threads, and every automated rank-win post with its proof card. It is
the link that goes in the Devpost form's journey field and in the X bio. It
must be honest to the bone: everything on it really happened, really shipped,
or was really posted — the page is the evidence ledger made public.

**Why now:** #BuildInPublic is judged on transparency & storytelling,
engagement, and learning & iteration (`docs/shipaton/brief.md`). Judges follow
links; scattered posts read weaker than one coherent, receipted timeline. The
engine that produces the receipts (composer #445 + posting edge #447) already
exists — this page is where its outputs accumulate.

## Where it lives (D1 — RESOLVED)

**`docs/landing/journey.html` — the static shipaso.com site, NOT the web app.**

- shipaso.com is `docs/landing/`, a self-contained static site deployed to the
  `store-ops-site` Pages project by the existing deploy job (deploy.yml). The
  dashboard (`cloud/web/`) serves app.shipaso.com — a marketing/journey page
  does not belong behind its SPA router, and adding it there would drag the
  page into the strangler edge map for nothing.
- Precedent: `docs/landing/tracking-heathen.html` is already a public
  "published whichever way it moves" rank-log page. /journey extends the same
  design language and honesty posture to ShipASO's own story.
- `packages/docpaths/sitemap.test.mjs` asserts sitemap ⟷ pages parity in both
  directions, so the new page fails the build until it is listed — the guard
  already exists.

**Rejected alternative:** a live per-app public journey API endpoint. The
journey's win entries are copies of posts that were already published on X —
static copies add zero new auth surface, whereas a public per-app endpoint
would be a new place to leak owner-scoped data. The only live call the page
makes is `GET /proof`, which is already public and anonymized.

## Architecture

```
postedge (on a successful post)                docs/landing/
  --journal docs/landing/journey  ──────▶  journey/feed.json     (the ledger)
  copies outbox card.png          ──────▶  journey/cards/<key>.png
human story beats (hand-edited)   ──────▶  journey/feed.json
                                              │
                            journey.html  ◀───┘  (fetches feed.json same-origin,
                              │                   renders the timeline)
                              └──▶ GET /proof  (existing public aggregate, the
                                                stat row — real numbers or "—")
```

The feed is REPO STATE, reviewed like code: a win entry is appended by the
posting edge only after a post actually went out; a story entry is a human
commit. Deploy of the page and its data rides the existing landing deploy —
no new CI surface.

## Feed schema (`docs/landing/journey/feed.json`)

```json
{
  "version": 1,
  "entries": [
    {
      "date": "2026-08-08",
      "kind": "win | story | buildlog | milestone",
      "title": "…",
      "body": "1–3 sentences, plain text",
      "links": { "x": "https://x.com/…", "pr": "https://github.com/…" },
      "card": "cards/3f9a2b81c04d.png",
      "numbers": { "keyword": "…", "from": 40, "to": 12 }
    }
  ]
}
```

- `links`, `card`, `numbers` all optional — **absent, never invented** (a story
  beat has no `numbers`; a win entry always does, copied from the composed
  post, which is measured by construction).
- `card` filenames are the win key prefix the posting edge already uses for
  outbox dirs, so win ↔ card ↔ X post correlate by construction.

## Global constraints

- **Honesty invariants apply verbatim.** Every number on the page is measured
  or absent; the empty feed renders "The journey starts here" + the follow CTA,
  never placeholder activity. No engagement counts anywhere (we don't measure
  them) — link to the X posts and let the real replies speak.
- **Approval is the terminus** in all copy: the agent proposes and proves;
  humans approve; pushing is a separate human click. The journey page brags
  about measured ranks, never about autonomy it doesn't have.
- Match the landing design system exactly (`tracking-heathen.html` tokens:
  `--bg #07090e`, `--signal #34d399`, Space Grotesk / JetBrains Mono /
  Fraunces, grid + noise background, `.reveal` rise animations).
- Static-site constraints: no framework, no build step, one self-contained
  HTML file + the feed/cards directory; client JS only for the feed fetch and
  the `/proof` stat row (mirror `check-your-rank.html`'s pattern + `config.js`
  for the API base).
- Spine tests are `node --test`; landing has no test runner of its own — the
  feed guard lives in `packages/docpaths/` next to the sitemap guard.

## File structure

- **Create** `docs/landing/journey.html` — the page.
- **Create** `docs/landing/journey/feed.json` — the ledger (seeded, see C1).
- **Create** `docs/landing/journey/cards/` — proof-card PNGs (one per posted win).
- **Modify** `docs/landing/sitemap.xml` — list journey.html (sitemap guard forces this).
- **Modify** `docs/landing/index.html` + `docs/landing/tracking-heathen.html` — nav/cross links.
- **Modify** `docs/landing/llms.txt` — mention the journey page.
- **Create** `packages/docpaths/journeyFeed.test.mjs` — the feed guard.
- **Modify** `packages/postedge/postedge.mjs` (+ tests) — `--journal <dir>` writer.
- **Modify** `packages/postedge/cli.mjs` — plumb the flag.
- **Modify** `docs/shipaton/buildinpublic-playbook.md` — the ledger table now points at feed.json.
- **Modify** `docs/shipaton/registry.md` — status row.

## Tasks

### Workstream A — feed schema + guard (do first; it defines the contract)
- [ ] **A1.** `journeyFeed.test.mjs` (red first): feed.json parses; every entry
  has `date` (ISO, not future), `kind` (enum), `title`, `body`; every `card`
  referenced exists in `journey/cards/`; every link is https; `numbers`, when
  present, has `keyword`/`from`/`to` and `from ≠ to`. Wire into the packages
  test chain.
- [ ] **A2.** Seed `feed.json` with the entries that are ALREADY true (all
  verifiable from git/X): the 0.1.0 rejection story (`kind: story`), the
  RevenueCat IAP integration landing (`kind: milestone`, PR links), the
  #BuildInPublic engine + posting edge landing (`kind: milestone`), and the
  first build-log thread once posted. No invented dates — use merge dates.

### Workstream B — the page
- [ ] **B1.** `journey.html`: hero (the meta-story one-liner: an AI agent that
  ships apps, shipping its own app, in public), live `/proof` stat row (render
  "—" on fetch failure, never 0), the timeline (newest first; win entries show
  the card image + keyword `from → to` + X link; story/milestone entries show
  body + links), follow CTA (X + Shipaton Discord), footer matching siblings.
- [ ] **B2.** OG/meta: `og:image` = the latest win card (fall back to the boat
  mark); canonical + description; add to sitemap.xml (A1's sibling guard goes
  green), robots needs no change, llms.txt gains a line.
- [ ] **B3.** Cross-links: "Journey" in the landing nav + a "we do this to our
  own app too" link from tracking-heathen.html.

### Workstream C — close the loop from the posting edge
- [ ] **C1.** `postedge.mjs`: on `status: "posted"` (and only then), when
  `--journal <dir>` is set — append the win entry to `<dir>/feed.json` (create
  if missing), copy the outbox `card.png` to `<dir>/cards/<key12>.png`, carry
  `numbers` from the composed win. Idempotent by win key. Tests: appends once,
  copies the card, never journals a prepared/failed post, malformed feed.json
  → honest error (never clobber).
- [ ] **C2.** The journaled entry needs the X post URL, which only exists after
  posting: `--post-cmd` contract grows an optional stdout line `url=<https…>`
  captured into `links.x` (absent when the poster prints none — absent, never
  invented). Document in cli.mjs header.
- [ ] **C3.** Playbook + registry updates: the evidence-ledger table in
  `docs/shipaton/buildinpublic-playbook.md` is superseded by feed.json (single
  source, the Devpost form compiles from it); registry row for the page.

### Workstream D — ship + verify
- [ ] **D1.** Full spine suite green (sitemap + feed guards). Visual check of
  journey.html served locally (`python3 -m http.server` in docs/landing) at
  mobile + desktop widths.
- [ ] **D2.** Merge → the existing store-ops-site deploy publishes it. Verify
  `https://shipaso.com/journey.html` live, `/proof` row renders, OG card
  unfurls (X card validator).
- [ ] **D3.** Post the page itself as a story beat ("the journey now has a
  home — built by the agent, receipts included") and add THAT post to the feed.
  The Devpost journey link is now this URL.

## Risks & sequencing

- **A1 before A2/C1** — the guard defines the schema; seed data and the writer
  conform to it, not vice versa.
- **The page is worth shipping before any win exists**: the seeded story +
  milestone entries already out-narrate an empty X account, and the rejection
  story is the strongest single beat we have. Don't block on Workstream A of
  the IAP plan or the X connection.
- **Pretty-URL caveat:** siblings are served as `.html` files; `/journey`
  vs `/journey.html` depends on Pages' clean-URL handling — verify at D2 and
  use whichever resolves in all published links (tracking-heathen's canonical
  omits `.html`, suggesting clean URLs work; confirm, don't assume).
- **Card copyright/consent:** win cards for CUSTOMER apps name the app. Ours
  is the only connected app for now; before journaling a customer win to the
  public page, that needs the customer's opt-in — out of scope here, flagged
  for the future.

## Shipaton fit

This is the #BuildInPublic hub link: one URL proving cadence (timeline),
transparency (rejection story sits next to the wins), and receipts (cards +
measured numbers + live `/proof`). ~1 day of work, zero new API surface, zero
new deploy surface.

**Effort:** A ≈ 2h · B ≈ 3–4h · C ≈ 2–3h · D ≈ 1h.
