# ShipASO simulator capture plan

You are the capture agent in the `capture-shots` GitHub Actions job, on a macOS
runner with Xcode, `xcrun simctl`, and `axe` (AXe UI driver) installed. The
ShipASO iOS app is already built for the simulator at:

    mobile/.build/DerivedData/Build/Products/Debug-iphonesimulator/ShipASO.app

Bundle id: `com.shipaso.app`. Your job: capture REAL screenshots of the running
app (and, if `RECORD_VIDEO=true`, one walkthrough video), then write a manifest.
Downstream, `scripts/render-shipshots.py --screens marketing/screenshots/capture/raw`
turns these raw captures into framed store sets — the filename stem of each PNG
is its `sourceScreen` id, so name files exactly as listed below.

## Honesty rules (non-negotiable, from CLAUDE.md)

- Every screenshot must be a genuine render of the running app. Never edit,
  compose, or synthesize an image; never mock app code or inject fake data.
- The app talks to the live `https://api.shipaso.com`. The public preview flow
  works signed-out. If a screen is unreachable (needs an authed session, network
  error, crash), do NOT fake it — record it under `missing` in the manifest with
  the reason, and move on.
- Prefer real content: search a well-known real app (e.g. "Slack" or "Notion")
  so the audit teaser shows measured output, not an empty state.

## Simulator

1. Pick the newest available iPhone **Pro Max** simulator
   (`xcrun simctl list devices available`). Create one with `simctl create` if
   the image ships none. Boot it, wait for it to settle.
2. Screenshots must come out at an App-Store-accepted portrait size:
   **1320x2868** (6.9-inch) or **1290x2796** (6.7-inch). Verify one early
   capture with `sips -g pixelWidth -g pixelHeight` before doing the rest —
   the workflow's verify step hard-fails on any other size.
3. Set the status bar to a clean state first:
   `xcrun simctl status_bar <UDID> override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 --operatorName ""`.
4. Install and launch: `xcrun simctl install <UDID> <path-to-.app>` then
   `xcrun simctl launch <UDID> com.shipaso.app`.

## Driving the UI

Use `axe describe-ui --udid <UDID>` to see what is on screen and
`axe tap --id <testID>` / `axe type <text>` to act. The app is Expo Router;
signed-out it lands on the public surface. Useful testIDs on the preview
screen: `preview-query` (search field), `preview-search` (submit),
`preview-result` (result card). Reference for the toolchain:
`skills/asc-shots-pipeline/SKILL.md`. Give the app a beat (1–2s) after
navigation before capturing; retry a flaky tap once before declaring a screen
missing.

## Shots (output: `marketing/screenshots/capture/raw/<id>.png`)

Capture with `xcrun simctl io <UDID> screenshot <path>` (or `axe screenshot`).

| id | what must be on screen |
|---|---|
| `login` | The signed-out entry screen: email field + the free-preview path visible. |
| `search` | The public preview screen with a real query typed in the search field, before/at submit. |
| `audit-result` | The preview result card for that query: app name + grade pill + teaser content, fully loaded (wait for `preview-result`). |
| `proof` | The public proof screen, if reachable without parameters from the signed-out surface; otherwise record it missing (it may require a proof id). |

Screens behind login (dashboard, runs, war-room) are expected `missing` —
magic-link auth cannot complete in CI. Say so in the manifest; do not attempt
to stub a session.

## Video (only if env `RECORD_VIDEO` is `true`)

One continuous ~25–30s pass saved to
`marketing/screenshots/capture/video/app-walkthrough.mov`: start
`xcrun simctl io <UDID> recordVideo --codec h264 <path>` in the background,
drive launch → type query → submit → result settles, then stop the recording
with SIGINT and confirm the file is non-empty. This is raw App-Store-preview /
demo-video footage — no titles, no editing.

## Manifest (required): `marketing/screenshots/capture/raw/capture-manifest.json`

```json
{
  "version": 1,
  "device": "<simulator name>",
  "os": "<iOS runtime version>",
  "pixelSize": "1320x2868",
  "captured": [{ "id": "audit-result", "file": "audit-result.png", "note": "query: Slack" }],
  "missing": [{ "id": "proof", "reason": "requires a proof id; no public entry point signed-out" }],
  "video": "video/app-walkthrough.mov"
}
```

`captured` lists only files that exist; `missing` states every planned shot you
could not take, with the real reason. Omit `video` if none was recorded. When
done, print a one-paragraph summary of what was captured vs missing.
