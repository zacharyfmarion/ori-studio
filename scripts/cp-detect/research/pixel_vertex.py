#!/usr/bin/env python3
"""E005: compact stride-one vertex detector trained on generated geometry only.

This is an isolated research trainer, not a promoted product model. RGB patches
are rendered on demand from a provenance-checked synthetic pack. A vertex
heatmap and radius-three nearest-vertex offsets cover interior and border fold
points. Separate crease/AUX centerline logits preserve auxiliary geometry
without assigning it mountain/valley semantics.
"""
import argparse
import gzip
import hashlib
import json
import math
import random
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from scipy.spatial import cKDTree
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader, Dataset

SEED = 91016
RADIUS = 3.0
# Oriedita's DrawingUtil.setColor(CYAN_3) and SvgExporter.determineColor.
# Also include saturated cyan used by other renderers. AUX is never a crease.
AUX_COLORS = ((100, 200, 200), (100, 200, 200), (0, 255, 255), (0, 100, 100))


class Block(nn.Sequential):
    def __init__(self, inputs, outputs):
        super().__init__(nn.Conv2d(inputs, outputs, 3, padding=1, bias=False),
                         nn.BatchNorm2d(outputs), nn.ReLU(),
                         nn.Conv2d(outputs, outputs, 3, padding=1, bias=False),
                         nn.BatchNorm2d(outputs), nn.ReLU())


class PixelVertex(nn.Module):
    def __init__(self, width=16):
        super().__init__()
        self.width = width
        self.enc0 = Block(3, width)
        self.enc1 = Block(width, width * 2)
        self.enc2 = Block(width * 2, width * 4)
        self.enc3 = Block(width * 4, width * 6)
        self.dec2 = Block(width * 10, width * 4)
        self.dec1 = Block(width * 6, width * 2)
        self.dec0 = Block(width * 3, width)
        self.head = nn.Conv2d(width, 5, 1)
        nn.init.constant_(self.head.bias, 0)
        with torch.no_grad():
            self.head.bias[0] = -2.19
            self.head.bias[3] = -2.19
            self.head.bias[4] = -2.19

    def forward(self, image):
        x0 = self.enc0(image)
        x1 = self.enc1(F.avg_pool2d(x0, 2))
        x2 = self.enc2(F.avg_pool2d(x1, 2))
        x3 = self.enc3(F.avg_pool2d(x2, 2))
        x = self.dec2(torch.cat([F.interpolate(x3, size=x2.shape[-2:], mode="nearest"), x2], 1))
        x = self.dec1(torch.cat([F.interpolate(x, size=x1.shape[-2:], mode="nearest"), x1], 1))
        x = self.dec0(torch.cat([F.interpolate(x, size=x0.shape[-2:], mode="nearest"), x0], 1))
        output = self.head(x)
        return torch.cat([output[:, :1], output[:, 1:3].tanh(), output[:, 3:5]], 1)


def load_pack(path, split):
    provenance = json.loads(path.with_suffix(".provenance.json").read_text())
    if provenance["real_patterns_used"] != 0 or hashlib.sha256(path.read_bytes()).hexdigest() != provenance["pack_sha256"]:
        raise ValueError("Invalid synthetic pack provenance")
    rows = []
    with gzip.open(path, "rt") as source:
        for line in source:
            row = json.loads(line)
            if row["split"] != split:
                continue
            row["points"] = np.asarray(row["points"], np.float32)
            row["edges"] = np.asarray(row["edges"], np.int32)
            row["nodes"] = np.asarray(row["nodes"], np.float32)
            row["assignments"] = np.asarray(row["assignments"])
            rows.append(row)
    if not rows:
        raise ValueError(f"No synthetic {split} rows")
    return rows


