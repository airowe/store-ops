# ShipASO — App Store submission prep (build-independent)

Everything here is ready to use the moment a processed build lands in App Store
Connect. Sources: the drafted ASO copy (`aso-copy.md`), `mobile/STORE.md §3`, and
the live ASC state (metadata + content-rights + support URL already written to
the draft version).

## 1. Status snapshot (as of 2026-07-16)

| Gate | State |
|---|---|
| Description / keywords / promo text | ✅ written to draft (en-US) |
| Name / subtitle | ✅ written to draft |
| Support URL (`https://shipaso.com/support`) | ✅ set + resolves (HTTP 200) |
| Content-rights (`DOES_NOT_USE_THIRD_PARTY_CONTENT`) | ✅ set |
| **Build** | 🔴 needs EAS build → ASC (blocked on `EXPO_TOKEN` repo secret) |
| **Screenshots** | 🔴 needs the app running (captions drafted below) |
| **Age rating** | 🔴 ASC UI questionnaire (answers below) |
| **App privacy** | 🔴 ASC UI questionnaire (answers below) |

## 2. Screenshot captions (draft)

Pair each with a captured screen. Keep them outcome-led and honest (no fabricated
numbers on the images — same rule the product enforces). 6.7" iPhone needs ≥3;
these are ordered strongest-first.

1. **"Know exactly where your app ranks."** — the audit result screen showing a
   real grade + per-keyword ranks (with an unmeasured rank shown as "—").
2. **"Get the fix — not just the problem."** — the proposed-changes / findings
   screen (title/subtitle/keyword suggestions).
3. **"Your credentials never leave your machine."** — the connect screen with the
   trust copy; reinforces the differentiator.
4. **"Track your rank over time."** — the rank-trend chart on an app detail.
5. **"Approve every change. Nothing auto-ships."** — the approval/run screen.

(4 and 5 optional if only 3 are ready.)

## 3. App Privacy questionnaire answers (from STORE.md §3 — match exactly)

- **Data collected:**
  - **Contact info → Email address**: collected, **linked** to the user, used for
    **App Functionality** (magic-link sign-in). NOT used for tracking.
  - Nothing else collected.
- **Tracking**: **No** — no tracking, no ads, no third-party analytics SDKs.
- **Store/API credentials (`.p8` / Play service-account)**: declare as **not
  collected/stored** — they are transient inputs, sent once over HTTPS to run an
  audit, **never persisted on device** (enforced by
  `credentials.neverPersisted.test.ts`) and never persisted server-side.
- **On-device storage**: session token (Keychain) + a cached copy of last-seen
  listing data (labeled "cached", never "live"). Not "data collection" in the
  App Privacy sense.

## 4. Age rating questionnaire

- No objectionable content across every category → expected rating **4+**.
- No unrestricted web access, no user-generated content, no gambling, no mature
  themes. Answer "None" throughout.

## 5. iOS encryption

- `ITSAppUsesNonExemptEncryption = false` (HTTPS/TLS only, no proprietary crypto).
  If ASC asks, declare **exempt** — no export compliance docs needed.
  (Confirm the Info.plist key is set so ASC doesn't prompt per-build.)

## 6. Purchases / IAP (review-risk — from STORE.md §3)

- Purchasing is handled on the **web** (Stripe Checkout in the system browser) —
  **no IAP** in the app. ⚠️ Known review risk: Apple may push back on "digital
  goods." Fallback: gate purchasing entirely off-app and present tier state
  read-only. Have this answer ready for the review notes.

## 7. The submission sequence (once a build is processed in ASC)

```bash
# A. Build (CI path — preferred; needs EXPO_TOKEN repo secret):
gh workflow run eas-build.yml -f platform=ios -f profile=production
#    watch: expo.dev/accounts/airowe/projects/shipaso/builds

# B. Submit the processed build to App Store Connect:
cd mobile && npx eas-cli submit --platform ios --profile production

# C. In ASC (or via asc), attach the build to version 1.0, then:
#    - upload screenshots (asc CLI or UI)
#    - complete Age Rating + App Privacy questionnaires (UI)
#    - add review notes incl. the IAP/web-purchase explanation (§6)

# D. Final submit for review — a deliberate human action in ASC.
```

## 8. Still requires YOU (external gates, per STORE.md §0)

- Set `EXPO_TOKEN` repo secret (`gh secret set EXPO_TOKEN`) to unblock the CI build.
- Apple signing identity / Team ID (EAS manages, but needs your Apple auth once).
- Capture the actual screenshots (device/simulator) or supply designed ones.
- Click through Age Rating + App Privacy in the ASC UI (no clean CLI path).
- The final "Submit for Review" click.
