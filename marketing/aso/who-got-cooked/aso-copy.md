# Who Got Cooked — listing copy

**App:** Who Got Cooked · `com.whogotcooked.app` · `6757512324`
**Locale:** en-US · **Store:** App Store
**Generated:** 2026-07-29 · scope: **keyword field only**

Name and subtitle are unchanged — they are both good and the subtitle is at its
limit. Only the keyword field is optimized here.

---

## Fields

| Field | Value | Chars |
|---|---|---|
| Name | `Who Got Cooked` | 14/30 (unchanged) |
| Subtitle | `AI-powered argument moderation` | 30/30 (unchanged) |
| **Keywords** | see below | **98/100** |

### Keyword field

```
texting,receipts,verdict,debate,relationship,toxicity,gaslighting,AITA,screenshot,group,chat,judge
```

**98/100 · 12 terms · no spaces after commas · no name/subtitle duplicates.**

Validated against the audit engine: the current field raises
`keywords_duplicate_indexed`; this one comes back **clean**.

---

## What changed and why

### Dropped

| Term | Chars | Reason |
|---|---|---|
| `argument` | 8 | **Already indexed** — it is in the subtitle. Apple indexes name + subtitle + keyword field together, so repeating it buys no reach. |
| `AI` | 2 | **Already indexed** — also in the subtitle. |
| `DARVO` | 5 | **Nobody searches it.** *Deny, Attack, Reverse Victim and Offender* — abuse-literature jargon. The owner did not recognise it; App Store searchers will not type it. |

### Split

| Before | After | Gain |
|---|---|---|
| `group chat` | `group,chat` | 1 char, and Apple indexes both words **plus** the phrase from separate comma terms. |

### Added

| Term | Why |
|---|---|
| `screenshot` | The literal first action a user takes — "send the screenshot". High intent, absent before. |
| `judge` | What people call the thing they want ("settle this", "who's right"). |
| `group` + `chat` | From the split; `chat` also matches the category. |

### Kept

`texting`, `receipts`, `verdict`, `debate`, `relationship`, `toxicity`,
`gaslighting`, `AITA` — all real searchable intent.

`AITA` is retained deliberately: Reddit shorthand, niche, but it is *only 4
characters* and its audience maps exactly onto this app. `gaslighting` at 11 is
the most expensive keeper — worth watching, and the first candidate to cut if a
better term appears.

---

## Honest limits

- **No search-volume data backs these choices.** ShipASO reports no keyword
  volume or difficulty (there is no measured source — #253 would be one, and it
  is blocked). Every term here is reasoned from what the app does and what a
  person would type, not from measured demand.
- **The dropped terms are dropped on reasoning, not evidence.** `DARVO` is a
  judgement call the owner confirmed; `argument`/`AI` are objectively redundant.
- Rank movement after shipping is the only real test — run `aso-rank-check` once
  this is live.

---

## Push

Nothing here is applied. `1.0.5` is `READY_FOR_SALE`, so there is no editable
version — the keyword field cannot be written until one exists.

Use **`asc-metadata-write-lane`**: it creates the version, attaches a build, and
pushes the field, then stops before submission. Approving is not shipping.
