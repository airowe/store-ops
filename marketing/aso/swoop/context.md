# ASO context — swoop

Auto-scaffolded by aso-context-gen from the live App Store listing. Review the
TODOs and fill in competitors + audience (the skills read this to sharpen keyword
expansion, relevance scoring, and competitor analysis).

```yaml
app: swoop
display_name: "Swoop: Chat & Meet IRL"
category: "Social Networking"
subcategory: "Lifestyle"
one_liner: "Meet people in real life at the venue or event you're already at — no login, no names, photo deleted when you leave."
audience: "People out at a bar, concert, festival, or event who want to connect with others physically nearby, without creating an account or exposing a profile."
platforms: [appstore, playstore]
store_ids:
  appstore: "6749875510"        # com.chat.swoop (production)
  playstore: "com.chat.swoop"

# Real competitors, pulled from App Store search for the app's core intents
# and snapshotted by aso-competitor-watch (see competitors.md).
# Listed as App Store IDs, not names: the orchestrator classifies any entry
# containing a "." as a bundle id, so "222 - find your people." (trailing
# period) was looked up as a bundle and failed. IDs are also stable across
# renames. Names kept in comments for readability.
competitors:
  - "6466442949"    # Timeleft: Make New Friends IRL — uses IRL in the title
  - "6499032288"    # Kiki: Local Chat & People Near — nearest positioning
  - "6450612690"    # 222 - find your people. — events/IRL, Lifestyle
  - "1537012560"    # BeFriend - Make new friends
  - "375990038"     # Meetup: Social Events & Groups — category incumbent

# seed keywords — hand-corrected. The auto-derived set contained listing
# artifacts ("need", "simple", "account") that are not search intents.
#
# This is the TRACKED SET: the exact 13 terms rank-checked on 2026-08-06 to
# establish the baseline (see audit-2026-08-06.md). Keep it stable — changing
# the set breaks week-over-week comparison, which is the whole point of
# tracking. Add terms deliberately; removing one discards its history.
# Ranked at baseline: no login chat #64, make friends irl #116, irl #119.
seeds:
  - "no login chat"
  - "make friends irl"
  - "irl"
  - "meet people"
  - "meet people nearby"
  - "meet people at events"
  - "make friends"
  - "anonymous chat"
  - "chat nearby"
  - "meet strangers nearby"
  - "talk to strangers"
  - "events near me"
  - "social app no account"

# brand terms (always keep, never optimize away)
brand_terms:
  - "Swoop"

# tone for generated copy
voice: "Plain and low-pressure, with dry humour. States what it does not do (no login, no names, no profile) as the selling point. Never hypey — the current release notes are the reference register."
```
