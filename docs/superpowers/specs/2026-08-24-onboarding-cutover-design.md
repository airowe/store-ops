# Finish the onboarding cutover

**Status:** design, awaiting approval
**Issue:** #504 (supersedes — that issue described the symptom, not the cause)
**Origin:** #329 (2026-07-24), the one screen of the redesign wave that never switched over

## The problem

On 2026-07-24 seven commits landed, each implementing a design canvas. Six
reached users. `/onboarding` did not.

#329's own message states the intent: *"Replace the form-wall setup with a
progressive stepper."* The replacement was never performed. Today there are two
setup flows:

| | reachable | persists | complete |
|---|---|---|---|
| `ConnectCard` (dashboard) | yes — every user | yes | yes |
| `/onboarding` | only by typing the URL | no | no |

Three defects follow from the stall:

1. **Nothing routes to it.** No link, no redirect, in web or mobile.
2. **It discards what it collects.** The route file says so: *"the collected
   answers stay local until a real persistence hook exists."*
3. **It shows fabricated data.** `OnboardingView` defaults to `sampleState()`,
   so a real user sees `app: { name: "Cal AI", grade: "A−" }` — an invented app
   and a fabricated audit grade, presented as their own result.

(3) is the most serious: it violates measured-or-nothing directly. It is worse
than the three inert buttons #504 was filed for, which are a symptom of the same
stall.

## What already exists

The "real persistence hook" was built for the competitors screen and is
production code today:

- `app_competitors` table, per-pair `confirmed` status
- `POST /apps` (connect), `POST /apps/:id/competitors/discover`,
  `POST /apps/:id/competitors`, `.../:key/confirm`, `DELETE .../:key`
- Client wrappers for all of the above in `packages/api/endpoints.ts`
- `CompetitorsCard.tsx` — a working reference implementation of add/confirm/remove

Onboarding reimplemented rivals as throwaway local state instead of using them.
No new endpoint and no schema change is required.

## Scope

Build the three steps that do not exist, wire the one that does to real data,
and make `/onboarding` the first-run path.

### Step 1 — store

App Store only. `POST /apps` has no store parameter; it resolves via iTunes, and
a Play URL is parsed only to extract a bundle id which is then looked up on
iTunes. Google Play renders **disabled, labelled "coming soon"** — visible as a
direction, never as a choice that would mislead.

### Step 2 — your app

Reuse `ConnectCard`'s search/connect logic (`resolveApps` → `connectApp`,
including its ambiguous-match pick-list). Extract it from `DashboardView` into a
shared component so there is one connect implementation, not two.

The grade shown in the collapsed answer row is whatever the audit returned, or
absent. Never `sampleState()`'s "A−".

### Step 3 — rivals

Seed from `discoverCompetitors` against the real connected app. Add/confirm/
remove call the real endpoints; `onboardingModel`'s pure helpers stay as local
optimistic state over them.

**Honest empty state.** `discover` returns zero suggestions when the app has no
tracked keywords yet — the normal state for a just-connected app. The step must
say there are no suggestions yet and let the user type a rival, never invent
seeds. This mirrors the endpoint's own documented behavior.

### Step 4 — connect a key

Stays optional and dimmed, as designed. Links to the existing credential flow
rather than reimplementing it. "read-only until you do" is already accurate.

### Entry

- **0 apps** → redirect to `/onboarding`
- **1+ apps** → dashboard unchanged; `ConnectCard` below the tracked list stays
  the quick add-another path

The empty-state `ConnectCard` becomes unreachable and is deleted. The
add-another instance is untouched: a four-step wizard is the wrong shape for an
existing user adding their fourth app.

### Out of scope

- Google Play connect (its own backend project — resolution, ranks, audit)
- Mobile onboarding (#337, same stall; separate issue, and mobile's screen does
  not carry the fake-data or dead-button defects)
- Persisting store choice or step position across sessions — not needed while
  the flow is completed in one sitting

## Testing

TDD throughout, per repo standard.

The existing suite could not distinguish a wired control from a stub — that is
how #329 shipped inert and how the Sign in button (#503) survived a strangler
migration. Assertions here must be able to fail:

- **`sampleState` must not reach a real user.** Assert the connected-app row
  renders the audit's actual grade, and renders absent when there is none.
  A test that only checks "a grade is displayed" would pass on "A−" and is
  therefore not a test.
- **Every control asserts behavior, not presence.** `toBeInTheDocument()` is
  insufficient for any button in this flow.
- **Rivals hit the real endpoints** — confirm/remove assert the call, not just
  local chip state.
- **Zero-suggestion path** renders the honest empty state, not invented seeds.
- **Redirect** fires at 0 apps and does not fire at 1+.
- E2E: connect → confirm a rival → land on dashboard with that rival watched.

## Risks

**A reviewer could hit a half-built flow mid-work.** `/onboarding` is reachable
by URL today and shows fake data. If this lands in stages, un-route it until the
flow is complete rather than leave a partial wizard live.

**Extracting `ConnectCard` touches a working path.** The dashboard connect flow
is the one users rely on. Extraction must be behavior-preserving, covered by the
existing dashboard tests before the move.
