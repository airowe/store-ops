---
name: asc-metadata-sync
description: Sync and validate App Store metadata and localizations with asc, including legacy metadata format migration. Use when updating metadata or translations. Use when the user says "update my app description", "change my keywords", "sync my App Store metadata", "update the what's new notes", or "push my metadata changes to App Store Connect".
---

# asc metadata sync

Use this skill to keep local metadata in sync with App Store Connect.

> **Discover exact flags with `-h`, not `--help`.** For a two-word subcommand,
> `asc localizations update --help` prints `Unknown command`; the working form is
> `asc localizations update -h`. Always confirm flags against your installed `asc`
> version before running — the reference below is verified but versions drift.

## Two Types of Localizations

App Store metadata splits across two record types. Use the right one:

- **Version localizations** (per-release): `description`, `keywords`, `whatsNew`,
  `supportUrl`, `marketingUrl`, `promotionalText`
- **App info localizations** (app-level): `name`, `subtitle`, `privacyPolicyUrl`,
  `privacyChoicesUrl`, `privacyPolicyText`

```bash
# List (either type — pass --version for version locs, --app for app-info)
asc localizations list --version "VERSION_ID"

# Download version localizations to .strings files
asc localizations download --version "VERSION_ID" --path "./localizations"

# Upload edited .strings files back
asc localizations upload --version "VERSION_ID" --path "./localizations"
```

## Quick Field Updates

Set individual fields directly with `asc localizations update` (works for both
version and app-info fields — `--name`/`--subtitle` are app-info level, the rest
are version level):

```bash
# Version fields (need --version)
asc localizations update --app "APP_ID" --version "VERSION_ID" --locale "en-US" \
  --keywords "keyword1,keyword2,keyword3"
asc localizations update --app "APP_ID" --version "VERSION_ID" --locale "en-US" \
  --description "Your app description"
asc localizations update --app "APP_ID" --version "VERSION_ID" --locale "en-US" \
  --support-url "https://support.example.com" \
  --marketing-url "https://example.com" \
  --promotional-text "Limited-time promo copy"

# App-info fields (name / subtitle — no --version)
asc localizations update --app "APP_ID" --locale "en-US" \
  --name "App Name" --subtitle "Your subtitle"
```

The full flag set on `asc localizations update`: `--name`, `--subtitle`,
`--keywords`, `--description`, `--whats-new`, `--promotional-text`,
`--support-url`, `--marketing-url`, plus `--locale` (required), `--app`, and
`--version` (for version-level fields).

> `--whats-new` is a release note — App Store Connect rejects it on a first
> **1.0** version ("cannot be fulfilled because of the state of another
> resource") and only accepts it on an update. Set it once the app has shipped
> at least once.

An alternative for the version fields is `asc apps info edit` (`--description`,
`--keywords`, `--support-url`, `--marketing-url`, `--promotional-text`); the
older `asc app-info set` / `asc app-infos list` still work but are **deprecated**
in favour of the `apps info` forms.

> The older `asc app-info set` / `asc app-infos list` still work but are
> **deprecated** — they now redirect to `asc apps info edit` / `asc apps info list`.
> Prefer the `apps info` forms.

## Legacy (Fastlane) Metadata Format Workflow

Round-trip an app's metadata through a Fastlane-style directory tree. This is the
export → edit → validate → dry-run → import loop.

### 1. Export current state

Requires **both** `--version-id` and `--output-dir` (this is a common trip-up):

```bash
asc migrate export \
  --app "APP_ID" \
  --version-id "VERSION_ID" \
  --output-dir "./fastlane"
# → ./fastlane/metadata/<locale>/keywords.txt, name.txt, description.txt, ...
```

### 2. Edit the exported .txt files

Each field is a plain text file, e.g. `./fastlane/metadata/en-US/keywords.txt`.

### 3. Validate (character limits + required fields)

```bash
asc migrate validate --fastlane-dir "./fastlane"
# reports per-field issues (e.g. "description is empty") with errorCount/warnCount
```

### 4. Dry-run the import — ALWAYS do this before writing

```bash
asc migrate import \
  --app "APP_ID" --version-id "VERSION_ID" \
  --fastlane-dir "./fastlane" --dry-run
# prints the exact localizations + fields it WOULD upload. Nothing is written.
```

> `migrate import` expects a `screenshots/` directory inside `--fastlane-dir`.
> `migrate export` does not create one, so if you only exported metadata:
> `mkdir -p ./fastlane/screenshots` before importing.

### 5. Import for real (only after the dry-run looks right)

```bash
asc migrate import --app "APP_ID" --version-id "VERSION_ID" --fastlane-dir "./fastlane"
```

## Version-Level Metadata (copyright, release type)

```bash
asc versions update --version-id "VERSION_ID" --copyright "2026 Your Company"
asc versions update --version-id "VERSION_ID" --release-type AFTER_APPROVAL
```

## TestFlight Release Notes

```bash
asc build-localizations create --build "BUILD_ID" --locale "en-US" \
  --whats-new "TestFlight notes here"
asc build-localizations update --id "LOCALIZATION_ID" --whats-new "Updated notes"
```

## Multi-Language Workflow

```bash
# 1. Download every locale to .strings
asc localizations download --version "VERSION_ID" --path "./localizations"

# 2. Translate the .strings files (or use a translation service)

# 3. Upload them all back
asc localizations upload --version "VERSION_ID" --path "./localizations"

# 4. Verify
asc localizations list --version "VERSION_ID" --output table
```

## .strings File Format

```
// en-US.strings — version localization
"description" = "Your app description";
"keywords" = "keyword1,keyword2,keyword3";
"whatsNew" = "What's new in this version";
"supportUrl" = "https://support.example.com";
```

```
// en-US.strings — app-info localization
"name" = "Your App Name";
"subtitle" = "Your subtitle";
"privacyPolicyUrl" = "https://example.com/privacy";
```

## Character Limits

| Field | Limit |
|-------|-------|
| Name | 30 |
| Subtitle | 30 |
| Keywords | 100 (comma-separated) |
| Description | 4000 |
| What's New | 4000 |
| Promotional Text | 170 |

`asc migrate validate` enforces these before an import.

## Notes

- Version localizations and app info localizations are different records — set
  version fields with `--version`, app-info fields (name/subtitle) without it.
- Confirm any command's flags with `asc <group> <verb> -h` (single dash) before running.
- `migrate import --dry-run` previews the exact write; treat it as mandatory before a real import.
- Privacy Policy URL is an app-info field, not a version field.
