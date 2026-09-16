#!/usr/bin/env python3
"""Source-only resolution ablation on declared development cases (E022).

Uses the selected synthetic checkpoint unchanged. All predictions are written
before strict scoring reads truth. Never chooses resolution using truth size.
"""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np
import torch

from pixel_vertex import PixelVertex
from pixel_vertex_infer import infer_image, primitives
from run_probes import normalized_fold


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--keys', nargs='+', required=True)
    parser.add_argument('--sizes', type=int, nargs='+', default=[3072, 4096])
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    by_key = {r['key']: r for r in json.loads(args.inventory.read_text())['cases']}
    rows = [by_key[k] for k in args.keys]
    if any(r['split'] != 'development' for r in rows):
        raise ValueError('Resolution exploration refuses holdout cases')
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=False)
    if checkpoint['config']['real_training_patterns'] != 0:
        raise ValueError('Expected synthetic-only checkpoint')
    model = PixelVertex(checkpoint['config']['width']).eval().to('mps')
    model.load_state_dict(checkpoint['model'])
    torch.set_num_threads(2)
    cv2.setNumThreads(1)
    args.out.mkdir(parents=True, exist_ok=True)
    config = {'checkpoint_sha256': hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
              'keys': args.keys, 'sizes': args.sizes, 'threshold': 0.35,
              'decode_timeout': 60, 'selection': 'development-only before inference'}
    config_path = args.out / 'config.json'
    if config_path.exists() and json.loads(config_path.read_text()) != config:
        raise ValueError('Refusing to mix protocols')
    config_path.write_text(json.dumps(config, indent=2))
    records, pairs, indices = [], [], []
    for row in rows:
        source = Path(row['source'])
        if hashlib.sha256(source.read_bytes()).hexdigest() != row['source_sha256']:
            raise ValueError('Frozen source changed')
        for size in args.sizes:
            case = args.out / row['key'].replace('/', '__') / str(size)
            case.mkdir(parents=True, exist_ok=True)
            done = case / 'complete.json'
            if done.exists():
                records.append(json.loads(done.read_text()))
                continue
            start = time.perf_counter()
            with (case / 'rectify.log').open('w') as log:
                subprocess.run(['target/release/examples/recognition_probe', str(source),
                                str(case), str(size), 'rectify-only'],
                               stdout=log, stderr=log, timeout=30, check=True)
            image = cv2.cvtColor(cv2.imread(str(case / 'rectified.png')), cv2.COLOR_BGR2RGB)
            inference = time.perf_counter()
            points, lines = infer_image(model, image.astype(np.float32) / 255, 'mps')
            inference = time.perf_counter() - inference
            vertices = primitives(points, size)
            vertex_file = case / 'vertices.json'
            vertex_file.write_text(json.dumps(vertices))
            crease_file = case / 'crease.f32'
            lines[0].astype('<f4').tofile(crease_file)
            record = {'key': row['key'], 'size': size, 'vertices': len(vertices),
                      'inference_seconds': inference}
            command = ['target/release/examples/recognition_probe', str(source), str(case),
                       str(size), str(case / '.unused'), str(vertex_file), str(crease_file),
                       'pixel-direct']
            try:
                with (case / 'decode.log').open('w') as log:
                    result = subprocess.run(command, stdout=log, stderr=log, timeout=60)
                record['exit_code'] = result.returncode
            except subprocess.TimeoutExpired:
                record['timeout'] = True
            crease_file.unlink()
            fold = case / 'recognized.fold'
            if fold.exists():
                record['prediction'] = str(fold)
                record['decode_seconds'] = json.loads((case / 'result.json').read_text())['decode_seconds']
            record['total_seconds'] = time.perf_counter() - start
            done.write_text(json.dumps(record, indent=2))
            records.append(record)
            print(json.dumps(record), flush=True)
    # Only now read truth, after every source-only prediction has finished.
    for index, record in enumerate(records):
        row = by_key[record['key']]
        if not record.get('prediction') or not row['topology_sha256']:
            continue
        truth = Path(row['source']).parent / 'topology.fold'
        if hashlib.sha256(truth.read_bytes()).hexdigest() != row['topology_sha256']:
            raise ValueError('Frozen truth changed')
        case = Path(record['prediction']).parent
        pred = case / 'normalized.fold'; target = case / 'truth.normalized.fold'
        pred.write_text(json.dumps(normalized_fold(Path(record['prediction']))))
        target.write_text(json.dumps(normalized_fold(truth)))
        pairs.append(f'{pred}\t{target}'); indices.append(index)
    pair_file = args.out / 'pairs.tsv'; pair_file.write_text('\n'.join(pairs) + '\n')
    result = subprocess.run(['target/release/examples/strict_diff', str(pair_file), '4'],
                            capture_output=True, text=True, check=True)
    for index, text in zip(indices, result.stdout.splitlines(), strict=True):
        records[index]['score'] = json.loads(text)['metrics']
    (args.out / 'runs.json').write_text(json.dumps(records, indent=2))
    for record in records:
        print(json.dumps({k: v for k, v in record.items() if k != 'score'} |
                         {'edges': record.get('score', {}).get('edges')}), flush=True)


if __name__ == '__main__':
    main()
