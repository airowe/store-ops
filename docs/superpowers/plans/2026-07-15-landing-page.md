# ShipASO Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public marketing landing page at `/` with an inline live-audit hero, move the authed dashboard to `/dashboard`, and extract the shared audit widget — without abandoning the product's honest voice.

**Architecture:** `/` becomes a pure public `LandingView` (no auth branching). The audit input+result is extracted from `PreviewView` into a shared `ListingAudit` component mounted in both the landing hero and `/preview`. The dashboard moves to `/dashboard` and is added to the strangler edge map. Proof numbers come from the real `/proof` endpoint with a graceful empty state.

**Tech Stack:** React 19, TanStack Router (code-based tree), TanStack Query v5, Vite, Vitest + Testing Library, Playwright (E2E).

## Global Constraints

- **Honest voice — verbatim rule:** no fabricated grade, no fake proof number, no invented testimonials, no fake urgency. A genuine 0 shows as 0; missing data shows an honest "connect an app" line, never a number.
- **Reuse the design system:** only existing tokens/classes (`.card`, `.btn`, `.btn.primary`, `.grade`, `.stat`, `.grid`, `.muted`, `.faint`, `.micro`, `--signal`, display/mono/sans fonts, existing `@starting-style` + `prefers-reduced-motion`). No new color tokens.
- **Preserve every existing `data-testid`** on the audit widget: `preview-query`, `preview-search`, `preview-note`, `pcand-<bundle>`, `preview-result`, `preview-grade`, `preview-summary`, `preview-sample`, `preview-signin`.
- **Module imports use the `.js` extension** (ESM/NodeNext) even for `.tsx` sources — match existing files.
- **`/` is unconditional public** — no session check, no redirect. Signed-in users see the landing at `/` and reach the dashboard via nav.
- **Types are the wire contract:** `AppPreview` fields are all required; `ProofAggregate = { appsWithWins, totalWins, bestImprovement, medianImprovement }` (all numbers).

---

### Task 1: Extract `ListingAudit` from `PreviewView`

Pull the audit input + candidate list + result card out of `PreviewView` into a standalone component so the landing hero and `/preview` share one implementation. Behavior must be identical — this is a pure refactor gated by the existing tests still passing.

**Files:**
- Create: `cloud/web/src/features/public/ListingAudit.tsx`
- Modify: `cloud/web/src/features/public/PreviewView.tsx`
- Create: `cloud/web/src/features/public/ListingAudit.test.tsx`
- Modify: `cloud/web/src/features/public/publicViews.test.tsx` (PreviewView tests still pass through the wrapper — no change expected, but run them)

**Interfaces:**
- Consumes: `preview(client, { query })` / `preview(client, { bundle_id })` from `@shipaso/api`; types `ApiClient`, `Candidate`, `PreviewResult`.
- Produces: `ListingAudit` component — `export function ListingAudit({ client, onSignIn }: { client: ApiClient; onSignIn: () => void })`. Renders the full audit UX (input, candidates, result, sign-in-to-run). PreviewView renders `<ListingAudit client={client} onSignIn={onSignIn} />` under its own heading.

- [ ] **Step 1: Write the failing test** for the extracted component.

