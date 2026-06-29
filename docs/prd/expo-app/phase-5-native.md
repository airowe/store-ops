# Phase 5 — Native enhancements PRD (ShipASO mobile)

Parent: `00-implementation-plan.md`. Depends on: Phases 1–2.

## Objective
Add the mobile-only value the web can't give: push notifications (a run finished
/ awaits your approval), light offline caching, and polished deep links.

## Scope
- **In:** push registration + notification handling + deep-link routing into the
  relevant run/app; offline cache (React Query persistence) for last-seen data;
  deep links for `apps/:id` and `runs/:id`.
- **Out:** store build/submit (Phase 6).

## Files
- `mobile/src/notifications/{register,handlers}.ts`
- `mobile/src/lib/queryPersist.ts` (React Query persistence via AsyncStorage)
- `mobile/app/_layout.tsx` (wire notification → router navigation)
- tests: `notifications.test.ts`, `deeplink.test.ts`, `queryPersist.test.ts`

## Contracts / reuse
- A **device-token register** endpoint + a **notify** trigger when a run becomes
  `awaiting_approval`/completes (small server addition; reuses the run lifecycle).
  Until it exists, the client registers and no-ops gracefully.
- Deep links reuse Phase 1's universal-link config (`apps/:id`, `runs/:id`).

## Acceptance criteria
- App registers for push (with permission prompt) and stores the device token
  server-side; denial is handled gracefully (feature simply off).
- A notification tap routes to the exact run/app.
- Offline: last-loaded dashboard/app/run render from cache when offline, with a
  clear "stale / offline" indicator — never presented as fresh/measured-now.
- Honesty: cached data is labeled as cached; never shown as a live read.

## Tests
- `notifications.test.ts` — register success/denied; tap → navigation target.
- `queryPersist.test.ts` — cache hydrate/dehydrate; stale labeling.
- `deeplink.test.ts` — `runs/:id` / `apps/:id` resolve to the right screen.

## Dependencies / external gates
- **Server gate:** device-token registration + notify-on-run hook (optional;
  client degrades without it).
- `expo-notifications` config + (for prod) APNs/FCM credentials (Phase 6/EAS).

## Definition of done
Push + deep links + offline caching work in a dev build; cached data is honestly
labeled. Notifications degrade gracefully without the server hook.
