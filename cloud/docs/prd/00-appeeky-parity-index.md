# Appeeky feature-parity PRDs — index & prioritization

**Created:** 2026-06-21
**Source gap analysis:** `docs/competitive/appeeky.md`, `docs/competitive/positioning-vs-appeeky.md`
**Scope:** Everything that moves ShipASO toward parity with Appeeky's *visible* feature surface.

---

## The honest framing (read before building anything)

Appeeky is ahead on **breadth, surfaces, data, platforms, and price** — and is one
feature away from claiming our wedge (the closed push-and-prove loop). The
positioning analysis concluded: **do not try to out-feature them.** These PRDs
exist so the gap is *understood and costed*, not so we blindly chase all of it.

Parity work splits into three honesty buckets:

- **Build, it widens the wedge.** Work that makes the closed loop more
  demonstrable or harder to copy → top priority (PRDs 01, 07).
- **Build to neutralize a checkbox-comparison loss**, where we can do it
  *honestly* → real but secondary (PRDs 02, 03, 06).
- **Do NOT build naively** — the data Appeeky shows as confident numbers is the
  exact data we deliberately refuse to fabricate (#78). Closing this "gap" means
  sourcing *real* data or labeling estimates as estimates. Never ship a fabricated
  number to match them (PRDs 04, 05).

The fastest competitive ROI is **not** parity — it's making the proof loop
demonstrable on one real app (see `positioning-vs-appeeky.md`). Treat these PRDs
as the parity backlog that runs *alongside* that, not instead of it.

---

## The PRDs

| # | Title | Gap it closes | Wedge impact | Honesty risk | Rough size |
|---|---|---|---|---|---|
| [01](./01-mcp-server.md) | MCP server (agent integration) | No MCP server exposing our data as tools | **Widens** — makes the loop usable from Claude/Cursor | Low | M |
| [02](./02-daily-rank-cadence.md) | Configurable + daily rank cadence | We run weekly; they snapshot daily | Neutral | Low | S–M |
| [03](./03-review-sentiment.md) | Review sentiment + topic extraction | Whole analytics surface we lack | Neutral | Low (real public data) | M |
| [04](./04-keyword-metrics-honest.md) | Volume / difficulty / opportunity — **honest** | They show numbers; we show "unmeasured" | **HIGH** | M–L |
| [05](./05-google-play-platform.md) | Google Play (Android) support | iOS-only vs their iOS+Android | Neutral | L |
| [06](./06-native-surfaces.md) | Native macOS / iOS companion surfaces | Web-only vs desktop+mobile+web | Neutral | L (post-launch) |
| [07](./07-rlhf-activation.md) | Activate the learning-from-edits loop | Dormant plumbing → real differentiator | **Widens** | Medium (governance) | M |

**Wedge impact** = does it strengthen the one thing Appeeky can't yet copy.
**Honesty risk** = does shipping it tempt us to present unmeasured data as measured.

---

## Recommended sequencing

1. **PRD 01 (MCP server)** — highest leverage. It's the only parity item that
   *also* widens the wedge: it puts the push-and-prove loop inside the agent IDEs
   where our buyers already work, and it's a clean, bounded build on top of
   engine functions that already exist and are tested.
2. **PRD 02 (cadence)** — small, already half-specced (#52/#53), removes a
   visible "they're daily, you're weekly" loss. Daily rank data also *feeds the
   proof loop* (tighter before/after attribution → PRD in `rankAttribution.ts`).
3. **PRD 03 (review sentiment)** — real public data, no fabrication risk, fills a
   whole missing analytics tab. Good standalone value.
4. **PRD 07 (RLHF activation)** — only after a governance/owner decision; turns
   already-shipped dormant plumbing into a claim we can defend.
5. **PRD 04 (keyword metrics)** — do LAST and CAREFULLY. This is the one that can
   quietly violate the product's core honesty discipline. Read its "Non-goals"
   section twice.
6. **PRDs 05 / 06 (Android, native surfaces)** — large, post-launch, only if the
   market signal justifies the surface-area expansion.

---

## What these PRDs deliberately do NOT cover

- **Racing Appeeky to the bottom on price** ($8/$20/$66). A pricing decision, not
  a feature PRD.
- **Out-featuring them on breadth.** The positioning doc is explicit: breadth is
  their game, not ours.
- **Marketing the learning loop before it's real** (covered as a non-goal in 07).
- **Issue #34 (live store push from the UI)** is explicitly out of scope for any
  of these — it remains a never-auto-build per the product's safety constraints.