Create `cloud/web/src/features/public/ListingAudit.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { ListingAudit } from "./ListingAudit.js";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function clientReturning(result: unknown): ApiClient {
  const post = vi.fn(async () => result);
  return { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
}

describe("<ListingAudit />", () => {
  it("audits a query and renders the real grade + summary", async () => {
    const client = clientReturning({
      preview: {
        appName: "Weatherly",
        auditGrade: "B",
        leadKeyword: "weather",
        leadRank: 12,
        keywordsChecked: 20,
        inTop10: 4,
        sample: [{ keyword: "weather", rank: 12 }, { keyword: "radar", rank: null }],
      },
    });
    wrap(<ListingAudit client={client} onSignIn={vi.fn()} />);
    fireEvent.change(screen.getByTestId("preview-query"), { target: { value: "weatherly" } });
    fireEvent.click(screen.getByTestId("preview-search"));
    await waitFor(() => expect(screen.getByTestId("preview-grade")).toHaveTextContent("B"));
    expect(screen.getByTestId("preview-summary")).toHaveTextContent("#12");
    expect(screen.getByTestId("preview-sample")).toHaveTextContent("—"); // null rank never fabricated
  });

  it("surfaces the server's message on a no-match (404-as-throw)", async () => {
    const post = vi.fn(async () => { throw new Error("no app found for zzz"); });
    const client = { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
    wrap(<ListingAudit client={client} onSignIn={vi.fn()} />);
    fireEvent.change(screen.getByTestId("preview-query"), { target: { value: "zzz" } });
    fireEvent.click(screen.getByTestId("preview-search"));
    await waitFor(() => expect(screen.getByTestId("preview-note")).toHaveTextContent("no app found for zzz"));
  });

  it("calls onSignIn from the result's sign-in-to-run button", async () => {
    const onSignIn = vi.fn();
    const client = clientReturning({
      preview: { appName: "X", auditGrade: "A", leadKeyword: "k", leadRank: 1, keywordsChecked: 1, inTop10: 1, sample: [] },
    });
    wrap(<ListingAudit client={client} onSignIn={onSignIn} />);
    fireEvent.change(screen.getByTestId("preview-query"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("preview-search"));
    await waitFor(() => screen.getByTestId("preview-signin"));
    fireEvent.click(screen.getByTestId("preview-signin"));
    expect(onSignIn).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cloud/web && npx vitest run src/features/public/ListingAudit.test.tsx`
Expected: FAIL — `Failed to resolve import "./ListingAudit.js"`.

- [ ] **Step 3: Create `ListingAudit.tsx`** by moving the audit body out of `PreviewView` verbatim (state, both mutations, `apply`/`fail`/`startFresh`, the input, candidates, result card). Only the outer `<h1>`/subcopy stay behind in PreviewView.

```tsx
/**
 * ListingAudit — the shared try-before-signup audit widget. Audits any live
 * listing on real data and renders the honest result (no inflated grade, an
 * unmeasured rank is "—", never a fabricated number). Mounted in both the
 * landing hero and /preview so the audit logic — including the 404-as-throw
 * error path — lives in exactly one place.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient, Candidate, PreviewResult } from "@shipaso/api";
import { preview } from "@shipaso/api";

export function ListingAudit({ client, onSignIn }: { client: ApiClient; onSignIn: () => void }) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [result, setResult] = useState<NonNullable<PreviewResult["preview"]> | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function apply(r: PreviewResult) {
    if (r.needsChoice) {
      setCandidates(r.candidates ?? []);
      setResult(null);
      setNote((r.candidates ?? []).length === 0 ? "No apps found. Try a name, store link, or bundle id." : null);
    } else if (r.preview) {
      setResult(r.preview);
      setCandidates(null);
      setNote(null);
    } else {
      setNote(r.error ?? "Couldn’t preview that app.");
    }
  }

  function fail(e: unknown) {
    setCandidates(null);
    setResult(null);
    setNote(e instanceof Error ? e.message : "Couldn’t preview that app.");
  }

  const startFresh = () => setNote(null);

  const search = useMutation({
    mutationFn: (q: string) => preview(client, { query: q }),
    onMutate: startFresh,
    onSuccess: apply,
    onError: fail,
  });
  const pick = useMutation({
    mutationFn: (bundle_id: string) => preview(client, { bundle_id }),
    onMutate: startFresh,
    onSuccess: apply,
    onError: fail,
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, maxWidth: 480, marginTop: 8 }}>
        <input
          className="txt"
          data-testid="preview-query"
          value={query}
          placeholder="App name or bundle id"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn primary" data-testid="preview-search" disabled={!query.trim() || search.isPending} onClick={() => search.mutate(query.trim())}>
          {search.isPending ? "Auditing…" : "Audit"}
        </button>
      </div>

      {note ? <p className="faint" data-testid="preview-note" style={{ marginTop: 8 }}>{note}</p> : null}

      {candidates?.map((c) => (
        <button
          key={c.bundle_id}
          type="button"
          className="card appcard"
          data-testid={`pcand-${c.bundle_id}`}
          style={{ padding: "10px 12px", marginTop: 6 }}
          onClick={() => pick.mutate(c.bundle_id)}
        >
          <div className="name">{c.name}</div>
          <div className="bundle">{c.bundle_id}</div>
        </button>
      ))}

      {result ? (
        <div className="card" data-testid="preview-result">
          <b>{result.appName || "Audit preview"}</b>
          {result.auditGrade ? (
            <span className="grade" data-testid="preview-grade">{result.auditGrade}</span>
          ) : null}

          <p className="muted" data-testid="preview-summary">
            {result.leadKeyword && result.leadRank != null ? (
              <>
                Ranks <b>#{result.leadRank}</b> for “{result.leadKeyword}” · {result.inTop10} of{" "}
                {result.keywordsChecked} tracked keywords in the top 10.
              </>
            ) : (
              <>Checked {result.keywordsChecked} keywords — none ranking yet.</>
            )}
          </p>

          {result.sample.length ? (
            <div className="difflist" data-testid="preview-sample">
              {result.sample.map((s) => (
                <div key={s.keyword} className="move-row">
                  <span className="kw">{s.keyword}</span>
                  <span className="mono">{s.rank == null ? "—" : `#${s.rank}`}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="asc-unlock" style={{ marginTop: 12 }}>
            <b>Connect &amp; run</b>
            <p className="micro">Sign in to run the fix and prepare the push — your credentials, your machine.</p>
            <button type="button" className="btn primary" data-testid="preview-signin" onClick={onSignIn} style={{ marginTop: 8 }}>
              Sign in to run
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

