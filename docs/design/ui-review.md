# UI patterns review & modernization proposal

_Scope: the web dashboard (`cloud/public/`) and the Expo mobile app (`mobile/`).
Reviewed: design tokens, layout, components, motion, charts, accessibility, and
cross-surface consistency. This document is the review; the accompanying PR lands
the safe, additive **foundation** (light mode + modern-chart primitives) and
scopes the rest as follow-up._

---

## 1. Current state — what's already strong

The product has a real, deliberate design system, not an accidental one:

- **One canonical palette, shared across surfaces.** `cloud/public/styles.css
  :root` is the source of truth; `mobile/src/theme/tokens.ts` ports it verbatim
  and `tokens.test.ts` fails CI if the two drift. That discipline is rare and
  worth protecting — every change below preserves it.
- **A single accent** (`--signal`, the "rank moved" green) with an enforced
  restraint model. Secondary meaning is carried by `--brand`, `--warn`, `--bad`
  only where semantically earned.
- **An honesty model baked into the UI** — unseen vs empty vs zero are distinct
  visual states (`.cov-bar.unseen` dashed, `RankMovementRow` "—" never `0`,
  sparkline plots null as `#200+`). This is a genuine differentiator and no
  proposal here weakens it.
- **Motion with a `prefers-reduced-motion` escape hatch** throughout.
- **Responsive intent** already present (`.wrap` cap on web, `resolveLayout` on
  mobile for iPad multi-column).

The gaps are not quality gaps — they're **coverage** gaps: the system was built
dark-only, the two surfaces have drifted in component shape, and charts are a
single hand-rolled SVG. That's what this proposal targets.

---

## 2. Findings & proposals

### 2.1 Consistency (web ↔ mobile, and within each)

| # | Finding | Proposal |
|---|---------|----------|
| C1 | **Charts exist on web, not mobile.** Web has `sparkline()` (rank trend); mobile app-detail only shows a "What changed" text list — no trend chart. | ✅ *Implemented:* shared `Sparkline` primitive on mobile (`mobile/src/components/Sparkline.tsx`) with the same honesty rules, wired into app detail as a "Rank trend" card. |
| C2 | **Mobile components import the static `palette` directly** (~20 files), so there's no single seam to theme or restyle. | ✅ *Foundation:* `usePalette()` hook + `ThemeProvider`; `primitives.tsx` migrated as the reference. Remaining files listed in §4. |
| C3 | **Type scale mismatch.** Web `body` is 15px with a `--display`/`--sans`/`--mono` triad; mobile `fontSize` scale is close but `mono` falls back to platform monospace rather than JetBrains Mono in several spots. | Load the three brand faces via `expo-font` at the root and set `fontFamily` on the `mono`/`display` text kinds (today only `sans` is reliably applied). Low risk, high polish. |
| C4 | **Badge / chip vocabulary differs.** Web has a rich chip system (`.badge`, `.dchip`, `.impact-chip`, `.reach-chip`, `.bucket`); mobile re-implements a subset ad hoc per card. | Extract a mobile `Chip`/`Badge` primitive mirroring the web's status→color mapping, so `AppCard`, `FindingCard`, `RankMovementRow` share one source of truth. |
| C5 | **Button variants diverge.** Web has `primary / ok / bad / ghost / small`; mobile has `primary / ghost` only. | Add `danger` and `small` to the mobile `Button` to match approval/reject flows (war room, credential sheets). |

### 2.2 Better UX

- **U1 — Chart is the weakest data surface.** A single un-gridded line with only
  two endpoint labels under-communicates. ✅ *Implemented:* gridline floor,
  rounded caps, softer gradient, and endpoint dots ringed in the panel color on
  both surfaces. Next: hover/press tooltips reading each snapshot (web `<title>`
  exists for annotations; extend to points, add a press affordance on mobile).
- **U2 — Empty/loading states are inconsistent.** Web `.empty`/`.locked`/
  `.run-loading` are well-designed; mobile uses a mix of `EmptyState`,
  `Centered`+spinner, and inline "no ranks yet" text. Standardize on
  `EmptyState` with an optional CTA everywhere.
- **U3 — Focus visibility.** Web inputs have a strong `:focus` ring
  (`--signal-glow`); the new theme toggle got a `:focus-visible` ring too. Audit
  remaining interactive elements (`.war-chip`, `.copy-btn`, `.rawcmds summary`)
  for a visible keyboard-focus state.
