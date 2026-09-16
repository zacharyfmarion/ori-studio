#!/usr/bin/env python3
"""Run the frozen family split against an external corpus; commit no geometry.

Build first: cargo build -p oristudio-precrease --release --example compare_constructions
Example: python3 scripts/precrease/benchmark_constructions.py /external/curated \
  --split development --output artifacts/precrease-construction/development-final.json
The product mode shares the normal ten-second deadline between scheduling and
construction refinement. Teacher mode instead fixes work, with no wall deadline.
"""
import argparse
import hashlib
import json
import platform
import statistics
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROTOCOL = ROOT / "research/precrease-construction-protocol.json"
PROTECTED = [
    "missing_targets", "duplicate_folds", "unavailable", "wrong_face", "reversed",
    "uncovered", "pinches_beyond", "unknown_pinch_precision", "invisible",
    "imprecise", "impractical", "difficult", "unknown_precision", "lost_ends",
]


def select_input(directory):
    if (directory / "truth.fold").is_file():
        return directory / "truth.fold"
    candidates = sorted(p for p in directory.iterdir()
                        if p.suffix in {".fold", ".cp", ".opx", ".osf"}
                        and p.stem not in {"detected", "topology"})
    if len(candidates) != 1:
        raise ValueError(f"expected one source input in {directory}, got {candidates}")
    return candidates[0]


def summarize(rows):
    pairs = [r for r in rows if "before" in r]
    metrics = {}
    if pairs:
        for key, value in pairs[0]["before"].items():
            if isinstance(value, (int, float)):
                a = sum(r["before"][key] for r in pairs)
                b = sum(r["after"][key] for r in pairs)
                metrics[key] = {"before": a, "after": b,
                                "reduction_percent": 100 * (1 - b / a) if a else None}
    regressions = []
    for r in pairs:
        for key in PROTECTED:
            if r["after"][key] > r["before"][key]:
                regressions.append([r["design"], key])
        for key in ["unavailable_folds", "approximate_folds"]:
            if not set(r["after"][key]) <= set(r["before"][key]):
                regressions.append([r["design"], key])
    work_target = any((metrics.get(k, {}).get("reduction_percent") or 0) >= 20
                      for k in ["extra_marks", "extra_length"])
    difficulty = metrics.get("difficult", {"before": 0, "after": 0})
    times = sorted(r["search_ms"] + r["refinement_ms"] for r in pairs)
    return {
        "inputs": len({r["design"] for r in rows}), "paired_components": len(pairs),
        "statuses": {s: sum(r["status"] == s for r in rows) for s in sorted({r["status"] for r in rows})},
        "metrics": metrics, "protected_regressions": regressions,
        "target_met": work_target and difficulty["after"] < difficulty["before"] and not regressions,
        "sequence_ms": {"median": statistics.median(times), "maximum": max(times)} if times else {},
        "construction_deadlines_hit": sum(r["stats"]["expired"] for r in pairs),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("--split", choices=["development", "evaluation"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=["product", "teacher"], default="product")
    args = parser.parse_args()
    protocol_bytes = PROTOCOL.read_bytes()
    protocol = json.loads(protocol_bytes)
    families = protocol["family_by_design"]
    if {families[d] for d in protocol["development"]} & {families[d] for d in protocol["evaluation"]}:
        raise ValueError("development and evaluation share a family")
    paths = [select_input(args.corpus / d) for d in protocol[args.split]]
    receipts = {p.parent.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    for design, sha in receipts.items():
        if sha != protocol["input_sha256"][design]:
            raise ValueError(f"input changed since protocol was fixed: {design}")
    options = (["--product", "--budget-ms", "10000"] if args.mode == "product" else
               ["--trials", "64000", "--budget-ms", "0", "--tradeoffs", "--single-alignment"])
    command = [str(ROOT / "target/release/examples/compare_constructions"), *options, *map(str, paths)]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists():
        raise FileExistsError(args.output)
    rows = []
    source_files = sorted((ROOT / "crates/oristudio-precrease/src").rglob("*.rs"))
    source_receipt = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_files}
    binary_sha256 = hashlib.sha256(Path(command[0]).read_bytes()).hexdigest()
    # Flush receipts incrementally so an interrupted long run remains auditable.
    raw = args.output.with_suffix(".jsonl")
    with raw.open("x") as out:
        with subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, text=True) as process:
            for line in process.stdout:
                row = json.loads(line)
                path = Path(row.pop("path"))
                row.update(design=path.parent.name, file=path.name,
                           input_sha256=receipts[path.parent.name])
                rows.append(row)
                out.write(json.dumps(row, sort_keys=True) + "\n")
                out.flush()
                print(f"{len(rows)}/{len(paths)} {path.parent.name}: {row['status']}", flush=True)
            if process.wait():
                raise RuntimeError(f"benchmark failed with exit code {process.returncode}; see {raw}")
    report = {
        "description": "Same-closure comparison against the merged ordering policy, both using the corrected final auxiliary pinch pass. Native only; no ReferenceFinder fallback.",
        "split": args.split, "mode": args.mode, "platform": platform.platform(),
        "options": options, "protocol_sha256": hashlib.sha256(protocol_bytes).hexdigest(),
        "source_sha256": source_receipt, "binary_sha256": binary_sha256,
        "summary": summarize(rows),
        "complete_summary": summarize([r for r in rows if r["status"] == "complete"]),
        "cases": rows,
    }
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
