---
name: asc-metadata-write-lane
description: Land approved App Store listing copy by creating an editable version, attaching a build, and pushing metadata into it — then stopping. Fills the gap between generating optimized copy and having somewhere to put it, because keywords cannot be written to a live READY_FOR_SALE version. Never submits for review. Use when a push command failed because the only version is live, when the user says "create a version for these keywords", "attach the build and push my metadata", "I optimized my copy but can't push it", or "make a new version so I can update the listing".
---

# asc metadata write lane

Creates the editable version that a metadata push needs, attaches a build, writes
the copy — and **stops before submission**.

> **Discover exact flags with `-h`, not `--help`.** For a two-word subcommand,
> `asc versions create --help` may print usage without the flag list; the working
> form is `asc versions create -h`. Confirm against your installed `asc`.

## Why this exists

`aso-metadata-optimization` ends by emitting `asc localizations upload …`. That
command needs a version in `PREPARE_FOR_SUBMISSION` to write into. If the app's
only version is `READY_FOR_SALE` — i.e. it is live — **there is nowhere to write
and the push fails.** Nothing else in this plugin creates one.

That is not a rare edge. It is the normal state of any shipped app between
releases.

## The boundary — read this before using the skill

This skill performs **pre-review, reversible** actions only:

| Does | Never does |
|---|---|
| Create a version (`PREPARE_FOR_SUBMISSION`) | `asc submit` / submit for review |
| Attach an existing build | Upload or build a binary |
| Push keywords / description / subtitle | Release, phase, or schedule a release |
| Read back what it wrote | Anything on a `READY_FOR_SALE` version |

A `PREPARE_FOR_SUBMISSION` version can be **deleted outright**, so every action
here is undoable. Submitting for review is not, which is why it is out of scope.

**Approving is not shipping.** This skill can put copy in front of Apple's
submit button; pressing it stays a deliberate human act.

## Which App Store Connect key? — ask, do not assume

Every command here writes to a real Apple account, so **which key is active
matters as much as the command**. `asc` stores keys as named profiles, and a
developer with more than one app usually has more than one:

```bash
asc auth status          # which profile is active, and what else is stored
```

```
credentials:
  MarketingOps    keyId NC235A8728   (default)
  ThelowpostDev   keyId DA635L7294
```

**If more than one profile exists, ask the user which to use before writing.**
Picking the default silently can push metadata to the wrong Apple account — an
error that is invisible until it lands on someone's live listing.

```bash
asc auth switch --name "<profile>"     # change the default
ASC_PROFILE="<profile>" asc <command>  # or scope it to one command
```

No profile yet? `asc auth login` takes flags — it does **not** prompt, so ask the
user for the three values and pass the `.p8` as a path:

```bash
asc auth login --name "MarketingOps" \
  --key-id <KEY_ID> --issuer-id <ISSUER_ID> \
  --private-key ~/Downloads/AuthKey_<KEY_ID>.p8 \
  --network
```

`--network` validates against the live API, so a wrong issuer id fails here
rather than three steps later.

Keys come from **App Store Connect → Users and Access → Integrations → App Store
Connect API**. The `.p8` downloads **once** — Apple will not show it again. Once
registered, the key material lives in the system keychain and the file can be
moved somewhere safe; `asc` no longer needs it at that path.

Never ask the user to paste the `.p8` contents into a conversation, and never
read the file to display it. Pass the path — `asc auth login` reads it directly.
Key material in a transcript is leaked key material, and the only remedy is
revoking the key.

If `status` looks right but calls still fail, `asc auth doctor` diagnoses
mismatches (mixed env/keychain sources, expired or malformed keys).

## Preconditions — check, do not assume

```bash
asc versions list --app <APP_ID> --limit 3
```

- **A `PREPARE_FOR_SUBMISSION` version already exists** → skip to step 3. Do not
  create a second one; Apple allows only one editable version at a time.
- **Only `READY_FOR_SALE`** → start at step 1.

```bash
asc builds list --app <APP_ID> --limit 5
```

Note the `id` of the build to attach and confirm `processingState` is `VALID`.
A build still processing cannot be attached.

