# ShipASO simulator capture plan

You are the capture agent in the `capture-shots` GitHub Actions job, on a macOS
runner with Xcode, `xcrun simctl`, and `axe` (AXe UI driver) installed. The
ShipASO iOS app is already built for the simulator at:

    mobile/.build/DerivedData/Build/Products/Release-iphonesimulator/ShipASO.app

It is a **Release** build on purpose: it embeds `main.jsbundle`, so it runs with
no Metro. (A Debug build needs Metro, which nothing here starts — it launches
straight into the React Native red-box. Proven on the first run, 2026-09-05.)

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
- Prefer real content: search a real app so the audit teaser shows measured
  output, not an empty state. **Pick one that resolves fast.** The public
  preview runs the engine uncached, and big listings take minutes (measured
  2026-09-05: Slack 299 s, Notion 150 s — see #537), which reads as "broken"
  on screen. The verified query is **"Heathen"** → candidate *Heathen - Secular
  Meditation* (`app.airowe.clarity`), which resolves in about 30 s. Typing its
  App Store id `6759360137` skips the candidate step but looks odd in the shot.

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
signed-out it lands on the public surface. Reference for the toolchain:
`skills/asc-shots-pipeline/SKILL.md`. Give the app a beat (1–2s) after
navigation before capturing; retry a flaky tap once before declaring a screen
missing.

Learned on the first run (2026-09-05) — read before you poll for anything:

- **`describe-ui` does not list most testIDs.** Only text fields show up as
  `AXUniqueId` (`preview-query`, `preview-search`, `email-input`,
  `token-input`). Buttons, candidate rows and the result container
  (`audit-free`, `pcand-*`, `preview-result`) are NOT in the dump — yet
  `axe tap --id <testID>` still finds them. So: **tap by id, wait on visible
  text** (`AXLabel`), never wait for a Pressable's id to appear.
- Text to wait for: login → `Audit any listing` (the button); preview →
  `preview-query`; candidates → labels of the form `<name>, <bundle id>`
  (e.g. `Heathen - Secular Meditation, app.airowe.clarity`) — tap one by
  `--label`; result → a summary starting `Ranks #` or `Checked N keywords`;
  proof → `The receipts`.
- An app-name query returns a **candidate list**, not a result. Tap the
  intended candidate, then wait for the summary text (allow 60–120 s).
- The proof screen has no in-app link. Open it with
  `xcrun simctl openurl <UDID> "shipaso://proof"`, accept the system
  "Open in ShipASO?" dialog with `axe tap --label Open`, and allow up to
  60 s — it lands later than it looks like it should.
- Each `describe-ui` call takes 1–3 s; poll with a delay, not in a tight loop.

## Shots (output: `marketing/screenshots/capture/raw/<id>.png`)

Capture with `xcrun simctl io <UDID> screenshot <path>` (or `axe screenshot`).

| id | what must be on screen |
|---|---|
| `login` | The signed-out entry screen: email field + the free-preview path visible. |
| `search` | The public preview screen with a real query typed in the search field, before/at submit. |
| `audit-result` | The preview result card for that query: app name + teaser content, fully loaded (wait for the `Ranks #…` / `Checked …` summary text — the `preview-result` id is not visible to `describe-ui`). |
| `proof` | The public proof screen ("The receipts"), reached via the `shipaso://proof` deep link as described above. It needs no parameters. |

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
