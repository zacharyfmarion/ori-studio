#!/usr/bin/env python3
"""Assemble the labelled image set for the crease-pattern likelihood gate.

Writes a JSONL manifest of ``{"label": "pos"|"neg"|"amb", "group": ..., "path": ...}``
rows that ``cargo run --example cp_likelihood_features`` turns into features and
``fit-model.py`` fits on. Nothing here is copied: rows point at the files where
they live.

Sources, all outside the repo (see ``README.md`` → "Crease-pattern likelihood
gate"):

- positives — the designer sets under ``<datasets>/real/*``, the curated cases
  under ``<datasets>/real_benchmark/curated/*/source.*``, the rendered corpus
  under ``<datasets>/real_benchmark/cpoogle``, and every scraped crop the
  scrape pipeline's Gemini pass accepted;
- negatives — every crop that pass rejected, grouped by its label (photos of
  folded models, multi-panel pages, diagrams, hand-drawn, text, blank), plus
  optional natural photographs (``--photo-dir``, repeatable);
- ambiguous — the app's own landing screenshots, reported but never trained on.

The Gemini labels are noisy: a "multi-panel" or "blank" reject often contains a
real crease pattern. Judge false positives by eye before believing a rate.
"""
from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import sys

IMAGE_EXT = ('.png', '.jpg', '.jpeg', '.webp')


def image_files(root: str) -> list[str]:
    return sorted(
        p for p in glob.glob(os.path.join(root, '**', '*'), recursive=True)
        if p.lower().endswith(IMAGE_EXT)
    )


def gemini_group(label: str | None) -> str:
    lab = (label or 'other').lower()
    if 'photo' in lab or lab in ('folded-model', 'finished model'):
        return 'neg_folded_model'
    if 'multi' in lab:
        return 'neg_multi_panel'
    if 'diagram' in lab:
        return 'neg_diagram'
    if 'hand' in lab:
        return 'neg_hand_drawn'
    if lab in ('text', 'blank'):
        return f'neg_{lab}'
    return 'neg_other'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--datasets', default=os.path.expanduser('~/Documents/datasets/create-pattern-detector'),
                        help='create-pattern-detector dataset root')
    parser.add_argument('--ml-repo', default=os.path.expanduser('~/Documents/code/create-pattern-detector'),
                        help='create-pattern-detector repo root (scraped crop paths are relative to it)')
    parser.add_argument('--photo-dir', action='append', default=[],
                        help='directory of natural photographs to add as negatives (repeatable)')
    parser.add_argument('--screenshot-dir', action='append', default=[],
                        help='directory of app screenshots to add as ambiguous rows (repeatable)')
    parser.add_argument('--out', required=True, help='manifest JSONL to write')
    args = parser.parse_args()

    rows: list[dict] = []

    def add(label: str, group: str, path: str) -> None:
        rows.append({'label': label, 'group': group, 'path': os.path.abspath(path)})

    real = os.path.join(args.datasets, 'real')
    for d in sorted(glob.glob(os.path.join(real, '*'))):
        if not os.path.isdir(d):
            continue
        for p in image_files(d):
            if 'render' in os.path.basename(p).lower():
                continue
            add('pos', f'real/{os.path.basename(d)}', p)
    for p in sorted(glob.glob(os.path.join(args.datasets, 'real_benchmark', 'curated', '*', 'source.*'))):
        if p.lower().endswith(IMAGE_EXT):
            add('pos', 'curated', p)
    for p in image_files(os.path.join(args.datasets, 'real_benchmark', 'cpoogle')):
        add('pos', 'cpoogle_render', p)

    crops: dict[str, dict] = {}
    for f in sorted(glob.glob(os.path.join(args.datasets, 'scraped', 'manifests', '*.jsonl'))):
        with open(f) as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                gemini = row.get('gemini')
                if isinstance(gemini, dict) and gemini.get('is_crease_pattern') in (True, False):
                    crops[row['crop_path']] = row  # later manifests override earlier ones
    missing = 0
    for crop_path, row in crops.items():
        p = os.path.join(args.ml_repo, crop_path)
        if not os.path.exists(p):
            missing += 1
            continue
        gemini = row['gemini']
        if gemini['is_crease_pattern']:
            add('pos', 'scraped_accepted', p)
        else:
            add('neg', gemini_group(gemini.get('label')), p)
    if missing:
        print(f'note: {missing} classified crops are not on disk under {args.ml_repo}', file=sys.stderr)

    for d in args.photo_dir:
        for p in image_files(d):
            add('neg', 'neg_photo', p)
    for d in args.screenshot_dir:
        for p in image_files(d):
            add('amb', 'app_screenshot', p)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or '.', exist_ok=True)
    with open(args.out, 'w') as out:
        for row in rows:
            out.write(json.dumps(row) + '\n')
    counts = collections.Counter((r['label'], r['group']) for r in rows)
    for (label, group), n in sorted(counts.items()):
        print(f'{n:6d}  {label:3s}  {group}')
    print(f'{len(rows)} rows -> {args.out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
