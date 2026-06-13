#!/usr/bin/env python3
"""
End-to-end integration test for the store-ops loop.

Unit tests cover each lib in isolation; this proves the PIECES WIRE TOGETHER:
context.md → orchestrator → rank snapshot → ranks.md, and the cross-lib data
flow (context parsing feeding the rank step feeding the file). Network is mocked
at the urlopen layer so it runs offline in CI, but the real code paths execute.

Run:  python3 lib/integration_test.py
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import aso_rank_check as rc  # noqa: E402
import aso_competitor_watch as cw  # noqa: E402
import store_ops_orchestrator as orch  # noqa: E402


class _FakeResp:
    def __init__(self, body): self._b = body.encode()
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return self._b


def _itunes_search(bundle, name, rank_pos, total):
    """Build a search response where `bundle` sits at rank_pos of `total`."""
    results = []
    for i in range(total):
        if i + 1 == rank_pos:
            results.append({"bundleId": bundle, "trackName": name})
        else:
            results.append({"bundleId": f"other.{i}", "trackName": f"App {i}"})
    return json.dumps({"resultCount": total, "results": results})


CONTEXT_MD = """# ASO context — demo

```yaml
app: demo
display_name: "Demo App"
category: "Lifestyle"
store_ids:
  appstore: ""
  playstore: "com.demo.app"
competitors:
  - "111111"
seeds:
  - "alpha"
  - "beta"
brand_terms:
  - "Demo"
audience: "real users"
```
"""


def test_orchestrator_full_loop_writes_ranks_and_competitors():
    """The headline test: run the orchestrator on a fresh app dir and assert it
    produces a real ranks.md + competitors.md with correct data."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        app_dir = root / "marketing" / "aso" / "demo"
        app_dir.mkdir(parents=True)
        (app_dir / "context.md").write_text(CONTEXT_MD)

        # mock the iTunes endpoints both libs call
        calls = {"n": 0}

        def fake_urlopen(req, timeout=20):
            url = req.full_url
            calls["n"] += 1
            if "/search?" in url:
                # rank query — put com.demo.app at #3 for any keyword
                return _FakeResp(_itunes_search("com.demo.app", "Demo App", 3, 50))
            if "/lookup?" in url:
                # competitor lookup for id 111111
                return _FakeResp(json.dumps({"resultCount": 1, "results": [
                    {"trackName": "Competitor", "version": "2.0",
                     "formattedPrice": "Free", "averageUserRating": 4.5,
                     "userRatingCount": 100, "genres": ["Lifestyle"]}]}))
            return _FakeResp(json.dumps({"resultCount": 0, "results": []}))

        rc.urllib.request.urlopen = fake_urlopen
        cw.urllib.request.urlopen = fake_urlopen
        rc._sleep = lambda *a, **k: None
        cw._sleep = lambda *a, **k: None

        rcode = orch.main([
            "--app", "demo", "--root", str(root), "--date", "2026-06-12",
        ])
        assert rcode == 0, f"orchestrator exit {rcode}"

        ranks = (app_dir / "ranks.md").read_text()
        assert "## 2026-06-12" in ranks
        assert "| alpha | #3 |" in ranks, ranks  # seed ranked at #3
        assert "| beta | #3 |" in ranks

        comps = (app_dir / "competitors.md").read_text()
        assert "## 2026-06-12" in comps
        assert "Competitor" in comps and "version: 2.0" in comps


def test_second_run_computes_deltas():
    """Run twice; the second run must show the rank deltas vs. the first."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        app_dir = root / "marketing" / "aso" / "demo"
        app_dir.mkdir(parents=True)
        (app_dir / "context.md").write_text(CONTEXT_MD)

        state = {"pos": 5}

        def fake_urlopen(req, timeout=20):
            url = req.full_url
            if "/search?" in url:
                return _FakeResp(_itunes_search("com.demo.app", "Demo", state["pos"], 50))
            return _FakeResp(json.dumps({"resultCount": 0, "results": []}))

        rc.urllib.request.urlopen = fake_urlopen
        rc._sleep = lambda *a, **k: None

        # run 1: ranked #5
        orch.main(["--app", "demo", "--root", str(root), "--date", "2026-06-01",
                   "--steps", "ranks"])
        # run 2: improved to #2 → should show ↑ +3
        state["pos"] = 2
        orch.main(["--app", "demo", "--root", str(root), "--date", "2026-06-08",
                   "--steps", "ranks"])

        ranks = (app_dir / "ranks.md").read_text()
        assert ranks.count("## ") == 2, "should have two snapshot blocks"
        # the latest block should show the improvement
        latest = ranks[ranks.rfind("## 2026-06-08"):]
        assert "↑ +3" in latest, latest


def test_orchestrator_reports_missing_context():
    with tempfile.TemporaryDirectory() as tmp:
        rcode = orch.main(["--app", "ghost", "--root", tmp, "--date", "2026-06-12"])
        assert rcode == 1, "missing context.md should exit 1"


def _run():
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in tests:
        try:
            fn(); print(f"  ok   {fn.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            import traceback
            print(f"  FAIL {fn.__name__}: {e}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run())
