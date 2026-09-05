import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * No price language on any screen that ends up in an App Store screenshot.
 *
 * App Review rejected 0.1.0 under Guideline 2.3.7 (submission a64749cd,
 * 2026-07-29): "The app screenshots include references to the price of the app
 * or the service it provides." All three screenshots carried it, twice as the
 * largest text on screen:
 *
 *   01-audit-result.png   "Try it — free, no signup"
 *   02-search-any-app.png "Try it — free, no signup"
 *   03-login-free.png     "Try it free — no signup"
 *
 * Apple counts "free" as a price reference, explicitly: "references to free or
 * discounted services are considered a price reference".
 *
 * The trap that made this expensive: these were NOT caption overlays rendered
 * by the screenshot pipeline. They are the app's own UI text, captured live
 * from the simulator. So the fix is a code change plus a rebuild plus a
 * re-capture — not an asset swap — and a regression here silently reappears in
 * the next screenshot set, where nobody reads it until App Review does.
 *
 * Scoped to the PUBLIC pre-auth screens, because those are what a screenshot
 * shows. Price language behind a login (a billing screen naming a plan price)
 * is legitimate and not what 2.3.7 addresses.
 *
 * "No signup" is deliberately still allowed — that describes friction, not
 * price.
 */
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

/** Screens that appear, or plausibly appear, in an App Store screenshot. */
const SCREENSHOT_SURFACES = [
  "mobile/app/(public)/preview.tsx",
  "mobile/app/(public)/login.tsx",
  "mobile/src/components/brand.tsx",
  "cloud/web/src/features/public/PreviewView.tsx",
];

/**
 * Price language per Apple's wording. Deliberately narrow: it matches the
 * marketing claim ("try it free", "free trial", "$0", "50% off"), not every
 * occurrence of the word — "free" appears legitimately in "your credentials
 * never leave your machine, free of…" style prose and in code identifiers.
 */
const PRICE_CLAIMS = [
  /\btry it (for )?free\b/i,
  /\bfree\s*[—–-]\s*no signup\b/i,
  /\bfree,\s*no signup\b/i,
  /\bfree trial\b/i,
  /\bfor free\b/i,
  /\bno cost\b/i,
  /\b\$\s?0\b/,
  /\b\d+%\s*off\b/i,
  /\bdiscount(ed)?\b/i,
  /\bon sale\b/i,
];

/**
 * Only user-visible strings — JSX text and quoted literals, never comments.
 *
 * Stripping comments is load-bearing in BOTH directions here. The comments
 * beside these strings necessarily quote the words under test ("no signup",
 * "free") to explain the rule, so a check against raw source would both
 * false-positive on the price guard and false-pass on the promise guard.
 * Block comments are removed wholesale, since a JSX `{/* … *␘/}` spans lines
 * and its body is not prefixed per line.
 */
function visibleText(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block + JSX comments, including multi-line
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

for (const file of SCREENSHOT_SURFACES) {
  test(`${file} states no price claim (Guideline 2.3.7)`, () => {
    const text = visibleText(read(file));
    const hits = PRICE_CLAIMS.flatMap((re) => {
      const m = text.match(re);
      return m ? [m[0]] : [];
    });
    assert.deepEqual(
      hits,
      [],
      `${file} contains price language ${JSON.stringify(hits)} — this screen is captured into an App Store screenshot, and Apple counts "free"/discount wording as a price reference (Guideline 2.3.7). Say what it does, not what it costs; "no signup" is fine.`,
    );
  });
}

/**
 * The positive half: the screens must still say the audit needs no account.
 * Removing "free" by deleting the whole promise would pass the rule above and
 * lose the thing that makes a logged-out visitor (and a reviewer) reach real
 * value without a sign-in wall.
 */
for (const file of ["mobile/app/(public)/preview.tsx", "mobile/app/(public)/login.tsx"]) {
  test(`${file} still promises a no-signup audit`, () => {
    // Asserted against visibleText(), NOT the raw source. The comments added
    // beside these strings explain that "no signup" is friction rather than
    // price — so they contain the very phrase being checked for, and matching
    // the raw file would pass on the COMMENT after the UI text was deleted.
    // Mutation testing caught exactly that: removing the promise from the
    // headline left this green because the comment above it still said it.
    assert.match(
      visibleText(read(file)),
      /no signup/i,
      `${file} no longer promises a no-signup audit — that is the reason this screen exists ahead of the login wall`,
    );
  });
}
