# Git hooks

Version-controlled hooks for this repo. They are **not** active until you point
git at this directory (a tracked file can't set local git config itself):

```bash
git config core.hooksPath .githooks
```

Run that once per clone. The `cloud/package.json` `prepare` script does it for
you automatically after `npm install` in `cloud/`.

## `pre-push`

Runs the same gate the deploy workflow runs — **typecheck → unit (vitest) →
build → e2e (playwright, serial)** — locally, before anything reaches GitHub. A
branch that fails the gate never gets pushed, so the deploy-on-merge-to-main
pipeline isn't where you first discover a break.

- **typecheck + unit always run**, from `cloud/`.
- **e2e runs only when the push touches the app's UI** — any of
  `cloud/web/src/**`, `cloud/web/tests-e2e/**`, `cloud/web/index.html`, or
  `cloud/web/public/**`. Pure-backend pushes skip it and stay fast (~5s vs
  ~60s). The hook reads the exact pushed ranges from git's stdin to decide; a
  brand-new branch is compared against `origin/main`.
- **e2e builds first.** The suite runs from `cloud/web` against the built
  `dist/`, which `tests-e2e/serve.mjs` serves with an SPA fallback — so the gate
  exercises the real bundle, not the dev server.
- e2e runs `--workers=1` on purpose: a local gate should never false-block a
  push on parallelism flake, so it trades wall-clock for a reliable verdict.
- The hook frees port `:8794` first (`cloud/web/playwright.config.ts`) so a
  stale listener from another worktree can't poison the run.

> Updated for #356 Phase 3, which retired the legacy `cloud/public/` dashboard.
> The trigger paths, the port (`:8793` → `:8794`) and the suite's location all
> moved with it; the old `cloud/tests/e2e/` suite was deleted with its subject.

**Knobs:**

```bash
PREPUSH_E2E=always git push   # force e2e even on a backend-only push
PREPUSH_E2E=skip   git push   # never run e2e (typecheck + unit only)
git push --no-verify          # skip the ENTIRE gate (or: PREPUSH_SKIP=1 git push)
```

Requires `cloud/node_modules` (run `npm ci` in `cloud/` first); the hook errors
clearly if they're missing.
