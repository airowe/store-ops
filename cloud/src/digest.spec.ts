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
    checked_at: checkedAt,
  };
}

const WEEK1 = "2026-06-01 09:00:00";
const WEEK2 = "2026-06-08 09:00:00";
const WEEK3 = "2026-06-15 09:00:00";

/** Pull a single keyword's entry out of a built digest. */
function entryFor(entries: DigestEntry[], keyword: string): DigestEntry {
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
      tier: "autopilot",
      hasPendingApproval: false,
      rankHistory: [
        snap("secular meditation", 44, w1),
        snap("secular meditation", 12, w2),
      ],
      ...over,
    };
  }

  it("sends to autopilot and fleet tiers, skips free and launch", () => {
    const msgs = planDigests(
      [
        app({ appId: "a", email: "auto@x.com", tier: "autopilot" }),
        app({ appId: "b", email: "fleet@x.com", tier: "fleet" }),
        app({ appId: "c", email: "free@x.com", tier: "free" }),
        app({ appId: "d", email: "launch@x.com", tier: "launch" }),
      ],
      { dashboardUrl: "https://app.shipaso.com" },
    );
    const recipients = msgs.map((m) => m.to).sort();
    expect(recipients).toEqual(["auto@x.com", "fleet@x.com"]);
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
