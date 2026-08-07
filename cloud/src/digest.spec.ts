/**
 * Weekly "what moved" digest — PURE builder + renderers, fully testable with no
 * network and no DB. We feed in-memory RankSnapshotRow[] arrays (the same shape
 * `getRankHistory` returns: flat, mixed keywords, ASC by checked_at) and assert
 * the deltas, direction classification, top-mover selection, movement detection,
 * and the rendered html/text. The generic `EmailSender.send` is exercised for
 * both the Console and Resend impls without touching the wire.
 *
 * Rank convention: LOWER is better. Improving = current < previous = delta
 * negative = direction "up". A null current after a non-null previous = "lost";
 * a non-null current after a null/absent previous = "new".
 */
import { describe, expect, it } from "vitest";
import {
  buildDigest,
  rankDeltasView,
  planDigests,
  renderDigestHtml,
  renderDigestText,
  type DigestEntry,
  type DigestAppInput,
} from "./digest.js";
import type { RankSnapshotRow } from "./d1.js";
import { ConsoleEmailSender, ResendEmailSender } from "./auth.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

let seq = 0;
/** Build a RankSnapshotRow with a monotonically-increasing id (ASC tie-break). */
function snap(
  keyword: string,
  rank: number | null,
  checkedAt: string,
  total = 200,
): RankSnapshotRow {
  return {
    id: `snap-${String(seq++).padStart(6, "0")}`,
    app_id: "app-1",
    keyword,
    rank,
    total,
    country: "us",
    checked_at: checkedAt,
  };
}

const WEEK1 = "2026-06-01 09:00:00";
const WEEK2 = "2026-06-08 09:00:00";
const WEEK3 = "2026-06-15 09:00:00";

/** Pull a single keyword's entry out of a built digest. */
function entryFor<T extends DigestEntry>(entries: T[], keyword: string): T {
  const found = entries.find((e) => e.keyword === keyword);
  if (!found) throw new Error(`no digest entry for keyword "${keyword}"`);
  return found;
}

describe("buildDigest — delta + direction classification", () => {
  it("classifies an improvement (lower rank) as direction 'up' with negative delta", () => {
    const history = [snap("budget tracker", 40, WEEK1), snap("budget tracker", 12, WEEK2)];
    const { entries } = buildDigest(history, { appName: "Acme" });
    const e = entryFor(entries, "budget tracker");
    expect(e.previous).toBe(40);
    expect(e.current).toBe(12);
    // lower-is-better: moved up 28 positions, delta is current - previous = -28
    expect(e.delta).toBe(-28);
    expect(e.direction).toBe("up");
  });

  it("classifies a worsening (higher rank) as direction 'down' with positive delta", () => {
    const history = [snap("expense app", 10, WEEK1), snap("expense app", 33, WEEK2)];
    const { entries } = buildDigest(history, { appName: "Acme" });
    const e = entryFor(entries, "expense app");
    expect(e.delta).toBe(23);
    expect(e.direction).toBe("down");
  });

  it("classifies entering the top-200 (prev null → current number) as 'new'", () => {
    const history = [snap("zero based", null, WEEK1), snap("zero based", 88, WEEK2)];
    const { entries } = buildDigest(history, { appName: "Acme" });
    const e = entryFor(entries, "zero based");
    expect(e.previous).toBeNull();
    expect(e.current).toBe(88);
    expect(e.delta).toBeNull();
    expect(e.direction).toBe("new");
  });

  it("classifies a keyword with only ONE snapshot (no previous) as 'new'", () => {
    const history = [snap("brand new kw", 55, WEEK1)];
    const { entries } = buildDigest(history, { appName: "Acme" });
    const e = entryFor(entries, "brand new kw");
    expect(e.previous).toBeNull();
    expect(e.current).toBe(55);
    expect(e.direction).toBe("new");
  });

  it("classifies dropping out of the top-200 (prev number → current null) as 'lost'", () => {
    const history = [snap("savings", 7, WEEK1), snap("savings", null, WEEK2)];
    const { entries } = buildDigest(history, { appName: "Acme" });
    const e = entryFor(entries, "savings");
    expect(e.previous).toBe(7);
    expect(e.current).toBeNull();
    expect(e.delta).toBeNull();
    expect(e.direction).toBe("lost");
  });

  it("classifies an unchanged rank as 'same' with delta 0", () => {
    const history = [snap("money", 15, WEEK1), snap("money", 15, WEEK2)];
    const { entries } = buildDigest(history, { appName: "Acme" });
    const e = entryFor(entries, "money");
    expect(e.delta).toBe(0);
    expect(e.direction).toBe("same");
  });

  it("classifies still-unranked (both null) as 'same' with null delta", () => {
    const history = [snap("obscure kw", null, WEEK1), snap("obscure kw", null, WEEK2)];
    const { entries } = buildDigest(history, { appName: "Acme" });
    const e = entryFor(entries, "obscure kw");
    expect(e.delta).toBeNull();
    expect(e.direction).toBe("same");
  });
});