Note: the audit button here uses `className="btn primary"` (the landing hero wants a prominent primary CTA; `/preview` is fine with primary too — visually consistent).

- [ ] **Step 4: Rewrite `PreviewView.tsx`** as a thin wrapper.

```tsx
/**
 * Preview — try-before-signup. Heading + the shared <ListingAudit>. Signup is
 * gated at value (inside the audit result), never a cold login wall.
 */
import type { ApiClient } from "@shipaso/api";
import { ListingAudit } from "./ListingAudit.js";

export function PreviewView({ client, onSignIn }: { client: ApiClient; onSignIn: () => void }) {
  return (
    <section>
      <h1>Try it — free, no signup</h1>
      <p className="muted">Audit any live App Store listing on real data. Sign in only when you want to run the fix.</p>
      <ListingAudit client={client} onSignIn={onSignIn} />
    </section>
  );
}
```

- [ ] **Step 5: Run the new + existing public tests to verify all pass**

Run: `cd cloud/web && npx vitest run src/features/public/`
Expected: PASS — `ListingAudit.test.tsx` green, and the existing `publicViews.test.tsx` PreviewView cases still pass through the wrapper.

- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/public/ListingAudit.tsx cloud/web/src/features/public/ListingAudit.test.tsx cloud/web/src/features/public/PreviewView.tsx
git commit -m "refactor(web): extract shared ListingAudit from PreviewView

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `LandingView` — hero, how-it-works, proof strip, close

Build the public landing page. Hero embeds `ListingAudit`; proof strip reads `/proof` with a graceful empty state.

**Files:**
- Create: `cloud/web/src/features/public/LandingView.tsx`
- Create: `cloud/web/src/features/public/LandingView.test.tsx`

**Interfaces:**
- Consumes: `ListingAudit` (Task 1); `getProof(client)` → `ProofAggregate` from `@shipaso/api`; type `ApiClient`.
- Produces: `export function LandingView({ client, onSignIn }: { client: ApiClient; onSignIn: () => void })`. (`onSignIn` → navigate `/login`. The audit is inline, so no audit-navigation callback is needed. The way back to the dashboard is the Topbar logo link from Task 4, not a landing-body prop.)

- [ ] **Step 1: Write the failing test**

