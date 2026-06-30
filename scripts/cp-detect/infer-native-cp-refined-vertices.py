#!/usr/bin/env python3
"""Run the V3 vertex refiner (PyTorch/MPS) over crop tensors from `refiner_cache plan`.

The geometry (proposals -> crop tensors, and later decode -> merge) lives in shared
Rust (`oristudio_cp_detect::refinement`); this is the forward-pass bookend, mirroring
`infer-native-cp-dense-cache.py`. No browser.

Flow:
  refiner_cache plan  -> <crops>/crops_index.json + <id>.crops.f32  ([N,11,96,96] f32)
  THIS SCRIPT         -> <out>/<id>.<head>.f32 + <id>.outputs.json  (7 raw head tensors)
  refiner_cache merge -> refined-vertex cache for the benchmark's --refined-vertices

The 7 heads are written as the model emits them (logits for heatmap/kind/degree/rays/
boundary_side; pixel offsets for vertex_offset) — exactly what the Rust decode expects.

Usage:
  infer-native-cp-refined-vertices.py --crops <dir> --out <dir> \
      [--checkpoint <best.pt>] [--detector-repo <path>] [--device mps] [--batch-size 256]
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

HEAD_NAMES = [
    "vertex_heatmap",
    "vertex_offset",
    "vertex_kind",
    "degree",
    "incident_rays",
    "boundary_contact_heatmap",
    "boundary_side",
]
CROP_SIZE = 96
INPUT_CHANNELS = 11


def default_config() -> dict:
    cfg_path = Path(__file__).with_name("current-vertex-refiner.json")
    return json.loads(cfg_path.read_text()) if cfg_path.exists() else {}


def resolve_detector_repo(arg: str | None, config: dict) -> Path:
    if arg:
        return Path(arg).expanduser()
    repo = config.get("detector_repo", {})
    import os

    env = repo.get("env", "CP_DETECTOR_REPO")
    if os.environ.get(env):
        return Path(os.environ[env]).expanduser()
    return Path(repo.get("canonical_path", "~/Documents/code/create-pattern-detector")).expanduser()


def resolve_checkpoint(arg: str | None, config: dict, detector_repo: Path) -> Path:
    if arg:
        return Path(arg).expanduser()
    rel = config.get("detector_repo", {}).get(
        "checkpoint",
        "checkpoints/runpod_vertex_refiner_v3_light_rendered_ft_20260626_4090/full/best.pt",
    )
    return detector_repo / rel


def select_device(name: str | None) -> torch.device:
    if name:
        return torch.device(name)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def load_model(checkpoint_path: Path, detector_repo: Path, device: torch.device):
    sys.path.insert(0, str(detector_repo))
    from src.models import VertexRefinerV3  # noqa: WPS433

    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
    model = VertexRefinerV3(input_channels=INPUT_CHANNELS)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.to(device)
    model.eval()
    return model


def read_f32(path: Path) -> np.ndarray:
    return np.fromfile(path, dtype="<f4")


def write_f32(path: Path, array: np.ndarray) -> None:
    array.astype("<f4", copy=False).tofile(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--crops", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--checkpoint")
    parser.add_argument("--detector-repo")
    parser.add_argument("--device")
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    config = default_config()
    detector_repo = resolve_detector_repo(args.detector_repo, config)
    checkpoint_path = resolve_checkpoint(args.checkpoint, config, detector_repo)
    device = select_device(args.device)

    crops_dir = Path(args.crops)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    index = json.loads((crops_dir / "crops_index.json").read_text())
    samples = index["samples"]

    print(f"loading {checkpoint_path} on {device}", file=sys.stderr)
    model = load_model(checkpoint_path, detector_repo, device)

    ids = list(samples.keys())
    if args.limit:
        ids = ids[: args.limit]
    crop_values = INPUT_CHANNELS * CROP_SIZE * CROP_SIZE
    for sample_id in ids:
        meta = samples[sample_id]
        crop_count = int(meta["crop_count"])
        if crop_count == 0:
            continue
        flat = read_f32(crops_dir / f"{sample_id}.crops.f32")
        if flat.size != crop_count * crop_values:
            raise SystemExit(
                f"{sample_id}: crop tensor size {flat.size} != {crop_count}*{crop_values}"
            )
        crops = torch.from_numpy(
            flat.reshape(crop_count, INPUT_CHANNELS, CROP_SIZE, CROP_SIZE).copy()
        )

        head_chunks: dict[str, list[np.ndarray]] = {name: [] for name in HEAD_NAMES}
        with torch.no_grad():
            for start in range(0, crop_count, args.batch_size):
                batch = crops[start : start + args.batch_size].to(device)
                outputs = model(batch)
                for name in HEAD_NAMES:
                    head_chunks[name].append(outputs[name].detach().to("cpu").numpy())

        descriptor = {}
        for name in HEAD_NAMES:
            tensor = np.concatenate(head_chunks[name], axis=0)
            file_name = f"{sample_id}.{name}.f32"
            write_f32(out_dir / file_name, tensor.reshape(-1))
            descriptor[name] = {"dims": list(tensor.shape), "file": file_name}
        (out_dir / f"{sample_id}.outputs.json").write_text(json.dumps(descriptor))
        print(f"inferred {sample_id} -> {crop_count} crops", file=sys.stderr)


if __name__ == "__main__":
    main()
