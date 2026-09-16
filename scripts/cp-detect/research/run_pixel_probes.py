#!/usr/bin/env python3
"""E005 ablations on the frozen development probe, with scoring after inference."""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np
import torch

from pixel_vertex import PixelVertex
from pixel_vertex_infer import infer_image, primitives
from run_probes import normalized_fold


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--threshold", type=float, default=0.35)
    parser.add_argument("--modes", nargs="+", choices=["vertices", "vertices_and_lines", "pixel_only"],
                        default=["vertices", "vertices_and_lines"])
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    if checkpoint["config"]["real_training_patterns"] != 0:
        raise ValueError("Expected synthetic-only checkpoint")
    model = PixelVertex(checkpoint["config"]["width"])
    model.load_state_dict(checkpoint["model"])
    model.eval().to(args.device)
    torch.set_num_threads(2)
    rows = json.loads((args.probe / "selection.json").read_text())
    if any(r["split"] != "development" for r in rows):
        raise ValueError("Exploration refuses held-out cases")
    (args.out / "selection.json").write_text(json.dumps(rows, indent=2))
    (args.out / "config.json").write_text(json.dumps({
        "checkpoint_sha256": hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
        "threshold": args.threshold, "size": args.size,
        "synthetic_validation": checkpoint["synthetic_val"]}, indent=2))
    records, pairs, pair_indices = [], [], []
    for row in rows:
        key = row["key"].replace("/", "__")
        case = args.out / key
        case.mkdir(parents=True, exist_ok=True)
        source = Path(row["source"])
        if hashlib.sha256(source.read_bytes()).hexdigest() != row["source_sha256"]:
            raise ValueError("Frozen source changed")
        image = cv2.cvtColor(cv2.imread(str(args.probe / str(args.size) / key / "rectified.png")), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
        started = time.perf_counter()
        points, lines = infer_image(model, image, args.device, args.threshold)
        vertices = primitives(points, args.size)
        inference_seconds = time.perf_counter() - started
        vertex_path = case / "vertices.json"
        vertex_path.write_text(json.dumps(vertices))
        for name, values in zip(("crease", "aux"), lines):
            values.astype("<f4").tofile(case / f"{name}.f32")
            cv2.imwrite(str(case / f"{name}.png"), np.rint(values * 255).astype(np.uint8))
        for mode in args.modes:
            dest = case / mode
            dest.mkdir(exist_ok=True)
            command = ["target/release/examples/recognition_probe", str(source), str(dest),
                       str(args.size), str(args.cache), str(vertex_path)]
            if mode in {"vertices_and_lines", "pixel_only"}:
                command.append(str(case / "crease.f32"))
            if mode == "pixel_only":
                command.append("pixel-only")
            record = {"key": row["key"], "complexity": row["complexity"], "mode": mode,
                      "vertices": len(vertices), "pixel_inference_seconds": inference_seconds}
            with (dest / "run.log").open("w") as log:
                try:
                    result = subprocess.run(command, stdout=log, stderr=log, timeout=90)
                    record["exit_code"] = result.returncode
                except subprocess.TimeoutExpired:
                    record["timeout"] = True
            fold = dest / "recognized.fold"
            if fold.exists():
                normal = dest / "normalized.fold"
                normal.write_text(json.dumps(normalized_fold(fold)))
                pairs.append(f"{normal}\t{args.probe / (key + '.truth.fold')}")
                pair_indices.append(len(records))
                result = json.loads((dest / "result.json").read_text())
                record["decode_seconds"] = result["decode_seconds"]
            records.append(record)
            (args.out / "runs.json").write_text(json.dumps(records, indent=2))
            print(json.dumps(record), flush=True)
    pair_file = args.out / "pairs.tsv"
    pair_file.write_text("\n".join(pairs) + "\n")
    scored = subprocess.run(["target/release/examples/strict_diff", str(pair_file), "4"], capture_output=True, text=True, check=True)
    (args.out / "strict.jsonl").write_text(scored.stdout)
    for index, line in zip(pair_indices, scored.stdout.splitlines(), strict=True):
        records[index]["score"] = json.loads(line).get("metrics")
    (args.out / "runs.json").write_text(json.dumps(records, indent=2))
    for mode in args.modes:
        scores = [r["score"] for r in records if r["mode"] == mode and r.get("score")]
        print(mode, "completed", len(scores), "/", len(rows), "exact", sum(s["exact_topology"] for s in scores),
              "errors", sum(s["edges"]["extra_edges"] + s["edges"]["missing_edges"] for s in scores),
              "macro_f1", sum(s["edges"]["f1"] for s in scores) / len(rows), flush=True)


if __name__ == "__main__":
    main()