describe("rankDeltasView — the API payload that feeds the animated dashboard", () => {
  it("returns one entry per keyword, each with current/previous/delta/direction", () => {
    const history = [
      snap("budget tracker", 40, WEEK1),
      snap("budget tracker", 12, WEEK2),
      snap("expense app", 10, WEEK1),
      snap("expense app", 33, WEEK2),
    ];
    const view = rankDeltasView(history, { appName: "Acme" });
    expect(view.appName).toBe("Acme");
    const up = entryFor(view.entries, "budget tracker");
    expect(up).toMatchObject({ current: 12, previous: 40, delta: -28, direction: "up" });
    const down = entryFor(view.entries, "expense app");
    expect(down).toMatchObject({ current: 33, previous: 10, delta: 23, direction: "down" });
  });

  it("orders entries by movement significance: biggest improvement first, 'same' last", () => {
    const history = [
      snap("small win", 20, WEEK1),
      snap("small win", 17, WEEK2), // up 3
      snap("big win", 80, WEEK1),
      snap("big win", 9, WEEK2), // up 71 — should lead
      snap("flat", 5, WEEK1),
      snap("flat", 5, WEEK2), // same — should trail
    ];
    const view = rankDeltasView(history, { appName: "Acme" });
    expect(view.entries[0]!.keyword).toBe("big win");
    expect(view.entries[view.entries.length - 1]!.keyword).toBe("flat");
  });

  // #74: when a `keywords` allowlist is passed (the CURRENT targeted set), the
  // view must drop history-only keywords no longer targeted — e.g. 'manager'/
  // 'mangia' tombstoned in pre-#57 snapshots must not resurface in rank movement.
  it("filters out keywords not in the current targeted set (#74)", () => {
    const history = [
      snap("recipe", 200, WEEK1),
      snap("recipe", 200, WEEK2),
      snap("manager", 175, WEEK1), // dropped pre-#57 keyword — must NOT appear
      snap("manager", 175, WEEK2),
      snap("mangia", 168, WEEK1), // brand token — must NOT appear
      snap("mangia", 168, WEEK2),
    ];
    const view = rankDeltasView(history, { appName: "Mangia", keywords: ["recipe", "meal", "pantry"] });
    const kws = view.entries.map((e) => e.keyword);
    expect(kws).toContain("recipe");
    expect(kws).not.toContain("manager");
    expect(kws).not.toContain("mangia");
  });

  it("returns ALL keywords when no allowlist is passed (back-compat)", () => {
    const history = [snap("a", 10, WEEK1), snap("a", 10, WEEK2), snap("b", 20, WEEK1), snap("b", 20, WEEK2)];
    const view = rankDeltasView(history, { appName: "Acme" });
    expect(view.entries.map((e) => e.keyword).sort()).toEqual(["a", "b"]);
  });

  it("falls back to the on-render shape (previous null) for single-snapshot keywords", () => {
    const history = [snap("brand new", 55, WEEK1)];
    const view = rankDeltasView(history, { appName: "Acme" });
    const e = entryFor(view.entries, "brand new");
    expect(e.previous).toBeNull();
    expect(e.current).toBe(55);
    expect(e.direction).toBe("new");
  });

  it("flags anyMovement false when nothing moved (so the UI can skip the animation)", () => {
    const history = [snap("flat", 5, WEEK1), snap("flat", 5, WEEK2)];
    const view = rankDeltasView(history, { appName: "Acme" });
    expect(view.anyMovement).toBe(false);
  });

  it("returns an empty entry list (not a throw) for an app with no history", () => {
    const view = rankDeltasView([], { appName: "Acme" });
    expect(view.entries).toEqual([]);
    expect(view.anyMovement).toBe(false);
  });

  // ── PRD 02: rank-attribution overlay (correlational, opt-in via `pushes`) ──
  it("overlays a linked, correlational attribution when a push added the moved keyword", () => {
    const history = [snap("stoic", null, WEEK1), snap("stoic", 18, WEEK2)];
    const view = rankDeltasView(history, {
      appName: "Acme",
      pushes: [
        {
          runId: "run-1",
          pushedAt: "2026-06-04 12:00:00", // between WEEK1 and WEEK2
          currentKeywords: "calm",
          proposedKeywords: "calm,stoic",
          currentSubtitle: "",
          proposedSubtitle: "",
        },
      ],
    });
    const e = entryFor(view.entries, "stoic");
    expect(e.confidence).toBe("linked");
    expect(e.attributedChange?.runId).toBe("run-1");
    expect(e.attributedChange?.note.toLowerCase()).toContain("after you added");
    expect(e.attributedChange?.note.toLowerCase()).not.toContain("caused");
  });

  it("leaves entries un-attributed (no overlay) when `pushes` is omitted", () => {
    const history = [snap("stoic", null, WEEK1), snap("stoic", 18, WEEK2)];
    const view = rankDeltasView(history, { appName: "Acme" });
    const e = entryFor(view.entries, "stoic");
    expect(e.confidence).toBeUndefined();
    expect(e.attributedChange).toBeUndefined();
  });

  it("marks a moved keyword 'coincident' (no overlay) when no push added it", () => {
    const history = [snap("stoic", 50, WEEK1), snap("stoic", 30, WEEK2)];
    const view = rankDeltasView(history, {
      appName: "Acme",
      pushes: [
        {
          runId: "run-2",
          pushedAt: "2026-06-04 12:00:00",
          currentKeywords: "calm",
          proposedKeywords: "calm,mindfulness", // did not add "stoic"
          currentSubtitle: "",
          proposedSubtitle: "",
        },
      ],
    });
    const e = entryFor(view.entries, "stoic");
    expect(e.confidence).toBe("coincident");
    expect(e.attributedChange).toBeUndefined();
  });
});

