#!/usr/bin/env python3
"""Failure-attribution + oracle-ablation aggregator for the CP detector.

Runs `compare_exact_solve_benchmark` over an oracle matrix (topology ceiling, i.e.
--skip-exact-solve so the solver is not a confound) and aggregates the per-sample
attribution into:

  1. lever ranking  -- singleton gain and leave-one-out residual per oracle
  2. error mass     -- where lost GT creases go (detector / selection / assignment)
  3. near-miss      -- dominant blocker among samples within K wrong creases

All stratified by density bucket (easy/medium/hard) and, for the error mass, family.

The oracles (upstream of the exact solver):
  J = --oracle-vertices         (GT junction locations -> junction-detection lever)
  A = --oracle-junction-labels  (GT assignments         -> assignment lever)
  S = --oracle-selection        (GT-optimal pick        -> beam-scoring lever)
Production lines come from the source image, so line evidence is the baseline (a true
GT line oracle is not built; see the plan).

Usage:
  failure-attribution.py run   --bin PATH --cache DIR --out DIR   # run matrix + aggregate
  failure-attribution.py agg   --out DIR                          # aggregate existing runs
"""

import argparse
import collections
import json
import subprocess
import sys
from pathlib import Path

ORACLES = {"J": "--oracle-vertices", "S": "--oracle-selection", "A": "--oracle-junction-labels"}
# P0 baseline, the three singletons, the leave-one-out pairs, and the full stack.
COMBOS = ["P0", "J", "S", "A", "JS", "JA", "SA", "JSA"]
BUCKETS = ["easy", "medium", "hard"]
BASE_FLAGS = [
    "--candidate-source", "junction-first-v1",
    "--parity-repair", "--skip-flat-folder",
    "--line-evidence-source", "source-image",
    "--skip-exact-solve",
]


def combo_flags(combo):
    return [] if combo == "P0" else [ORACLES[c] for c in combo]


def run_matrix(binary, cache, out):
    out.mkdir(parents=True, exist_ok=True)
    for bucket in BUCKETS:
        manifest = Path(cache) / f"manifest.{bucket}.json"
        for combo in COMBOS:
            run_dir = out / f"{bucket}-{combo}"
            cmd = [binary, "--manifest", str(manifest), *BASE_FLAGS,
                   *combo_flags(combo), "--out", str(run_dir)]
            print(f"  run {bucket}/{combo} ...", file=sys.stderr)
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def load(out, bucket, combo):
    path = out / f"{bucket}-{combo}" / "per_sample.jsonl"
    if not path.exists():
        return None
    return [json.loads(line) for line in path.open()]


def exact_rate(rows):
    n = len(rows)
    ex = sum(1 for r in rows if r["attribution"]["exact_topology"])
    return ex, n


def pct(num, den):
    return f"{100 * num / den:4.0f}%" if den else "   -"


