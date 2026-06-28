import type { CopyFields } from "./optimize.js";
import type { NormalizedListing } from "./store/types.js";

export type BundleFile = { path: string; content: string };
export type FastlaneBundle = { files: BundleFile[] };

const DEFAULT_LOCALE = "en-US";
const DEFAULT_ANDROID_LANG = "en-US";

/**
 * Build the `fastlane/metadata/` file tree that Fastlane `deliver` (App Store)
 * reads directly. This is the metadata handoff that ties into the user's
 * existing build pipeline: they commit this tree (or merge the PR that writes
 * it) and their CI — which already holds the store credentials — runs
 * `fastlane deliver`. ShipASO produces the artifact; it never holds credentials
 * and never pushes.
 *
 * ShipASO is iOS-only: it does not connect to Google Play, runs no Play audit,
 * and Play indexes copy differently. So we deliberately emit NO `metadata/android`
 * (`fastlane supply`) tree — presenting an unsupported store as supported would
 * be dishonest. Android support is gated on real Play integration (PRD-05).
 *
 * App Store (deliver):  fastlane/metadata/<locale>/{name,subtitle,keywords,promotional_text,description}.txt
 */
export function buildFastlaneBundle(
  copy: CopyFields,
  opts: { locale?: string } = {},
): FastlaneBundle {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const files: BundleFile[] = [];
  const add = (path: string, content: string | undefined) => {
    // Skip undefined AND empty fields. An empty field written to a .txt file would
    // make `fastlane deliver` WIPE the live value on App Store Connect — so a
    // field we didn't propose (e.g. subtitle/keywords when ASC wasn't read, #30)
    // must produce NO file, not a blank one that clobbers the listing (#29).
    if (content === undefined || content.trim() === "") return;
    files.push({ path, content });
  };

  // ── App Store · deliver ──
  const ios = `fastlane/metadata/${locale}`;
  add(`${ios}/name.txt`, copy.name);
  add(`${ios}/subtitle.txt`, copy.subtitle);
  add(`${ios}/keywords.txt`, copy.keywords);
  add(`${ios}/promotional_text.txt`, copy.promo);
  add(`${ios}/description.txt`, copy.description);
  add(`${ios}/release_notes.txt`, copy.whatsNew); // What's New / release notes (#46)

  // ── README ──
  add("fastlane/metadata/SHIPASO_README.md", fastlaneReadme(locale));

  return { files };
}

/** Operator-facing note dropped beside the metadata tree. */
export function fastlaneReadme(locale: string): string {
  return [
    "# ShipASO — Fastlane metadata handoff",
    "",
    "ShipASO generated this `fastlane/metadata/` tree from your approved copy.",
    "It is the metadata your build pipeline already knows how to push — ShipASO",
    "never holds your store credentials and never pushes for you.",
    "",
    "## What this is",
    "",
    "- **App Store** (`fastlane deliver`): `metadata/" + locale + "/*.txt`",
    "  — `name`, `subtitle`, `keywords`, `promotional_text`, `description`, `release_notes`.",
    "",
    "## How to apply it",
    "",
    "1. Commit this tree into your app repo (or merge the PR that adds it).",
    "2. Your CI — which already holds your App Store Connect API key / Play service",
    "   account — runs the push:",
    "",
    "   ```bash",
    "   # App Store (metadata only; safe to run without uploading a build)",
    "   fastlane deliver --skip_binary_upload --skip_screenshots --force",
    "   ```",
    "",
    "3. The credentialed step lives in your pipeline, not in ShipASO.",
    "",
    "## ⚠️ This OVERWRITES existing metadata",
    "",
    "Committing these files **replaces** the matching files already in your repo —",
    "and `fastlane deliver` then pushes them over your live App Store Connect",
    "listing. **Review `git diff` before committing**, especially `subtitle.txt`",
    "and `keywords.txt`: if you have hand-tuned ASO there, this could regress it.",
    "ShipASO only includes a field here when it had a value to propose — a field",
    "ShipASO did not read (e.g. subtitle/keywords without an App Store Connect key)",
    "is **omitted entirely** so it can't blank or downgrade your live value.",
    "",
    "_The App Store push is the one irreversible step. Review the diff before you merge._",
    "",
  ].join("\n");
}