- **U4 — Touch targets.** Mobile `Button` enforces `minHeight: 48` (good); some
  inline `Pressable` rows (run list, competitor rows) are shorter. Enforce a
  44pt minimum.
- **U5 — Theme control discoverability.** ✅ *Implemented:* web topbar toggle +
  mobile Settings → Appearance (System / Light / Dark).

### 2.3 Light mode ✅ (web complete, mobile scaffolded)

The web CSS already routed every color through custom properties, which made
this tractable:

- **Web (complete).** Added `:root[data-theme="light"]` + a
  `prefers-color-scheme` auto path + an explicit-dark override. The seven
  hardcoded `rgba(255,255,255,…)` raised-fills, the two `rgba(7,9,14,…)` scrims,
  and the `#04140d` on-accent text were promoted to semantic tokens
  (`--raise{,-2,-3}`, `--topbar-bg`, `--overlay`, `--on-signal`) so the whole UI
  flips without touching a single component selector. A tiny pre-paint inline
  script in `index.html` applies the saved theme before first paint (no flash).
  Accent green darkens to `#0f9d63` for AA contrast on light.
- **Mobile (foundation).** `lightPalette` + `paletteFor(scheme)` + a
  persisted `ThemeProvider` (system default via `useColorScheme`, shared
  `store-ops:theme` key with the web). `primitives.tsx` consumes the live
  palette; the remaining components need the mechanical swap in §4.

**Design intent:** "editorial light" — warm paper (`#f6f7f9`), not stark white,
so the identity survives the flip. Texture (grain) is dropped in light where it
would read as noise.

### 2.4 Modern charts — foundation for graphs

- **Shared spec.** Rank trend, coverage, and opportunity bars should read as one
  chart family: theme-aware colors pulled from tokens (never hardcoded hex), a
  quiet gridline floor, rounded line caps, a soft signal-gradient area, honest
  null handling, and endpoint/round labels in tabular-nums.
- ✅ *Implemented:* both sparklines now follow this (web reads `--signal` at
  render time so the gradient re-tints per theme; mobile mirrors it via
  `react-native-svg`). Geometry is a pure, unit-tested function on each side
  (`buildSparkGeometry` on mobile).
- **Roadmap (proposed):**
  1. Extend the sparkline to a small `Chart` module with axis ticks + point
     tooltips (both surfaces).
  2. Promote the coverage gauge (`.cov-gauge`) and driver bars
     (`.opp-bar`, `.gap-bar`) to the same tokenized primitives.
  3. Add a **war-room** multi-series line (you vs. competitors) — the data
     already exists (`WarRoomGrid`); it's currently a table only.
  4. Consider a dependency-free chart helper shared conceptually across both
     surfaces so a new chart type is authored once.

---

## 3. What this PR implements (safe + additive)

1. **Web light mode** — token layer, `data-theme` + `prefers-color-scheme`,
   pre-paint script, topbar toggle. No component markup changed; existing dark
   look is the untouched default.
2. **Modern chart pass** — theme-aware, gridded, rounded sparkline on web;
   new `Sparkline` primitive on mobile wired into app detail.
3. **Mobile theme foundation** — light palette (pinned to the web light block in
   `tokens.test.ts`), `ThemeProvider` / `usePalette` / `useThemeMode`, migrated
   primitives, and a Settings → Appearance control.

All of it is backward-compatible: the static `palette` export stays (dark), the
no-provider fallback is dark, and dark remains the default on both surfaces.

## 4. Follow-up: complete mobile light mode

Mechanical migration — swap `import { palette } from ".../theme"` for
`const palette = usePalette()` inside each component (styles that depend on color
move from module-scope `StyleSheet.create` to inline/`useMemo`). Files:

`AppCard`, `FindingCard`, `RankMovementRow`, `CoverageGauge`, `CompetitorsCard`,
`AgentTriggersCard`, `KeywordLists`, `Portfolio`, `WarRoomGrid`,
`ScreenshotGallery`, `ConnectPicker`, `CredentialSheet`, `StoredKeysCard`,
`PlayAuditView`, `ApprovalGate`, `TextField`, `EmptyState`, `Grid`, and the
screen files that use `palette.*` inline (`apps/[id]`, `settings`, `runs/[id]`,
`war-room/[id]`, `index`, `portfolio`).

Each is low-risk and independently testable. Recommend one PR per 3–4 components
so review stays small.
