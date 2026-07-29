/**
 * Find-or-create the `appScreenshotSet` an upload lands in (#374).
 *
 * Apple keys sets by (localization, screenshotDisplayType) — `APP_IPHONE_67`,
 * `APP_IPHONE_65`, and so on. An app that already ships screenshots has sets;
 * a fresh version, or a device size never used, has none.
 *
 * `uploadScreenshot` takes a set id as given, and until this module nothing
 * produced one — so the upload path could not be used for an app with no
 * screenshots, which is exactly the case the feature exists to serve. That gap
 * survived every unit and route test because they all supply the id; only
 * pointing it at a real app (0 sets) surfaced it.
 *
 * FIND BEFORE CREATE, and never create blind: if the list fails we do NOT fall
 * back to creating, because that is how a listing ends up with two sets for one
 * device size.
 */
import { ASC_BASE, ascError, type FetchLike } from "./ascWrite.js";

export type EnsureScreenshotSetInput = {
  token: string;
  /** The appStoreVersionLocalization the set hangs off. */
  localizationId: string;
  /** Apple's device bucket, e.g. "APP_IPHONE_67". Quoted verbatim. */
  displayType: string;
};

export type EnsureScreenshotSetResult = {
  id: string;
  /** true when this call created the set; false when an existing one was reused. */
  created: boolean;
};

type SetRow = { id?: string; attributes?: { screenshotDisplayType?: string } };

export async function ensureScreenshotSet(
  fetchFn: FetchLike,
  input: EnsureScreenshotSetInput,
): Promise<EnsureScreenshotSetResult> {
  const displayType = input.displayType.trim();
  if (!displayType) throw new Error("a screenshot display type is required (e.g. APP_IPHONE_67)");

  const auth = { authorization: `Bearer ${input.token}` };

  // ── find ──────────────────────────────────────────────────────────────────
  const listRes = await fetchFn(
    `${ASC_BASE}/appStoreVersionLocalizations/${encodeURIComponent(input.localizationId)}/appScreenshotSets?limit=50`,
    { headers: auth },
  );
  // Deliberately NOT degrading to "create" on failure: an unreadable list is
  // "we don't know what exists", and creating on that guess duplicates sets.
  if (!listRes.ok) throw await ascError(listRes, "list screenshot sets");

  const listed = (await listRes.json().catch(() => ({}))) as { data?: SetRow[] };
  const existing = (listed.data ?? []).find(
    (s) => s.attributes?.screenshotDisplayType === displayType,
  );
  if (existing?.id) return { id: existing.id, created: false };

  // ── create ────────────────────────────────────────────────────────────────
  const createRes = await fetchFn(`${ASC_BASE}/appScreenshotSets`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      data: {
        type: "appScreenshotSets",
        attributes: { screenshotDisplayType: displayType },
        relationships: {
          appStoreVersionLocalization: {
            data: { type: "appStoreVersionLocalizations", id: input.localizationId },
          },
        },
      },
    }),
  });
  if (!createRes.ok) throw await ascError(createRes, "create screenshot set");

  const created = (await createRes.json().catch(() => ({}))) as { data?: { id?: string } };
  const id = created.data?.id;
  if (!id) throw new Error("App Store Connect returned no id for the created screenshot set");
  return { id, created: true };
}
