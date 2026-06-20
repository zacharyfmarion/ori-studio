#!/usr/bin/env python3
"""Export a create-pattern-detector CPLineNet checkpoint for browser inference."""

from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import sys
from pathlib import Path

from current_model import current_checkpoint, default_detector_repo, load_current_model

REPO_ROOT = Path(__file__).resolve().parents[2]
CURRENT_MODEL = load_current_model()
OUTPUT_NAMES = [
    "line_logits",
    "angle",
    "junction_logits",
    "junction_offset",
    "assignment_logits",
    "non_crease_logits",
    "line_style_logits",
    "boundary_contact_logits",
    "vertex_type_logits",
    "boundary_side_logits",
    "boundary_offset",
    "boundary_coord",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--detector-repo",
        type=Path,
        default=default_detector_repo(CURRENT_MODEL),
        help=(
            "Path to the create-pattern-detector checkout. Defaults to CP_DETECTOR_REPO "
            "or scripts/cp-detect/current-model.json."
        ),
    )
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=current_checkpoint(CURRENT_MODEL),
        help="Checkpoint path, absolute or relative to --detector-repo.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / CURRENT_MODEL["stable_model_asset_dir"],
        help="Browser model asset directory.",
    )
    parser.add_argument("--model-filename", default="model.onnx")
    parser.add_argument("--model-id", default=CURRENT_MODEL["model_id"])
    parser.add_argument("--created-at", default=CURRENT_MODEL["created_at"])
    parser.add_argument("--image-size", type=int, default=int(CURRENT_MODEL["inference"]["image_size"]))
    parser.add_argument("--threshold", type=float, default=float(CURRENT_MODEL["inference"]["threshold"]))
    parser.add_argument(
        "--batchnorm-mode",
        choices=["eval", "batch-stats", "explicit-batch-stats"],
        default=CURRENT_MODEL["inference"]["onnx_batchnorm_mode"],
        help=(
            "BatchNorm export strategy. explicit-batch-stats rewrites BatchNorm2d "
            "to explicit per-image mean/variance ops so ONNX Runtime does not need "
            "training-mode BatchNormalization semantics."
        ),
    )
    parser.add_argument("--opset", type=int, default=17)
    return parser.parse_args()


def resolve_detector_repo(arg: Path | None) -> Path:
    repo = (arg or default_detector_repo(CURRENT_MODEL)).expanduser().resolve()
    if not (repo / "src/models/cpline_net.py").exists():
        raise SystemExit(f"Not a create-pattern-detector repo: {repo}")
    return repo


def absolute_checkpoint(detector_repo: Path, checkpoint: Path) -> Path:
    path = checkpoint if checkpoint.is_absolute() else detector_repo / checkpoint
    path = path.expanduser().resolve()
    if not path.exists():
        raise SystemExit(f"Missing checkpoint: {path}")
    return path


def load_model(detector_repo: Path, checkpoint: Path):
    sys.path.insert(0, str(detector_repo))
    import torch
    from src.models import CPLineNet

    loaded = torch.load(checkpoint, map_location="cpu", weights_only=False)
    config = loaded.get("config", {})
    offset_radius = float(config.get("junction_offset_radius_px", 0.0) or 0.0)
    model_kwargs = {
        "backbone": config.get("backbone", "hrnet_w18"),
        "pretrained": False,
        "hidden_channels": int(config.get("hidden_channels", 128)),
        "v2_heads": bool(config.get("v2_heads", False)),
    }
    if "junction_offset_clamp" in inspect.signature(CPLineNet).parameters:
        model_kwargs["junction_offset_clamp"] = 1.0 if offset_radius > 0 else 0.5
    model = CPLineNet(**model_kwargs)
    model.load_state_dict(loaded["model_state_dict"])
    model.eval()
    if not model.v2_heads:
        raise SystemExit("Checkpoint does not have CPLineNet-V2 heads")
    return torch, model, offset_radius


