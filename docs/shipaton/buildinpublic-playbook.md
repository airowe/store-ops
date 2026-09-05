# #BuildInPublic playbook — cadence, beats, and the evidence ledger

The award is judged on three axes (confirmed, see `docs/shipaton/brief.md`):
**transparency & storytelling · engagement · learning & iteration.** Audience
size explicitly does not matter. What matters is a legible public journey with
receipts — and evidence that public feedback changed the product.

Only posts inside the engagement window (Aug 1, 8:30 am PT – Sep 30, 11:45 pm PT)
count. Every post's link goes in the ledger at the bottom — the Devpost form
asks for them, and compiling them the night before the deadline is how entries
die.

## The three post engines (least → most manual)

1. **Win posts.** The agent moves a real rank → the engine composes the post +
   proof card (`cloud/src/buildInPublicPost.ts`), and the posting edge
   (`packages/postedge/cli.mjs`) rasterizes them into the outbox. Two legs:
   - **Bluesky — fully automated.** `--post-cmd packages/postedge/bsky-post.mjs`
     posts text + card via the free AT Protocol API (app password, never the
     account password) and journals the win with its bsky.app link.
   - **X — manual paste.** X has no free write API and we're not paying for
     one: paste the prepared post (30 seconds), then `--mark-posted <url>`
     consumes + journals the win exactly as an automated post would.
   One win, one journal entry — whichever leg runs first consumes it; add the
   other platform's link to the entry by hand if you post there too. The
   meta-story survives intact: *the agent writes its own announcements.*
2. **Build-log threads (semi-automated).** Weekly "what shipped" thread drafted
   from the real merge history by `packages/postedge/buildlog.mjs` — run it,
   edit for voice, post. Cadence is the hardest axis to sustain by hand; this
   makes the floor automatic.
3. **Story posts (manual, highest value).** The beats below. Wins AND
   challenges — the judges say both count.

## Story beats (the calendar)

| When | Beat | Why it lands |
|---|---|---|
| now | **"Apple rejected us on 4 guidelines. Here's all of them."** — from `marketing/aso/shipaso/rejection-2026-07-29.md` | Transparency axis. Rejection stories out-engage launch posts, and ours ends with a real fix (IAP) |
| now | **The monetization architecture post** — Stripe on web + RevenueCat IAP in-app, server as source of truth, "highest active tier wins" so nobody double-pays | HAMM crossover evidence + shows real engineering in public |
| now | **"Rejected again — and the bug was in the instructions"** — 2.1(a) on 08-24; the reviewer could not sign in because our own notes sent them to a mailbox only we can read, while the fix (a 90-day review token) had already shipped in code and nobody put it in the notes. Draft: `docs/shipaton/posts/2026-09-04-rejected-again.md` | The strongest learning-&-iteration beat we have: a documented misdiagnosis, corrected in public, with the receipt (signed in on an iPad sim to prove it). Ships the "wins AND challenges" advice literally |
| 0.1.1 submitted | **"Resubmission day"** — what changed since the rejection, screenshot of the ASC submit screen | A cliffhanger judges can follow |
| 0.1.1 live | **Launch post** — store link + the first real IAP sandbox→production story | The hard gate, celebrated in public |
| first real win | **The first automated win post** + a quote-post explaining the pipeline behind it | The product IS the growth loop — say so over the receipt |
| weekly | **Build-log thread** (engine 2) | Cadence floor |
| Sep (pre-submit) | **"What public feedback changed"** roundup — link each shipped change to the comment/issue that prompted it | The learning & iteration axis, made explicit. Start collecting NOW (ledger column below) |

## Rules of engagement

- Post everything to X first, then drop the link in the Shipaton Discord
  **#post-engagement-boost** channel (exists for exactly this).
- Reply to every substantive comment — "engagement" is judged as discussion
  sparked, and replies are where feedback (→ iteration evidence) comes from.
- Honesty invariants apply in public exactly as in-product: measured numbers or
  nothing, and never claim the agent pushes to a store on its own — approving
  is not shipping.
- When a public suggestion ships, say so in the PR body AND link the PR back in
  the thread — that closes the loop both directions and feeds the Sep roundup.

## Evidence ledger

**The ledger is `docs/landing/journey/feed.json`** — the same file that renders
the public journey page at shipaso.com/journey (see
`docs/landing/journey.html`). Win entries are appended automatically by the
posting edge (`--journal`, only on a successful post); story/milestone beats
are committed by hand. `packages/docpaths/journeyFeed.test.mjs` guards every
entry: real past dates, existing card assets, measured-or-absent numbers,
https links. At submission, the Devpost post-links field is compiled from the
feed entries' post links (`links.post` — X, Bluesky, or wherever the post
lives).

Feedback-that-shipped notes (the Sep roundup's raw material) go in the entry
`body` when the change ships, with the PR linked in `links.pr`.
