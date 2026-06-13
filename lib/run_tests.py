#!/usr/bin/env python3
"""
Run every store-ops lib test suite and report a combined result.

Each *_test.py is a standalone script (plain asserts, exits non-zero on
failure). This discovers and runs them all, aggregates pass/fail counts, and
exits non-zero if any suite fails — the single entry point for CI and for a
human sanity check.

    python3 lib/run_tests.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> int:
    suites = sorted(HERE.glob("*_test.py"))
    if not suites:
        print("no *_test.py suites found", file=sys.stderr)
        return 1

    total_pass = total_fail = suites_failed = 0
    print(f"running {len(suites)} test suites\n" + "=" * 50)
    for suite in suites:
        proc = subprocess.run([sys.executable, str(suite)],
                              capture_output=True, text=True)
        last = (proc.stdout.strip().splitlines() or ["(no output)"])[-1]
        ok = proc.returncode == 0
        # parse "N/M passed" if present
        nums = last.replace("/", " ").split()
        p = next((int(x) for x in nums if x.isdigit()), 0)
        m = 0
        for a, b in zip(nums, nums[1:]):
            if a.isdigit() and b.isdigit():
                p, m = int(a), int(b)
                break
        total_pass += p
        total_fail += (m - p) if m else (0 if ok else 1)
        if not ok:
            suites_failed += 1
        mark = "ok  " if ok else "FAIL"
        print(f"  [{mark}] {suite.name:36} {last}")
        if not ok:
            # surface the failing detail
            for line in proc.stdout.splitlines():
                if "FAIL" in line:
                    print(f"          {line.strip()}")

    print("=" * 50)
    status = "ALL GREEN" if suites_failed == 0 else f"{suites_failed} SUITE(S) FAILED"
    print(f"{status} — {total_pass} tests passed across {len(suites)} suites")
    return 1 if suites_failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
