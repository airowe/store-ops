# Phase 4 — Extras PRD (ShipASO mobile)

Parent: `00-implementation-plan.md`. Depends on: Phase 2 (3 optional).

## Objective
Round out parity with the web's remaining surfaces: rank war room, share-a-win
card, Scale-tier portfolio, public proof, and the billing linkout.

## Scope
- **In:** war room (head-to-head grid), share-a-win (render/share the server
  SVG card), portfolio roll-up, proof screen, billing → web checkout.
- **Out:** native push/offline (Phase 5), store build (Phase 6).

## Files
- `mobile/app/(app)/apps/[id]/war-room.tsx`
- `mobile/app/(app)/portfolio.tsx`, `mobile/app/(public)/proof.tsx`
- `mobile/src/components/{WarRoomGrid,ShareWinButton,PortfolioRow,TierBadge}.tsx`
- `mobile/src/api/endpoints.ts` (+ `warRoom`, `portfolio`, `proof`, `billingCheckout`)
- tests: `warRoom.test.tsx`, `shareWin.test.tsx`, `portfolio.test.tsx`, `proof.test.tsx`

## Contracts / reuse
- `GET /apps/:id/war-room` (head-to-head; Scale). `GET /apps/:id/share-card.svg`
  (fetch SVG → render via `react-native-svg` / share via the OS share sheet).
- `GET /portfolio` (402 below Scale → upsell). `GET /proof` (public, cached).
- `POST /billing/checkout {tier}` → `{url}` → open in `expo-web-browser` (see plan
  §1c: keep purchasing on the web to avoid IAP rejection risk).

## Acceptance criteria
- War room renders the head-to-head grid; an unchecked competitor stays "—"
  (never a guessed number); Reduce-Motion jumps to final values.
- Share-a-win renders the real server SVG and shares it; only appears on a real win.
- Portfolio shows per-app grade/lead-rank/pending + summary; below Scale → a clean
  upsell (402), not a crash.
- Proof renders anonymized aggregates (no app/user data).
- Billing opens the Stripe Checkout URL in the system browser; tier state reads
  from the API.

## Tests
- Honesty: war-room "—" for unchecked; share-win only on a real win; portfolio
  402 → upsell. Fixtures from the mock contract.

## Dependencies / external gates
- **Decision gate (plan §1c):** confirm web-checkout vs IAP before store
  submission — this affects whether the billing screen is allowed as-is.

## Definition of done
All remaining web surfaces have native equivalents; billing routes to web
checkout pending the IAP decision.