describe("buildDigest — last-two-distinct-snapshots window", () => {
  it("uses the two most-recent DISTINCT checked_at snapshots per keyword (ignores older)", () => {
    // three weekly passes; the delta must be WEEK2 (40) → WEEK3 (10), not WEEK1.
    const history = [
      snap("planner", 90, WEEK1),
      snap("planner", 40, WEEK2),
      snap("planner", 10, WEEK3),
    ];
    const { entries } = buildDigest(history, { appName: "Acme" });
    const e = entryFor(entries, "planner");
    expect(e.previous).toBe(40);
    expect(e.current).toBe(10);
    expect(e.delta).toBe(-30);
    expect(e.direction).toBe("up");
  });

  it("collapses multiple rows that share one checked_at into a single distinct snapshot", () => {
    // two rows at WEEK2 (same checked_at) must count as ONE snapshot; the previous
    // distinct snapshot is WEEK1, so the delta is WEEK1 → WEEK2.
    const history = [
      snap("dupe kw", 50, WEEK1),
      snap("dupe kw", 20, WEEK2),
      snap("dupe kw", 20, WEEK2),
    ];
    const { entries } = buildDigest(history, { appName: "Acme" });
    const e = entryFor(entries, "dupe kw");
    expect(e.previous).toBe(50);
    expect(e.current).toBe(20);
    expect(e.delta).toBe(-30);
  });

  it("groups a flat mixed-keyword history into one entry per keyword", () => {
    const history = [
      snap("alpha", 30, WEEK1),
      snap("beta", 100, WEEK1),
      snap("alpha", 20, WEEK2),
      snap("beta", 80, WEEK2),
    ];
    const { entries } = buildDigest(history, { appName: "Acme" });
    expect(entries).toHaveLength(2);
    expect(entryFor(entries, "alpha").delta).toBe(-10);
    expect(entryFor(entries, "beta").delta).toBe(-20);
  });
});

