#!/usr/bin/env python3
"""Development-only peak-threshold ablation with fixed synthetic weights.

Reuse the selected source-only rectification/resolution. Infer once at the
lowest threshold and filter predictions before decoding. Truth is opened only
after every prediction exists; no failed case is omitted from scoring.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

import cv2
import numpy as np
import torch

from pixel_vertex import PixelVertex
from pixel_vertex_infer import infer_image, primitives
from run_probes import normalized_fold


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory', type=Path, required=True)
    p.add_argument('--recognition', type=Path, required=True)
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--keys', nargs='+', required=True)
    p.add_argument('--thresholds', type=float, nargs='+', default=[.1, .2, .35, .5])
    a = p.parse_args()
    inventory = {r['key']: r for r in json.loads(a.inventory.read_text())['cases']}
    previous = {r['key']: r for r in json.loads((a.recognition / 'runs.json').read_text())}
    if any(inventory[k]['split'] != 'development' for k in a.keys):
        raise ValueError('This exploration refuses holdout cases')
    if (a.out / 'config.json').exists():
        raise ValueError('Refusing to overwrite an experiment')
    a.out.mkdir(parents=True, exist_ok=True)
    checkpoint = torch.load(a.checkpoint, map_location='cpu', weights_only=False)
    if checkpoint['config']['real_training_patterns'] != 0:
        raise ValueError('Synthetic-only checkpoint required')
    model = PixelVertex(checkpoint['config']['width']).eval().to('mps')
    model.load_state_dict(checkpoint['model'])
    torch.set_num_threads(2); cv2.setNumThreads(1)
    config = {k: str(v) if isinstance(v, Path) else v for k, v in vars(a).items()}
    config.update(checkpoint_sha256=hashlib.sha256(a.checkpoint.read_bytes()).hexdigest(),
                  inventory_sha256=hashlib.sha256(a.inventory.read_bytes()).hexdigest(),
                  script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    (a.out / 'config.json').write_text(json.dumps(config, indent=2))
    records = []
    for key in a.keys:
        row = inventory[key]; source = Path(row['source'])
        if hashlib.sha256(source.read_bytes()).hexdigest() != row['source_sha256']:
            raise ValueError('Frozen source changed')
        base = Path(previous[key]['prediction']).parent
        image = cv2.cvtColor(cv2.imread(str(base / 'rectified.png')), cv2.COLOR_BGR2RGB)
        size = image.shape[0]
        points, lines = infer_image(model, image.astype(np.float32) / 255, 'mps', min(a.thresholds))
        case = a.out / key.replace('/', '__'); case.mkdir()
        crease = case / 'crease.f32'; lines[0].astype('<f4').tofile(crease)
        (case / 'all-peaks.json').write_text(json.dumps(points))
        for threshold in a.thresholds:
            out = case / str(threshold); out.mkdir()
            vertices = primitives([v for v in points if v[2] >= threshold], size)
            vertex_file = out / 'vertices.json'; vertex_file.write_text(json.dumps(vertices))
            record = {'key': key, 'threshold': threshold, 'vertices': len(vertices), 'size': size,
                      'out': str(out)}
            start = time.perf_counter()
            try:
                with (out / 'decode.log').open('w') as log:
                    subprocess.run(['target/release/examples/recognition_probe', str(source), str(out),
                                    str(size), str(out / '.unused'), str(vertex_file), str(crease),
                                    'pixel-direct'], stdout=log, stderr=log, timeout=60, check=True)
                record['prediction'] = str(out / 'recognized.fold')
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
                record['error'] = type(error).__name__
            record['decode_seconds'] = time.perf_counter() - start
            records.append(record); print(json.dumps(record), flush=True)
        crease.unlink()
    pairs = []
    for record in records:
        row = inventory[record['key']]; out = Path(record['out'])
        truth = Path(row['source']).parent / 'topology.fold'
        if hashlib.sha256(truth.read_bytes()).hexdigest() != row['topology_sha256']:
            raise ValueError('Frozen truth changed')
        pred = normalized_fold(Path(record['prediction'])) if record.get('prediction') else {
            'vertices_coords': [], 'edges_vertices': [], 'edges_assignment': []}
        (out / 'prediction.normalized.fold').write_text(json.dumps(pred))
        (out / 'truth.normalized.fold').write_text(json.dumps(normalized_fold(truth)))
        pairs.append(f'{out}/prediction.normalized.fold\t{out}/truth.normalized.fold')
    pair_file = a.out / 'pairs.tsv'; pair_file.write_text('\n'.join(pairs) + '\n')
    result = subprocess.run(['target/release/examples/strict_diff', str(pair_file), '4'],
                            capture_output=True, text=True, check=True)
    for record, line in zip(records, result.stdout.splitlines(), strict=True):
        record['score'] = json.loads(line)['metrics']
    (a.out / 'runs.json').write_text(json.dumps(records, indent=2))
    print(json.dumps([{k: r[k] for k in ['key', 'threshold']} | {'edges': r['score']['edges']}
                      for r in records]), flush=True)


if __name__ == '__main__':
    main()