def draw_auxiliary(canvas, rng, size, ss):
    """Render generated AUX and return its separate positive centerline target."""
    ink = np.zeros(canvas.shape[:2], np.uint8)
    center_ink = np.zeros_like(ink)
    color = np.asarray(AUX_COLORS[int(rng.integers(len(AUX_COLORS)))], float)
    if rng.random() < 0.35:
        color = np.clip(color + rng.normal(0, 9, 3), 0, 255)
    center = rng.uniform(size * 0.1, size * 0.9, 2)
    angle = rng.uniform(0, np.pi)
    axis = np.array([np.cos(angle), np.sin(angle)])
    normal = np.array([-axis[1], axis[0]])
    spacing = rng.uniform(3, 18)
    width = max(1, round(rng.uniform(0.5, 2.5) * ss))
    count = int(rng.integers(4, 32))
    fan = rng.random() < 0.30
    for i in range(-count // 2, count // 2 + 1):
        a = center - axis * size * rng.uniform(0.2, 0.9) + normal * i * spacing
        b = center + axis * size * rng.uniform(0.2, 0.9) + normal * i * spacing
        if fan:
            a = center - axis * size * 0.4
        coords = np.rint((np.stack([a, b]) * ss + (ss - 1) / 2) * 16).astype(np.int32)
        cv2.line(ink, tuple(coords[0]), tuple(coords[1]), 255, width, cv2.LINE_AA, shift=4)
        cv2.line(center_ink, tuple(coords[0]), tuple(coords[1]), 255, ss * 2, cv2.LINE_AA, shift=4)
    alpha = ink[..., None].astype(float) / 255
    canvas[:] = np.rint(canvas * (1 - alpha) + color * alpha).astype(np.uint8)
    return center_ink


def render_patch(row, rng, size, aux_mode=None):
    # Render coordinates directly into a crop: no full-paper raster or source
    # image enters training. Large patterns retain their dense local geometry.
    scale = float(rng.choice([512, 768, 1024, 1536, 2048, 3072]))
    points = row["points"].copy()
    nodes = row["nodes"][:, :2].copy()
    if rng.random() < 0.5:
        points[:, 0] = 1 - points[:, 0]
        nodes[:, 0] = 1 - nodes[:, 0]
    if rng.random() < 0.5:
        points, nodes = points[:, ::-1].copy(), nodes[:, ::-1].copy()
    points *= scale
    nodes *= scale
    if rng.random() < 0.85:
        possible = np.flatnonzero(row["nodes"][:, 2] > 0.5) if rng.random() < 0.30 else np.arange(len(nodes))
        center = nodes[rng.choice(possible)] if len(possible) else rng.uniform(0, scale, 2)
        center = center + rng.uniform(-size * 0.38, size * 0.38, 2)
    else:
        center = rng.uniform(-size * 0.1, scale + size * 0.1, 2)
    origin = center - size / 2
    points -= origin
    nodes -= origin
    selected = np.all((nodes > 5) & (nodes < size - 6), axis=1)
    # Targets cover the whole crop; validation discards the 5-pixel halo only.
    visible = np.all((nodes >= 0) & (nodes < size), axis=1)
    node_points = nodes[visible]
    ss = 2
    dark = rng.random() < 0.20
    background = rng.uniform(15, 65, 3) if dark else rng.uniform(226, 255, 3)
    if rng.random() < 0.7:
        background[:] = background.mean()
    canvas = np.empty((size * ss, size * ss, 3), np.uint8)
    canvas[:] = background.astype(np.uint8)
    crease_ink = np.zeros(canvas.shape[:2], np.uint8)
    aux_ink = np.zeros_like(crease_ink)
    # A separate RNG keeps paired clean/AUX evaluation on identical geometry,
    # crease style and degradation. AUX crossings never become target nodes.
    aux_rng = np.random.default_rng(int(rng.integers(2**32)))
    with_aux = rng.random() < 0.5
    if aux_mode is not None:
        with_aux = aux_mode
    aux_on_top = rng.random() < 0.5
    gray = rng.uniform(180, 245) if dark else rng.uniform(0, 90)
    palette = {"B": np.array([gray, gray, gray]), "U": np.array([gray, gray, gray])}
    monochrome = rng.random() < 0.30
    if monochrome:
        palette.update(M=np.array([gray, gray, gray]), V=np.array([gray, gray, gray]))
    else:
        palette.update(M=np.array([rng.uniform(170, 255), rng.uniform(0, 110), rng.uniform(0, 110)]),
                       V=np.array([rng.uniform(0, 110), rng.uniform(30, 165), rng.uniform(175, 255)]))
        if dark:
            palette["M"] = palette["M"] * 0.75 + 55
            palette["V"] = palette["V"] * 0.75 + 55
    # Editor grids are background guides, distinct from both explicit AUX and
    # actual black/gray creases. Restrict this distractor to colored patterns
    # so identical grayscale strokes are not given contradictory semantics.
    if rng.random() < 0.45 and not monochrome:
        grid = int(rng.uniform(max(background) + 5, 100) if dark
                   else rng.uniform(175, min(background)))
        spacing = float(rng.uniform(8, 64))
        phase = rng.uniform(0, spacing, 2)
        for d in range(2):
            for t in np.arange(phase[d], size, spacing):
                a, b = [0, t], [size, t]
                if d:
                    a, b = a[::-1], b[::-1]
                coords = np.rint((np.array([a, b]) * ss + (ss - 1) / 2) * 16).astype(np.int32)
                cv2.line(canvas, tuple(coords[0]), tuple(coords[1]), (grid, grid, grid),
                         max(1, round(ss * rng.uniform(0.5, 1.5))), cv2.LINE_AA, shift=4)
    if with_aux and not aux_on_top:
        aux_ink = draw_auxiliary(canvas, aux_rng, size, ss)
    width = float(np.exp(rng.uniform(np.log(0.7), np.log(7.0 if rng.random() < 0.3 else 3.8))))
    e = row["edges"]
    segments = points[e]
    # Only segments whose boxes intersect the patch need rasterization.
    include = np.all(segments.max(axis=1) >= -5, axis=1) & np.all(segments.min(axis=1) <= size + 5, axis=1)
    for segment, assignment in zip(segments[include], row["assignments"][include]):
        color = palette.get(assignment, palette["U"])
        weight = width * (rng.uniform(0.8, 1.6) if assignment == "B" else 1)
        # Area downsampling centers output pixel x at high-res 2*x + 0.5.
        # This phase matters for subpixel targets; do not omit the half pixel.
        coords = np.round((segment * ss + (ss - 1) / 2) * 16).astype(np.int32)
        cv2.line(canvas, tuple(coords[0]), tuple(coords[1]), tuple(int(x) for x in color),
                 max(1, round(weight * ss)), cv2.LINE_AA, shift=4)
        # Crease center support is independent of displayed ink thickness.
        # Thick AUX strokes and their intersections remain negative here.
        cv2.line(crease_ink, tuple(coords[0]), tuple(coords[1]), 255, ss * 2,
                 cv2.LINE_AA, shift=4)
    if with_aux and aux_on_top:
        aux_ink = draw_auxiliary(canvas, aux_rng, size, ss)
    image = cv2.resize(canvas, (size, size), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    line_target = np.stack([cv2.resize(ink, (size, size), interpolation=cv2.INTER_AREA)
                            for ink in (crease_ink, aux_ink)]).astype(np.float32) / 255
    if rng.random() < 0.25:
        low = int(rng.integers(size // 2, size))
        image = cv2.resize(cv2.resize(image, (low, low), interpolation=cv2.INTER_AREA),
                           (size, size), interpolation=cv2.INTER_LINEAR)
    if rng.random() < 0.35:
        image = cv2.GaussianBlur(image, (5, 5), rng.uniform(0.15, 1.0))
    if rng.random() < 0.35:
        image = np.clip(image + rng.normal(0, rng.uniform(0.002, 0.012), image.shape), 0, 1).astype(np.float32)
    if rng.random() < 0.25:
        # JPEG creates the cyan/blue mixtures that clean flat colors omit.
        _, encoded = cv2.imencode(".jpg", np.rint(image * 255).astype(np.uint8),
                                 [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(65, 99))])
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR).astype(np.float32) / 255
    if np.median(image.max(axis=2)) < 0.5:
        image = 1 - image.max(axis=2, keepdims=True) - image.min(axis=2, keepdims=True) + image
    heat = np.zeros((size, size), np.float32)
    offsets = np.zeros((2, size, size), np.float32)
    distance = np.full((size, size), np.inf, np.float32)
    for x, y in node_points:
        ix, iy = int(round(float(x))), int(round(float(y)))
        x0, x1 = max(0, ix - 4), min(size, ix + 5)
        y0, y1 = max(0, iy - 4), min(size, iy + 5)
        yy, xx = np.mgrid[y0:y1, x0:x1]
        d2 = (xx - x) ** 2 + (yy - y) ** 2
        heat[y0:y1, x0:x1] = np.maximum(heat[y0:y1, x0:x1], np.exp(-d2 / 2.0))
        if 0 <= ix < size and 0 <= iy < size:
            heat[iy, ix] = 1.0
        nearer = (d2 <= RADIUS ** 2) & (d2 < distance[y0:y1, x0:x1])
        distance[y0:y1, x0:x1][nearer] = d2[nearer]
        offsets[0, y0:y1, x0:x1][nearer] = ((x - xx) / RADIUS)[nearer]
        offsets[1, y0:y1, x0:x1][nearer] = ((y - yy) / RADIUS)[nearer]
    mask = np.isfinite(distance).astype(np.float32)
    return (image.transpose(2, 0, 1).copy(), heat[None], offsets, mask[None],
            line_target, nodes[selected], row["nodes"][selected, 2])


class Patches(Dataset):
    def __init__(self, rows, size, length, seed):
        self.rows, self.size, self.length, self.seed = rows, size, length, seed
        self.families = {}
        for i, row in enumerate(rows):
            self.families.setdefault(row["family"], []).append(i)
        self.family_names = sorted(self.families)

    def __len__(self):
        return self.length

    def sample(self, index, aux_mode=None):
        rng = np.random.default_rng(self.seed + index * 104729)
        family = self.family_names[int(rng.integers(len(self.family_names)))]
        row = self.rows[int(rng.choice(self.families[family]))]
        return render_patch(row, rng, self.size, aux_mode)

    def __getitem__(self, index):
        return tuple(torch.from_numpy(x) for x in self.sample(index)[:5])


def loss_for(output, heat, offset, mask, line_target):
    logits = output[:, :1].float()
    p = logits.sigmoid().clamp(1e-5, 1 - 1e-5)
    positive = heat >= 0.999
    heat_loss = torch.where(positive, -(1 - p) ** 2 * p.log(),
                            -(1 - heat) ** 4 * p ** 2 * (1 - p).log()).sum() / positive.sum().clamp(min=1)
    offset_loss = (F.smooth_l1_loss(output[:, 1:3].float(), offset, reduction="none") * mask).sum() / (2 * mask.sum().clamp(min=1))
    line_logits = output[:, 3:5].float()
    line_prob = line_logits.sigmoid()
    line_bce = (F.binary_cross_entropy_with_logits(line_logits, line_target, reduction="none") * (1 + 3 * line_target)).mean()
    line_dice = 1 - (2 * (line_prob * line_target).sum() + 1) / (line_prob.sum() + line_target.sum() + 1)
    line_loss = line_bce + line_dice
    return heat_loss + 2 * offset_loss + line_loss, heat_loss.detach(), offset_loss.detach(), line_loss.detach()


def decode_points(output, threshold=0.35):
    heat = output[:1].sigmoid()
    peaks = (heat == F.max_pool2d(heat[None], 3, 1, 1)[0]) & (heat >= threshold)
    _, y, x = peaks.nonzero(as_tuple=True)
    points = torch.stack([x, y], 1).float() + output[1:3, y, x].T * RADIUS
    return points.cpu().numpy()


@torch.no_grad()
def validate(model, dataset, device, count, aux_mode=None):
    model.eval()
    matched = predicted = truth = border_matched = border_truth = 0
    line_tp = np.zeros(2, np.int64)
    line_fp = np.zeros(2, np.int64)
    line_fn = np.zeros(2, np.int64)
    aux_pixels = aux_as_crease = 0
    for i in range(count):
        image, _, _, _, lines, nodes, boundary = dataset.sample(i, aux_mode)
        output = model(torch.from_numpy(image[None]).to(device))[0]
        pred_lines = output[3:5].sigmoid().cpu().numpy() >= 0.5
        true_lines = lines >= 0.5
        line_tp += (pred_lines & true_lines).sum(axis=(1, 2))
        line_fp += (pred_lines & ~true_lines).sum(axis=(1, 2))
        line_fn += (~pred_lines & true_lines).sum(axis=(1, 2))
        aux_only = true_lines[1] & (lines[0] < 0.05)
        aux_pixels += int(aux_only.sum())
        aux_as_crease += int((aux_only & pred_lines[0]).sum())
        points = decode_points(output)
        points = points[np.all((points > 5) & (points < dataset.size - 6), axis=1)]
        predicted += len(points)
        truth += len(nodes)
        border_truth += int(boundary.sum())
        if not len(points) or not len(nodes):
            continue
        tree = cKDTree(nodes)
        d, j = tree.query(points, distance_upper_bound=1.5)
        used = set()
        for k in np.argsort(d):
            if not np.isfinite(d[k]) or int(j[k]) in used:
                continue
            used.add(int(j[k]))
            matched += 1
            border_matched += int(boundary[j[k]])
    return {"matched": matched, "predicted": predicted, "truth": truth,
            "precision": matched / max(predicted, 1), "recall": matched / max(truth, 1),
            "f1": 2 * matched / max(predicted + truth, 1),
            "border_recall": border_matched / max(border_truth, 1), "samples": count,
            "line_iou": {name: float(tp / max(tp + fp + fn, 1))
                         for name, tp, fp, fn in zip(("crease", "aux"), line_tp, line_fp, line_fn)},
            "aux_only_pixels": aux_pixels, "aux_as_crease_fraction": aux_as_crease / max(aux_pixels, 1)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=5000)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--size", type=int, default=192)
    parser.add_argument("--width", type=int, default=16)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--eval-every", type=int, default=500)
    parser.add_argument("--val-count", type=int, default=128)
    parser.add_argument("--lr", type=float, default=0.001)
    parser.add_argument("--init", type=Path)
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()
    if (args.out / "config.json").exists():
        raise SystemExit("Refusing to overwrite a run")
    args.out.mkdir(parents=True, exist_ok=True)
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(2)
    cv2.setNumThreads(0)
    device = torch.device(args.device)
    model = PixelVertex(args.width).to(device)
    if args.init:
        initial = torch.load(args.init, map_location="cpu", weights_only=False)
        if initial["config"]["real_training_patterns"] != 0:
            raise ValueError("Refusing initialization without synthetic-only provenance")
        model.load_state_dict(initial["model"])
    config = {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()}
    config.update(seed=args.seed, parameters=sum(p.numel() for p in model.parameters()),
                  torch=torch.__version__, real_training_patterns=0, output_stride=1,
                  offset_radius=RADIUS, train_script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  heads=["vertex_logit", "offset_x", "offset_y", "crease_logit", "aux_logit"],
                  aux_augmentation_probability=0.5, aux_colors=AUX_COLORS,
                  grid_augmentation_probability_for_colored=0.45,
                  dark_background_probability=0.20,
                  dark_normalization="chroma-preserving-image-median",
                  init_sha256=hashlib.sha256(args.init.read_bytes()).hexdigest() if args.init else None,
                  pack_sha256=hashlib.sha256(args.pack.read_bytes()).hexdigest())
    (args.out / "config.json").write_text(json.dumps(config, indent=2))
    print(json.dumps(config), flush=True)
    train = Patches(load_pack(args.pack, "train"), args.size, args.steps * args.batch, args.seed)
    val = Patches(load_pack(args.pack, "val"), args.size, args.val_count, SEED + 2_000_000)
    loader = DataLoader(train, batch_size=args.batch, num_workers=args.workers,
                        pin_memory=device.type == "cuda", persistent_workers=args.workers > 0)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.0001)
    best_f1 = -1
    if args.init:
        metrics = validate(model, val, device, args.val_count)
        best_f1 = metrics["f1"]
        torch.save({"model": model.state_dict(), "config": config, "step": 0, "synthetic_val": metrics}, args.out / "best.pt")
        (args.out / "initial-validation.json").write_text(json.dumps(metrics, indent=2))
        print(json.dumps({"step": 0, "validation": metrics}), flush=True)
    started = time.perf_counter()
    with (args.out / "history.jsonl").open("w") as history:
        for step, batch in enumerate(loader, 1):
            model.train()
            image, heat, offsets, mask, line_target = [x.to(device, non_blocking=True) for x in batch]
            optimizer.zero_grad(set_to_none=True)
            output = model(image)
            loss, heat_loss, offset_loss, line_loss = loss_for(output, heat, offsets, mask, line_target)
            if not torch.isfinite(loss):
                raise RuntimeError("Nonfinite training loss")
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
            lr = args.lr * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * step / args.steps)))
            for group in optimizer.param_groups:
                group["lr"] = lr
            if step == 1 or step % 50 == 0 or step == args.steps:
                record = {"step": step, "loss": float(loss.detach()), "heat_loss": float(heat_loss),
                          "offset_loss": float(offset_loss), "line_loss": float(line_loss), "seconds": time.perf_counter() - started}
                print(json.dumps(record), flush=True)
                history.write(json.dumps(record) + "\n")
                history.flush()
            if step % args.eval_every == 0 or step == args.steps:
                metrics = validate(model, val, device, args.val_count)
                metrics["paired_clean"] = validate(model, val, device, min(64, args.val_count), False)
                metrics["paired_aux"] = validate(model, val, device, min(64, args.val_count), True)
                checkpoint = {"model": model.state_dict(), "config": config, "step": step, "synthetic_val": metrics}
                torch.save(checkpoint, args.out / "latest.pt")
                torch.save(checkpoint, args.out / f"step-{step}.pt")
                if metrics["f1"] > best_f1:
                    best_f1 = metrics["f1"]
                    torch.save(checkpoint, args.out / "best.pt")
                record = {"step": step, "validation": metrics, "seconds": time.perf_counter() - started}
                print(json.dumps(record), flush=True)
                history.write(json.dumps(record) + "\n")
                history.flush()
    (args.out / "complete.json").write_text(json.dumps({"steps": args.steps, "best_synthetic_f1": best_f1,
                                                       "seconds": time.perf_counter() - started}))


if __name__ == "__main__":
    main()