describe("buildDigest — topMover + anyMovement", () => {
  it("selects the biggest IMPROVEMENT as topMover (most negative numeric delta)", () => {
    const history = [
      snap("small win", 20, WEEK1),
      snap("small win", 15, WEEK2), // -5
      snap("big win", 95, WEEK1),
      snap("big win", 40, WEEK2), // -55
      snap("regressed", 5, WEEK1),
      snap("regressed", 60, WEEK2), // +55 (worse, never the top mover)
    ];
    const { topMover } = buildDigest(history, { appName: "Acme" });
    expect(topMover).not.toBeNull();
    expect(topMover!.keyword).toBe("big win");
    expect(topMover!.delta).toBe(-55);
  });

  it("returns topMover null and anyMovement false when nothing moved", () => {
    const history = [
      snap("flat a", 10, WEEK1),
      snap("flat a", 10, WEEK2),
      snap("flat b", null, WEEK1),
      snap("flat b", null, WEEK2),
    ];
    const { topMover, anyMovement } = buildDigest(history, { appName: "Acme" });
    expect(topMover).toBeNull();
    expect(anyMovement).toBe(false);
  });

  it("counts a 'new' entry as movement even though its numeric delta is null", () => {
    const history = [snap("fresh", null, WEEK1), snap("fresh", 120, WEEK2)];
    const { anyMovement, topMover } = buildDigest(history, { appName: "Acme" });
    expect(anyMovement).toBe(true);
    // a 'new' entry with no numeric delta is not a numeric topMover, but with no
    // numeric movers at all it is still the most notable event.
    expect(topMover).not.toBeNull();
    expect(topMover!.keyword).toBe("fresh");
  });

  it("counts a 'lost' entry as movement", () => {
    const history = [snap("dropped", 3, WEEK1), snap("dropped", null, WEEK2)];
    const { anyMovement } = buildDigest(history, { appName: "Acme" });
    expect(anyMovement).toBe(true);
  });

  it("prefers a numeric improvement over a 'new' entry for topMover", () => {
    const history = [
      snap("numeric", 50, WEEK1),
      snap("numeric", 20, WEEK2), // -30 improvement
      snap("entered", null, WEEK1),
      snap("entered", 199, WEEK2), // new, null delta
    ];
    const { topMover } = buildDigest(history, { appName: "Acme" });
    expect(topMover!.keyword).toBe("numeric");
  });
});

describe("buildDigest — empty / safety", () => {
  it("handles empty history with no throw", () => {
    const { entries, topMover, anyMovement, appName } = buildDigest([], { appName: "Acme" });
    expect(entries).toEqual([]);
    expect(topMover).toBeNull();
    expect(anyMovement).toBe(false);
    expect(appName).toBe("Acme");
  });

  it("carries appName through to the result", () => {
    const { appName } = buildDigest([snap("k", 1, WEEK1)], { appName: "Budgeteer" });
    expect(appName).toBe("Budgeteer");
  });
});

