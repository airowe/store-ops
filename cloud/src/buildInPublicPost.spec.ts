/**
 * #BuildInPublic post composer — the growth loop's copy + honesty rules.
 *
 * Pure: no network, no `bird`/X. Asserts the post states the real move, carries
 * the award hashtags + the store link, fits X's 280-char budget, and — the
 * load-bearing rule — emits NOTHING when there is no genuine win.
 */
import { describe, expect, it } from "vitest";
import {
  buildInPublicPostFromDeltas,
  composeBuildInPublicPost,
  type PostMeta,
} from "./buildInPublicPost.js";
import type { RankDeltaView } from "./digest.js";
import type { ShareWin } from "./shareCard.js";

const META: PostMeta = { appName: "ShipASO", storeUrl: "https://apps.apple.com/app/id6787632160" };
const TWEET_MAX = 280;
const TCO = 23;

/** X's effective length: every URL counts as 23 regardless of real length. */
function xLen(text: string, url: string): number {
  return text.includes(url) ? text.length - url.length + TCO : text.length;
}

const climb: ShareWin = { keyword: "budget tracker", current: 12, previous: 40, delta: -28, direction: "up" };
const debut: ShareWin = { keyword: "expense app", current: 22, previous: null, delta: null, direction: "new" };

describe("composeBuildInPublicPost", () => {
  it("states the real move, the store link, and both award hashtags for a climb", () => {
    const post = composeBuildInPublicPost(climb, META);
    expect(post.text).toContain("budget tracker");
    expect(post.text).toContain("#40 → #12");
    expect(post.text).toContain("up 28 spots");
    expect(post.text).toContain(META.storeUrl);
    expect(post.text).toContain("#BuildInPublic");
    expect(post.text).toContain("#Shipaton");
    expect(post.hashtags).toEqual(["#BuildInPublic", "#Shipaton"]);
  });

  it("renders the proof card (wide) that backs the claim", () => {
    const post = composeBuildInPublicPost(climb, META);
    expect(post.cardSvg).toContain("<svg");
    expect(post.cardSvg).toContain('width="1200"');
    expect(post.cardSvg).toContain("budget tracker");
    expect(post.cardSvg).toContain("#12");
  });

  it("phrases a strong new entry as a debut, with no before→after arrow", () => {
    const post = composeBuildInPublicPost(debut, META);
    expect(post.text).toContain("debuted at #22");
    expect(post.text).not.toContain("→");
    expect(post.text).toContain("#BuildInPublic");
  });

  it("uses the singular 'spot' for a one-place climb", () => {
    const one: ShareWin = { keyword: "k", current: 9, previous: 10, delta: -1, direction: "up" };
    expect(composeBuildInPublicPost(one, META).text).toContain("up 1 spot");
    expect(composeBuildInPublicPost(one, META).text).not.toContain("up 1 spots");
  });

  it("fits X's 280-char budget (URL counted as a t.co link)", () => {
    const post = composeBuildInPublicPost(climb, META);
    expect(xLen(post.text, META.storeUrl)).toBeLessThanOrEqual(TWEET_MAX);
  });

  it("trims only the keyword — never the move, link, or tags — to fit a huge keyword", () => {
    const huge: ShareWin = { ...climb, keyword: "x".repeat(300) };
    const post = composeBuildInPublicPost(huge, META);
    expect(xLen(post.text, META.storeUrl)).toBeLessThanOrEqual(TWEET_MAX);
    // the sacred parts survive
    expect(post.text).toContain("#40 → #12");
    expect(post.text).toContain(META.storeUrl);
    expect(post.text).toContain("#BuildInPublic");
    expect(post.text).toContain("…"); // keyword was elided
  });
});

describe("buildInPublicPostFromDeltas — honesty bar", () => {
  const view = (entries: RankDeltaView["entries"]): RankDeltaView => ({ entries } as RankDeltaView);

  it("composes a post from the best qualifying win in the view", () => {
    const post = buildInPublicPostFromDeltas(view([climb]), META);
    expect(post).not.toBeNull();
    expect(post!.text).toContain("up 28 spots");
  });

  it("returns null when there is no genuine win (holds/slips/weak debuts → post nothing)", () => {
    const hold: RankDeltaView["entries"][number] = {
      keyword: "k",
      current: 30,
      previous: 30,
      delta: 0,
      direction: "same",
    };
    const slip: RankDeltaView["entries"][number] = {
      keyword: "k2",
      current: 50,
      previous: 40,
      delta: 10,
      direction: "down",
    };
    expect(buildInPublicPostFromDeltas(view([hold, slip]), META)).toBeNull();
  });

  it("returns null for a weak debut (debuted outside the strong-new threshold)", () => {
    const weak: RankDeltaView["entries"][number] = {
      keyword: "k",
      current: 180,
      previous: null,
      delta: null,
      direction: "new",
    };
    expect(buildInPublicPostFromDeltas(view([weak]), META)).toBeNull();
  });
});