Create `cloud/web/src/features/public/LandingView.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { LandingView } from "./LandingView.js";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("<LandingView />", () => {
  it("renders the hero, the inline audit input, and the how-it-works steps", async () => {
    const client = { get: vi.fn(async () => ({ appsWithWins: 0, totalWins: 0, bestImprovement: 0, medianImprovement: 0 })), post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    wrap(<LandingView client={client} onSignIn={vi.fn()} />);
    expect(screen.getByTestId("landing-hero")).toBeVisible();
    expect(screen.getByTestId("preview-query")).toBeVisible(); // the inline audit
    expect(screen.getByTestId("how-it-works")).toHaveTextContent("Audit");
    expect(screen.getByTestId("how-it-works")).toHaveTextContent("Approve");
    expect(screen.getByTestId("how-it-works")).toHaveTextContent("Run");
  });

  it("shows real proof stats when the aggregate has wins", async () => {
    const client = { get: vi.fn(async () => ({ appsWithWins: 3, totalWins: 17, bestImprovement: 42, medianImprovement: 12 })), post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    wrap(<LandingView client={client} onSignIn={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("stat-total wins")).toHaveTextContent("17"));
    expect(screen.getByTestId("stat-best improvement")).toHaveTextContent("42 ranks");
  });

  it("shows the honest empty line — not a fake number — when proof is empty", async () => {
    const client = { get: vi.fn(async () => ({ appsWithWins: 0, totalWins: 0, bestImprovement: 0, medianImprovement: 0 })), post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    wrap(<LandingView client={client} onSignIn={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("proof-empty")).toBeVisible());
    expect(screen.queryByTestId("stat-total wins")).toBeNull();
  });

  it("shows the honest empty line when proof 401s for a logged-out visitor", async () => {
    const client = { get: vi.fn(async () => { throw new Error("401"); }), post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    wrap(<LandingView client={client} onSignIn={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("proof-empty")).toBeVisible());
  });

  it("wires the secondary sign-in link", () => {
    const onSignIn = vi.fn();
    const client = { get: vi.fn(async () => ({ appsWithWins: 0, totalWins: 0, bestImprovement: 0, medianImprovement: 0 })), post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    wrap(<LandingView client={client} onSignIn={onSignIn} />);
    fireEvent.click(screen.getByTestId("landing-signin"));
    expect(onSignIn).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cloud/web && npx vitest run src/features/public/LandingView.test.tsx`
Expected: FAIL — `Failed to resolve import "./LandingView.js"`.

- [ ] **Step 3: Create `LandingView.tsx`**

`hasWins` gates the proof strip: treat empty (all-zero) OR errored `/proof` as "no proof yet" and render the honest line. A genuine win count > 0 renders the `.stat` tiles.

```tsx
/**
 * Landing — the public marketing front door at "/". Renders for everyone (no
 * auth branching). Leads with a live inline audit (the value IS the hero), a
 * plain 3-step how-it-works, and REAL measured proof with a graceful empty
 * state — never a fabricated number. Honest voice throughout.
 */
import { useQuery } from "@tanstack/react-query";
import type { ApiClient, ProofAggregate } from "@shipaso/api";
import { getProof } from "@shipaso/api";
import { ListingAudit } from "./ListingAudit.js";

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="card stat">
      <div className="stat-v" data-testid={`stat-${label}`}>
        {value}
        {suffix ?? ""}
      </div>
      <div className="stat-k">{label}</div>
    </div>
  );
}

const STEPS: { title: string; body: string }[] = [
  { title: "Audit", body: "See your real keyword ranks on live data. No signup." },
  { title: "Approve", body: "You decide what changes. Nothing auto-ships." },
  { title: "Run", body: "The fix is pushed — your credentials stay on your machine." },
];

export function LandingView({
  client,
  onSignIn,
}: {
  client: ApiClient;
  onSignIn: () => void;
}) {
  const proofQ = useQuery<ProofAggregate>({ queryKey: ["proof"], queryFn: () => getProof(client), retry: false });
  const p = proofQ.data;
  const hasWins = !proofQ.isError && !!p && p.totalWins > 0;

  return (
    <section>
      <div data-testid="landing-hero">
        <h1>Know exactly where your app ranks — then fix it.</h1>
        <p className="muted" style={{ maxWidth: 560 }}>
          ShipASO audits your App Store listing on real keyword data, proposes the fix, and runs it —
          your credentials never leave your machine.
        </p>
        <ListingAudit client={client} onSignIn={onSignIn} />
        <p className="faint" style={{ marginTop: 10 }}>
          Already have apps connected?{" "}
          <button type="button" className="btn ghost" data-testid="landing-signin" onClick={onSignIn}>
            Sign in
          </button>
        </p>
      </div>

      <h2 style={{ marginTop: 36 }}>How it works</h2>
      <div className="grid" data-testid="how-it-works">
        {STEPS.map((s, i) => (
          <div className="card" key={s.title}>
            <b>
              {i + 1}. {s.title}
            </b>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              {s.body}
            </p>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 36 }}>Proof</h2>
      {hasWins ? (
        <div className="grid" data-testid="proof-stats">
          <Stat label="apps with wins" value={p.appsWithWins} />
          <Stat label="total wins" value={p.totalWins} />
          <Stat label="best improvement" value={p.bestImprovement} suffix=" ranks" />
          <Stat label="median improvement" value={p.medianImprovement} suffix=" ranks" />
        </div>
      ) : (
        <p className="muted" data-testid="proof-empty">
          Connect an app to start measuring real wins — every number here is measured, never simulated.
        </p>
      )}

      <div className="card" style={{ marginTop: 36 }}>
        <b>Your credentials, your machine — nothing simulated.</b>
        <p className="muted" style={{ margin: "6px 0 12px" }}>
          Audit any listing free. Sign in only when you want to run the fix.
        </p>
        <button type="button" className="btn ghost" data-testid="landing-close-signin" onClick={onSignIn}>
          Sign in
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cloud/web && npx vitest run src/features/public/LandingView.test.tsx`
Expected: PASS — all five cases green.