def aggregate(out):
    lines = []

    # --- 1. Lever ranking (topology ceiling, exact_topology %) ---
    lines.append("## 1. Lever ranking (exact-topology %, topology ceiling, no solver)\n")
    lines.append("Singleton = +oracle vs P0. Leave-one-out residual = full stack minus that")
    lines.append("oracle; the gap to the full stack is the masking-free marginal lever.\n")
    lines.append(f"{'bucket':<8}{'P0':>6}{'+J(junc)':>10}{'+A(asgn)':>10}{'+S(sel)':>9}"
                 f"{'ALL':>6}{'  | leave-one-out (ALL - X)':<30}")
    for bucket in BUCKETS:
        cells = {}
        for combo in COMBOS:
            rows = load(out, bucket, combo)
            if rows is None:
                break
            cells[combo] = exact_rate(rows)
        if len(cells) < len(COMBOS):
            lines.append(f"{bucket:<8}(missing runs)")
            continue
        p0 = pct(*cells["P0"])
        j, a, s = pct(*cells["J"]), pct(*cells["A"]), pct(*cells["S"])
        allc = pct(*cells["JSA"])
        loo_j = pct(*cells["SA"])   # ALL - J
        loo_a = pct(*cells["JS"])   # ALL - A
        loo_s = pct(*cells["JA"])   # ALL - S
        lines.append(f"{bucket:<8}{p0:>6}{j:>10}{a:>10}{s:>9}{allc:>6}"
                     f"   -J={loo_j} -A={loo_a} -S={loo_s}")
    lines.append("")

    # --- 2. Error mass (P0) ---
    lines.append("## 2. Error mass at P0 (where lost GT creases go)\n")
    lines.append(f"{'bucket':<8}{'gt_edges':>9}{'detector':>10}{'selection':>11}"
                 f"{'assign_wrong':>13}{'spurious':>10}")
    for bucket in BUCKETS:
        rows = load(out, bucket, "P0")
        if rows is None:
            continue
        a = collections.Counter()
        for r in rows:
            for k in ("gt_edges", "detector_miss", "selection_miss", "assignment_wrong", "spurious"):
                a[k] += r["attribution"][k]
        g = a["gt_edges"]
        lines.append(f"{bucket:<8}{g:>9}{a['detector_miss']:>6}{pct(a['detector_miss'], g):>4}"
                     f"{a['selection_miss']:>7}{pct(a['selection_miss'], g):>4}"
                     f"{a['assignment_wrong']:>9}{pct(a['assignment_wrong'], g):>4}"
                     f"{a['spurious']:>6}{pct(a['spurious'], g):>4}")
    lines.append("")

    # --- 3. Near-miss blocker (P0) ---
    lines.append("## 3. Near-miss blocker at P0 (samples within K=3 wrong creases of exact)\n")
    lines.append("Of non-exact samples that are close, the single dominant lost-crease type.\n")
    lines.append(f"{'bucket':<8}{'near-miss n':>12}{'detector':>10}{'selection':>11}{'assignment':>12}")
    K = 3
    for bucket in BUCKETS:
        rows = load(out, bucket, "P0")
        if rows is None:
            continue
        dom = collections.Counter()
        near = 0
        for r in rows:
            at = r["attribution"]
            if at["exact_topology"]:
                continue
            wrong = at["detector_miss"] + at["selection_miss"] + at["spurious"]
            if wrong > K:
                continue
            near += 1
            cand = {"detector": at["detector_miss"], "selection": at["selection_miss"],
                    "assignment": at["assignment_wrong"]}
            dom[max(cand, key=cand.get)] += 1
        lines.append(f"{bucket:<8}{near:>12}{dom['detector']:>10}{dom['selection']:>11}{dom['assignment']:>12}")
    lines.append("")

    # --- 4. Error mass by family (P0, all buckets pooled) ---
    lines.append("## 4. Error mass by family (P0, pooled)\n")
    fam = collections.defaultdict(collections.Counter)
    for bucket in BUCKETS:
        rows = load(out, bucket, "P0")
        if rows is None:
            continue
        for r in rows:
            f = r.get("family") or "unknown"
            for k in ("gt_edges", "detector_miss", "selection_miss", "assignment_wrong", "spurious"):
                fam[f][k] += r["attribution"][k]
            fam[f]["samples"] += 1
    lines.append(f"{'family':<22}{'n':>5}{'gt_edges':>9}{'detector':>10}{'selection':>11}{'spurious':>10}")
    for f, a in sorted(fam.items(), key=lambda kv: -kv[1]["gt_edges"]):
        g = a["gt_edges"]
        lines.append(f"{f[:22]:<22}{a['samples']:>5}{g:>9}{a['detector_miss']:>6}{pct(a['detector_miss'], g):>4}"
                     f"{a['selection_miss']:>7}{pct(a['selection_miss'], g):>4}"
                     f"{a['spurious']:>6}{pct(a['spurious'], g):>4}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--bin", required=True)
    r.add_argument("--cache", required=True)
    r.add_argument("--out", required=True)
    g = sub.add_parser("agg")
    g.add_argument("--out", required=True)
    args = parser.parse_args()
    out = Path(args.out)
    if args.cmd == "run":
        run_matrix(args.bin, args.cache, out)
    report = aggregate(out)
    print(report)
    (out / "REPORT.md").write_text(report + "\n")


if __name__ == "__main__":
    main()
