#!/usr/bin/env python3
"""Source-only E005 inference on an already rectified image; never reads truth.

Outputs RefinedVertexPrimitive JSON accepted by recognition_probe. Tiling uses
fixed 512-pixel inputs and a 64-pixel context halo, suitable for a static ONNX
browser model. Output ownership is disjoint; halo predictions are discarded.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.nn import functional as F

from pixel_vertex import PixelVertex, RADIUS


@torch.no_grad()
def infer_image(model, image, device, threshold=0.35, tile=512, halo=64):
    # Invert background brightness while preserving chroma direction: red
    # stays red, blue stays blue, cyan stays cyan. A full RGB inversion would
    # swap these semantic colors. The rule is source-only and image-global.
    if np.median(image.max(axis=2)) < 0.5:
        image = 1 - image.max(axis=2, keepdims=True) - image.min(axis=2, keepdims=True) + image
    h, w = image.shape[:2]
    stride = tile - 2 * halo
    pad_y = (stride - h % stride) % stride
    pad_x = (stride - w % stride) % stride
    padded = np.pad(image, ((halo, halo + pad_y), (halo, halo + pad_x), (0, 0)),
                    mode="constant", constant_values=1)
    vertices = []
    dense_lines = np.zeros((2, h, w), np.float32)
    for y0 in range(0, h, stride):
        for x0 in range(0, w, stride):
            patch = padded[y0:y0 + tile, x0:x0 + tile]
            inputs = torch.from_numpy(patch.transpose(2, 0, 1).copy()[None]).to(device)
            output = model(inputs)[0]
            crop_h, crop_w = min(stride, h - y0), min(stride, w - x0)
            dense_lines[:, y0:y0+crop_h, x0:x0+crop_w] = (
                output[3:5, halo:halo+crop_h, halo:halo+crop_w].sigmoid().cpu().numpy())
            heat = output[:1].sigmoid()
            peaks = (heat == F.max_pool2d(heat[None], 3, 1, 1)[0]) & (heat >= threshold)
            _, yy, xx = peaks.nonzero(as_tuple=True)
            local_points = torch.stack([xx, yy], 1).float() + output[1:3, yy, xx].T * RADIUS
            scores = heat[0, yy, xx].cpu().numpy()
            local_points = local_points.cpu().numpy()
            for (x, y), score in zip(local_points, scores):
                # Ownership is decided after offsets, so all subpixel points
                # have exactly one tile even immediately across a crop seam.
                if not (halo <= x < halo + stride and halo <= y < halo + stride):
                    continue
                x, y = float(x + x0 - halo), float(y + y0 - halo)
                if not (0 <= x < w and 0 <= y < h):
                    continue
                vertices.append((x, y, float(score)))
    # Rare seam disagreement can put two offset estimates either side of the
    # ownership boundary. Keep the stronger within 1 pixel, not a large radius
    # that would merge legitimate crowded junctions.
    unique = []
    for x, y, score in sorted(vertices, key=lambda v: -v[2]):
        if any((x - u) ** 2 + (y - v) ** 2 < 1 for u, v, _ in unique):
            continue
        unique.append((x, y, score))
    return unique, dense_lines


def primitives(points, size, inset=32):
    output = []
    end = size - inset
    for x, y, score in points:
        if not (inset - 4 <= x <= end + 4 and inset - 4 <= y <= end + 4):
            continue
        sides = [(abs(y - inset), "top"), (abs(x - end), "right"),
                 (abs(y - end), "bottom"), (abs(x - inset), "left")]
        sides.sort()
        if sides[1][0] <= 4:
            # Paper corners are supplied exactly by the downstream decoder.
            continue
        r = {"x": x, "y": y, "score": score, "kind": "interior_junction"}
        if sides[0][0] <= 4:
            side = sides[0][1]
            r.update(kind="boundary_contact", boundary_side=side)
            if side in {"top", "bottom"}:
                r["y"] = float(inset if side == "top" else end)
                r["side_coordinate"] = (x - inset) / (size - 2 * inset)
            else:
                r["x"] = float(inset if side == "left" else end)
                r["side_coordinate"] = (y - inset) / (size - 2 * inset)
        output.append(r)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--threshold", type=float, default=0.35)
    parser.add_argument("--export", type=Path)
    args = parser.parse_args()
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    if checkpoint["config"]["real_training_patterns"] != 0:
        raise ValueError("Expected the synthetic-only E005 checkpoint")
    model = PixelVertex(checkpoint["config"]["width"])
    model.load_state_dict(checkpoint["model"])
    model.eval()
    if args.export:
        args.export.parent.mkdir(parents=True, exist_ok=True)
        torch.onnx.export(model, torch.zeros(1, 3, 512, 512), args.export,
                          input_names=["image"], output_names=["vertices"],
                          opset_version=17, dynamo=False)
    device = torch.device(args.device)
    model.to(device)
    raw = cv2.imread(str(args.image))
    if raw is None or raw.shape[0] != raw.shape[1]:
        raise ValueError("Expected a square rectified source image")
    image = cv2.cvtColor(raw, cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    start = time.perf_counter()
    points, dense_lines = infer_image(model, image, device, args.threshold)
    result = primitives(points, len(image))
    elapsed = time.perf_counter() - start
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result))
    for name, values in zip(("crease", "aux"), dense_lines):
        values.astype("<f4").tofile(args.out.with_suffix(f".{name}.f32"))
        cv2.imwrite(str(args.out.with_suffix(f".{name}.png")), np.rint(values * 255).astype(np.uint8))
    record = {"checkpoint_sha256": hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
              "image_sha256": hashlib.sha256(args.image.read_bytes()).hexdigest(),
              "threshold": args.threshold, "size": len(image), "device": str(device),
              "raw_vertices": len(points), "primitives": len(result), "seconds": elapsed,
              "synthetic_validation": checkpoint["synthetic_val"]}
    args.out.with_suffix(".report.json").write_text(json.dumps(record, indent=2))
    print(json.dumps(record))


if __name__ == "__main__":
    main()
