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
e2e (playwright, serial)** — locally, before anything reaches GitHub. A branch
that fails the gate never gets pushed, so the deploy-on-merge-to-main pipeline
isn't where you first discover a break.

- **typecheck + unit always run.**
- **e2e runs only when the push touches UI** (`cloud/public/**` or
  `cloud/tests/e2e/**`). Pure-backend pushes skip it and stay fast (~5s vs ~60s).
  The hook reads the exact pushed ranges from git's stdin to decide; a brand-new
  branch is compared against `origin/main`.
- e2e runs `--workers=1` on purpose: a few specs (picker pagination) are flaky
  under default parallelism + the shared `:8793` static server. Serial is
  deterministic, and a local gate must never false-block a push.
- The hook frees port `:8793` first so a stale listener from another worktree
  can't poison the run.

**Knobs:**

```bash
PREPUSH_E2E=always git push   # force e2e even on a backend-only push
PREPUSH_E2E=skip   git push   # never run e2e (typecheck + unit only)
git push --no-verify          # skip the ENTIRE gate (or: PREPUSH_SKIP=1 git push)
```

Requires `cloud/node_modules` (run `npm ci` in `cloud/` first); the hook errors
clearly if they're missing.
