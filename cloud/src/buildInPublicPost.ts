/**
 * #BuildInPublic post composer — turns a real, honest rank win into a
 * ready-to-post social update (text + the branded proof card).
 *
 * This is the growth loop that makes ShipASO its own marketing: every time the
 * agent moves an organic App Store rank, we can emit a post that PROVES it
 * (`shareCard.ts` renders the card) and narrates it with the #BuildInPublic +
 * #Shipaton tags. The composer is PURE — the caller (a cron/hook, or the `bird`
 * skill) does the actual posting.
 *
 * Honesty bar (inherited from `pickShareWin`): we only ever post a genuine climb
 * or a strong new entry. No win → no post. Better to say nothing than to dress
 * up a hold or a slip — the same discipline the product enforces everywhere.
 */
import type { RankDeltaView } from "./digest.js";
import { pickShareWin, renderShareCardSvg, type ShareWin } from "./shareCard.js";

export type PostMeta = {
  /** The app whose rank moved (the card's subject). */
  appName: string;
  /** Public store listing URL — the post's single link (App Store / Play). */
  storeUrl: string;
};

export type BuildInPublicPost = {
  /** The composed post text, guaranteed to fit X's 280-char limit. */
  text: string;
  /** The branded proof-card SVG (wide / 1200×630) to attach as the image. */
  cardSvg: string;
  /** The tags the #BuildInPublic award is judged on (already in `text`). */
  hashtags: string[];
};

const HASHTAGS = ["#BuildInPublic", "#Shipaton"];
const TWEET_MAX = 280;
// X shortens every URL to a fixed-length t.co link, regardless of real length.
const TCO_LENGTH = 23;

/**
 * X counts every URL as `TCO_LENGTH` chars no matter its real length, so the
 * budget check replaces the link's real length with the t.co length.
 */
function effectiveLength(text: string, url: string): number {
  const urlPenalty = url.length - TCO_LENGTH;
  return text.length - (text.includes(url) ? urlPenalty : 0);
}

/** "up 28 spots" / "up 1 spot" for a climb; "" for a new entry. */
function climbPhrase(win: ShareWin): string {
  const n = Math.abs(win.delta ?? 0);
  return `up ${n} spot${n === 1 ? "" : "s"}`;
}

/**
 * Compose the post body for a win, keyword optionally shortened so the whole
 * thing fits the tweet budget. The move + link + hashtags are load-bearing and
 * never dropped; only the keyword is trimmed, and only if it would overflow.
 */
function compose(win: ShareWin, meta: PostMeta, keyword: string): string {
  const cur = win.current === null ? "" : `#${win.current}`;
  const tags = HASHTAGS.join(" ");
  if (win.direction === "new") {
    return `🚀 "${keyword}" for ${meta.appName} just debuted at ${cur}.\nReal organic App Store rank, moved by ShipASO's AI agent. ${meta.storeUrl}\n${tags}`;
  }
  const prev = win.previous === null ? "" : `#${win.previous}`;
  return `📈 "${keyword}" for ${meta.appName}: ${prev} → ${cur}, ${climbPhrase(win)}.\nReal organic App Store rank, moved by ShipASO's AI agent. ${meta.storeUrl}\n${tags}`;
}

/**
 * Compose a #BuildInPublic post from a single honest win. The keyword is trimmed
 * (never the proof or the link) if needed to fit X's 280-char budget.
 */
export function composeBuildInPublicPost(win: ShareWin, meta: PostMeta): BuildInPublicPost {
  let keyword = win.keyword;
  let text = compose(win, meta, keyword);
  // Trim only the keyword until it fits — the move, link, and tags are sacred.
  while (effectiveLength(text, meta.storeUrl) > TWEET_MAX && keyword.length > 1) {
    const overflow = effectiveLength(text, meta.storeUrl) - TWEET_MAX;
    const cut = Math.min(overflow + 1, keyword.length - 1);
    keyword = `${keyword.slice(0, keyword.length - cut).trimEnd()}…`;
    text = compose(win, meta, keyword);
  }
  return {
    text,
    cardSvg: renderShareCardSvg(win, { size: "wide", appName: meta.appName }),
    hashtags: [...HASHTAGS],
  };
}

/**
 * Compose a post from a full deltas view, or `null` when there is no honest win
 * to brag about (the caller posts nothing — that's the point).
 */
export function buildInPublicPostFromDeltas(
  view: RankDeltaView,
  meta: PostMeta,
): BuildInPublicPost | null {
  const win = pickShareWin(view);
  return win ? composeBuildInPublicPost(win, meta) : null;
}
