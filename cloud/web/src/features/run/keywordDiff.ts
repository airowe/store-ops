/**
 * Pure keyword-list diff for the CopyDiff keywords field. Splits two comma
 * lists into added / removed / kept term sets so the UI can render a token diff
 * instead of two strings the reader must compare by eye. Framework-free +
 * unit-tested.
 */
export type KeywordDiff = { added: string[]; removed: string[]; kept: string[] };

function terms(list: string | undefined): string[] {
  if (!list) return [];
  const out: string[] = [];
  for (const raw of list.split(",")) {
    const t = raw.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function diffKeywords(before: string | undefined, after: string | undefined): KeywordDiff {
  const b = terms(before);
  const a = terms(after);
  const bSet = new Set(b);
  const aSet = new Set(a);
  return {
    // after-order for kept + added; before-order for removed
    kept: a.filter((t) => bSet.has(t)),
    added: a.filter((t) => !bSet.has(t)),
    removed: b.filter((t) => !aSet.has(t)),
  };
}
