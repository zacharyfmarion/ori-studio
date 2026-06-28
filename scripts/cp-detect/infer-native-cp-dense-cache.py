#!/usr/bin/env python3
"""Run the PyTorch CP detector over a pack and write a dense-logits cache.

This is the GPU-native (MPS/CUDA) alternative to ``run-browser-dense-cache.mjs``:
it loads the source checkpoint directly and dumps the per-head ``*.f32`` tensors
that ``compare_exact_solve_benchmark`` consumes, with the same channel-major
``[C, H, W]`` byte layout the Rust reader expects.

It emits a dense-cache manifest for the whole pack plus one per ``bucket``
(easy/medium/hard) found in the pack samples, so the benchmark can be run per
difficulty tier.

NOTE: the current checkpoints require batch-statistics BatchNorm at inference
(``model.eval()`` running stats collapse junction recall); this mirrors
``run-python-correctness-baseline.py`` and ``current-model.json``.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image

from current_model import (
    current_checkpoint,
    default_detector_repo,
    load_current_model,
)

SCHEMA = "oristudio/cp-detect-dense-cache/v1"
CURRENT_MODEL = load_current_model()

# model output keys, in manifest order (only those present in the model are written)
ALL_HEAD_KEYS = [
    "line_logits",
    "junction_logits",
    "angle",
    "junction_offset",
    "assignment_logits",
    "non_crease_logits",
    "line_style_logits",
    "vertex_type_logits",
    "boundary_contact_logits",
    "boundary_side_logits",
    "boundary_offset",
    "boundary_coord",
]
# The junction-first + exact-solve benchmark path only consumes these (the six
# manifest-required heads plus junction_offset for real-junction subpixel
# decode). Dropping the rest roughly halves cache size. The benchmark treats the
# omitted heads as optional/absent.
LEAN_HEAD_KEYS = [
    "line_logits",
    "junction_logits",
    "junction_offset",
    "assignment_logits",
    "non_crease_logits",
    "line_style_logits",
    "boundary_contact_logits",
]


def main() -> int:
    args = parse_args()
    detector_repo = args.detector_repo.expanduser().resolve()
    import sys

    sys.path.insert(0, str(detector_repo))
    from src.inference.pipeline import load_cpline_model, select_device  # noqa: WPS433
    from src.models.batchnorm import model_eval_with_batchnorm_mode  # noqa: WPS433

    pack_path = args.pack.resolve()
    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    pack_root = pack_path.parent
    image_size = int(args.image_size or pack["image_size"])
    threshold = float(args.threshold if args.threshold is not None else CURRENT_MODEL["inference"]["threshold"])

    head_keys = ALL_HEAD_KEYS if args.heads == "all" else LEAN_HEAD_KEYS

    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    device = select_device(args.device)
    checkpoint = args.checkpoint.expanduser()
    print(f"loading model {checkpoint} on {device}")
    model = load_cpline_model(checkpoint, device)

    samples = pack["samples"]
    if args.limit:
        samples = samples[: args.limit]

    rows: list[dict[str, Any]] = []
    dims_seen: dict[str, list[int]] | None = None
    started = time.time()
    with torch.no_grad(), model_eval_with_batchnorm_mode(model, batchnorm_mode=args.batchnorm_mode):
        for i, sample in enumerate(samples):
            sid = sample["id"]
            sample_out = out_dir / sid
            sample_out.mkdir(exist_ok=True)
            image_tensor = load_image_tensor(pack_root / sample["input_png"], image_size, device)
            t0 = time.time()
            outputs = model(image_tensor)
            run_ms = (time.time() - t0) * 1000.0

            row: dict[str, Any] = {
                "id": sid,
                "source_id": sample.get("source_id"),
                "profile": sample.get("profile", "clean"),
                "family": sample.get("family", "native-cp"),
                "bucket": sample.get("bucket"),
                "edge_count": sample.get("edge_count"),
                "vertex_count": sample.get("vertex_count"),
                "assignment_counts": sample.get("assignment_counts"),
                "image_size": image_size,
                "threshold": threshold,
                "model_run_ms": round(run_ms, 2),
                "input_png": sample["input_png"],
                "gt_graph": sample["gt_graph"],
            }
            dims: dict[str, list[int]] = {}
            for key in head_keys:
                if key not in outputs:
                    continue
                tensor = outputs[key]
                arr = tensor.detach().cpu().numpy().astype("<f4")
                if arr.ndim == 4:
                    if arr.shape[0] != 1:
                        raise ValueError(f"{key}: expected batch 1, got {arr.shape}")
                    dims[key] = list(arr.shape)
                    arr = arr[0]
                else:
                    dims[key] = [1] + list(arr.shape)
                np.ascontiguousarray(arr).tofile(sample_out / f"{key}.f32")
                row[f"{key}_f32_path"] = f"{sid}/{key}.f32"
            dims_seen = dims_seen or dims
            rows.append(row)
            if (i + 1) % 10 == 0 or i + 1 == len(samples):
                print(f"  {i + 1}/{len(samples)}  {sid[:40]}  run={run_ms:.0f}ms", flush=True)

    total_s = round(time.time() - started, 2)
    write_manifests(out_dir, pack_path, rows, dims_seen or {}, image_size, total_s, device, checkpoint, head_keys)
    print(f"wrote dense cache: {len(rows)} samples in {total_s}s -> {out_dir}")
    return 0


def load_image_tensor(path: Path, image_size: int, device: torch.device) -> torch.Tensor:
    with Image.open(path) as opened:
        rgb = opened.convert("RGB")
    if rgb.size != (image_size, image_size):
        raise ValueError(f"expected {image_size}x{image_size}, got {rgb.size}: {path}")
    array = np.asarray(rgb, dtype=np.float32) / 255.0
    return torch.from_numpy(array).permute(2, 0, 1).unsqueeze(0).to(device)


def write_manifests(
    out_dir: Path,
    pack_path: Path,
    rows: list[dict[str, Any]],
    dims: dict[str, Any],
    image_size: int,
    total_s: float,
    device: Any,
    checkpoint: Path,
    head_keys: list[str],
) -> None:
    base = {
        "schema": SCHEMA,
        "generated_by": "scripts/cp-detect/infer-native-cp-dense-cache.py",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pack": str(pack_path),
        "implementation": "python-pytorch",
        "device": str(device),
        "checkpoint": str(checkpoint),
        "checkpoint_id": CURRENT_MODEL.get("model_id"),
        "image_size": image_size,
        "output_keys": [k for k in head_keys if any(f"{k}_f32_path" in r for r in rows)],
        "dims": dims,
        "total_seconds": total_s,
    }
    groups = {"all": rows}
    for name in ("easy", "medium", "hard"):
        groups[name] = [r for r in rows if r.get("bucket") == name]
    for name, items in groups.items():
        if name != "all" and not items:
            continue
        manifest = dict(base)
        manifest["bucket"] = name
        manifest["sample_count"] = len(items)
        manifest["samples"] = items
        path = out_dir / ("manifest.json" if name == "all" else f"manifest.{name}.json")
        path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--detector-repo", type=Path, default=default_detector_repo(CURRENT_MODEL))
    parser.add_argument("--pack", type=Path, required=True, help="pack manifest.json")
    parser.add_argument("--out", type=Path, required=True, help="dense-cache output dir")
    parser.add_argument("--checkpoint", type=Path, default=current_checkpoint(CURRENT_MODEL))
    parser.add_argument("--device", choices=["auto", "cpu", "mps", "cuda"], default="auto")
    parser.add_argument(
        "--batchnorm-mode",
        choices=["batch-stats", "eval"],
        default=CURRENT_MODEL["inference"]["python_batchnorm_mode"],
    )
    parser.add_argument("--threshold", type=float)
    parser.add_argument("--image-size", type=int)
    parser.add_argument("--heads", choices=["lean", "all"], default="lean")
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