// ── Google Play · supply ─────────────────────────────────────────────────────
//
// The Android handoff was deliberately removed until Play support was real (it
// must NEVER be derived from iOS copy). This rebuilds it under a strict gate:
// the metadata/android tree is written ONLY from a REAL Play `NormalizedListing`
// that was actually read, and ONLY for the fields that read returned. A field we
// did not read (null) or that came back empty produces NO file — an empty .txt
// would make `fastlane supply` WIPE the live Play value (the same omit-don't-blank
// safeguard the App Store path uses, doubly important for the long description).

/**
 * Build the `fastlane/metadata/android/<lang>/` tree that `fastlane supply` reads.
 *
 * GATE: the input is a REAL Play listing the engine actually read — the function
 * cannot be called with iOS `CopyFields`. It only emits files for a
 * `store === "googleplay"` listing, and only for fields that were measured
 * (non-null, non-empty). If nothing was measured, it returns an EMPTY bundle (no
 * tree, no README) — there is no honest handoff to make.
 *
 * supply fields: title.txt (≤30), short_description.txt (≤80), full_description.txt.
 */
export function buildFastlaneSupply(
  listing: NormalizedListing,
  opts: { lang?: string } = {},
): FastlaneBundle {
  // Defensive honesty gate: never emit an android tree from a non-Play listing
  // (that would be the exact "Android from iOS copy" bug this guards against).
  if (listing.store !== "googleplay") return { files: [] };

  const lang = opts.lang ?? DEFAULT_ANDROID_LANG;
  const base = `fastlane/metadata/android/${lang}`;
  const files: BundleFile[] = [];
  const add = (path: string, content: string | null) => {
    // Omit-don't-blank: a field we didn't read (null) OR that's empty produces NO
    // file. An empty .txt makes `supply` wipe the live value.
    if (content === null || content.trim() === "") return;
    files.push({ path, content });
  };

  add(`${base}/title.txt`, listing.title);
  add(`${base}/short_description.txt`, listing.tagline);
  add(`${base}/full_description.txt`, listing.longDescription);

  // No real field was read → no honest handoff. Emit nothing (not even a README).
  if (files.length === 0) return { files: [] };

  files.push({
    path: "fastlane/metadata/SHIPASO_README_ANDROID.md",
    content: fastlaneSupplyReadme(lang),
  });
  return { files };
}

/** Operator-facing note dropped beside the Google Play metadata tree. */
export function fastlaneSupplyReadme(lang: string): string {
  return [
    "# ShipASO — Fastlane supply (Google Play) handoff",
    "",
    "ShipASO generated this `fastlane/metadata/android/` tree from a REAL Google",
    "Play listing it read — never from your iOS copy. It is the metadata your build",
    "pipeline already knows how to push; ShipASO never holds your Play credentials",
    "and never pushes for you.",
    "",
    "## What this is",
    "",
    "- **Google Play** (`fastlane supply`): `metadata/android/" + lang + "/*.txt`",
    "  — `title`, `short_description`, `full_description`.",
    "- A field ShipASO could NOT read (Play has no keyword field; the short",
    "  description isn't in the public page data) is **omitted entirely** — never",
    "  written blank.",
    "",
    "## How to apply it",
    "",
    "1. Commit this tree into your app repo (or merge the PR that adds it).",
    "2. Your CI — which already holds your Play service-account JSON — runs the push:",
    "",
    "   ```bash",
    "   # Google Play (metadata only; no APK/AAB upload)",
    "   fastlane supply --skip_upload_apk --skip_upload_aab --skip_upload_images \\",
    "     --skip_upload_screenshots",
    "   ```",
    "",
    "3. The credentialed step lives in your pipeline, not in ShipASO.",
    "",
    "## ⚠️ This OVERWRITES existing metadata — and ONLY for an app you OWN",
    "",
    "`fastlane supply` pushes to the Play listing your service account controls, so",
    "only ever apply this tree to **your own** app — never a listing you merely",
    "audited as a competitor. Committing these files **replaces** the matching files",
    "in your repo, and `supply` then pushes them over your live Play listing.",
    "**Review `git diff` before committing**, especially `full_description.txt`:",
    "Google Play indexes it for search, so a regression there can cost ranking.",
    "ShipASO only includes a field when it had a real value to hand off — anything",
    "it did not read is omitted so it can't blank your live value.",
    "",
    "_The Play push is the irreversible step. Review the diff before you merge._",
    "",
  ].join("\n");
}
