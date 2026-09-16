#!/usr/bin/env python3
"""Pack generated geometry for E005; refuses non-synthetic input provenance.

Only reads the generated synthetic root and its declared train/val split.
Never opens the real benchmark. No rendered real patterns or pseudo-labels.
"""
import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

FAMILIES = {"treemaker-tree", "rabbit-ear-fold-program", "tessellation-fold-program",
            "search225-tiling", "box-pleated"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalized_geometry(fold):
    p = np.asarray(fold["vertices_coords"], dtype=np.float64)[:, :2]
    e = np.asarray(fold["edges_vertices"], dtype=np.int64)
    a = np.asarray(fold["edges_assignment"])
    if not (a == "B").any():
        raise ValueError("synthetic pattern has no explicit paper border")
    border = p[e[a == "B"].ravel()]
    lo, hi = border.min(axis=0), border.max(axis=0)
    if np.any(hi - lo <= 0):
        raise ValueError("degenerate synthetic paper")
    p = (p - lo) / (hi - lo)
    keep = a != "F"
    e, a = e[keep], a[keep]
    return p, e, a


def compact_fold(fold):
    p, e, a = normalized_geometry(fold)
    incident = [[] for _ in p]
    boundary = set(e[a == "B"].ravel().tolist())
    for u, v in e:
        incident[u].append(v)
        incident[v].append(u)
    nodes = []
    for i, ns in enumerate(incident):
        if not ns:
            continue
        if len(ns) == 2:
            x, y = p[ns] - p[i]
            norms = np.linalg.norm(x) * np.linalg.norm(y)
            if norms and x @ y / norms < -0.99999:
                continue
        nodes.append([float(p[i, 0]), float(p[i, 1]), int(i in boundary)])
    return {"points": p.round(8).tolist(), "edges": e.tolist(), "assignments": a.tolist(), "nodes": nodes}


def geometry_digest(points, edges):
    """Group geometry irrespective of numbering, M/V, rotation, or reflection.

    Those transformations are training augmentation, so putting transformed
    copies in validation would also leak. Coordinates are quantized to 1e-7
    of the paper width, far below the raster precision used by this experiment.
    """
    variants = []
    for swap in (False, True):
        for flip_x in (False, True):
            for flip_y in (False, True):
                p = points[:, ::-1].copy() if swap else points.copy()
                if flip_x:
                    p[:, 0] = 1 - p[:, 0]
                if flip_y:
                    p[:, 1] = 1 - p[:, 1]
                q = np.rint(p * 10_000_000).astype(np.int64)
                segments = q[edges].reshape(-1, 4).copy()
                reverse = (segments[:, 0] > segments[:, 2]) | (
                    (segments[:, 0] == segments[:, 2]) & (segments[:, 1] > segments[:, 3]))
                segments[reverse] = segments[reverse][:, [2, 3, 0, 1]]
                segments = segments[np.lexsort(segments[:, ::-1].T)]
                unique = np.r_[True, np.any(segments[1:] != segments[:-1], axis=1)]
                variants.append(segments[unique].astype("<i8").tobytes())
    return hashlib.sha256(min(variants)).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--synthetic-root", type=Path, required=True)
    parser.add_argument("--mix", default="cp_training_mix_v5_bp_search225")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--train-per-family", type=int, default=1200)
    parser.add_argument("--val-per-family", type=int, default=100)
    args = parser.parse_args()
    root = args.synthetic_root.resolve()
    if root.name != "synthetic":
        raise SystemExit("Expected the explicitly generated synthetic/ root")
    mix = root / args.mix
    manifest = mix / "raw-manifest.jsonl"
    grouped = collections.defaultdict(list)
    geometry_splits = collections.defaultdict(set)
    file_splits = collections.defaultdict(set)
    cached = {}
    for line in manifest.open():
        r = json.loads(line)
        if r["family"] not in FAMILIES or r["split"] not in {"train", "val", "test"}:
            continue
        if r.get("labelPolicy", {}).get("trainingEligible") is False:
            continue
        path = (mix / r["foldPath"]).resolve()
        if not path.is_relative_to(root):
            raise SystemExit("Geometry resolves outside generated synthetic root")
        if any(s in str(path).lower() for s in ["real_benchmark", "scraped", "cpoogle"]):
            raise SystemExit("Forbidden real-pattern provenance")
        r["resolved"] = path
        if path not in cached:
            sha = digest(path)
            points, edges, _ = normalized_geometry(json.loads(path.read_text()))
            geo = geometry_digest(points, edges)
            cached[path] = sha, geo
        r["source_sha256"], r["geometry_sha256"] = cached[path]
        geometry_splits[r["geometry_sha256"]].add(r["split"])
        file_splits[r["source_sha256"]].add(r["split"])
        grouped[r["family"], r["split"]].append(r)
        if len(cached) % 5000 == 0:
            print(f"Audited {len(cached)} source files", flush=True)
    if args.out.exists():
        raise SystemExit("Refusing to overwrite a training pack")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    counts, excluded, hashes = collections.Counter(), collections.Counter(), []
    seen = set()
    # Preserve declared validation/test ownership before subsampling. Excluding
    # only the sampled validation subset would quietly allow leakage later.
    owner = {geo: min(splits, key={"test": 0, "val": 1, "train": 2}.get)
             for geo, splits in geometry_splits.items()}
    temporary = args.out.with_suffix(args.out.suffix + ".partial")
    with gzip.open(temporary, "wt", compresslevel=6) as output:
        for (family, split), rows in sorted(grouped.items()):
            if split == "test":
                continue
            rows.sort(key=lambda r: hashlib.sha256(r["id"].encode()).hexdigest())
            limit = args.train_per_family if split == "train" else args.val_per_family
            for r in rows:
                geo, sha = r["geometry_sha256"], r["source_sha256"]
                if owner[geo] != split:
                    excluded[family, split, "reserved_other_split"] += 1
                    continue
                if geo in seen:
                    excluded[family, split, "duplicate_geometry"] += 1
                    continue
                if counts[family, split] >= limit:
                    continue
                seen.add(geo)
                geometry = compact_fold(json.loads(r["resolved"].read_text()))
                record = {"id": r["id"], "family": family, "split": split,
                          "source_sha256": sha, "geometry_sha256": geo, **geometry}
                output.write(json.dumps(record, separators=(",", ":")) + "\n")
                counts[family, split] += 1
                hashes.append(sha)
    temporary.rename(args.out)
    report = {"schema": "synthetic-vertex-pack/v2", "source_manifest_sha256": digest(manifest),
              "pack_sha256": digest(args.out), "counts": {f"{k[0]}/{k[1]}": v for k, v in sorted(counts.items())},
              "geometry_grouping": "dihedral-invariant sorted segments, 1e-7 quantization, assignments ignored",
              "source_cross_split_file_groups": sum(len(v) > 1 for v in file_splits.values()),
              "source_cross_split_geometry_groups": sum(len(v) > 1 for v in geometry_splits.values()),
              "exclusions": {"/".join(k): v for k, v in sorted(excluded.items())},
              "real_patterns_used": 0, "source_file_hashes": hashes}
    args.out.with_suffix(".provenance.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != "source_file_hashes"}, indent=2))


if __name__ == "__main__":
    main()
