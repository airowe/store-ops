# Google Ads API — response to the Compliance team

Paste-ready answers to the four questions in the review email, plus a cover
note. Send from a **shipaso.com domain email** (see the action list at the
bottom) and attach `DESIGN_DOC` converted to PDF.

---

## Cover note (top of the reply)

> Thank you for the detailed review. Answers to all four points are below, and
> an updated design document is attached. The key clarification: the application
> was filed before our product's public site was live — the product the Ads API
> supports is **ShipASO** (https://shipaso.com), an App Store Optimization tool
> for independent app developers. I've also moved our developer contact to a
> shipaso.com domain address. Happy to provide anything further.

---

## 1. Core business model

ShipASO (https://shipaso.com) is an **App Store Optimization (ASO) product for
independent iOS and Android developers**, operated by airowe, LLC.

It audits a developer's live app-store listing, researches the keywords that
listing should target, optimizes the listing copy to each store's character
limits, hands the developer a publish-ready change (commands or a pull request),
and then reads the resulting search rank back over time to prove the change
worked.

- **Primary customers:** independent and small-studio mobile app developers who
  publish their own apps and want better organic app-store search rank without
  hiring a consultant or buying an enterprise ASO suite.
- **Value exchange:** customers pay a subscription; in return ShipASO does the
  recurring ASO work (research → optimized copy → publish-ready change → weekly
  proof the rank moved) and pings them only when a real change is pending their
  approval. A free, open-source (MIT) plugin runs the same loop locally and
  serves as the lead/trust channel; the paid hosted tier sells the convenience
  of the loop running automatically on a schedule.

## 2. Functional API necessity

ShipASO ranks candidate keywords with a composite score:
`volume·0.4 + (100 − difficulty)·0.3 + relevance·0.3`.

The `relevance` and `difficulty` terms are computed from the app's own listing
and its competitive field. The `volume` term — real search demand — is currently
an **internal 0–100 estimate**, because we have no licensed source of true
search-volume data.

- **Specific feature required:** `KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics`,
  **read-only**. We send a short list of candidate keyword strings (already
  generated from the app's listing and competitors) and read back **average
  monthly searches** to replace our internal volume estimate.
- **How it improves the service:** a keyword with strong relevance/difficulty but
  near-zero real demand is a wasted metadata slot. Real search-volume metrics let
  us rank candidate keywords by *actual* demand, which directly improves the most
  important output of the product — which keywords go into the developer's
  limited app-store metadata fields.
- **Not used:** no campaign/ad/ad-group/budget/bid management, no conversion
  tracking, no remarketing, no `mutate` operations of any kind. The integration
  is read-only against a single service, called server-side under our own token.
  End users never receive a token, never authenticate to Google Ads, and never
  see raw Ads data — only a derived score in ShipASO's own UI. We do not resell
  or redistribute Ads data.

## 3. Working website

The website on the original application (`airowe.online`) predates our product
launch and does not describe the tool. The correct, working site for the product
this token supports is:

- **Marketing site:** https://shipaso.com
- **Hosted app:** https://app.shipaso.com
- **Free rank check (no account needed):** https://shipaso.com/check-your-rank
- **Open-source plugin (MIT):** https://github.com/airowe/store-ops

A full design document describing the business model and the exact API use case
is attached (PDF).

## 4. Corporate contact email

Updated. Our developer contact is now a shipaso.com domain, role-based address:
**google-ads-api@shipaso.com** (monitored distribution list). Please update the
contact of record for airowe, LLC to this address.

---

## Action list before you send (owner: you)

These are steps only you can do — I can't perform them:

1. **Stand up a domain email** at `shipaso.com` for the contact — ideally a
   role/distribution address `google-ads-api@shipaso.com` (Google explicitly
   recommends a role-based address). A personal `you@shipaso.com` also satisfies
   point 4; the role address is the stronger answer.
2. **Update the developer contact** in the Google Ads API Center to that
   shipaso.com address (this is what point 4 / the closing reminder asks for).
3. **Make sure `shipaso.com` describes the product** (it should already — the
   landing page is live). If `check-your-rank` is reachable, link it; the
   free-rank-check is your most credible "real working tool" proof.
4. **Convert `DESIGN_DOC.md` → PDF** and attach it (they accept .pdf/.doc/.rtf).
   `pandoc docs/google-ads-api/DESIGN_DOC.md -o gads_design_doc.pdf` if you have
   pandoc, or print-to-PDF from any Markdown viewer.
5. **Reply from the shipaso.com address**, paste the four answers above, attach
   the PDF.

Optional but strengthens the case: if `airowe.online` will linger, add a one-line
note + link there pointing to shipaso.com, so the originally-listed site isn't a
dead end when a reviewer visits it.
