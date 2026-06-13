# ASO context — <app-slug>

Copy this to `marketing/aso/<app>/context.md` and fill it in. Every store-ops
reasoning skill reads it to sharpen keyword expansion, relevance scoring, and
competitor analysis. All fields optional but more = better results.

```yaml
app: <app-slug>
display_name: "<App Name>"
category: "<primary store category, e.g. Health & Fitness>"
subcategory: "<optional secondary>"
one_liner: "<what the app does in one sentence>"
audience: "<who it's for>"
platforms: [appstore, playstore]
store_ids:
  appstore: "<APP_ID or leave blank to resolve via asc-id-resolver>"
  playstore: "<package name, e.g. com.example.app>"

# 3–5 real competitors (the skills will scrape their listings)
competitors:
  - "<Competitor App Name / package or App Store ID>"
  - "<...>"

# seed keywords — what users would search to find this app
seeds:
  - "<seed 1>"
  - "<seed 2>"
  - "<seed 3>"

# brand terms (always keep, never optimize away)
brand_terms:
  - "<your brand name>"

# tone for generated copy
voice: "<e.g. clear and practical / playful / premium>"
```
