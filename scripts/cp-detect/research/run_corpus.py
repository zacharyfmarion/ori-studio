#!/usr/bin/env python3
"""Frozen-protocol pixel-model corpus evaluation; real data is inference only.

No truth size cap: every selected source is attempted. Source-derived vertex
count chooses resolution. Scoring runs separately after prediction, using the
product's existing strict topology metric. This runner does not fit weights.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import subprocess
import threading
import time
from pathlib import Path

import cv2
import numpy as np
import torch

from auxiliary_lines import append_aux, extract_segments
from pixel_vertex import PixelVertex
from pixel_vertex_infer import infer_image, primitives
from run_probes import normalized_fold


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--split", choices=["development", "holdout"], required=True)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--jobs", type=int, default=4)
    args = parser.parse_args()
    protocol = json.loads(args.protocol.read_text())
    if sha(args.checkpoint) != protocol["checkpoint_sha256"]:
        raise ValueError("Checkpoint differs from frozen protocol")
    if sha(args.inventory) != protocol["inventory_sha256"]:
        raise ValueError("Corpus inventory differs from frozen protocol")
    for path, expected in protocol.get("source_sha256", {}).items():
        if sha(Path(path)) != expected:
            raise ValueError(f"Inference source differs from frozen protocol: {path}")
    args.out.mkdir(parents=True, exist_ok=True)
    config = {"protocol": protocol, "split": args.split, "jobs": args.jobs}
    config_path = args.out / "config.json"
    if config_path.exists() and json.loads(config_path.read_text()) != config:
        raise ValueError("Refusing to mix protocols in an output directory")
    config_path.write_text(json.dumps(config, indent=2))
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    if checkpoint["config"]["real_training_patterns"] != 0:
        raise ValueError("Expected synthetic-only checkpoint")
    model = PixelVertex(checkpoint["config"]["width"])
    model.load_state_dict(checkpoint["model"])
    model.eval().to("mps")
    torch.set_num_threads(2)
    cv2.setNumThreads(1)
    model_lock = threading.Lock()
    rows = [r for r in json.loads(args.inventory.read_text())["cases"] if r["split"] == args.split]
    (args.out / "selection.json").write_text(json.dumps(rows, indent=2))

    def process(row):
        key = row["key"].replace("/", "__")
        case = args.out / key
        case.mkdir(exist_ok=True)
        done = case / "complete.json"
        if done.exists():
            return json.loads(done.read_text())
        source = Path(row["source"])
        if sha(source) != row["source_sha256"]:
            raise ValueError("Frozen source changed")
        started = time.perf_counter()
        record = {"key": row["key"], "complexity": row["complexity"], "source_sha256": row["source_sha256"]}
        inference_seconds = 0
        for size in [1024, 2048]:
            dest = case / str(size)
            dest.mkdir(exist_ok=True)
            command = ["target/release/examples/recognition_probe", str(source), str(dest), str(size), "rectify-only"]
            with (dest / "rectify.log").open("w") as log:
                subprocess.run(command, check=True, timeout=20, stdout=log, stderr=log)
            rgb = cv2.cvtColor(cv2.imread(str(dest / "rectified.png")), cv2.COLOR_BGR2RGB)
            with model_lock:
                before = time.perf_counter()
                points, lines = infer_image(model, rgb.astype(np.float32) / 255, "mps", protocol["threshold"])
                inference_seconds += time.perf_counter() - before
            vertices = primitives(points, size)
            record[f"vertices_{size}"] = len(vertices)
            if size == 1024 and len(vertices) > protocol["high_resolution_vertex_threshold"]:
                continue
            break
        vertex_path = dest / "vertices.json"
        vertex_path.write_text(json.dumps(vertices))
        line_path = dest / "crease.f32"
        lines[0].astype("<f4").tofile(line_path)
        record.update(size=size, pixel_inference_seconds=inference_seconds)
        command = ["target/release/examples/recognition_probe", str(source), str(dest), str(size),
                   str(args.out / ".unused-cache"), str(vertex_path), str(line_path), protocol.get("decoder", "pixel-only")]
        try:
            with (dest / "decode.log").open("w") as log:
                result = subprocess.run(command, timeout=protocol["decode_timeout_seconds"], stdout=log, stderr=log)
                record["exit_code"] = result.returncode
        except subprocess.TimeoutExpired:
            record["timeout"] = True
        line_path.unlink(missing_ok=True)
        fold_path = dest / "recognized.fold"
        if fold_path.exists():
            record["prediction"] = str(fold_path)
            report = json.loads((dest / "result.json").read_text())
            record["decode_seconds"] = report["decode_seconds"]
            auxiliary = extract_segments(lines[1], rgb=rgb)
            record["auxiliary_segments"] = len(auxiliary)
            combined = append_aux(json.loads(fold_path.read_text()), auxiliary, size)
            (dest / "with-aux.fold").write_text(json.dumps(combined))
        record["process_seconds"] = time.perf_counter() - started
        done.write_text(json.dumps(record, indent=2))
        return record

    records = []
    with ThreadPoolExecutor(max_workers=args.jobs) as pool, (args.out / "progress.jsonl").open("w") as progress:
        futures = {pool.submit(process, row): row for row in rows}
        for future in as_completed(futures):
            row = futures[future]
            try:
                record = future.result()
            except Exception as error:
                record = {"key": row["key"], "complexity": row["complexity"], "error": str(error)}
            records.append(record)
            progress.write(json.dumps(record) + "\n")
            progress.flush()
            print(json.dumps({"done": len(records), "total": len(rows), **record}), flush=True)
    records.sort(key=lambda r: r["key"])
    by_key = {r["key"]: r for r in rows}
    pairs, indices = [], []
    for index, record in enumerate(records):
        row = by_key[record["key"]]
        record["has_topology_truth"] = bool(row["topology_sha256"])
        if not record.get("prediction") or not row["topology_sha256"]:
            continue
        truth = Path(row["source"]).parent / "topology.fold"
        if sha(truth) != row["topology_sha256"]:
            raise ValueError("Frozen topology changed during evaluation")
        case = args.out / row["key"].replace("/", "__")
        normal = case / "normalized.fold"
        normal.write_text(json.dumps(normalized_fold(Path(record["prediction"]))))
        target = case / "truth.normalized.fold"
        target.write_text(json.dumps(normalized_fold(truth)))
        pairs.append(f"{normal}\t{target}")
        indices.append(index)
    pair_file = args.out / "pairs.tsv"
    pair_file.write_text("\n".join(pairs) + "\n")
    result = subprocess.run(["target/release/examples/strict_diff", str(pair_file), "4"], capture_output=True, text=True, check=True)
    (args.out / "strict.jsonl").write_text(result.stdout)
    for index, line in zip(indices, result.stdout.splitlines(), strict=True):
        metrics = json.loads(line).get("metrics")
        if metrics:
            records[index]["score"] = {k: metrics[k] for k in ["edges", "vertices", "assignments", "exact_topology", "exact_topology_and_assignment"]}
    (args.out / "runs.json").write_text(json.dumps(records, indent=2))
    scored = [r for r in records if r["has_topology_truth"]]
    summary = {"attempted": len(records), "with_truth": len(scored),
               "successful_predictions": sum("score" in r for r in scored),
               "exact": sum(r.get("score", {}).get("exact_topology", False) for r in scored),
               "errors_on_completed": sum(r["score"]["edges"]["missing_edges"] + r["score"]["edges"]["extra_edges"] for r in scored if "score" in r),
               "macro_f1_counting_failure_as_zero": sum(r.get("score", {}).get("edges", {}).get("f1", 0) for r in scored) / max(1, len(scored))}
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
