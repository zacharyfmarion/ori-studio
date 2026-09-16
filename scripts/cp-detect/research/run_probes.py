#!/usr/bin/env python3
"""Run paired source-only recognition probes and score with the current metric.

Selects a deterministic, complexity-stratified DEVELOPMENT subset before any
results are examined. Scoring is a separate process after inference. All outputs
are private, ignored artifacts. The holdout is refused by this exploratory tool.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path


def normalized_fold(path):
    fold = json.loads(path.read_text())
    points, edges = fold["vertices_coords"], fold["edges_vertices"]
    assignments = fold.get("edges_assignment", ["U"] * len(edges))
    border = [points[v] for edge, a in zip(edges, assignments) if a == "B" for v in edge] or points
    lo = [min(p[d] for p in border) for d in range(2)]
    span = [max(p[d] for p in border) - lo[d] for d in range(2)]
    if min(span) <= 0:
        raise ValueError("degenerate paper frame")
    keep = [i for i, a in enumerate(assignments) if a != "F"]
    value = {"file_spec": 1.2,
             "vertices_coords": [[(p[d] - lo[d]) / span[d] * 1024 for d in range(2)] for p in points],
             "edges_vertices": [edges[i] for i in keep],
             "edges_assignment": [assignments[i] for i in keep]}
    roles = fold.get("cp_detector", {}).get("edge_boundary_role")
    if roles is not None:
        value["cp_detector"] = {"edge_boundary_role": [roles[i] for i in keep]}
    return value


def choose(rows, per_stratum):
    strata = defaultdict(list)
    for r in rows:
        if r["split"] == "development" and r["topology_sha256"]:
            strata[(r["key"].split("/")[0], r["complexity"])].append(r)
    selected = []
    for key, values in sorted(strata.items()):
        selected.extend(sorted(values, key=lambda r: hashlib.sha256(r["key"].encode()).hexdigest())[:per_stratum])
    return selected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--per-stratum", type=int, default=2)
    parser.add_argument("--sizes", type=int, nargs="+", default=[1024, 2048])
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    rows = choose(json.loads(args.inventory.read_text())["cases"], args.per_stratum)
    args.out.mkdir(parents=True, exist_ok=True)
    selection = args.out / "selection.json"
    if selection.exists():
        if json.loads(selection.read_text()) != rows:
            raise SystemExit("The frozen probe selection differs; use a new output directory")
    else:
        selection.write_text(json.dumps(rows, indent=2))
    if args.prepare_only:
        print("Selected", len(rows), "development cases")
        return
    pairs, pair_keys, records = [], [], []
    for row in rows:
        source = Path(row["source"])
        if hashlib.sha256(source.read_bytes()).hexdigest() != row["source_sha256"]:
            raise SystemExit(f"Source changed: {row['key']}")
        truth = source.parent / "topology.fold"
        if hashlib.sha256(truth.read_bytes()).hexdigest() != row["topology_sha256"]:
            raise SystemExit(f"Topology changed: {row['key']}")
        key = row["key"].replace("/", "__")
        truth_normal = args.out / (key + ".truth.fold")
        truth_normal.write_text(json.dumps(normalized_fold(truth)))
        for size in args.sizes:
            case_out = args.out / str(size) / key
            case_out.mkdir(parents=True, exist_ok=True)
            record = {"key": row["key"], "complexity": row["complexity"], "size": size}
            started = time.perf_counter()
            if not (case_out / "recognized.fold").exists():
                with (case_out / "run.log").open("w") as log:
                    try:
                        result = subprocess.run(["target/release/examples/recognition_probe", str(source),
                                                 str(case_out), str(size), str(args.cache)],
                                                stdout=log, stderr=log, timeout=args.timeout)
                        record["exit_code"] = result.returncode
                    except subprocess.TimeoutExpired:
                        record["timeout"] = True
            record["process_seconds"] = time.perf_counter() - started
            if (case_out / "result.json").exists():
                result = json.loads((case_out / "result.json").read_text())
                record.update({k: v for k, v in result.items() if k != "report"})
            fold_path = case_out / "recognized.fold"
            if fold_path.exists():
                normal = case_out / "normalized.fold"
                normal.write_text(json.dumps(normalized_fold(fold_path)))
                pairs.append(f"{normal}\t{truth_normal}")
                pair_keys.append(len(records))
            records.append(record)
            print(json.dumps(record), flush=True)
            # A separate architecture on precisely the same source pixels.
            if (case_out / "rectified.png").exists():
                raster = case_out / "raster.fold"
                result = subprocess.run([sys.executable, "scripts/cp-detect/research/raster_graph.py",
                                         str(case_out / "rectified.png"), str(raster)],
                                        capture_output=True, text=True, timeout=60)
                raster_record = {"key": row["key"], "complexity": row["complexity"],
                                 "size": size, "method": "raster", "exit_code": result.returncode}
                if result.returncode == 0:
                    raster_record.update(json.loads(result.stdout))
                    normal = case_out / "raster.normalized.fold"
                    normal.write_text(json.dumps(normalized_fold(raster)))
                    pairs.append(f"{normal}\t{truth_normal}")
                    pair_keys.append(len(records))
                else:
                    raster_record["error"] = result.stderr[-1000:]
                records.append(raster_record)
                print(json.dumps(raster_record), flush=True)
        (args.out / "runs.json").write_text(json.dumps(records, indent=2))
    pair_file = args.out / "pairs.tsv"
    pair_file.write_text("\n".join(pairs) + "\n")
    scored = subprocess.run(["target/release/examples/strict_diff", str(pair_file), "4.0"],
                            capture_output=True, text=True, check=True)
    (args.out / "strict.jsonl").write_text(scored.stdout)
    for index, line in zip(pair_keys, scored.stdout.splitlines(), strict=True):
        record = json.loads(line)
        metrics = record.get("metrics")
        if metrics:
            records[index]["score"] = {"exact": metrics["exact_topology"],
                                      "exact_assignment": metrics["exact_topology_and_assignment"],
                                      "edges": metrics["edges"], "vertices": metrics["vertices"]}
        else:
            records[index]["score_error"] = record.get("error", "missing metrics")
    (args.out / "runs.json").write_text(json.dumps(records, indent=2))
    summary = defaultdict(list)
    for r in records:
        summary[(r.get("method", "model"), r["size"])].append(r)
    for key, values in sorted(summary.items()):
        scores = [r["score"] for r in values if "score" in r]
        print(key, "completed", len(scores), "/", len(values), "exact", sum(s["exact"] for s in scores),
              "missing", sum(s["edges"]["missing_edges"] for s in scores),
              "extra", sum(s["edges"]["extra_edges"] for s in scores),
              "mean_f1", sum(s["edges"]["f1"] for s in scores) / max(len(values), 1), flush=True)


if __name__ == "__main__":
    main()