- [ ] **Step 5: Commit**

```bash
git add cloud/web/src/features/public/LandingView.tsx cloud/web/src/features/public/LandingView.test.tsx
git commit -m "feat(web): public landing page — inline audit hero + honest proof strip

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Route `/` to landing, dashboard to `/dashboard`

Wire the new landing at `/`, move the dashboard to `/dashboard`, and add a `LandingRoute` wrapper that injects navigation.

**Files:**
- Modify: `cloud/web/src/routes/public.tsx` (add `LandingRoute`)
- Modify: `cloud/web/src/router.tsx`
- Modify: `cloud/web/src/shell/edgeRoutes.ts`
- Modify: `cloud/web/src/shell/edgeRoutes.test.ts`

**Interfaces:**
- Consumes: `LandingView` (Task 2); `DashboardRoute` (existing, unchanged).
- Produces: `LandingRoute` exported from `routes/public.tsx`; router index route (`/`) → `LandingRoute`; new `/dashboard` route → `DashboardRoute`; `OWNED_PATHS` includes `/dashboard`.

- [ ] **Step 1: Write the failing edge-map test**

In `cloud/web/src/shell/edgeRoutes.test.ts`, add inside the top `describe`:

```ts
  it("owns /dashboard (the authed dashboard's new home)", () => {
    expect(resolveSurface("/dashboard", OWNED_PATHS)).toBe("web");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd cloud/web && npx vitest run src/shell/edgeRoutes.test.ts`
Expected: FAIL — `/dashboard` resolves to `"legacy"` (not yet owned).

- [ ] **Step 3: Add `/dashboard` to `OWNED_PATHS`** in `cloud/web/src/shell/edgeRoutes.ts`. Insert after the `"/settings"` entry:

```ts
  "/settings",
  "/dashboard",
  "/login",
```

- [ ] **Step 4: Run the edge test to verify it passes**

Run: `cd cloud/web && npx vitest run src/shell/edgeRoutes.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `LandingRoute`** to `cloud/web/src/routes/public.tsx`. Add the import and a new route wrapper:

```tsx
import { LandingView } from "../features/public/LandingView.js";
```

```tsx
export function LandingRoute() {
  const navigate = useNavigate();
  return (
    <LandingView
      client={client}
      onSignIn={() => void navigate({ to: "/login" })}
    />
  );
}
```

- [ ] **Step 6: Rewire `router.tsx`** — `/` → `LandingRoute`, add `/dashboard` → `DashboardRoute`.

Change the imports line for `./routes/public.js`:

```tsx
import { LandingRoute, LoginRoute, PreviewRoute, ProofRoute } from "./routes/public.js";
```

Replace the index route and add the dashboard route:

```tsx
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: LandingRoute });
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard", component: DashboardRoute });
```

Add `dashboardRoute` to the `addChildren([...])` array (after `indexRoute`):

```tsx
  indexRoute,
  dashboardRoute,
  healthRoute,
```

- [ ] **Step 7: Typecheck + build to verify the route tree compiles**

Run: `cd cloud/web && npm run build`
Expected: PASS — TypeScript compiles, Vite build succeeds. (`DashboardRoute` is already imported in `router.tsx`; no unused-import error.)

- [ ] **Step 8: Commit**

```bash
git add cloud/web/src/routes/public.tsx cloud/web/src/router.tsx cloud/web/src/shell/edgeRoutes.ts cloud/web/src/shell/edgeRoutes.test.ts
git commit -m "feat(web): / serves the landing page, dashboard moves to /dashboard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Topbar — logo/nav goes to `/dashboard` when signed in

The topbar logo currently isn't a link. With the dashboard no longer at `/`, a signed-in user needs a way back to it. Make the logo link to `/dashboard` when signed in, `/` otherwise.

**Files:**
- Modify: `cloud/web/src/shell/Topbar.tsx`
- Modify: `cloud/web/src/shell/Topbar.test.tsx`

**Interfaces:**
- Consumes: `headerState({ hasApiBase, session })` (existing) — `hs.mode` is `"signedIn" | "signIn" | "demoStub"`.
- Produces: logo wrapped in a router `<Link>` whose `to` is `/dashboard` when `hs.mode === "signedIn"`, else `/`.

- [ ] **Step 1: Write the failing test.** Read the existing `Topbar.test.tsx` first to match its render harness (it renders `<Topbar>` with a `session` prop). Add:

```tsx
  it("links the logo to /dashboard when signed in", () => {
    renderTopbar({ apiBase: "https://api.shipaso.com", session: { email: "me@x.com" } });
    expect(screen.getByTestId("logo-link")).toHaveAttribute("href", "/dashboard");
  });

  it("links the logo to / when signed out", () => {
    renderTopbar({ apiBase: "https://api.shipaso.com", session: null });
    expect(screen.getByTestId("logo-link")).toHaveAttribute("href", "/");
  });
```

Note: if the existing test harness renders `<Topbar>` bare (no router), a TanStack `<Link>` needs a router context — in that case use a plain `<a href>` computed from `hs.mode` instead of `<Link>` (the topbar is deliberately presentational/router-free per its header comment). Prefer the `<a href>` approach to keep Topbar render-testable without a router.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd cloud/web && npx vitest run src/shell/Topbar.test.tsx`
Expected: FAIL — no `logo-link` testid.

- [ ] **Step 3: Wrap the logo in an anchor** in `Topbar.tsx`. Compute the target and wrap:

```tsx
  const homeHref = hs.mode === "signedIn" ? "/dashboard" : "/";
```

Change the logo block to:

```tsx
        <a className="logo" href={homeHref} data-testid="logo-link" style={{ textDecoration: "none" }}>
          <span className="tick" aria-hidden="true">✓</span>
          <span>ShipASO <small>autonomous ASO</small></span>
        </a>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cloud/web && npx vitest run src/shell/Topbar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloud/web/src/shell/Topbar.tsx cloud/web/src/shell/Topbar.test.tsx
git commit -m "feat(web): topbar logo links to /dashboard when signed in

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: E2E — landing at `/`, dashboard at `/dashboard`, inline audit

Update the E2E for the moved dashboard and add coverage for the acquisition path (landing renders, inline audit returns a real grade). This is the gated path.

**Files:**
- Modify: `cloud/web/tests-e2e/mocks.ts` (fix `/proof` shape; add `/preview`)
- Modify: `cloud/web/tests-e2e/happyPath.e2e.ts`

**Interfaces:**
- Consumes: `installMocks(page)` (existing).
- Produces: mock `/proof` returns a real `ProofAggregate`; mock `/preview` returns a real `AppPreview`; E2E navigates the dashboard at `/dashboard` and the landing at `/`.

- [ ] **Step 1: Fix the `/proof` mock and add `/preview`** in `mocks.ts`. The current `/proof` returns `{ apps: 0, pushes: 0, wins: 0 }` — the wrong shape (it predates the `ProofAggregate` contract). Replace that ROUTES entry and add a `/preview` entry. In the `ROUTES` array, replace:

```ts
  [/\/proof$/, { apps: 0, pushes: 0, wins: 0 }],
```

with:

```ts
  [/\/proof$/, { appsWithWins: 2, totalWins: 9, bestImprovement: 31, medianImprovement: 8 }],
  [/\/preview$/, {
    preview: {
      appName: "Weatherly",
      auditGrade: "B",
      leadKeyword: "weather",
      leadRank: 12,
      keywordsChecked: 20,
      inTop10: 4,
      sample: [{ keyword: "weather", rank: 12 }, { keyword: "radar", rank: null }],
    },
  }],
```

- [ ] **Step 2: Update the two dashboard-at-`/` tests.** In `happyPath.e2e.ts`, the first test (`"dashboard lists connected apps"`) and the client-side-nav test both `goto("/")` expecting the dashboard. Change both to `/dashboard`:

In `"dashboard lists connected apps"`:

```ts
  await page.goto("/dashboard");
```

In `"clicking an app is CLIENT-SIDE navigation (no full page reload)"`:

```ts
  await page.goto("/dashboard");
```

- [ ] **Step 3: Add the landing E2E test.** Append to `happyPath.e2e.ts`:

```ts
test("the landing page at / renders the hero and audits inline", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing-hero")).toBeVisible();
  await expect(page.getByTestId("how-it-works")).toContainText("Approve");
  // real measured proof from the mock aggregate
  await expect(page.getByTestId("stat-total wins")).toContainText("9");
  // inline audit returns a real grade without leaving the page
  await page.getByTestId("preview-query").fill("weatherly");
  await page.getByTestId("preview-search").click();
  await expect(page.getByTestId("preview-grade")).toContainText("B");
  await expect(page.getByTestId("preview-summary")).toContainText("#12");
});

test("the dashboard is reachable at /dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Your apps" })).toBeVisible();
});
```

- [ ] **Step 4: Run the full E2E suite**

Run: `cd cloud/web && npm run build && npm run test:e2e -- --workers=1 --retries=1`
Expected: PASS — all existing tests (now hitting `/dashboard`) plus the two new landing/dashboard tests green.

- [ ] **Step 5: Commit**

```bash
git add cloud/web/tests-e2e/mocks.ts cloud/web/tests-e2e/happyPath.e2e.ts
git commit -m "test(web): E2E for the landing page + dashboard at /dashboard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Full gate — lint, typecheck, unit, React Doctor

Run every quality gate the repo enforces before this ships, matching the user's standing rule (lint + typecheck + test before commit) and the React Doctor regression check.

**Files:** none (verification only).

- [ ] **Step 1: Unit + typecheck + build (web)**

Run: `cd cloud/web && npm run build && npx vitest run`
Expected: PASS — no type errors, all unit tests green.

- [ ] **Step 2: Lint (if the web package defines it)**

Run: `cd cloud/web && npm run lint --if-present`
Expected: PASS (or no-op if unscripted).

- [ ] **Step 3: React Doctor regression check** on the changed files.

Run: `cd cloud/web && npx react-doctor@latest --verbose --scope changed`
Expected: score does not regress vs base. If it drops, fix the flagged issues (do not suppress) before proceeding.

- [ ] **Step 4: No commit** — this task only verifies. If any gate failed and required a fix, commit that fix with a descriptive message, then re-run the gate.

---

## Notes for the executor

- The whole feature lives in `cloud/web`. Run commands from that directory unless a path says otherwise.
- Do NOT open a PR or merge — the user controls that. Stop after Task 6 and report status.
- PR #212 (E2E CI gate) is a separate, independent change; it is not part of this plan.
- If a step's expected output doesn't match, STOP and report — don't paper over a red gate.
