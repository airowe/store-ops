# Onboarding Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/onboarding` the real first-run setup flow — four working steps over real endpoints — and delete the fabricated demo data it renders today.

**Architecture:** The persistence layer already exists (`app_competitors` + six shipped endpoints). This is a wiring and UI-completion job, not a backend build. `ConnectCard`'s search/connect logic is extracted from `DashboardView` into a shared component so onboarding step 2 and the dashboard's add-another path share one implementation. Zero-app users are redirected into the flow; the now-unreachable empty-state `ConnectCard` is deleted.

**Tech Stack:** React 18, TanStack Router + Query, TypeScript strict, Vitest + Testing Library, Playwright (E2E)

**Spec:** `docs/superpowers/specs/2026-08-24-onboarding-cutover-design.md`

## Global Constraints

- **Measured-or-nothing.** Every displayed number/grade is measured or absent (`—`). Never a placeholder, never `0` or a sample value standing in for "unknown".
- **Approval is the terminus.** Nothing may claim ShipASO pushes to a store on its own. The footer promise ("You approve every change. Nothing ships on its own.") stays.
- **Test files:** `*.test.ts[x]`, colocated with source.
- **TDD is mandatory:** stub → failing test → implement. A test that cannot fail is not a test.
- **`toBeInTheDocument()` is insufficient** for any control in this flow. Assert behavior — href, handler effect, or resulting call. This is how #329 shipped inert and #503 survived a strangler migration.
- **Store support is App Store only.** `POST /apps` has no store parameter; it resolves via iTunes. Google Play must render disabled/"coming soon", never as a selectable option.
- **No `// TODO:` comments.** File a GitHub issue instead.
- Conventional Commits; no AI tool names in commit messages.

## Critical finding — the grade pill has no data source

The design describes step 2 showing an "Audited: A−" pill. **`ConnectResult` is `{ id, name, bundleId }` — there is no grade**, and `AppListItem` has no grade either. Connect *triggers* a run; a grade exists only once that run completes.

`packages/api/types.ts:649` documents this exact failure mode from a previous occurrence:

> "This type previously claimed `{ grade, summary, findings }`, which the server has never sent; every field read `undefined` and the preview card rendered empty."

Therefore: **step 2 renders no grade at connect time.** The honest source is `findings_summary` (nullable, populated post-run) on `AppListItem`. Task 4 renders the app name only, with the audit state shown as pending — never an invented grade. Do not add a `grade` field to any type to satisfy the design mock.

---

### Task 1: Remove the fabricated demo data

`sampleState()` seeds a real user's screen with `name: "Cal AI"` and `grade: "A−"` — an invented app and fabricated audit result presented as their own. This is a live measured-or-nothing violation and ships first, independent of the rest.

