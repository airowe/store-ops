#!/usr/bin/env python3
"""
Unit tests for the orchestrator's pure logic (context.md parsing + helpers).
No network. Run:  python3 store_ops_orchestrator_test.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from store_ops_orchestrator import (  # noqa: E402
    parse_context, _bundle_from_context, _seeds_from_context,
    _competitors_from_context, _mini_yaml, next_actions,
)


CTX = """# ASO context — heathen

```yaml
app: heathen
display_name: "Heathen - Secular Meditation"
category: "Lifestyle"
store_ids:
  appstore: ""
  playstore: "app.airowe.clarity"
competitors:
  - "Calm"
  - "595287172"
seeds:
  - "meditation"
  - "stoic"
brand_terms:
  - "Heathen"
audience: "TODO — who is this for?"
```
"""


def test_parse_context_extracts_yaml_block():
    ctx = parse_context(CTX)
    assert ctx["app"] == "heathen"
    assert ctx["category"] == "Lifestyle"


def test_bundle_prefers_playstore():
    ctx = parse_context(CTX)
    assert _bundle_from_context(ctx) == "app.airowe.clarity"


def test_bundle_falls_back_to_appstore():
    ctx = {"store_ids": {"appstore": "123456", "playstore": ""}}
    assert _bundle_from_context(ctx) == "123456"


def test_seeds_extracted_and_todo_filtered():
    ctx = parse_context(CTX)
    seeds = _seeds_from_context(ctx)
    assert "meditation" in seeds and "stoic" in seeds


# ── prose / markdown context format (hand-authored files) ────────────────────
PROSE_CTX = """# Heathen — ASO context

- **Bundle:** app.airowe.clarity (internal codename: clarity-meditation)
- **Category:** Health & Fitness

## What it is
Secular meditation.

## Seed keywords
secular meditation, stoic, mindfulness, atheist meditation

## Competitors (for gap analysis)
- Calm, Headspace (generic head terms — aspirational only)
- Hallow (religious counterpart — the explicit contrast)
- Stoic. (journaling app)
- Waking Up (Sam Harris)

## Notes
Own the secular qualifier.
"""


def test_prose_format_extracts_bundle():
    ctx = parse_context(PROSE_CTX)
    assert _bundle_from_context(ctx) == "app.airowe.clarity"


def test_prose_format_extracts_seeds():
    ctx = parse_context(PROSE_CTX)
    seeds = _seeds_from_context(ctx)
    assert "secular meditation" in seeds
    assert "stoic" in seeds
    assert "atheist meditation" in seeds


def test_prose_format_extracts_competitors_by_name():
    ctx = parse_context(PROSE_CTX)
    comps = _competitors_from_context(ctx)
    # comma-listed AND bulleted names, with "(qualifier)" stripped
    assert "Calm" in comps and "Headspace" in comps
    assert "Hallow" in comps and "Waking Up" in comps
    # trailing period on "Stoic." is stripped
    assert "Stoic" in comps
    # the "(qualifier)" text must not leak into a competitor name
    assert not any("(" in c or "counterpart" in c.lower() for c in comps)


def test_prose_format_no_yaml_block_still_works():
    # the prose file has no ```yaml fence — must not fall through to empty
    ctx = parse_context(PROSE_CTX)
    assert ctx.get("seeds") and ctx.get("competitors")


def test_seeds_drop_todo_entries():
    ctx = {"seeds": ["real", "TODO — replace me"]}
    assert _seeds_from_context(ctx) == ["real"]


def test_competitors_extracted():
    ctx = parse_context(CTX)
    comps = _competitors_from_context(ctx)
    assert "Calm" in comps and "595287172" in comps


def test_competitors_drop_todo():
    ctx = {"competitors": ["Calm", "TODO"]}
    assert _competitors_from_context(ctx) == ["Calm"]


# ── mini-yaml fallback (when pyyaml absent) ──────────────────────────────────
def test_mini_yaml_flat_fields():
    out = _mini_yaml('app: x\ncategory: "Health"\n')
    assert out["app"] == "x"
    assert out["category"] == "Health"


def test_mini_yaml_lists():
    out = _mini_yaml('seeds:\n  - "a"\n  - "b"\nbrand_terms:\n  - "X"\n')
    assert out["seeds"] == ["a", "b"]
    assert out["brand_terms"] == ["X"]


def test_mini_yaml_nested_store_ids():
    # the mini parser flattens; nested store_ids becomes a list key — ensure no crash
    out = _mini_yaml('store_ids:\n  appstore: ""\n  playstore: "com.x"\n')
    # playstore is a flat field at this indent in the mini-parser's view
    assert "playstore" in out or "store_ids" in out


# ── next-actions guidance ────────────────────────────────────────────────────
def test_next_actions_flags_missing_competitors():
    ctx = {"competitors": ["TODO"], "seeds": ["x"], "audience": "real people"}
    acts = next_actions("heathen", ctx, [])
    assert any("competitors" in a.lower() for a in acts)


def test_next_actions_flags_todo_audience():
    ctx = {"competitors": ["Calm"], "seeds": ["x"], "audience": "TODO — who"}
    acts = next_actions("heathen", ctx, [])
    assert any("audience" in a.lower() for a in acts)


def test_next_actions_always_includes_optimize_step():
    ctx = {"competitors": ["Calm"], "seeds": ["x"], "audience": "real"}
    acts = next_actions("heathen", ctx, [])
    assert any("aso-keyword-research" in a or "optimiz" in a.lower() for a in acts)


def _run():
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in tests:
        try:
            fn(); print(f"  ok   {fn.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1; print(f"  FAIL {fn.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run())
