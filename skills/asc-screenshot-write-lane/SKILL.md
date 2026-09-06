---
name: asc-screenshot-write-lane
description: Put an approved run's rendered screenshot strip onto the editable App Store version through ShipASO, without looking up a single App Store Connect id by hand — bundle id → editable version → locale → device set (found or created) → each shot in order, with a per-shot ledger. Never touches a live version, never submits. Use when the user says "upload my screenshots to App Store Connect", "push the approved screenshot set", "ship the strip to the draft version", or an agent has an approved run and rendered PNGs and needs them on the listing.
---

# asc screenshot write lane

The screenshot half of the write lane. `asc-metadata-write-lane` gets copy onto
the editable version; this gets the **strip** there, through ShipASO's own
route, so the same gate that guards every other store write guards this one.

Verified live on 2026-09-06 (#374): one asset, Snagg 1.0.1, Apple accepted the
reservation, the MD5 and the commit. This lane is the version an agent can run
without a person pasting UUIDs.

## The boundary

| Does | Never does |
|---|---|
| Resolve the **editable** version (`PREPARE_FOR_SUBMISSION` and its rejected siblings) | Touch a `READY_FOR_SALE` version — it cannot be selected |
| Find or create the screenshot set for one locale × one device bucket | Submit, release, or start an experiment |
| Upload each shot in order; skip one already present with the same bytes | Upload a renderer placeholder (`needsReview`, `placeholder` in the name) — refused before any request |
| Report a ledger: uploaded / skipped / failed / never started | Hide a half-finished strip behind a boolean |

Gate, identical to every ASC write: paid tier, the user's own `asc_write_opt_in`,
an **approved** run, and this explicit call. **Approving is not shipping.**
Nothing here presses submit.

## 1) What you need

- A ShipASO key (`app.shipaso.com → Settings → Agent access`) as `$SHIPASO_KEY`.
- The run id of an **approved** run for the app.
- Rendered PNGs at an Apple-accepted size for the bucket you name (for
  `APP_IPHONE_67`: 1290×2796 or 1320×2868). The renderer's output dir is fine.
- The ASC key stored on the app in ShipASO (Settings → App Store Connect), or
  passed inline as `p8` / `keyId` / `issuerId` in the body.

An editable version must exist. If the only version is live, create one first
(`asc-metadata-write-lane` step 1, or `asc versions create --app <id> --version <v>`).

## 2) Build the body

```bash
python3 - <<'EOF' > strip.json
import base64, json, glob, os
shots = [{"fileName": os.path.basename(p), "fileBase64": base64.b64encode(open(p, "rb").read()).decode()}
         for p in sorted(glob.glob("shots/*.png"))]
json.dump({"screenshotDisplayType": "APP_IPHONE_67", "locale": "en-US", "shots": shots}, open("strip.json", "w"))
EOF
```

`locale` is optional and defaults to the app's storefront locale. File order is
upload order, and upload order is display order.

## 3) Upload

```bash
curl -s -X POST "https://api.shipaso.com/runs/$RUN_ID/asc/upload-screenshots" \
  -H "Authorization: Bearer $SHIPASO_KEY" \
  -H "content-type: application/json" \
  --data-binary @strip.json | jq .
```

## 4) Read the ledger, then verify against Apple

```json
{
  "ok": true,
  "version": { "id": "…", "versionString": "1.0.1", "state": "PREPARE_FOR_SUBMISSION" },
  "localizationId": "…", "screenshotSetId": "…", "setCreated": false,
  "uploaded": [{ "fileName": "01_home.png", "id": "…", "bytes": 108459, "checksum": "cc56…", "parts": 1 }],
  "skipped":  [{ "fileName": "02_detail.png", "id": "…", "reason": "already present" }],
  "remaining": []
}
```

- `ok: false` with `failed` and `remaining`: the strip stopped at `failed`.
  Fix the cause and call again; everything already uploaded is skipped, so a
  retry is idempotent.
- `{ "ok": false, "reason": "No editable App Store version found…" }` or
  `"No \"fr-FR\" localization…"`: nothing was touched. Create the version or
  the locale in App Store Connect and retry.
- HTTP 402 / 403: tier, opt-in, approval, or the deployment flag. Not a
  retry; a person's decision.

Confirm on Apple's side before calling it done:

```bash
asc screenshots list --version-localization "<localizationId>" --output json \
  | jq '.sets[] | {type: .set.attributes.screenshotDisplayType, shots: [.screenshots[].attributes | {fileName, sourceFileChecksum, state: .assetDeliveryState.state}]}'
```

Every uploaded checksum should appear with `state: "COMPLETE"`.

## What this does not do

- It does not render. Screenshots come from `asc-shots-pipeline`,
  `aso-goldie-config`, or your own capture.
- It does not delete or reorder existing screenshots. Removing an old set is a
  deliberate act in App Store Connect.
- It does not submit. The version stays in `PREPARE_FOR_SUBMISSION` until you
  press the button.