def export_onnx(torch, model, output_path: Path, image_size: int, opset: int, batchnorm_mode: str) -> None:
    from src.models.batchnorm import model_eval_with_batchnorm_mode

    class BrowserExportWrapper(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, image):
            outputs = self.inner(image)
            return tuple(outputs[name] for name in OUTPUT_NAMES)

    class ExplicitBatchNorm2d(torch.nn.Module):
        def __init__(self, source):
            super().__init__()
            self.eps = float(source.eps)
            if source.affine:
                self.register_buffer("weight", source.weight.detach().clone())
                self.register_buffer("bias", source.bias.detach().clone())
            else:
                self.register_buffer("weight", torch.ones(source.num_features, dtype=torch.float32))
                self.register_buffer("bias", torch.zeros(source.num_features, dtype=torch.float32))

        def forward(self, x):
            mean = x.mean(dim=(0, 2, 3), keepdim=True)
            centered = x - mean
            variance = (centered * centered).mean(dim=(0, 2, 3), keepdim=True)
            normalized = centered / torch.sqrt(variance + self.eps)
            return normalized * self.weight.view(1, -1, 1, 1) + self.bias.view(1, -1, 1, 1)

    def replace_batchnorm_with_explicit(module):
        for name, child in list(module.named_children()):
            if isinstance(child, torch.nn.modules.batchnorm._BatchNorm):
                setattr(module, name, ExplicitBatchNorm2d(child))
            else:
                replace_batchnorm_with_explicit(child)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros((1, 3, image_size, image_size), dtype=torch.float32)
    if batchnorm_mode == "explicit-batch-stats":
        replace_batchnorm_with_explicit(model)
    training = torch.onnx.TrainingMode.PRESERVE if batchnorm_mode == "batch-stats" else torch.onnx.TrainingMode.EVAL
    kwargs = {
        "input_names": ["image"],
        "output_names": OUTPUT_NAMES,
        "opset_version": opset,
        "training": training,
        "do_constant_folding": batchnorm_mode != "batch-stats",
    }
    if "dynamo" in inspect.signature(torch.onnx.export).parameters:
        kwargs["dynamo"] = False
    context_mode = "eval" if batchnorm_mode == "explicit-batch-stats" else batchnorm_mode
    with torch.inference_mode(), model_eval_with_batchnorm_mode(model, batchnorm_mode=context_mode):
        torch.onnx.export(BrowserExportWrapper(model), dummy, output_path, **kwargs)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_manifest(
    args: argparse.Namespace, model_path: Path, digest: str, offset_radius: float
) -> Path:
    manifest = {
        "schema": "oristudio/cp-detect-model-manifest/v1",
        "id": args.model_id,
        "created_at": args.created_at,
        "model": {
            "url": args.model_filename,
            "sha256": digest,
            "size_bytes": model_path.stat().st_size,
            "format": "onnx",
        },
        "inference": {
            "image_size": args.image_size,
            "threshold": args.threshold,
            "preprocessing": "rgb_chw_float32_0_1",
            "batchnorm_mode": args.batchnorm_mode,
            # CenterNet-style nearest-vertex offset normalization radius; 0
            # means legacy sub-pixel offsets. Decoders need this to scale
            # junction_offset votes (see junction_offset_cluster_radius_px).
            "junction_offset_radius_px": offset_radius,
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


def main() -> None:
    args = parse_args()
    detector_repo = resolve_detector_repo(args.detector_repo)
    checkpoint = absolute_checkpoint(detector_repo, args.checkpoint)
    args.output_dir = args.output_dir.expanduser().resolve()
    model_path = args.output_dir / args.model_filename

    torch, model, offset_radius = load_model(detector_repo, checkpoint)
    export_onnx(torch, model, model_path, args.image_size, args.opset, args.batchnorm_mode)
    check_onnx(model_path)
    digest = sha256(model_path)
    manifest_path = write_manifest(args, model_path, digest, offset_radius)

    print(f"wrote {model_path} ({model_path.stat().st_size} bytes)")
    print(f"wrote {manifest_path}")
    print(f"sha256 {digest}")


if __name__ == "__main__":
    main()