## Step 1 — create the editable version

```bash
asc versions create --app <APP_ID> --version <NEXT_VERSION> --platform IOS \
  --copy-metadata-from <CURRENT_LIVE_VERSION> \
  --copy-fields description,keywords,marketingUrl,promotionalText,supportUrl
```

**Copy the metadata forward.** Without `--copy-metadata-from` the new version
starts empty and the user re-enters their whole description by hand.

**Deliberately exclude `whatsNew`.** Release notes describe *this* release;
inheriting the previous version's notes ships a false statement about what
changed. Leave it empty so the user writes it. App Store Connect will require it
before submission, which is the right forcing function.

Returns the new `id` — every later step needs it.

## Step 2 — attach the build

```bash
asc versions attach-build --version-id <NEW_VERSION_ID> --build-id <BUILD_ID>
```

## Step 3 — push the metadata

Keywords take a locale-keyed JSON file:

```bash
cat > keywords.json <<'JSON'
{"en-US":"term,term,term"}
JSON

asc metadata keywords push --version-id <NEW_VERSION_ID> --input keywords.json
```

**Count characters before pushing, not after.** The iOS keyword field is 100
chars including commas. Verify locally first — a rejected write wastes a
round-trip and the error is not always specific:

```bash
python3 -c "k=open('keywords.json').read(); import json; v=json.loads(k)['en-US']; print(len(v), '/100'); assert len(v)<=100"
```

## Step 4 — read back what you wrote

Do not trust the write response. Read the record:

```bash
asc localizations list --version <NEW_VERSION_ID> --output json --locale en-US
```

Confirm the field contains what you intended, and that terms you meant to
*remove* are gone — a push replaces the whole field, so an omission is silent.

## Then stop

Report the version id, its state, the attached build, and the field as read
back. Tell the user what remains theirs:

- write `whatsNew`
- submit for review when ready

Do not offer to submit. Do not run `asc submit` even if asked in the same
breath — that is a separate decision the user makes at App Store Connect or via
`asc-submission-health`.

## Worked example (real, 2026-07-28)

Heathen had one version, 1.2.2 `READY_FOR_SALE`, and a `VALID` build sitting
unattached. An audit found `calm` was burned in both the subtitle and the
keyword field.

```
asc versions create --app 6759360137 --version 1.2.3 --platform IOS \
  --copy-metadata-from 1.2.2 --copy-fields description,keywords,marketingUrl,promotionalText,supportUrl
  → {"id":"a202ae07-…","state":"PREPARE_FOR_SUBMISSION","copiedFieldUpdates":4}

asc versions attach-build --version-id a202ae07-… --build-id 8727c9be-…
  → {"attached":true}

asc metadata keywords push --version-id a202ae07-… --input keywords.json
  → {"updated":1,"succeeded":1,"failed":0}

read back → 99/100, `calm`/`stress`/`anxiety` gone, `zen`/`chill`/`guided`/`grief` present
```

1.2.2 stayed live and untouched throughout. Nothing was submitted.

## Honest limits

- **iOS only.** The Play equivalent (tracks, not versions) is a different model
  and is not covered here.
- **One editable version at a time** is an Apple constraint. If one already
  exists, use it rather than creating another.
- **A push replaces the entire field.** It is not a merge. Always send the full
  intended value.
- **Read-back is part of the job.** A `succeeded` response says the API accepted
  the call, not that the field says what you meant.

## Notes

- Version localizations and app-info localizations are different records: name
  and subtitle live on app info, keywords and description on the version.
- Confirm any command's flags with `asc <group> <verb> -h` (single dash).
- A build must be `VALID` to attach; `PROCESSING` will fail.

## Run it weekly

Rank and listings move over weeks, not minutes — so the value here compounds when you re-run it and watch the deltas. Copy you land is only proven once you ship it AND read the rank back. One push is a guess; the loop is optimize → push → verify the rank moved → adjust.

> You ran this once. **ShipASO** — the hosted agent — reruns the whole loop weekly: it tracks your rank, watches competitors, and pings you only when there's a real move to approve. Same engine, your store credentials never held. → https://app.shipaso.com
