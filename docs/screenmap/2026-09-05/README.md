# screenmap local map — 2026-09-05 (#526)

The first full local run of [screenmap](https://github.com/aleqsio/screenmap)
against `mobile/`, simulator included, agent off. This answers the "run it
locally first" step on #526 with what the map actually contains.

| | |
|---|---|
| screenmap | checkout of 2026-09-05, argent 0.17.0 |
| Device | iPhone 17 Pro Max simulator, Xcode 26.6 |
| Build | Debug dev client, React Native built from source (see below) |
| Routes parsed | 19 (13 real screens + 6 colocated `*.test.tsx` files read as routes) |
| Captured | 19 by deep link, 0 failed, 0 by recorded flow, 0 by agent |
| Distinct screens | **3** |

## What the map contains

Of the 13 real screens, **11 are byte-identical**: every `(app)/*` route,
`auth/m`, `index`, and `(public)/login` all captured the login wall, because
the simulator has no session and the app redirects. The three distinct
captures are in `screens/`:

- `public_login.png` — the wall the other ten routes resolve to
- `public_preview.png` — "Score any App Store listing" (public)
- `public_proof.png` — "The receipts" (public)

`contact-sheet.png` shows all 13 as captured, duplicates included, so the
redirect is visible rather than described. The duplicate PNGs are not kept
here; `summary.json` and `graph.json` are the run's own output, unedited.

The three `[id]` routes (`apps`, `runs`, `war-room`) were deep-linked with a
bogus parameter, which screenmap detects and queues for the agent; with the
agent off they fell back to the same login wall.

## What this means for #526

- **The static parse is fine** (question 1, confirmed again): route groups
  resolve, 19 nodes, edges as expected. The `*.test.tsx` nodes should be
  filtered before any CI wiring; screenmap reads the file convention without
  honouring `metro.config.js`'s expo-router ignore.
- **Without a signed-in session the map is one screen.** A PR-review map
  needs a recorded login flow. The app signs in by magic link, so a
  deterministic flow needs either the App Review token field (a secret, not
  committable) or a seeded demo session. That decision is the owner's and is
  the real prerequisite now, ahead of any macOS-minute question.
- **`expo-dev-client` builds, with one local switch** (question 2). Adding
  the package was enough for `pod install`, but the Debug link failed twice
  against React Native 0.81's prebuilt core (`RCTPackagerConnection`,
  `RCTReconnectingWebSocket`, `facebook::react::Sealable` undefined; Release
  links fine with the same pods). Setting
  `ios.buildReactNativeFromSource: true` in `ios/Podfile.properties.json`
  and re-running `pod install` fixed it. `ios/` is git-ignored, so that
  setting lives only on this Mac; persisting it means adding
  `expo-build-properties` to `app.config.ts`, which touches every build and
  was deliberately not done here.

## Reproduce

```bash
cd mobile
npx expo install expo-dev-client          # on the branch, already done
# ios/Podfile.properties.json: "ios.buildReactNativeFromSource": "true"
(cd ios && pod install)
xcodebuild -workspace ios/ShipASO.xcworkspace -scheme ShipASO \
  -configuration Debug -destination 'id=<booted sim udid>' \
  -derivedDataPath <dir> ENABLE_DEBUG_DYLIB=NO build
SCREENMAP_APP_PATH=<dir>/Build/Products/Debug-iphonesimulator/ShipASO.app \
  node <screenmap>/action/cli/screenmap-ci.mjs baseline \
  --project "$PWD" --out mobile.map --no-agent
```

`.screenmap/config.json` in `mobile/` pins the device, scheme, and a sample
`id` parameter; the agent is disabled there too.
