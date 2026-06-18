# PRD 05 — Surface findings catalog (the rule reference)

> The exhaustive per-surface rule set the engine (PRD 01) implements: every
> finding's `id`, trigger condition, severity, impact, and copy. Kept separate so
> PRD 01 stays about architecture. `launch` = ship for launch; `ff` = fast-follow.
> Copy here is the source of truth — tune wording during implementation, keep ids.

Legend — severity: `crit`/`warn`/`good`/`info`; impact: `rank`/`conv`/`trust`/`comp`.

## screenshots (`snapshot.screenshots` → existing ShotScore; KEEP)
| id | trigger | sev | impact | title / fix | slice |
|----|---------|-----|--------|-------------|-------|
| `screenshots_grade_low` | grade D/F (real, dataReliable) | crit | conv | "Screenshots are hurting conversion (grade {G})" / "Add 4+ tall-phone screenshots; first 2–3 carry most installs." | launch |
| `screenshots_thin` | 1–3 iPhone shots | warn | conv | "Only {n} screenshots" / "Use more slots; the first 2–3 convert hardest." | launch |
| `screenshots_no_ipad` | universal app, 0 iPad | info | conv | "No iPad screenshots" / "Add them if you ship iPad." | ff |
| `screenshots_unknown` | grade "?" (no key / public-only) | info | conv | "Couldn't read screenshots from public data" / "Connect ASC for a real grade." | launch |

## previews (`snapshot.previews.devices[]`)
| id | trigger | sev | impact | title / fix | slice |
|----|---------|-----|--------|-------------|-------|
| `preview_missing` | `devices.length === 0` | warn | conv | "No app preview video" / "Add a 15–30s preview for your primary device — previews lift conversion." | launch |
| `preview_thin_coverage` | previews exist but not on 6.7" iPhone | info | conv | "Preview missing on the largest iPhone" / "Add a 6.7\" preview — it's the most-shown size." | ff |
| `preview_error_state` | a device's preview in PROCESSING/error | warn | conv | "A preview failed to process" / "Re-upload it — it won't show until it processes." | ff |

## appInfo (`snapshot.appInfo`)
| id | trigger | sev | impact | title / fix | slice |
|----|---------|-----|--------|-------------|-------|
| `privacy_policy_missing` | no `privacyPolicyUrl` on the primary locale | crit | comp | "No privacy policy URL" / "Add one in App Store Connect — Apple can reject without it, and it's a trust signal." | launch |
| `secondary_category_missing` | no `secondaryCategory` | warn | rank | "No secondary category set" / "Pick your most relevant secondary category — it's a free second ranking surface." | launch |
| `primary_category_context` | always (if read) | info | rank | "Category: {primary}" / "Confirm it matches the keywords you're targeting." | launch |
| `appinfo_name_mismatch` | appInfo name ≠ version-localization name | info | comp | "Your app name differs between listing layers" / "Align them in App Store Connect." | ff |

## versionState (`snapshot.versionState.current`)
| id | trigger | sev | impact | title / fix | slice |
|----|---------|-----|--------|-------------|-------|
| `version_in_review` | state IN_REVIEW/PENDING | info | comp | "Your app is in review" / "Metadata is locked until it clears — ship changes after." | launch |
| `version_no_draft` | only live, no editable version | info | comp | "No draft version" / "Create a new version to push metadata changes." (ties to #34) | launch |
| `version_context` | always | info | comp | "Live version {versionString} ({state})" / context only. | ff |

## pricing + IAPs (`snapshot.pricing`) — low-signal, never crit
| id | trigger | sev | impact | title / fix | slice |
|----|---------|-----|--------|-------------|-------|
| `iap_not_promoted` | `iaps.length > 0`, none promoted | info | conv | "You have {n} in-app purchases, none promoted" / "Promote your best IAPs — they can surface on your product page and in search." | ff |
| `pricing_context` | always (if read) | info | conv | "{free|paid}{, N IAPs}" / context that frames other advice. | ff |

## ageRating (`snapshot.ageRating`) — low-signal
| id | trigger | sev | impact | title / fix | slice |
|----|---------|-----|--------|-------------|-------|
| `age_rating_missing` | no declared rating | warn | comp | "Age rating not declared" / "Complete it in App Store Connect — it can block submission." | ff |
| `age_rating_context` | declared | info | comp | "Age rating: {rating}" / context only. | ff |

## customProductPages (`snapshot.customProductPages.pages[]`)
| id | trigger | sev | impact | title / fix | slice |
|----|---------|-----|--------|-------------|-------|
| `cpp_none` | `pages.length === 0` | info | conv | "No Custom Product Pages" / "CPPs let you tailor your store page per ad/audience — a growth lever once the basics are solid." (ties to #26) | ff |
| `cpp_present` | `pages.length > 0` | good | conv | "{n} Custom Product Pages" / "Nice — you're using CPPs." | ff |

## locales (`snapshot.locales[]`)
| id | trigger | sev | impact | title / fix | slice |
|----|---------|-----|--------|-------------|-------|
| `locale_single` | `locales.length === 1` | warn | rank | "Live in 1 locale" / "Each localization is a new keyword surface + audience. Start with the top locales for your category." | launch |
| `locale_incomplete` | a locale missing subtitle/keywords | warn | rank | "{locale} localization is incomplete" / "Fill its subtitle + keyword field — empty fields waste ranking surface." | ff |

## cross-surface / meta
| id | trigger | sev | impact | title / fix | slice |
|----|---------|-----|--------|-------------|-------|
| `asc_unlock` | `hasAscKey === false` | info | comp | "Unlock your full audit" / "Connect App Store Connect to audit screenshots, preview video, privacy policy, category, and localization gaps." (PRD 04 renders the CTA) | launch |
| `surface_read_error` | entry in `snapshot.errors` (flag-gated, default off) | info | comp | "Couldn't read {surface} from App Store Connect" / "Your key may lack that permission." | ff |

## Notes for the implementer
- **Don't invent severity** — use this table. If a real app surfaces a case not
  here, add a row here first, then implement.
- **Copy tone**: direct, specific, no fluff. Always name the lever (rank vs
  convert) and give one concrete action.
- **Evidence**: include the number when it sharpens ("0 of 3 device sizes",
  "{n} IAPs"); omit when it'd be noise.
- **Launch slice** (the must-have set): `screenshots_*`, `preview_missing`,
  `privacy_policy_missing`, `secondary_category_missing`, `primary_category_context`,
  `version_in_review`, `version_no_draft`, `locale_single`, `asc_unlock`. The rest
  are fast-follow.
