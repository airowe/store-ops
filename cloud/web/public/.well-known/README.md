# `.well-known/` — mobile universal-link association files

These let the ShipASO mobile app (Expo) claim `https://shipaso.com` deep links so
that **magic-link sign-in opens the app** (→ `POST /auth/exchange`) and
`apps/:id` / `runs/:id` links route to the right screen. Served from the web/Pages
origin (the domain in the magic link), with `application/json` pinned via
`../_headers`.

## ⚠️ Placeholders to fill before store submission (Phase 6)

Both files currently carry **placeholder identifiers** — they are templates, not
production-ready. They become live association files only once the developer
accounts and signing identities exist:

| File | Placeholder | Replace with |
|---|---|---|
| `apple-app-site-association` | `TEAMID` in `TEAMID.com.shipaso.app` | the Apple Developer **Team ID** (Membership page) |
| `apple-app-site-association` | `com.shipaso.app` | the app's real **bundle identifier** if different |
| `assetlinks.json` | `REPLACE_WITH_RELEASE_SIGNING_SHA256_FINGERPRINT` | the **SHA-256 fingerprint** of the release signing key (Play App Signing → App integrity, or `keytool -list -v`) |
| `assetlinks.json` | `com.shipaso.app` | the Android **package name** if different |

The `appIDs`/`package_name` here must match `app.config.ts` (`ios.bundleIdentifier`
/ `android.package`) in `mobile/`.

## Verification (after deploy + filling placeholders)

- Apple: `curl -sI https://shipaso.com/.well-known/apple-app-site-association`
  must return `content-type: application/json` and a 200 (no redirect).
- Android: Google's Statement List Tester, or
  `curl -s https://shipaso.com/.well-known/assetlinks.json | jq`.

Until then, the app falls back to the `shipaso://` custom scheme (and the demo
`X-User-Email` path) for local development — see `docs/prd/expo-app/phase-1-auth-dashboard.md`.
