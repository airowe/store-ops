import type { CopyFields } from "./optimize.js";

export type BundleFile = { path: string; content: string };
export type FastlaneBundle = { files: BundleFile[] };

const DEFAULT_LOCALE = "en-US";

/**
 * Build the `fastlane/metadata/` file tree that Fastlane `deliver` (App Store)
 * and `supply` (Google Play) read directly. This is the metadata handoff that
 * ties into the user's existing build pipeline: they commit this tree (or merge
 * the PR that writes it) and their CI — which already holds the store
 * credentials — runs `fastlane deliver` / `fastlane supply`. ShipASO produces
 * the artifact; it never holds credentials and never pushes.
 *
 * App Store (deliver):  fastlane/metadata/<locale>/{name,subtitle,keywords,promotional_text,description}.txt
 * Google Play (supply): fastlane/metadata/android/<locale>/{title,short_description,full_description}.txt
 *                       (Play has no keyword field.)
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

  // ── Google Play · supply (no keyword field) ──
  const android = `fastlane/metadata/android/${locale}`;
  add(`${android}/title.txt`, copy.name);
  add(`${android}/short_description.txt`, copy.subtitle);
  add(`${android}/full_description.txt`, copy.description);

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
    "  — `name`, `subtitle`, `keywords`, `promotional_text`, `description`.",
    "- **Google Play** (`fastlane supply`): `metadata/android/" + locale + "/*.txt`",
    "  — `title`, `short_description`, `full_description` (Play has no keyword field).",
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
    "",
    "   # Google Play",
    "   fastlane supply --skip_upload_apk --skip_upload_aab",
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