describe("renderDigestHtml / renderDigestText — content + CTA", () => {
  const dashboardUrl = "https://app.shipaso.com/dashboard";

  it("html lists the moved keyword and links the single dashboard CTA", () => {
    const digest = buildDigest(
      [snap("budget tracker", 40, WEEK1), snap("budget tracker", 12, WEEK2)],
      { appName: "Acme" },
    );
    const html = renderDigestHtml(digest, {
      appName: "Acme",
      dashboardUrl,
      hasPendingApproval: false,
    });
    expect(html).toContain("budget tracker");
    expect(html).toContain("Acme");
    expect(html).toContain(dashboardUrl);
    // exactly one CTA href to the dashboard
    const hrefs = html.match(new RegExp(`href="${dashboardUrl.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&")}"`, "g")) ?? [];
    expect(hrefs).toHaveLength(1);
  });

  it("text mirrors the keyword and the dashboard url", () => {
    const digest = buildDigest(
      [snap("budget tracker", 40, WEEK1), snap("budget tracker", 12, WEEK2)],
      { appName: "Acme" },
    );
    const text = renderDigestText(digest, {
      appName: "Acme",
      dashboardUrl,
      hasPendingApproval: false,
    });
    expect(text).toContain("budget tracker");
    expect(text).toContain(dashboardUrl);
  });

  it("shows the honest 'held steady' line when nothing moved (html + text)", () => {
    const digest = buildDigest(
      [snap("flat", 10, WEEK1), snap("flat", 10, WEEK2)],
      { appName: "Acme" },
    );
    const html = renderDigestHtml(digest, {
      appName: "Acme",
      dashboardUrl,
      hasPendingApproval: false,
    });
    const text = renderDigestText(digest, {
      appName: "Acme",
      dashboardUrl,
      hasPendingApproval: false,
    });
    expect(html.toLowerCase()).toContain("held steady");
    expect(text.toLowerCase()).toContain("held steady");
    expect(html.toLowerCase()).toContain("nothing needs you");
  });

  it("is a branded, share-worthy email — ShipASO identity + a visual rank-moved hero", () => {
    const digest = buildDigest(
      [snap("meditation", 12, WEEK1), snap("meditation", 4, WEEK2)],
      { appName: "Calm" },
    );
    const html = renderDigestHtml(digest, { appName: "Calm", dashboardUrl, hasPendingApproval: false });
    // brand identity present (so a screenshot of the email reads as ShipASO)
    expect(html).toContain("ShipASO");
    // the signal-green brand color shows up (the "rank moved" visual)
    expect(html.toLowerCase()).toContain("#34d399");
    // the top mover's before→after is rendered as the hero number
    expect(html).toContain("#12");
    expect(html).toContain("#4");
    // still exactly one dashboard CTA (the share-worthy upgrade must not add link clutter)
    const hrefs = html.match(new RegExp(`href="${dashboardUrl.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&")}"`, "g")) ?? [];
    expect(hrefs).toHaveLength(1);
  });

  it("surfaces a pending-approval line + link when hasPendingApproval is true", () => {
    const digest = buildDigest(
      [snap("flat", 10, WEEK1), snap("flat", 10, WEEK2)],
      { appName: "Acme" },
    );
    const html = renderDigestHtml(digest, {
      appName: "Acme",
      dashboardUrl,
      hasPendingApproval: true,
    });
    const text = renderDigestText(digest, {
      appName: "Acme",
      dashboardUrl,
      hasPendingApproval: true,
    });
    expect(html.toLowerCase()).toContain("waiting for your approval");
    expect(text.toLowerCase()).toContain("waiting for your approval");
  });

  it("omits the pending-approval line when hasPendingApproval is false", () => {
    const digest = buildDigest(
      [snap("budget tracker", 40, WEEK1), snap("budget tracker", 12, WEEK2)],
      { appName: "Acme" },
    );
    const html = renderDigestHtml(digest, {
      appName: "Acme",
      dashboardUrl,
      hasPendingApproval: false,
    });
    expect(html.toLowerCase()).not.toContain("waiting for your approval");
  });

  it("escapes html-unsafe characters in the app name and keyword", () => {
    const digest = buildDigest(
      [snap("<b>kw</b>", 40, WEEK1), snap("<b>kw</b>", 12, WEEK2)],
      { appName: "<script>x</script>" },
    );
    const html = renderDigestHtml(digest, {
      appName: "<script>x</script>",
      dashboardUrl,
      hasPendingApproval: false,
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<b>kw</b>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ── the card: identity, chips, grades, screenshots ───────────────────────────
//
// The digest was text + inline CSS with no images at all. The card adds the
// visual layer (app icon, chips, grade tiles, screenshot strip) modelled on the
// app-intelligence cards people actually screenshot — but built ONLY from
// measured data. AppKittie's equivalent leads with ESTIMATED downloads and
// revenue; we have neither, and inventing them would break the first invariant.
// Ours leads with rank + coverage, which are measured.
//
// Every card field is optional: absent → that piece is omitted, never a
// placeholder. Email clients block remote images by default, so nothing the
// reader NEEDS may live in an image — ranks, grades and chips are text.

describe("renderDigestHtml — the card", () => {
  const dashboardUrl = "https://app.shipaso.com/dashboard";
  const base = { appName: "Swoop", dashboardUrl, hasPendingApproval: false };

  function digest() {
    return buildDigest(
      [snap("no login chat", 64, WEEK1), snap("no login chat", 31, WEEK2)],
      { appName: "Swoop" },
    );
  }

  const card = {
    iconUrl: "https://is1-ssl.mzstatic.com/image/thumb/icon.png/256x256bb.jpg",
    developer: "Swoopchat LLC",
    version: "1.0.33",
    category: "Social Networking",
    price: "Free",
    rating: { average: 5, count: 2 },
    grades: [
      { label: "Screenshots", grade: "B" },
      { label: "Keywords", grade: "C" },
      { label: "Description", grade: "D" },
    ],
    screenshotUrls: ["https://cdn/1.png", "https://cdn/2.png", "https://cdn/3.png"],
  };

  it("renders the identity row: icon, developer and version", () => {
    const html = renderDigestHtml(digest(), { ...base, card });
    expect(html).toContain(card.iconUrl);
    expect(html).toContain("Swoopchat LLC");
    expect(html).toContain("1.0.33");
  });

  it("renders the metadata chips", () => {
    const html = renderDigestHtml(digest(), { ...base, card });
    expect(html).toContain("Social Networking");
    expect(html).toContain("Free");
    expect(html).toContain("5.0");
    expect(html).toContain("(2)");
  });

  it("renders a tile per audit grade", () => {
    const html = renderDigestHtml(digest(), { ...base, card });
    for (const g of card.grades) expect(html).toContain(g.label);
  });

  it("renders the screenshot strip", () => {
    const html = renderDigestHtml(digest(), { ...base, card });
    for (const u of card.screenshotUrls) expect(html).toContain(u);
  });

  it("gives every image alt text — clients block images by default", () => {
    const html = renderDigestHtml(digest(), { ...base, card });
    const imgs = html.match(/<img[^>]*>/g) ?? [];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(img).toMatch(/alt="[^"]*"/);
  });

  it("keeps the result readable with every image stripped", () => {
    const html = renderDigestHtml(digest(), { ...base, card });
    const noImages = html.replace(/<img[^>]*>/g, "");
    expect(noImages).toContain("#31");
    expect(noImages).toContain("no login chat");
    expect(noImages).toContain(dashboardUrl);
  });

  it("omits the card entirely when no card data is supplied", () => {
    const html = renderDigestHtml(digest(), base);
    expect(html).not.toContain("<img");
    expect(html).toContain("#31");
    expect(html).toContain(dashboardUrl);
  });

  it("omits only the pieces that are missing, never a placeholder", () => {
    const html = renderDigestHtml(digest(), {
      ...base,
      card: { developer: "Swoopchat LLC" },
    });
    expect(html).toContain("Swoopchat LLC");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("escapes card values", () => {
    const html = renderDigestHtml(digest(), {
      ...base,
      card: { developer: "<script>x</script>", category: "<b>c</b>" },
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<b>c</b>");
  });

  it("caps the screenshot strip so a 10-shot set can't blow up the email", () => {
    const many = Array.from({ length: 10 }, (_, i) => `https://cdn/${i}.png`);
    const html = renderDigestHtml(digest(), { ...base, card: { screenshotUrls: many } });
    const imgs = html.match(/<img[^>]*>/g) ?? [];
    expect(imgs.length).toBeLessThanOrEqual(5);
  });

  it("planDigests threads an app's card into its rendered html", () => {
    const [msg] = planDigests(
      [
        {
          appId: "a1",
          appName: "Swoop",
          email: "dev@example.com",
          tier: "indie",
          hasPendingApproval: false,
          rankHistory: [snap("no login chat", 64, WEEK1), snap("no login chat", 31, WEEK2)],
          card: { developer: "Swoopchat LLC", iconUrl: "https://cdn/icon.png" },
        },
      ],
      { dashboardUrl },
    );
    expect(msg!.html).toContain("Swoopchat LLC");
    expect(msg!.html).toContain("https://cdn/icon.png");
  });

  it("planDigests still renders a text-only digest for an app with no card", () => {
    const [msg] = planDigests(
      [
        {
          appId: "a1",
          appName: "Swoop",
          email: "dev@example.com",
          tier: "indie",
          hasPendingApproval: false,
          rankHistory: [snap("no login chat", 64, WEEK1), snap("no login chat", 31, WEEK2)],
        },
      ],
      { dashboardUrl },
    );
    expect(msg!.html).not.toContain("<img");
    expect(msg!.html).toContain("#31");
  });

  it("still frames a first run as a baseline when card data is present", () => {
    const first = buildDigest([snap("irl", 119, WEEK1)], { appName: "Swoop" });
    const html = renderDigestHtml(first, { ...base, card });
    expect(html).not.toContain("▲");
    expect(html).toContain("Swoopchat LLC");
  });
});

// ── first-run baseline: a starting position is NOT a result ───────────────────
//
// A first snapshot has no prior, so every ranked keyword classifies as "new".
// The HTML hero used to render `new` with the same green ▲ as a real
// improvement — so a baseline read as "ShipASO moved you to #64 this week"
// when nothing had moved at all. The TEXT render was always honest ("entered
// the top 200 at #64"); only the visual overstated it, and the visual is the
// part people screenshot. Baseline framing is now explicit.

describe("renderDigestHtml — first-run baseline is never dressed as a win", () => {
  const dashboardUrl = "https://app.shipaso.com/dashboard";
  const opts = { appName: "Swoop", dashboardUrl, hasPendingApproval: false };

  /** A first-ever snapshot: three ranked keywords, no prior history. */
  function firstRun() {
    return buildDigest(
      [
        snap("no login chat", 64, WEEK1),
        snap("make friends irl", 116, WEEK1),
        snap("irl", 119, WEEK1),
        snap("meet people", null, WEEK1),
        snap("make friends", null, WEEK1),
      ],
      { appName: "Swoop" },
    );
  }

  it("flags a digest whose every entry lacks a prior snapshot as firstRun", () => {
    expect(firstRun().isFirstRun).toBe(true);
  });

  it("does NOT flag a digest with real week-over-week movement as firstRun", () => {
    const d = buildDigest(
      [snap("budget tracker", 40, WEEK1), snap("budget tracker", 12, WEEK2)],
      { appName: "Acme" },
    );
    expect(d.isFirstRun).toBe(false);
  });

  it("renders no movement arrow on a first run", () => {
    const html = renderDigestHtml(firstRun(), opts);
    expect(html).not.toContain("▲");
    expect(html).not.toContain("▼");
  });

  it("does not paint the first-run hero in the movement-signal colour", () => {
    const html = renderDigestHtml(firstRun(), opts);
    // #34d399 is the "improved" green; it may still appear on the CTA button,
    // but never inside the hero number.
    const hero = html.slice(html.indexOf("Best rank"), html.indexOf("</div>", html.indexOf("Best rank")) + 220);
    expect(hero).not.toContain("#34d399");
  });

  it("labels the first-run hero as a baseline, not a 'top mover'", () => {
    const html = renderDigestHtml(firstRun(), opts);
    expect(html.toLowerCase()).not.toContain("top mover");
    expect(html).toContain("Best rank");
  });

  it("leads with coverage — how many of the tracked keywords rank at all", () => {
    const html = renderDigestHtml(firstRun(), opts);
    // 3 of the 5 tracked keywords returned a rank.
    expect(html).toContain("3 of 5");
  });

  it("never claims a keyword 'entered' anything on a first run", () => {
    const html = renderDigestHtml(firstRun(), opts);
    expect(html.toLowerCase()).not.toContain("entered the top");
  });

  it("still shows the real starting rank and the single CTA", () => {
    const html = renderDigestHtml(firstRun(), opts);
    expect(html).toContain("#64");
    expect(html).toContain(dashboardUrl);
  });

  it("does not promise a 'trend' in the CTA when there is only one snapshot", () => {
    const html = renderDigestHtml(firstRun(), opts);
    expect(html).not.toContain("See the full trend");
    expect(html).toContain("See the full picture");
  });

  it("lists the other starting ranks as plain positions, not movements", () => {
    const html = renderDigestHtml(firstRun(), opts);
    expect(html).toContain("make friends irl");
    expect(html).toContain("#116");
    expect(html).not.toContain("entered");
  });

  it("keeps the green ▲ hero for a genuine improvement (week 2+ unchanged)", () => {
    const d = buildDigest(
      [snap("budget tracker", 40, WEEK1), snap("budget tracker", 12, WEEK2)],
      { appName: "Acme" },
    );
    const html = renderDigestHtml(d, { ...opts, appName: "Acme" });
    expect(html).toContain("▲");
    expect(html).toContain("#34d399");
    expect(html.toLowerCase()).toContain("top mover");
  });

  it("text render also frames a first run as a baseline", () => {
    const text = renderDigestText(firstRun(), opts);
    expect(text.toLowerCase()).not.toContain("top mover");
    expect(text).toContain("3 of 5");
  });
});

// ── EmailSender.send (generic primitive) ───────────────────────────────────────

describe("EmailSender.send — generic primitive", () => {
  type Call = { url: string; init: RequestInit };
  function mockFetch(status = 200, body: unknown = { id: "email_123" }) {
    const calls: Call[] = [];
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { fn, calls };
  }

  it("ConsoleEmailSender.send logs the subject, recipient, and text body", async () => {
    const lines: string[] = [];
    const sender = new ConsoleEmailSender((line) => lines.push(line));
    await sender.send({
      to: "owner@example.com",
      subject: "Your weekly ShipASO digest",
      html: "<p>hi</p>",
      text: "weekly digest body",
    });
    const joined = lines.join("\n");
    expect(joined).toContain("owner@example.com");
    expect(joined).toContain("Your weekly ShipASO digest");
    expect(joined).toContain("weekly digest body");
  });

  it("ResendEmailSender.send POSTs /emails with bearer auth, single recipient, and both parts", async () => {
    const { fn, calls } = mockFetch();
    const sender = new ResendEmailSender({ apiKey: "re_k", from: "ShipASO <hi@mail.x>", fetchFn: fn });
    await sender.send({
      to: "owner@example.com",
      subject: "Your weekly ShipASO digest",
      html: "<p>moved</p>",
      text: "moved",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_k");
    const payload = JSON.parse(calls[0]!.init.body as string);
    expect(payload.from).toBe("ShipASO <hi@mail.x>");
    expect(payload.to).toEqual(["owner@example.com"]);
    expect(payload.subject).toBe("Your weekly ShipASO digest");
    expect(payload.html).toBe("<p>moved</p>");
    expect(payload.text).toBe("moved");
  });

  it("ResendEmailSender.send throws on a non-2xx response", async () => {
    const { fn } = mockFetch(500, { message: "boom" });
    const sender = new ResendEmailSender({ apiKey: "k", from: "x@y.com", fetchFn: fn });
    await expect(
      sender.send({ to: "u@e.com", subject: "s", html: "<p>h</p>", text: "t" }),
    ).rejects.toThrow(/resend/i);
  });

  it("magic-link send still works and routes through the same transport (unchanged behavior)", async () => {
    const { fn, calls } = mockFetch();
    const sender = new ResendEmailSender({ apiKey: "k", from: "x@y.com", fetchFn: fn });
    await sender.sendMagicLink("user@example.com", "https://app/auth/callback?token=abc");
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(calls[0]!.init.body as string);
    expect(payload.to).toEqual(["user@example.com"]);
    expect(payload.html).toContain("https://app/auth/callback?token=abc");
    expect(payload.text).toContain("https://app/auth/callback?token=abc");
  });
});

describe("planDigests (pure: who gets a digest, and what's in it)", () => {
  const w1 = "2026-06-01 09:00:00";
  const w2 = "2026-06-08 09:00:00";
  function app(over: Partial<DigestAppInput>): DigestAppInput {
    return {
      appId: "a1",
      appName: "Clarity",
      email: "owner@example.com",
      tier: "indie",
      hasPendingApproval: false,
      rankHistory: [
        snap("secular meditation", 44, w1),
        snap("secular meditation", 12, w2),
      ],
      ...over,
    };
  }

  it("sends to every paid tier (indie/startup/scale), skips free", () => {
    const msgs = planDigests(
      [
        app({ appId: "a", email: "indie@x.com", tier: "indie" }),
        app({ appId: "b", email: "startup@x.com", tier: "startup" }),
        app({ appId: "c", email: "scale@x.com", tier: "scale" }),
        app({ appId: "d", email: "free@x.com", tier: "free" }),
      ],
      { dashboardUrl: "https://app.shipaso.com" },
    );
    const recipients = msgs.map((m) => m.to).sort();
    expect(recipients).toEqual(["indie@x.com", "scale@x.com", "startup@x.com"]);
  });

  it("builds a real subject + the moved keyword into html and text", () => {
    const [msg] = planDigests([app({})], { dashboardUrl: "https://app.shipaso.com" });
    expect(msg).toBeDefined();
    expect(msg!.to).toBe("owner@example.com");
    expect(msg!.subject).toMatch(/Clarity/);
    expect(msg!.html).toContain("secular meditation");
    expect(msg!.text).toContain("secular meditation");
  });

  it("surfaces a pending approval with the dashboard CTA when one is open", () => {
    const [msg] = planDigests([app({ hasPendingApproval: true })], {
      dashboardUrl: "https://app.shipaso.com",
    });
    expect(msg!.html).toContain("https://app.shipaso.com");
    expect((msg!.html + msg!.text).toLowerCase()).toContain("approv");
  });

  it("still emails an eligible app when nothing moved (held-steady honesty)", () => {
    const steady = app({
      rankHistory: [snap("calm", 5, w1), snap("calm", 5, w2)],
    });
    const [msg] = planDigests([steady], { dashboardUrl: "https://app.shipaso.com" });
    expect(msg).toBeDefined();
    expect((msg!.text + msg!.html).toLowerCase()).toMatch(/held steady|nothing/);
  });

  it("returns no messages for an empty app list", () => {
    expect(planDigests([], { dashboardUrl: "https://app.shipaso.com" })).toEqual([]);
  });
});
