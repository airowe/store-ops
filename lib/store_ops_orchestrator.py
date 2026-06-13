#!/usr/bin/env python3
"""
store-ops orchestrator — run the full ASO loop for one app, end to end.

Chains the deterministic data steps (the parts that DON'T need an LLM) and
reports exactly what reasoning the agent should run next. This is the spine the
`/store-ops <app>` flow drives:

    read context.md
      → rank snapshot   (aso-rank-monitor)
      → competitor snapshot (aso-competitor-watch)
      → status report: what's stale, what's missing, what to optimize next

The *reasoning* stages (keyword scoring, copy generation) stay with the skills —
this gathers the ground-truth data they consume and orchestrates the file flow,
so the agent isn't running five tools by hand.

Reads `marketing/aso/<app>/context.md` for bundle id + competitors + seeds.

Usage:
    python3 store_ops_orchestrator.py --app heathen --root . --date 2026-06-11
    python3 store_ops_orchestrator.py --app heathen --root . --date 2026-06-11 \
        --steps ranks,competitors        # only run specific steps
    python3 store_ops_orchestrator.py --app heathen --root . --json

Exit codes: 0 ok · 1 bad args / no context.md.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aso_rank_monitor as rmon  # noqa: E402
import aso_competitor_watch as cwatch  # noqa: E402
from aso_rank_check import ranks_for  # noqa: E402


# ── context.md parsing ───────────────────────────────────────────────────────
# Two formats exist in the wild:
#   1. a fenced ```yaml block (the aso-context scaffold), and
#   2. hand-authored prose with markdown headers (## Seed keywords, ## Competitors,
#      a "**Bundle:** ..." line). parse_context handles BOTH.
def parse_context(md: str) -> dict:
    m = re.search(r"```yaml\n(.*?)```", md, re.S)
    if m:
        block = m.group(1)
        try:
            import yaml  # type: ignore
            data = yaml.safe_load(block) or {}
            if isinstance(data, dict) and data:
                return data
        except Exception:  # noqa: BLE001
            pass
        return _mini_yaml(block)
    # no yaml block → prose/markdown format
    return _parse_prose(md)


def _parse_prose(md: str) -> dict:
    """Extract bundle, seeds, competitors from hand-authored prose context.md.

    Recognizes:
      - **Bundle:** app.airowe.clarity (...)          → store_ids.playstore
      - ## Seed keywords \\n comma, list / - bullets   → seeds[]
      - ## Competitors ... \\n - Name (...)            → competitors[]
    """
    out: dict = {"store_ids": {}}

    # bundle from a "**Bundle:** <id>" line (take the first token)
    mb = re.search(r"\*\*Bundle:\*\*\s*([A-Za-z0-9._-]+)", md)
    if mb:
        out["store_ids"]["playstore"] = mb.group(1)

    def _section(title: str) -> str:
        m = re.search(rf"^##\s+{title}.*?\n(.*?)(?=^##\s|\Z)", md, re.S | re.M | re.I)
        return m.group(1).strip() if m else ""

    # seeds: a comma line and/or bullets
    seeds_block = _section("Seed keywords") or _section("Seeds")
    seeds: list[str] = []
    for line in seeds_block.splitlines():
        line = line.strip().lstrip("-").strip()
        if not line:
            continue
        # split comma lists; bullets are single terms
        for part in line.split(","):
            p = part.strip().strip('"').strip("'")
            if p and not p.startswith("#"):
                seeds.append(p)
    if seeds:
        out["seeds"] = seeds

    # competitors: bullet list, take the name before any "(" qualifier
    comp_block = _section("Competitors")
    comps: list[str] = []
    for line in comp_block.splitlines():
        line = line.strip()
        if not line.startswith("-"):
            continue
        name = line.lstrip("-").strip()
        name = re.split(r"\s*[\(—:]", name)[0].strip()  # drop "(qualifier)" / "— note"
        # a comp line can list several ("Calm, Headspace") — split those too
        for c in name.split(","):
            c = c.strip().strip(".")
            if c:
                comps.append(c)
    if comps:
        out["competitors"] = comps
    return out


def _mini_yaml(block: str) -> dict:
    """Tiny one-level YAML parser for the flat fields + lists + one level of
    nested maps (store_ids:) we need. Not a general parser — pyyaml is used when
    present; this is the no-dependency fallback."""
    out: dict = {}
    cur_list_key = None      # an indented "- " list belongs to this key
    cur_map_key = None       # an indented "key: val" map belongs to this key
    base_indent = 0
    for raw in block.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        # list item under the current list key
        if line.startswith("- ") and cur_list_key:
            if not isinstance(out.get(cur_list_key), list):
                out[cur_list_key] = []
            out[cur_list_key].append(line[2:].strip().strip('"').strip("'"))
            continue
        m = re.match(r"^(\w[\w_]*):\s*(.*)$", line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        # nested map entry (indented under a pending map key like store_ids)
        if indent > base_indent and cur_map_key:
            if not isinstance(out.get(cur_map_key), dict):
                out[cur_map_key] = {}
            out[cur_map_key][k] = v.strip('"').strip("'")
            continue
        # top-level key
        base_indent = indent
        if v == "":
            cur_list_key = k     # next indented "- " → list; "key:" → map
            cur_map_key = k
            out.setdefault(k, None)
        else:
            cur_list_key = cur_map_key = None
            out[k] = v.strip('"').strip("'").strip("[]")
    return out


def _bundle_from_context(ctx: dict) -> str:
    ids = ctx.get("store_ids") or {}
    if isinstance(ids, dict):
        return (ids.get("playstore") or ids.get("appstore") or "").strip()
    return ""


def _seeds_from_context(ctx: dict) -> list[str]:
    seeds = ctx.get("seeds") or []
    return [s for s in seeds if isinstance(s, str) and "TODO" not in s]


def _competitors_from_context(ctx: dict) -> list[str]:
    comps = ctx.get("competitors") or []
    return [c for c in comps if isinstance(c, str) and "TODO" not in c]


# ── steps ────────────────────────────────────────────────────────────────────
def step_ranks(app: str, bundle: str, seeds: list[str], root: Path, date: str,
               country: str) -> dict:
    if not bundle or not seeds:
        return {"step": "ranks", "status": "skipped",
                "reason": "need a bundle id and non-TODO seeds in context.md"}
    path = rmon.ranks_md_path(root, app)
    existing = path.read_text() if path.exists() else ""
    prev = rmon.previous_ranks(existing)
    kws = list(prev.keys()) or seeds
    current = ranks_for(bundle, kws, country=country)
    if all(r.error for r in current):
        return {"step": "ranks", "status": "error", "reason": "all fetches failed"}
    deltas = rmon.compute_deltas(current, prev)
    snapshot = rmon.render_snapshot(date, country, deltas)
    path.parent.mkdir(parents=True, exist_ok=True)
    header = "" if existing else (
        f"# {app} — App Store organic rank log\n\nBundle: {bundle}. "
        f"aso-rank-monitor.\n\n")
    base = existing if existing.endswith("\n") or not existing else existing + "\n"
    path.write_text((header + base if not existing else base) + snapshot + "\n")
    return {"step": "ranks", "status": "ok", "digest": rmon.digest_line(deltas),
            "keywords": len(kws), "file": str(path)}


def step_competitors(app: str, comps: list[str], root: Path, date: str,
                     country: str) -> dict:
    if not comps:
        return {"step": "competitors", "status": "skipped",
                "reason": "no competitors listed in context.md (fill them in)"}
    path = cwatch.md_path(root, app)
    existing = path.read_text() if path.exists() else ""
    prev = cwatch.previous_listings(existing)
    # classify each competitor: numeric → App Store id; has a dot → bundle id;
    # otherwise → an app NAME we resolve to an id via iTunes search.
    ids = [c for c in comps if c.isdigit()]
    bundles = [c for c in comps if not c.isdigit() and "." in c]
    names = [c for c in comps if not c.isdigit() and "." not in c]
    unresolved = []
    for nm in names:
        rid = cwatch.resolve_name_to_id(nm, country=country)
        (ids.append(rid) if rid else unresolved.append(nm))
    current = (cwatch.lookup_all(ids, by="id", country=country)
               + cwatch.lookup_all(bundles, by="bundleId", country=country))
    if all(c.error for c in current) and current:
        return {"step": "competitors", "status": "error", "reason": "all lookups failed"}
    if not current:
        return {"step": "competitors", "status": "skipped",
                "reason": f"could not resolve any competitor ({', '.join(unresolved)})"}
    changes = cwatch.diff(current, prev)
    snapshot = cwatch.render_snapshot(date, country, current)
    path.parent.mkdir(parents=True, exist_ok=True)
    header = "" if existing else (f"# {app} — competitor listing watch\n\n"
                                  f"aso-competitor-watch.\n\n")
    base = existing if not existing or existing.endswith("\n") else existing + "\n"
    path.write_text((header + base if not existing else base) + snapshot + "\n")
    return {"step": "competitors", "status": "ok",
            "digest": cwatch.digest_line(changes), "tracked": len(current),
            "file": str(path)}


def next_actions(app: str, ctx: dict, results: list[dict]) -> list[str]:
    """What the agent should reason about next, given the data we gathered."""
    todos = []
    if not _competitors_from_context(ctx):
        todos.append(f"Fill `competitors:` in marketing/aso/{app}/context.md "
                     f"(competitor-watch is skipped without them).")
    if not _seeds_from_context(ctx):
        todos.append(f"Fill real `seeds:` in context.md (the scaffold's may be weak).")
    if "TODO" in str(ctx.get("audience", "")):
        todos.append(f"Fill `audience:` / `voice:` in context.md (sharpens copy).")
    copy_path = Path(f"marketing/aso/{app}/aso-copy.md")
    todos.append(f"Run aso-keyword-research → aso-metadata-optimization to turn "
                 f"the gathered data into real copy in {copy_path}.")
    return todos


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="store-ops full-loop orchestrator")
    ap.add_argument("--app", required=True)
    ap.add_argument("--root", default=".")
    ap.add_argument("--date", required=True, help="snapshot date YYYY-MM-DD")
    ap.add_argument("--country", default="US")
    ap.add_argument("--steps", default="ranks,competitors",
                    help="comma list of steps to run (ranks,competitors)")
    ap.add_argument("--json", action="store_true")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    root = Path(args.root).resolve()
    ctx_path = root / "marketing" / "aso" / args.app / "context.md"
    if not ctx_path.exists():
        print(f"no context.md for {args.app} — run aso-context first", file=sys.stderr)
        return 1
    ctx = parse_context(ctx_path.read_text())
    bundle = _bundle_from_context(ctx)
    seeds = _seeds_from_context(ctx)
    comps = _competitors_from_context(ctx)
    steps = {s.strip() for s in args.steps.split(",") if s.strip()}

    results = []
    if "ranks" in steps:
        results.append(step_ranks(args.app, bundle, seeds, root, args.date, args.country))
    if "competitors" in steps:
        results.append(step_competitors(args.app, comps, root, args.date, args.country))

    actions = next_actions(args.app, ctx, results)

    if args.json:
        print(json.dumps({"app": args.app, "bundle": bundle,
                          "results": results, "next_actions": actions}, indent=2))
        return 0

    print(f"=== store-ops: {args.app} ({bundle or 'no bundle'}) ===")
    for r in results:
        line = f"  [{r['status']:7}] {r['step']}"
        if r.get("digest"):
            line += f" — {r['digest']}"
        if r.get("reason"):
            line += f" ({r['reason']})"
        print(line)
    print("\n  next:")
    for a in actions:
        print(f"   • {a}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
