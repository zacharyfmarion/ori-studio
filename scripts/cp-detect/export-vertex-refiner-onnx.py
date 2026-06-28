#!/usr/bin/env python3
"""Export a create-pattern-detector VertexRefiner checkpoint for browser inference."""

from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import shutil
import sys
from pathlib import Path
from typing import Any

from current_vertex_refiner import (
    current_checkpoint,
    default_detector_repo,
    load_current_vertex_refiner,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CURRENT_REFINER = load_current_vertex_refiner()

OUTPUT_NAMES = [
    "vertex_heatmap",
    "vertex_offset",
    "vertex_kind",
    "degree",
    "incident_rays",
    "boundary_contact_heatmap",
    "boundary_side",
]

INPUT_CHANNELS_V3 = [
    "image_gray",
    "source_ink_probability",
    "source_distance_to_ink",
    "source_orientation_cos2",
    "source_orientation_sin2",
    "signed_distance_to_frame",
    "frame_edge_mask",
    "inside_paper_mask",
    "boundary_contact_prior",
    "crop_x_normalized",
    "crop_y_normalized",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--detector-repo",
        type=Path,
        default=default_detector_repo(CURRENT_REFINER),
        help=(
            "Path to the create-pattern-detector checkout. Defaults to "
            "CP_DETECTOR_REPO or scripts/cp-detect/current-vertex-refiner.json."
        ),
    )
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=current_checkpoint(CURRENT_REFINER),
        help="Checkpoint path, absolute or relative to --detector-repo.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / CURRENT_REFINER["stable_model_asset_dir"],
        help="Stable browser model asset directory.",
    )
    parser.add_argument(
        "--versioned-output-dir",
        type=Path,
        default=REPO_ROOT / CURRENT_REFINER["versioned_model_asset_dir"],
        help="Optional versioned browser model asset directory copied after export.",
    )
    parser.add_argument("--model-filename", default=CURRENT_REFINER["model_filename"])
    parser.add_argument("--model-id", default=CURRENT_REFINER["model_id"])
    parser.add_argument("--created-at", default=CURRENT_REFINER["created_at"])
    parser.add_argument(
        "--model-version",
        choices=["v3"],
        default=CURRENT_REFINER["inference"]["model_version"],
    )
    parser.add_argument(
        "--crop-size",
        type=int,
        default=int(CURRENT_REFINER["inference"]["crop_size"]),
    )
    parser.add_argument("--base-channels", type=int, default=None)
    parser.add_argument(
        "--heatmap-threshold",
        type=float,
        default=float(CURRENT_REFINER["inference"]["heatmap_threshold"]),
    )
    parser.add_argument(
        "--boundary-heatmap-threshold",
        type=float,
        default=float(CURRENT_REFINER["inference"]["boundary_heatmap_threshold"]),
    )
    parser.add_argument(
        "--nms-radius-px",
        type=int,
        default=int(CURRENT_REFINER["inference"]["nms_radius_px"]),
    )
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument(
        "--skip-onnxruntime-check",
        action="store_true",
        help="Skip ONNX Runtime parity smoke check after export.",
    )
    return parser.parse_args()


def resolve_detector_repo(arg: Path | None) -> Path:
    repo = (arg or default_detector_repo(CURRENT_REFINER)).expanduser().resolve()
    if not (repo / "src/models/vertex_refiner.py").exists():
        raise SystemExit(f"Not a create-pattern-detector repo: {repo}")
    return repo


def absolute_checkpoint(detector_repo: Path, checkpoint: Path) -> Path:
    path = checkpoint if checkpoint.is_absolute() else detector_repo / checkpoint
    path = path.expanduser().resolve()
    if not path.exists():
        raise SystemExit(f"Missing checkpoint: {path}")
    return path


def load_model(detector_repo: Path, checkpoint: Path, model_version: str, base_channels: int | None):
    sys.path.insert(0, str(detector_repo))
    import torch
    from src.models import VertexRefinerV3

    loaded = torch.load(checkpoint, map_location="cpu", weights_only=False)
    config = loaded.get("config", {})
    checkpoint_model_version = str(
        config.get("model_version") or config.get("input_version") or model_version
    )
    if checkpoint_model_version != model_version:
        raise SystemExit(
            f"Checkpoint model_version={checkpoint_model_version!r} does not match {model_version!r}"
        )
    model_base_channels = int(base_channels or config.get("base_channels", 48))
    model = VertexRefinerV3(base_channels=model_base_channels)
    model.load_state_dict(loaded["model_state_dict"])
    model.eval()
    return torch, model, config, model_base_channels


