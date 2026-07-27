# store-ops

For project structure, conventions, and the traps this repo has actually hit,
see `.claude/codebase-context.md`.

Two invariants override convenience everywhere in this codebase:

1. **Measured-or-nothing.** Every displayed number is measured or absent — `—`,
   never a placeholder, never `0` standing in for "unknown".
2. **Approval is the terminus.** Nothing claims ShipASO pushes to a store on its
   own. Approving is not shipping.

Verify claims against the source. Issues, comments, and docs in this repo have
repeatedly described work as unbuilt long after it shipped.
