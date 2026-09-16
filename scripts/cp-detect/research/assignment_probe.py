#!/usr/bin/env python3
"""Source-only, post-selection color sampling. Real truth is scoring-only."""
import argparse
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np

from run_probes import normalized_fold


def assignments(rgb, fold):
    size = rgb.shape[0]
    vertices = np.array(fold['vertices_coords'])[:, :2] * (size - 64) + 32
    result = list(fold['edges_assignment'])
    changes = []
    for i, ((a, b), label) in enumerate(zip(fold['edges_vertices'], result)):
        if label not in ('U', 'M', 'V'):
            continue
        start, end = vertices[[a, b]]
        delta = end - start
        length = np.linalg.norm(delta)
        if length < 1:
            continue
        normal = np.array([-delta[1], delta[0]]) / length
        trim = min(0.3, 3 / length)
        t = np.linspace(trim, 1 - trim, max(3, int(length * (1 - 2 * trim)) + 1))
        offsets = np.arange(-2, 2.01, 0.5)
        points = start + t[:, None, None] * delta + offsets[None, :, None] * normal
        xy = np.clip(np.rint(points).astype(int), 0, size - 1)
        colors = rgb[xy[:, :, 1], xy[:, :, 0]].astype(float)
        r, g, b = colors.transpose(2, 0, 1)
        chroma = r - b
        cyan = (np.minimum(g - r, b - r) > 12) & (np.abs(g - b) <= 12 + 0.25 * np.minimum(g - r, b - r))
        chroma[cyan] = 0
        merit = np.abs(chroma) / (1 + offsets ** 2)
        chosen = chroma[np.arange(len(t)), np.argmax(merit, axis=1)]
        colored = np.abs(chosen) > 12
        if colored.mean() < 0.5:
            continue
        signed = np.clip(chosen, -128, 128)
        confidence = abs(signed.sum()) / max(abs(signed).sum(), 1)
        if confidence < 0.6:
            continue
        new = 'M' if signed.sum() > 0 else 'V'
        if new != label:
            changes.append([i, label, new, float(confidence)])
            result[i] = new
    return result, changes


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--corpus', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    runs = json.loads((a.corpus / 'runs.json').read_text())
    pairs, records = [], []
    for run in runs:
        if not run.get('prediction') or not run.get('score'):
            continue
        source = Path(run['prediction'])
        fold = json.loads(source.read_text())
        rgb = cv2.cvtColor(cv2.imread(str(source.parent / 'rectified.png')), cv2.COLOR_BGR2RGB)
        fold['edges_assignment'], changes = assignments(rgb, fold)
        dest = a.out / (run['key'].replace('/', '__') + '.fold')
        dest.write_text(json.dumps(fold))
        normal = dest.with_suffix('.normalized.fold')
        normal.write_text(json.dumps(normalized_fold(dest)))
        pairs.append(f'{normal}\t{source.parent.parent / "truth.normalized.fold"}')
        records.append({'key': run['key'], 'changes': changes, 'before': run['score']['assignments']})
    (a.out / 'pairs.tsv').write_text('\n'.join(pairs) + '\n')
    score = subprocess.run(['target/release/examples/strict_diff', str(a.out / 'pairs.tsv'), '4'], check=True, text=True, capture_output=True)
    (a.out / 'raw.jsonl').write_text(score.stdout)
    for record, line in zip(records, score.stdout.splitlines(), strict=True):
        record['after'] = json.loads(line)['metrics']
    (a.out / 'runs.json').write_text(json.dumps(records, indent=2))
    print(json.dumps({'before_wrong': sum(r['before']['wrong_edges'] for r in records),
                      'after_wrong': sum(r['after']['assignments']['wrong_edges'] for r in records),
                      'exact_assignment': sum(r['after']['exact_topology_and_assignment'] for r in records),
                      'changes': sum(len(r['changes']) for r in records)}))


if __name__ == '__main__':
    main()