def export_onnx(torch, model, output_path: Path, crop_size: int, opset: int) -> None:
    from src.models.vertex_refiner import VertexRefinerOnnxWrapper

    output_path.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros((1, len(INPUT_CHANNELS_V3), crop_size, crop_size), dtype=torch.float32)
    wrapper = VertexRefinerOnnxWrapper(model).eval()
    kwargs: dict[str, Any] = {
        "input_names": ["refiner_input"],
        "output_names": OUTPUT_NAMES,
        "opset_version": opset,
        "training": torch.onnx.TrainingMode.EVAL,
        "do_constant_folding": True,
        "dynamic_axes": {
            "refiner_input": {0: "batch"},
            **{name: {0: "batch"} for name in OUTPUT_NAMES},
        },
    }
    if "dynamo" in inspect.signature(torch.onnx.export).parameters:
        kwargs["dynamo"] = False
    with torch.inference_mode():
        torch.onnx.export(wrapper, dummy, output_path, **kwargs)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_manifest(
    args: argparse.Namespace,
    model_path: Path,
    digest: str,
    detector_repo: Path,
    checkpoint: Path,
    checkpoint_config: dict[str, Any],
    base_channels: int,
) -> Path:
    manifest = {
        "schema": "oristudio/cp-vertex-refiner-model-manifest/v1",
        "id": args.model_id,
        "created_at": args.created_at,
        "model": {
            "url": args.model_filename,
            "sha256": digest,
            "size_bytes": model_path.stat().st_size,
            "format": "onnx",
        },
        "source": {
            "detector_repo": detector_repo.as_posix(),
            "checkpoint": checkpoint.as_posix(),
        },
        "architecture": {
            "class": "VertexRefinerV3",
            "model_version": args.model_version,
            "base_channels": base_channels,
            "crop_size": args.crop_size,
            "input_channels": INPUT_CHANNELS_V3,
            "output_names": OUTPUT_NAMES,
            "ray_bins": 36,
            "vertex_kind_names": [
                "background",
                "interior_junction",
                "boundary_contact",
                "corner",
                "endpoint_or_dangling",
            ],
            "boundary_side_names": ["top", "right", "bottom", "left"],
        },
        "training": {
            "augment_profile": checkpoint_config.get("augment_profile"),
            "auxiliary_mode": checkpoint_config.get("auxiliary_mode"),
            "source_only": checkpoint_config.get("auxiliary_mode") == "zero",
        },
        "inference": {
            "model_version": args.model_version,
            "input_version": args.model_version,
            "onnx_input_name": "refiner_input",
            "onnx_output_names": OUTPUT_NAMES,
            "crop_size": args.crop_size,
            "input_channels": len(INPUT_CHANNELS_V3),
            "input_channel_names": INPUT_CHANNELS_V3,
            "preprocessing": "v3_source_frame_channels_chw_float32",
            "heatmap_threshold": args.heatmap_threshold,
            "boundary_heatmap_threshold": args.boundary_heatmap_threshold,
            "nms_radius_px": args.nms_radius_px,
            "merge_radius_px": float(CURRENT_REFINER["inference"]["merge_radius_px"]),
            "boundary_merge_radius_px": float(
                CURRENT_REFINER["inference"]["boundary_merge_radius_px"]
            ),
            "min_support_fraction": float(
                CURRENT_REFINER["inference"].get("min_support_fraction", 0.0)
            ),
            "split_same_crop_conflicts": bool(
                CURRENT_REFINER["inference"].get("split_same_crop_conflicts", False)
            ),
            "split_min_support_fraction": float(
                CURRENT_REFINER["inference"].get("split_min_support_fraction", 0.0)
            ),
            "proposal_cap": int(CURRENT_REFINER["inference"]["proposal_cap"]),
            "batch_size": int(CURRENT_REFINER["inference"]["proposal_cap"]),
        },
        "outputs": {name: name for name in OUTPUT_NAMES},
    }
    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest_path


def check_onnx(path: Path) -> None:
    import onnx

    model = onnx.load(path)
    onnx.checker.check_model(model)


def check_onnxruntime(torch, model, model_path: Path, crop_size: int) -> None:
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError as error:
        raise SystemExit(f"ONNX Runtime check requested but dependency is missing: {error}") from error

    rng = np.random.default_rng(17)
    inputs_np = rng.normal(
        loc=0.0,
        scale=0.25,
        size=(3, len(INPUT_CHANNELS_V3), crop_size, crop_size),
    ).astype(np.float32)
    session = ort.InferenceSession(model_path.as_posix(), providers=["CPUExecutionProvider"])
    onnx_outputs = session.run(OUTPUT_NAMES, {"refiner_input": inputs_np})
    with torch.inference_mode():
        torch_outputs = model(torch.from_numpy(inputs_np))
    for name, actual in zip(OUTPUT_NAMES, onnx_outputs):
        expected = torch_outputs[name].detach().cpu().numpy()
        max_abs_error = float(np.max(np.abs(expected - actual)))
        if max_abs_error > 2e-4:
            raise SystemExit(
                f"ONNX Runtime parity failed for {name}: max_abs_error={max_abs_error:g}"
            )


def copy_to_versioned(output_dir: Path, versioned_output_dir: Path | None) -> None:
    if versioned_output_dir is None:
        return
    versioned_output_dir.mkdir(parents=True, exist_ok=True)
    for filename in ("model.onnx", "manifest.json"):
        shutil.copy2(output_dir / filename, versioned_output_dir / filename)


def main() -> None:
    args = parse_args()
    detector_repo = resolve_detector_repo(args.detector_repo)
    checkpoint = absolute_checkpoint(detector_repo, args.checkpoint)
    args.output_dir = args.output_dir.expanduser().resolve()
    args.versioned_output_dir = (
        None if args.versioned_output_dir is None else args.versioned_output_dir.expanduser().resolve()
    )
    model_path = args.output_dir / args.model_filename

    torch, model, config, base_channels = load_model(
        detector_repo,
        checkpoint,
        args.model_version,
        args.base_channels,
    )
    export_onnx(torch, model, model_path, args.crop_size, args.opset)
    check_onnx(model_path)
    if not args.skip_onnxruntime_check:
        check_onnxruntime(torch, model, model_path, args.crop_size)
    digest = sha256(model_path)
    manifest_path = write_manifest(
        args,
        model_path,
        digest,
        detector_repo,
        checkpoint,
        config,
        base_channels,
    )
    copy_to_versioned(args.output_dir, args.versioned_output_dir)

    print(f"wrote {model_path} ({model_path.stat().st_size} bytes)")
    print(f"wrote {manifest_path}")
    if args.versioned_output_dir is not None:
        print(f"copied manifest/model to {args.versioned_output_dir}")
    print(f"sha256 {digest}")


if __name__ == "__main__":
    main()
