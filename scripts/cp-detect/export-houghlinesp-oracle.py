#!/usr/bin/env python3
"""Export Python OpenCV HoughLinesP oracle fixtures.

The Rust OpenCV-port work uses this script as the source of truth. It calls
Python OpenCV with NumPy-backed CPU arrays and writes ordered raw HoughLinesP
segments for exact parity tests.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image


SCHEMA = "oristudio/cp-detect-houghlinesp-oracle/v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="*", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--rho", type=float, default=1.0)
    parser.add_argument("--theta", type=float, default=math.pi / 720.0)
    parser.add_argument("--threshold", type=int, default=10)
    parser.add_argument("--min-line-length", type=float, default=6.0)
    parser.add_argument("--max-line-gap", type=float, default=4.0)
    parser.add_argument("--generate-tiny-fixtures", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cv2.ocl.setUseOpenCL(False)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    fixtures: list[dict[str, Any]] = []
    if args.generate_tiny_fixtures:
        for fixture_id, mask in tiny_fixture_masks():
            fixtures.append(export_fixture(fixture_id, mask, args.output_dir, args))
    for input_path in args.inputs:
        mask = read_mask(input_path)
        fixtures.append(export_fixture(input_path.stem, mask, args.output_dir, args))

    manifest = {
        "schema": SCHEMA,
        "generated_by": "scripts/cp-detect/export-houghlinesp-oracle.py",
        "opencv": {
            "version": cv2.__version__,
            "opencl_available": bool(cv2.ocl.haveOpenCL()),
            "opencl_used": bool(cv2.ocl.useOpenCL()),
            "build_summary": build_summary(),
        },
        "config": {
            "rho": args.rho,
            "theta": args.theta,
            "threshold": args.threshold,
            "min_line_length": args.min_line_length,
            "max_line_gap": args.max_line_gap,
        },
        "fixtures": fixtures,
    }
    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {manifest_path}")
    return 0


def export_fixture(
    fixture_id: str,
    mask: np.ndarray,
    output_dir: Path,
    args: argparse.Namespace,
) -> dict[str, Any]:
    fixture_dir = output_dir / fixture_id
    fixture_dir.mkdir(parents=True, exist_ok=True)
    mask = binary_mask(mask)
    segments = cv2.HoughLinesP(
        mask,
        args.rho,
        args.theta,
        args.threshold,
        minLineLength=args.min_line_length,
        maxLineGap=args.max_line_gap,
    )
    ordered_segments = [] if segments is None else segments.reshape(-1, 4).astype(int).tolist()
    write_pgm(fixture_dir / "mask.pgm", mask)
    (fixture_dir / "oracle_segments.json").write_text(
        json.dumps(ordered_segments, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"id": fixture_id, "segments": len(ordered_segments)}), flush=True)
    return {
        "id": fixture_id,
        "width": int(mask.shape[1]),
        "height": int(mask.shape[0]),
        "mask_path": f"{fixture_id}/mask.pgm",
        "oracle_segments_path": f"{fixture_id}/oracle_segments.json",
        "oracle_segment_count": len(ordered_segments),
    }


def tiny_fixture_masks() -> list[tuple[str, np.ndarray]]:
    fixtures: list[tuple[str, np.ndarray]] = []

    empty = np.zeros((32, 32), dtype=np.uint8)
    fixtures.append(("tiny_empty", empty))

    single = np.zeros((32, 32), dtype=np.uint8)
    single[16, 16] = 255
    fixtures.append(("tiny_single_point", single))

    short = np.zeros((32, 32), dtype=np.uint8)
    short[16, 12:16] = 255
    fixtures.append(("tiny_short_horizontal", short))

    horizontal = np.zeros((32, 32), dtype=np.uint8)
    horizontal[16, 4:28] = 255
    fixtures.append(("tiny_horizontal", horizontal))

    vertical = np.zeros((32, 32), dtype=np.uint8)
    vertical[4:28, 16] = 255
    fixtures.append(("tiny_vertical", vertical))

    diagonal = np.zeros((32, 32), dtype=np.uint8)
    np.fill_diagonal(diagonal[4:28, 4:28], 255)
    fixtures.append(("tiny_diagonal", diagonal))

    gap_within = np.zeros((32, 32), dtype=np.uint8)
    gap_within[16, 4:14] = 255
    gap_within[16, 16:28] = 255
    fixtures.append(("tiny_gap_within", gap_within))

    gap_beyond = np.zeros((32, 32), dtype=np.uint8)
    gap_beyond[16, 4:12] = 255
    gap_beyond[16, 18:28] = 255
    fixtures.append(("tiny_gap_beyond", gap_beyond))

    crossing = np.zeros((32, 32), dtype=np.uint8)
    for offset in range(4, 28):
        crossing[offset, offset] = 255
        crossing[offset, 31 - offset] = 255
    fixtures.append(("tiny_crossing_diagonals", crossing))

    parallel = np.zeros((32, 32), dtype=np.uint8)
    parallel[10, 4:28] = 255
    parallel[14, 4:28] = 255
    fixtures.append(("tiny_parallel", parallel))

    t_junction = np.zeros((32, 32), dtype=np.uint8)
    t_junction[10, 6:26] = 255
    t_junction[10:26, 16] = 255
    fixtures.append(("tiny_t_junction", t_junction))

    border_touching = np.zeros((32, 32), dtype=np.uint8)
    border_touching[0, 2:30] = 255
    border_touching[2:30, 0] = 255
    fixtures.append(("tiny_border_touching", border_touching))

    noisy = horizontal.copy()
    noisy[5, 5] = 255
    noisy[22, 7] = 255
    noisy[8, 25] = 255
    fixtures.append(("tiny_line_plus_noise", noisy))

    grid = np.zeros((32, 32), dtype=np.uint8)
    for coord in range(4, 29, 6):
        grid[coord, 2:30] = 255
        grid[2:30, coord] = 255
    fixtures.append(("tiny_grid", grid))

    return fixtures


def read_mask(path: Path) -> np.ndarray:
    image = Image.open(path).convert("L")
    return np.array(image, dtype=np.uint8)


def binary_mask(mask: np.ndarray) -> np.ndarray:
    if mask.ndim != 2:
        raise ValueError(f"expected single-channel mask, got shape {mask.shape}")
    return np.where(mask > 0, 255, 0).astype(np.uint8)


def write_pgm(path: Path, mask: np.ndarray) -> None:
    path.write_bytes(
        b"P5\n"
        + f"{mask.shape[1]} {mask.shape[0]}\n255\n".encode("ascii")
        + mask.astype(np.uint8).tobytes()
    )


def build_summary() -> list[str]:
    interesting = []
    for line in cv2.getBuildInformation().splitlines():
        if any(key in line for key in ("OpenCL", "IPP", "CPU/HW", "Parallel framework")):
            interesting.append(line)
    return interesting


if __name__ == "__main__":
    raise SystemExit(main())
