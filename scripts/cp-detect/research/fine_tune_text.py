#!/usr/bin/env python3
"""E023: synthetic text distractors, with paired clean/annotated validation.

Imports the unchanged E013 model/renderer. No real image, text, geometry, or
benchmark file enters this trainer. Checkpoint selection uses generated
validation only, subject to clean-geometry and AUX retention floors.
"""
import argparse
import hashlib
import json
import math
import random
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.utils.data import DataLoader

import pixel_vertex as base


class TextPatches(base.Patches):
    def __init__(self, rows, size, length, seed, probability):
        super().__init__(rows, size, length, seed)
        self.probability = probability

    def sample(self, index, aux_mode=None):
        value = list(super().sample(index, aux_mode))
        rng = np.random.default_rng(self.seed + 7_000_003 + index * 65537)
        if rng.random() >= self.probability:
            return tuple(value)
        image = np.rint(value[0].transpose(1, 2, 0) * 255).astype(np.uint8).copy()
        layer = image.copy()
        alphabet = np.array(list('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -'))
        for _ in range(int(rng.integers(1, 4))):
            text = ''.join(rng.choice(alphabet, size=int(rng.integers(4, 25))))
            font = int(rng.choice([cv2.FONT_HERSHEY_SIMPLEX, cv2.FONT_HERSHEY_DUPLEX,
                                   cv2.FONT_HERSHEY_COMPLEX, cv2.FONT_HERSHEY_TRIPLEX]))
            if rng.random() < .2:
                font |= cv2.FONT_ITALIC
            scale = float(rng.uniform(.3, 1.5) * self.size / 192)
            position = (int(rng.integers(-self.size // 2, self.size - 10)),
                        int(rng.integers(10, self.size + 20)))
            gray = int(rng.integers(0, 190))
            color = (gray, gray, gray)
            if rng.random() < .15:
                color = (220, 30, 40) if rng.random() < .5 else (30, 50, 220)
            cv2.putText(layer, text, position, font, scale, color,
                        int(rng.choice([1, 1, 2])), cv2.LINE_AA)
        alpha = float(rng.uniform(.35, 1))
        image = (image.astype(np.float32) * (1 - alpha) + layer.astype(np.float32) * alpha) / 255
        value[0] = image.transpose(2, 0, 1).copy()
        return tuple(value)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pack', type=Path, required=True)
    p.add_argument('--init', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--steps', type=int, default=3000)
    p.add_argument('--batch', type=int, default=16)
    p.add_argument('--device', default='mps')
    p.add_argument('--workers', type=int, default=4)
    p.add_argument('--eval-every', type=int, default=500)
    p.add_argument('--val-count', type=int, default=128)
    p.add_argument('--lr', type=float, default=.0001)
    p.add_argument('--seed', type=int, default=591016)
    p.add_argument('--clean-f1-floor', type=float)
    p.add_argument('--text-probability', type=float, default=.4)
    args = p.parse_args()
    if not 0 <= args.text_probability <= 1:
        p.error('text-probability must lie in [0, 1]')
    if (args.out / 'config.json').exists():
        raise ValueError('Refusing to overwrite a training run')
    args.out.mkdir(parents=True, exist_ok=True)
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    torch.set_num_threads(2); cv2.setNumThreads(0)
    initial = torch.load(args.init, map_location='cpu', weights_only=False)
    if initial['config']['real_training_patterns'] != 0:
        raise ValueError('Synthetic-only initialization required')
    device = torch.device(args.device)
    model = base.PixelVertex(initial['config']['width']).to(device)
    model.load_state_dict(initial['model'])
    train_rows = base.load_pack(args.pack, 'train'); val_rows = base.load_pack(args.pack, 'val')
    train = TextPatches(train_rows, 192, args.steps * args.batch, args.seed, args.text_probability)
    clean = base.Patches(val_rows, 192, args.val_count, base.SEED + 2_000_000)
    annotated = TextPatches(val_rows, 192, args.val_count, base.SEED + 2_000_000, 1.)
    config = {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()}
    config.update(width=initial['config']['width'], real_training_patterns=0,
                  augmentation='random-ascii-hershey-text-v1', probability=args.text_probability,
                  selection='highest annotated F1, specified clean F1 floor or initial minus .005, AUX IoU floor initial minus .02',
                  init_sha256=hashlib.sha256(args.init.read_bytes()).hexdigest(),
                  pack_sha256=hashlib.sha256(args.pack.read_bytes()).hexdigest(),
                  train_script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  base_script_sha256=hashlib.sha256(Path(base.__file__).read_bytes()).hexdigest(),
                  torch=torch.__version__)
    (args.out / 'config.json').write_text(json.dumps(config, indent=2))
    for index in range(8):
        sample = train.sample(index)[0].transpose(1, 2, 0)
        cv2.imwrite(str(args.out / f'synthetic-sample-{index}.png'),
                    cv2.cvtColor(np.rint(sample * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
    started = time.perf_counter()
    clean_initial = base.validate(model, clean, device, args.val_count)
    text_initial = base.validate(model, annotated, device, args.val_count)
    clean_floor = args.clean_f1_floor if args.clean_f1_floor is not None else clean_initial['f1'] - .005
    initial_eligible = clean_initial['f1'] >= clean_floor
    best = text_initial['f1'] if initial_eligible else -math.inf
    metrics = {'clean': clean_initial, 'annotated': text_initial}
    (args.out / 'initial-validation.json').write_text(json.dumps(metrics, indent=2))
    if initial_eligible:
        torch.save({'model': model.state_dict(), 'config': config, 'step': 0,
                    'synthetic_val': clean_initial, 'paired_text_val': metrics}, args.out / 'best.pt')
    print(json.dumps({'step': 0, 'validation': metrics, 'eligible': initial_eligible}), flush=True)
    loader = DataLoader(train, batch_size=args.batch, num_workers=args.workers,
                        persistent_workers=args.workers > 0, pin_memory=device.type == 'cuda')
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=.0001)
    with (args.out / 'history.jsonl').open('w') as history:
        for step, batch in enumerate(loader, 1):
            model.train()
            image, heat, offsets, mask, line_target = [v.to(device) for v in batch]
            optimizer.zero_grad(set_to_none=True)
            loss, *parts = base.loss_for(model(image), heat, offsets, mask, line_target)
            if not torch.isfinite(loss):
                raise ValueError('Nonfinite training loss')
            loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 5.); optimizer.step()
            for group in optimizer.param_groups:
                group['lr'] = args.lr * (.1 + .9 * .5 * (1 + math.cos(math.pi * step / args.steps)))
            if step % 50 == 0:
                record = {'step': step, 'loss': float(loss.detach()), 'seconds': time.perf_counter() - started}
                history.write(json.dumps(record) + '\n'); history.flush(); print(json.dumps(record), flush=True)
            if step % args.eval_every == 0 or step == args.steps:
                clean_score = base.validate(model, clean, device, args.val_count)
                text_score = base.validate(model, annotated, device, args.val_count)
                eligible = (clean_score['f1'] >= clean_floor and
                            clean_score['line_iou']['aux'] >= clean_initial['line_iou']['aux'] - .02)
                selected = eligible and text_score['f1'] > best
                metrics = {'clean': clean_score, 'annotated': text_score}
                checkpoint = {'model': model.state_dict(), 'config': config, 'step': step,
                              'synthetic_val': clean_score, 'paired_text_val': metrics}
                torch.save(checkpoint, args.out / f'step-{step}.pt')
                if selected:
                    best = text_score['f1']; torch.save(checkpoint, args.out / 'best.pt')
                record = {'step': step, 'validation': metrics, 'eligible': eligible,
                          'selected': selected, 'seconds': time.perf_counter() - started}
                history.write(json.dumps(record) + '\n'); history.flush(); print(json.dumps(record), flush=True)
    (args.out / 'complete.json').write_text(json.dumps({'steps': args.steps,
        'best_annotated_f1': best if math.isfinite(best) else None,
        'seconds': time.perf_counter() - started}))


if __name__ == '__main__':
    main()