**Files:**
- Modify: `cloud/web/src/features/onboarding/onboardingModel.ts`
- Modify: `cloud/web/src/features/onboarding/OnboardingView.tsx:32`
- Test: `cloud/web/src/features/onboarding/onboardingModel.test.ts`
- Test: `cloud/web/src/features/onboarding/OnboardingView.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `emptyState(): OnboardingState` — replaces `sampleState()` as the default. Shape unchanged: `{ stepIndex: 0, store: null, app: null, rivals: [], suggested: [] }`

- [ ] **Step 1: Write the failing test**

In `onboardingModel.test.ts`:

```ts
describe("emptyState", () => {
  it("invents no app, no grade, and no rivals", () => {
    const s = emptyState();
    expect(s.app).toBeNull();
    expect(s.store).toBeNull();
    expect(s.rivals).toEqual([]);
    expect(s.suggested).toEqual([]);
    expect(s.stepIndex).toBe(0);
  });
});
```

In `OnboardingView.test.tsx` — the negative control that proves the fake data is gone:

```ts
it("renders no fabricated app or grade when given no initial state", () => {
  render(<OnboardingView onDone={() => {}} onSkip={() => {}} />);
  expect(screen.queryByText(/Cal AI/)).toBeNull();
  expect(screen.queryByText(/A−/)).toBeNull();
  expect(screen.queryByText(/Audited:/)).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud/web && npx vitest run src/features/onboarding/`
Expected: FAIL — `emptyState is not defined`, and the view test finds "Cal AI".

- [ ] **Step 3: Implement**

In `onboardingModel.ts`, replace `sampleState` with:

```ts
/**
 * The starting state for a real user: nothing answered, nothing invented.
 * (Replaces sampleState(), which seeded a fabricated app + grade — measured-or-
 * nothing means an unanswered step renders empty, never a plausible sample.)
 */
export function emptyState(): OnboardingState {
  return { stepIndex: 0, store: null, app: null, rivals: [], suggested: [] };
}
```

Delete `sampleState` entirely. In `OnboardingView.tsx:32`:

```tsx
const [state, setState] = useState<OnboardingState>(initial ?? emptyState());
```

Update the `sampleState` import to `emptyState`.

Two existing tests assert the fabricated values and MUST be updated — they are
currently pinning the bug in place:

- `onboardingModel.test.ts:15` — a fixture literal `app: { name: "Cal AI", grade: "A−" }`
- `onboardingModel.test.ts:78` — `expect(s.app).toEqual({ name: "Cal AI", grade: "A−" })`

Move that fixture into the test file as a local constant (test data belongs in
tests, not in the shipped model) and drop `grade` from it — Task 4 removes the
field. Do not delete these tests to make the suite pass; rewrite them against
the local fixture.

Reference: `mobile/src/onboarding/model.ts:71` already does this correctly —
`initialState()` returns the same empty shape and invents nothing. Mobile is NOT
affected by this defect; only its test fixtures mention "Cal AI", which is fine.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud/web && npx vitest run src/features/onboarding/`
Expected: PASS. Then `npx vitest run` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add cloud/web/src/features/onboarding/
git commit -m "fix(onboarding): stop rendering a fabricated app and grade"
```

---

### Task 2: Un-route /onboarding while the flow is incomplete

The spec's stated risk: `/onboarding` is URL-reachable today and, mid-build, would show a partial wizard to anyone who guesses the path — including an App Review reviewer. Un-route it now; Task 7 restores it complete.

**Files:**
- Modify: `cloud/web/src/router.tsx:36,58`
- Modify: `cloud/web/src/shell/edgeRoutes.ts:28`
- Test: `cloud/web/src/shell/edgeRoutes.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `/onboarding` resolves to `"legacy"` (i.e. not owned by the SPA) until Task 7

- [ ] **Step 1: Write the failing test**

In `edgeRoutes.test.ts`:

```ts
it("does not own /onboarding while the flow is incomplete (restored in Task 7)", () => {
  expect(resolveSurface("/onboarding")).toBe("legacy");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cloud/web && npx vitest run src/shell/edgeRoutes.test.ts`
Expected: FAIL — receives `"web"`.

- [ ] **Step 3: Implement**

Remove `"/onboarding"` from `OWNED_PATHS` in `edgeRoutes.ts`. In `router.tsx`, remove `onboardingRoute` from the route tree array (line 58) and its `createRoute` (line 36). Leave the import and `routes/onboarding.tsx` in place — Task 7 restores them.

Remove the now-stale assertion in `edgeRoutes.test.ts` that expects `/onboarding` to be owned, if one exists.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud/web && npx vitest run && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add cloud/web/src/router.tsx cloud/web/src/shell/edgeRoutes.ts cloud/web/src/shell/edgeRoutes.test.ts
git commit -m "chore(onboarding): un-route the incomplete flow until it is finished"
```

---

### Task 3: Extract ConnectCard into a shared component

`ConnectCard` is currently a private function inside `DashboardView.tsx:340`. Step 2 needs the same search/connect behavior. Extract before reuse so there is one implementation.

This touches the connect path users rely on today — the move must be behavior-preserving.

**Files:**
- Create: `cloud/web/src/features/connect/ConnectAppCard.tsx`
- Create: `cloud/web/src/features/connect/ConnectAppCard.test.tsx`
- Modify: `cloud/web/src/features/dashboard/DashboardView.tsx` (delete local `ConnectCard`, import the shared one)

**Interfaces:**
- Consumes: `resolveApps(client, query, offset?)`, `connectApp(client, { bundle_id?, query?, name? })` from `@shipaso/api`; types `Candidate`, `ConnectResult`
- Produces: `<ConnectAppCard client={ApiClient} onConnected={(id: string) => void} heading?={string} />` — `heading` defaults to `"Connect an app"`

- [ ] **Step 1: Write the failing test**

In `ConnectAppCard.test.tsx`:

```tsx
it("searches, then connects the chosen candidate and reports the new id", async () => {
  const resolve = vi.fn().mockResolvedValue({ candidates: [{ bundle_id: "com.a", name: "Acme" }] });
  const connect = vi.fn().mockResolvedValue({ id: "app-1", name: "Acme", bundleId: "com.a" });
  const onConnected = vi.fn();
  renderWithClient(<ConnectAppCard client={fakeClient({ resolve, connect })} onConnected={onConnected} />);

  await userEvent.type(screen.getByTestId("connect-input"), "acme");
  await userEvent.click(screen.getByTestId("connect-search"));
  await userEvent.click(await screen.findByTestId("cand-com.a"));

  await waitFor(() => expect(onConnected).toHaveBeenCalledWith("app-1"));
});

it("renders an honest empty state when the search matches nothing", async () => {
  const resolve = vi.fn().mockResolvedValue({ candidates: [] });
  renderWithClient(<ConnectAppCard client={fakeClient({ resolve })} onConnected={() => {}} />);
  await userEvent.type(screen.getByTestId("connect-input"), "zzz");
  await userEvent.click(screen.getByTestId("connect-search"));
  expect(await screen.findByText("No matches.")).toBeInTheDocument();
});
```

Mirror the existing dashboard test helpers for `renderWithClient` / `fakeClient`; if none exist, build a minimal QueryClientProvider wrapper and a stub `ApiClient` whose `post`/`get` dispatch to the supplied mocks.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cloud/web && npx vitest run src/features/connect/`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Move the `ConnectCard` function body from `DashboardView.tsx:340-392` verbatim into `ConnectAppCard.tsx`, renaming the export to `ConnectAppCard` and adding the optional `heading` prop:

```tsx
export function ConnectAppCard({
  client,
  onConnected,
  heading = "Connect an app",
}: {
  client: ApiClient;
  onConnected: (id: string) => void;
  heading?: string;
}) {
  // ...body moved verbatim; replace the hardcoded <b>Connect an app</b> with <b>{heading}</b>
}
```

Keep every `data-testid` unchanged (`connect-input`, `connect-search`, `cand-*`) — existing dashboard tests depend on them. In `DashboardView.tsx`, delete the local function and import the shared component; both call sites keep their current props.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud/web && npx vitest run && npx tsc --noEmit`
Expected: PASS — including the pre-existing dashboard connect tests, which prove the extraction preserved behavior.

- [ ] **Step 5: Commit**

```bash
git add cloud/web/src/features/connect/ cloud/web/src/features/dashboard/DashboardView.tsx
git commit -m "refactor(connect): extract ConnectAppCard so onboarding and the dashboard share one connect"
```

---

### Task 4: Build steps 1 and 2 (store, then app)

**Files:**
- Modify: `cloud/web/src/features/onboarding/OnboardingView.tsx`
- Modify: `cloud/web/src/features/onboarding/onboardingModel.ts`
- Test: `cloud/web/src/features/onboarding/OnboardingView.test.tsx`
- Test: `cloud/web/src/features/onboarding/onboardingModel.test.ts`

**Interfaces:**
- Consumes: `emptyState()` (Task 1), `<ConnectAppCard>` (Task 3), `storeLabel(store)`
- Produces:
  - `chooseStore(state, store: Store): OnboardingState` — sets `store`, advances `stepIndex` to 1
  - `setApp(state, app: { name: string }): OnboardingState` — sets `app`, advances `stepIndex` to 2
  - `OnboardingState["app"]` narrows to `{ name: string } | null` (the `grade` field is REMOVED — see "Critical finding" above)

- [ ] **Step 1: Write the failing test**

In `onboardingModel.test.ts`:

```ts
it("chooseStore records the store and advances to the app step", () => {
  const s = chooseStore(emptyState(), "app-store");
  expect(s.store).toBe("app-store");
  expect(s.stepIndex).toBe(1);
});

it("setApp records the name and advances to rivals", () => {
  const s = setApp(chooseStore(emptyState(), "app-store"), { name: "Acme" });
  expect(s.app).toEqual({ name: "Acme" });
  expect(s.stepIndex).toBe(2);
});
```

In `OnboardingView.test.tsx`:

```tsx
it("offers App Store as the only selectable store, with Play visibly unavailable", () => {
  render(<OnboardingView onDone={() => {}} onSkip={() => {}} />);
  expect(screen.getByTestId("onb-store-app-store")).toBeEnabled();
  const play = screen.getByTestId("onb-store-google-play");
  expect(play).toBeDisabled();
  expect(play).toHaveTextContent(/coming soon/i);
});

it("choosing a store reveals the connect step", async () => {
  render(<OnboardingView onDone={() => {}} onSkip={() => {}} />);
  await userEvent.click(screen.getByTestId("onb-store-app-store"));
  expect(screen.getByTestId("connect-input")).toBeInTheDocument();
});

it("claims no audit grade for a freshly connected app", async () => {
  render(<OnboardingView onDone={() => {}} onSkip={() => {}} initial={{
    stepIndex: 2, store: "app-store", app: { name: "Acme" }, rivals: [], suggested: [],
  }} />);
  expect(screen.getByTestId("onb-answer-app")).toHaveTextContent("Acme");
  expect(screen.queryByText(/Audited:/)).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud/web && npx vitest run src/features/onboarding/`
Expected: FAIL — `chooseStore`/`setApp` undefined; store buttons absent.

- [ ] **Step 3: Implement**

In `onboardingModel.ts`, narrow the app type and add the two transitions:

```ts
/**
 * The connected app (step 2). Name only: connect returns { id, name, bundleId }
 * and carries NO grade — a grade exists only after the triggered run completes.
 * (types.ts:649 records what happens when a type claims a field the server never
 * sends: every read is undefined and the UI renders empty, silently.)
 */
app: { name: string } | null;

export function chooseStore(state: OnboardingState, store: Store): OnboardingState {
  return { ...state, store, stepIndex: Math.max(state.stepIndex, 1) };
}

export function setApp(state: OnboardingState, app: { name: string }): OnboardingState {
  return { ...state, app, stepIndex: Math.max(state.stepIndex, 2) };
}
```

In `OnboardingView.tsx`, render step 1 as the active step when `state.store === null`:

```tsx
<div className="onb-store-choice">
  <button
    type="button"
    className="btn primary"
    data-testid="onb-store-app-store"
    onClick={() => setState((s) => chooseStore(s, "app-store"))}
  >
    App Store
  </button>
  <button type="button" className="btn ghost" data-testid="onb-store-google-play" disabled>
    Google Play · coming soon
  </button>
</div>
```

When `state.store !== null && state.app === null`, render step 2:

```tsx
<ConnectAppCard
  client={client}
  heading="Which app?"
  onConnected={(id) => { onAppConnected(id); }}
/>
```

`OnboardingView` gains two props: `client: ApiClient` and `onAppConnected: (id: string) => void` (the route supplies both; the route holds the connected app id for Task 5). The collapsed answer row for the app renders `{state.app.name}` and NO grade pill — delete the `onb-grade-pill` markup.

Also delete the two inert `Edit` buttons (#504) rather than wiring them: an unanswered step is reached by not having answered it, and re-editing a connected app is a dashboard concern, not a first-run one.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud/web && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloud/web/src/features/onboarding/
git commit -m "feat(onboarding): real store and app steps, with no invented grade"
```

---

### Task 5: Wire step 3 (rivals) to the real endpoints

Replace throwaway local chip state with the shipped competitor endpoints.

**Files:**
- Modify: `cloud/web/src/features/onboarding/OnboardingView.tsx`
- Test: `cloud/web/src/features/onboarding/OnboardingView.test.tsx`

**Interfaces:**
- Consumes: `getCompetitors(c, id)`, `discoverCompetitors(c, id)`, `addCompetitor(c, id, { name })`, `confirmCompetitor(c, id, key)`, `removeCompetitor(c, id, key)` — all returning `CompetitorsResponse = { competitors: Competitor[]; discovered?: number; note?: string }`, where `Competitor = { key, name, source, status }` and `status: "confirmed" | "suggested"`
- Produces: nothing consumed downstream

- [ ] **Step 1: Write the failing test**

```tsx
it("seeds rivals from real discovery and confirms through the API", async () => {
  const discover = vi.fn().mockResolvedValue({
    competitors: [{ key: "k1", name: "Rival One", source: "itunes", status: "suggested" }],
    discovered: 1,
  });
  const confirm = vi.fn().mockResolvedValue({
    competitors: [{ key: "k1", name: "Rival One", source: "itunes", status: "confirmed" }],
  });
  renderOnboardingAtRivals({ discover, confirm });

  await userEvent.click(await screen.findByTestId("onb-suggest-k1"));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.anything(), "app-1", "k1"));
});

it("says there are no suggestions yet rather than inventing seeds", async () => {
  const discover = vi.fn().mockResolvedValue({
    competitors: [],
    discovered: 0,
    note: "No tracked keywords yet — add a rival by name.",
  });
  renderOnboardingAtRivals({ discover });

  expect(await screen.findByTestId("onb-rivals-empty"))
    .toHaveTextContent("No tracked keywords yet — add a rival by name.");
  expect(screen.queryByTestId(/^onb-suggest-/)).toBeNull();
});

it("adds a typed rival through the API", async () => {
  const add = vi.fn().mockResolvedValue({
    competitors: [{ key: "k9", name: "Typed", source: "manual", status: "confirmed" }],
  });
  renderOnboardingAtRivals({ discover: vi.fn().mockResolvedValue({ competitors: [] }), add });

  await userEvent.type(screen.getByTestId("onb-rival-input"), "Typed");
  await userEvent.click(screen.getByTestId("onb-rival-add"));
  await waitFor(() => expect(add).toHaveBeenCalledWith(expect.anything(), "app-1", { name: "Typed" }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud/web && npx vitest run src/features/onboarding/`
Expected: FAIL — chips are local-only; `onb-rival-input` and `onb-rivals-empty` do not exist.

- [ ] **Step 3: Implement**

On entering step 3, fire `discoverCompetitors(client, appId)` once via `useQuery`. Derive both lists from the response — `confirmed = competitors.filter(c => c.status === "confirmed")`, `suggested = competitors.filter(c => c.status === "suggested")` — rather than from local state. Wire, following `CompetitorsCard.tsx`'s mutation pattern (invalidate/`onSuccess` refresh):

- suggested chip click → `confirmCompetitor`
- confirmed chip `×` → `removeCompetitor`
- `+ Add rival` (the third inert button from #504) → reveal a text input `onb-rival-input` with an `onb-rival-add` submit → `addCompetitor(client, appId, { name })`

When `competitors` is empty, render `data-testid="onb-rivals-empty"` showing the server's `note` verbatim, falling back to "No suggestions yet — add a rival by name." Never synthesize rival names.

`onboardingModel`'s `addRival`/`removeRival` may remain as pure optimistic helpers over the server list, or be deleted if unused — do not keep them as the source of truth.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud/web && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloud/web/src/features/onboarding/
git commit -m "feat(onboarding): rivals step over the real competitor endpoints"
```

---

### Task 6: Step 4 (optional key) and the finish transition

**Files:**
- Modify: `cloud/web/src/features/onboarding/OnboardingView.tsx`
- Test: `cloud/web/src/features/onboarding/OnboardingView.test.tsx`

**Interfaces:**
- Consumes: `state.app` (Task 4)
- Produces: nothing consumed downstream

- [ ] **Step 1: Write the failing test**

```tsx
it("links the optional key step to the credential surface without claiming a key exists", async () => {
  renderOnboardingAtRivals({ discover: vi.fn().mockResolvedValue({ competitors: [] }) });
  const link = screen.getByTestId("onb-connect-key");
  expect(link).toHaveAttribute("href", "/settings");
  expect(screen.getByTestId("onb-upcoming")).toHaveTextContent(/read-only until you do/i);
});

it("keeps the approval promise on screen", () => {
  render(<OnboardingView {...baseProps} />);
  expect(screen.getByText(/Nothing ships on its own/i)).toBeInTheDocument();
});

it("Continue hands back the collected state", async () => {
  const onDone = vi.fn();
  render(<OnboardingView {...baseProps} onDone={onDone} />);
  await userEvent.click(screen.getByTestId("onb-continue"));
  expect(onDone).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud/web && npx vitest run src/features/onboarding/`
Expected: FAIL — `onb-connect-key` does not exist.

- [ ] **Step 3: Implement**

Turn the dimmed upcoming row into a real anchor to the existing credential surface — an `<a href="/settings">`, not a button, matching the #503 lesson that a control which goes nowhere is not a control:

```tsx
<a className="onb-upcoming-link" href="/settings" data-testid="onb-connect-key">
  Connect a key to push
</a>
<span className="onb-upcoming-note mono">optional · read-only until you do</span>
```

Keep the footer promise verbatim. `Continue →` and `Skip` already call `onDone`/`onSkip` — leave them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud/web && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloud/web/src/features/onboarding/
git commit -m "feat(onboarding): optional key step links to the real credential surface"
```

---

### Task 7: Restore the route and redirect zero-app users

**Files:**
- Modify: `cloud/web/src/router.tsx`
- Modify: `cloud/web/src/shell/edgeRoutes.ts`
- Modify: `cloud/web/src/routes/onboarding.tsx`
- Modify: `cloud/web/src/features/dashboard/DashboardView.tsx` (delete the empty-state `ConnectAppCard` + empty block)
- Test: `cloud/web/src/shell/edgeRoutes.test.ts`
- Test: `cloud/web/src/features/dashboard/DashboardView.test.tsx`

**Interfaces:**
- Consumes: the completed `<OnboardingView>` (Tasks 4–6)
- Produces: `/onboarding` owned again; dashboard redirects at zero apps

- [ ] **Step 1: Write the failing test**

In `edgeRoutes.test.ts` — replace the Task 2 assertion:

```ts
it("owns /onboarding now that the flow is complete", () => {
  expect(resolveSurface("/onboarding")).toBe("web");
});
```

In `DashboardView.test.tsx`:

```tsx
it("sends a user with no apps to the guided setup", async () => {
  const navigate = vi.fn();
  renderDashboard({ apps: [], navigate });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/onboarding", replace: true }));
});

it("does not redirect a user who already has an app", async () => {
  const navigate = vi.fn();
  renderDashboard({ apps: [{ id: "a1", name: "Acme", bundle_id: "com.a" }], navigate });
  await waitFor(() => expect(screen.getByTestId("dashboard")).toBeInTheDocument());
  expect(navigate).not.toHaveBeenCalled();
});

it("keeps the add-another connect card for an existing user", () => {
  renderDashboard({ apps: [{ id: "a1", name: "Acme", bundle_id: "com.a" }] });
  expect(screen.getByTestId("connect-input")).toBeInTheDocument();
});
```

The second test is the negative control: without it, an unconditional redirect passes the first.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud/web && npx vitest run src/shell/ src/features/dashboard/`
Expected: FAIL — `/onboarding` resolves `"legacy"`; no redirect fires.

- [ ] **Step 3: Implement**

Restore `"/onboarding"` in `OWNED_PATHS` and re-add `onboardingRoute` to `router.tsx`'s route tree.

In `routes/onboarding.tsx`, supply the new props and hold the connected app id:

```tsx
export function OnboardingRoute() {
  const navigate = useNavigate();
  const [appId, setAppId] = useState<string | null>(null);
  const toDashboard = () => void navigate({ to: "/dashboard" });
  return (
    <OnboardingView
      client={client}
      appId={appId}
      onAppConnected={setAppId}
      onDone={toDashboard}
      onSkip={toDashboard}
    />
  );
}
```

Update the file's doc comment — the "answers stay local until a real persistence hook exists" note is no longer true.

In `DashboardView.tsx`, replace the zero-app block with a redirect:

```tsx
if (apps.length === 0) {
  return <Navigate to="/onboarding" replace />;
}
```

Delete the empty-state `<ConnectAppCard>` and the `data-testid="empty"` block — both become unreachable. Keep the `ConnectAppCard` below the tracked list untouched.

Guard the redirect behind the same loading/error checks that already precede it, so a logged-out or still-loading visitor is never bounced on a transient empty list (`DashboardView.tsx:38` documents this exact hazard).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud/web && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloud/web/src/router.tsx cloud/web/src/shell/edgeRoutes.ts cloud/web/src/routes/onboarding.tsx cloud/web/src/features/dashboard/
git commit -m "feat(onboarding): route first-run users into the guided setup"
```

---

### Task 8: E2E the whole flow, then verify in a browser

**Files:**
- Create/modify: `cloud/web/tests-e2e/onboarding.e2e.ts`

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 1: Write the failing test**

```ts
test("first-run: no apps → guided setup → connect → confirm a rival → dashboard", async ({ page }) => {
  await routeMockBackend(page, { apps: [] });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/onboarding/);

  await page.getByTestId("onb-store-app-store").click();
  await page.getByTestId("connect-input").fill("acme");
  await page.getByTestId("connect-search").click();
  await page.getByTestId("cand-com.acme").click();

  await page.getByTestId("onb-suggest-k1").click();
  await page.getByTestId("onb-continue").click();
  await expect(page.getByTestId("dashboard")).toBeVisible();
});

test("the guided setup never shows a grade it has not measured", async ({ page }) => {
  await routeMockBackend(page, { apps: [] });
  await page.goto("/onboarding");
  await expect(page.getByText("Cal AI")).toHaveCount(0);
  await expect(page.getByText(/Audited:/)).toHaveCount(0);
});
```

Follow the mock-backend routing pattern already used in `tests-e2e/happyPath.e2e.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud/web && npm run test:e2e -- --workers=1`
Expected: FAIL before Tasks 1–7 are complete.

- [ ] **Step 3: Implement**

No product code — this task verifies. If a test fails, fix the defect in the owning task's files and note it in the commit.

- [ ] **Step 4: Run the full gate**

```bash
cd cloud/web && npx tsc --noEmit && npx vitest run && npm run test:e2e -- --workers=1 --retries=1 && npm run build
```
Expected: all green.

Then verify in a real browser, not only in tests — a rendered-correctly check is not a works-correctly check (#503 passed 9 unit tests while the button did nothing):
- `/onboarding` with zero apps: all four steps reachable, no "Cal AI", no invented grade
- each control actually does something when clicked
- both light and dark themes

- [ ] **Step 5: Commit**

```bash
git add cloud/web/tests-e2e/
git commit -m "test(onboarding): e2e the first-run flow end to end"
```

---

## Definition of done

- [ ] `sampleState` is deleted; no fabricated app or grade can reach a user
- [ ] All four steps work over real endpoints; nothing collected is discarded
- [ ] Zero-app users land in `/onboarding`; 1+ app users are not redirected
- [ ] The three inert buttons from #504 are gone — wired or deliberately removed
- [ ] Every control asserts behavior in a test that can fail
- [ ] Full gate green: typecheck, unit, E2E, build
- [ ] Verified by hand in a browser, both themes
- [ ] #504 closed as superseded; spec and plan linked from the PR
