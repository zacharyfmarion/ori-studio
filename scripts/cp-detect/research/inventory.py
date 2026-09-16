#!/usr/bin/env python3
"""Freeze an evaluation-only corpus inventory and deterministic 80/20 split.

Never imported by training or inference. Ground-truth geometry fingerprints keep
identical graphs together even when their case names or image encodings differ.
The resulting manifest contains private corpus identifiers: keep it in artifacts/.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path

from PIL import Image


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def geometry_digest(fold):
    points = fold.get("vertices_coords", [])
    if not points:
        return None
    lo = [min(p[d] for p in points) for d in range(2)]
    scale = max(max(p[d] for p in points) - lo[d] for d in range(2)) or 1
    normalized = [tuple(round((p[d] - lo[d]) / scale, 7) for d in range(2)) for p in points]
    assignments = fold.get("edges_assignment", [])
    edges = sorted((sorted([normalized[a], normalized[b]]), assignments[i] if i < len(assignments) else "U")
                   for i, (a, b) in enumerate(fold.get("edges_vertices", [])))
    return hashlib.sha256(json.dumps(edges, separators=(",", ":")).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    rows = []
    for source in sorted(args.corpus.glob("*/*/source.*")):
        if source.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            continue
        case = source.parent
        truth = case / "truth.fold"
        topology = case / "topology.fold"
        fold_path = truth if truth.exists() else topology
        fold = json.loads(fold_path.read_text()) if fold_path.exists() else {}
        geometry = geometry_digest(fold)
        fingerprint = geometry or digest(source)
        split_hash = hashlib.sha256(("cp-recognition-2026-09-16:" + fingerprint).encode()).hexdigest()
        with Image.open(source) as im:
            size = list(im.size)
        edges = sum(a.upper() not in {"B", "F"} for a in fold.get("edges_assignment", []))
        bucket = "small" if edges < 200 else "medium" if edges < 800 else "large" if edges < 2000 else "giant"
        rows.append({"key": str(case.relative_to(args.corpus)), "source": str(source.resolve()),
                     "source_sha256": digest(source), "image_size": size,
                     "topology_sha256": digest(topology) if topology.exists() else None,
                     "truth_sha256": digest(truth) if truth.exists() else None,
                     "geometry_sha256": geometry, "creases": edges, "complexity": bucket,
                     "split": "holdout" if int(split_hash[:8], 16) % 5 == 0 else "development"})
    if not rows:
        raise SystemExit("No corpus cases found")
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = args.out / "inventory.json"
    if manifest.exists():
        raise SystemExit(f"Refusing to overwrite frozen inventory: {manifest}")
    manifest.write_text(json.dumps({"schema": "cp-recognition-inventory/v1", "cases": rows}, indent=2) + "\n")
    summary = collections.Counter((r["key"].split("/")[0], r["split"], r["complexity"]) for r in rows)
    for key, count in sorted(summary.items()):
        print(*key, count)
    print("cases", len(rows), "inventory_sha256", digest(manifest))


if __name__ == "__main__":
    main()
