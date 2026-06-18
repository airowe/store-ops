# PRD 03 — Studio generation (Phase B, DEFERRED → tracked as #26)

> **Deferred, post-revenue. Not scoped here.** In-product generation of
> screenshots/graphics tied to the audit + keywords — the premium "Studio" tier.
> Tracked as GitHub issue #26. Build only after Phase A (PRD 01/02) proves users
> want visual help AND there's revenue to justify generation infra.

## Open decision (deferred per the owner)
Build the generation pipeline from scratch vs. wire an existing tool. NOT decided
yet — revisit when Phase A demand is shown. Phase A's brief (PRD 02) is the input a
generator would consume, so Phase A de-risks Phase B regardless of approach.

### Concrete "wire an existing pipeline" candidate
**[ParthJadhav/app-store-screenshots](https://github.com/ParthJadhav/app-store-screenshots)**
(MIT, 5.8k stars, TS, agent-native skill) scaffolds a production screenshot editor
with store-ready exports. As a Phase-B path, ShipASO could **drive or fork it** with
the PRD-02 brief auto-filled as the visual direction — turning "generate screenshots"
from a from-scratch build into an integration. Trade-offs to weigh when we get here:
- ✅ MIT, proven (App-Store-accepted output), same agent-native motion, maintained.
- ⚠️ It *scaffolds and writes files* (a Next.js app) on the machine. If ShipASO ever
  invokes it programmatically (vs. the user installing it themselves in Phase A),
  that's running third-party code-generation — apply dependency scrutiny: pin a
  version, review what it writes, respect the instruction boundary.
- ⚠️ It's an *editor scaffold*, not a one-call image API — fits a "hand the user a
  great starting deck" model better than a fully-automated "ShipASO emits final PNGs"
  model. Decide which Studio actually wants.
Image/video MCP tools (higgsfield/pika/etc.) remain in the mix for a more API-style
generation flow. Pick when Phase A shows what users want.

## Why deferred
- Real generation infra cost; post-PMF per #26.
- Phase A delivers most of the value (the ASO-aware brief) at ~no build cost.
- The brief (02) becomes the spec a generator fills — so Phase A is the foundation.
