#!/usr/bin/env python3
"""E021 DIAGNOSTIC ONLY: attribute errors using explicit truth substitutions.

These are oracle ablations, never candidate predictions or training examples.
Only development cases with square paper are supported. Frozen source-only
recognition is the comparison; truth vertices/evidence reveal decoder ceilings.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np
import torch
from scipy.spatial import cKDTree

from pixel_vertex import PixelVertex
from pixel_vertex_infer import infer_image
from run_probes import normalized_fold


def ideal_vertices(fold, size):
    points = np.asarray(fold['vertices_coords'], np.float64) / 1024
    output = []
    for x, y in points:
        sides = [(abs(y), 'top'), (abs(x - 1), 'right'),
                 (abs(y - 1), 'bottom'), (abs(x), 'left')]
        sides.sort()
        if sides[1][0] < 1e-7:
            continue
        vertex = {'x': float(32 + x * (size - 64)),
                  'y': float(32 + y * (size - 64)),
                  'score': 1., 'kind': 'interior_junction'}
        if sides[0][0] < 1e-7:
            side = sides[0][1]
            vertex.update(kind='boundary_contact', boundary_side=side,
                          side_coordinate=float(x if side in {'top', 'bottom'} else y))
        output.append(vertex)
    return output


def ideal_lines(fold, size):
    points = np.asarray(fold['vertices_coords']) / 1024 * (size - 64) + 32
    ink = np.zeros((size, size), np.uint8)
    for a, b in fold['edges_vertices']:
        xy = np.rint(points[[a, b]] * 256).astype(np.int32)
        cv2.line(ink, tuple(xy[0]), tuple(xy[1]), 255, 2, cv2.LINE_AA, shift=8)
    return ink.astype(np.float32) / 255


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--corpus', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--keys', nargs='+', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    inventory = {r['key']: r for r in json.loads(args.inventory.read_text())['cases']}
    rows = [inventory[k] for k in args.keys]
    if any(r['split'] != 'development' or not r['key'].startswith('cpoogle/') for r in rows):
        raise ValueError('Oracle exploration requires rendered development cases')
    runs = {r['key']: r for r in json.loads((args.corpus / 'runs.json').read_text())}
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=False)
    if checkpoint['config']['real_training_patterns'] != 0:
        raise ValueError('Expected synthetic-only checkpoint')
    model = PixelVertex(checkpoint['config']['width']).eval().to('mps')
    model.load_state_dict(checkpoint['model'])
    torch.set_num_threads(2)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'config.json').write_text(json.dumps({
        'diagnostic_only': True, 'truth_substitution': True,
        'checkpoint_sha256': hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
        'keys': args.keys}, indent=2))
    records, pairs = [], []
    for row in rows:
        source = Path(row['source'])
        if hashlib.sha256(source.read_bytes()).hexdigest() != row['source_sha256']:
            raise ValueError('Frozen source changed')
        baseline = runs[row['key']]
        root = Path(baseline['prediction']).parent
        size = baseline['size']
        image = cv2.cvtColor(cv2.imread(str(root / 'rectified.png')), cv2.COLOR_BGR2RGB)
        _, line = infer_image(model, image.astype(np.float32) / 255, 'mps')
        truth_path = source.parent / 'topology.fold'
        if hashlib.sha256(truth_path.read_bytes()).hexdigest() != row['topology_sha256']:
            raise ValueError('Frozen truth changed')
        truth = normalized_fold(truth_path)
        truth_vertices = ideal_vertices(truth, size)
        case = args.out / row['key'].replace('/', '__')
        case.mkdir(exist_ok=True)
        truth_file = case / 'truth.fold'
        truth_file.write_text(json.dumps(truth))
        learned_vertices = json.loads((root / 'vertices.json').read_text())
        # Only replace classification of existing detections, never add nodes.
        points = [[v['x'], v['y']] for v in truth_vertices]
        tree = cKDTree(points)
        boundary_corrected = []
        for vertex in learned_vertices:
            distance, index = tree.query([vertex['x'], vertex['y']])
            repaired = dict(vertex)
            if distance <= 4:
                target = truth_vertices[index]
                for key in ['boundary_side', 'side_coordinate']:
                    repaired.pop(key, None)
                repaired['kind'] = target['kind']
                if target['kind'] == 'boundary_contact':
                    side = target['boundary_side']
                    repaired['boundary_side'] = side
                    repaired['side_coordinate'] = ((vertex['x'] if side in {'top', 'bottom'}
                                                   else vertex['y']) - 32) / (size - 64)
            boundary_corrected.append(repaired)
        for mode, vertices, crease in [
            ('oracle-boundary', boundary_corrected, line[0]),
            ('oracle-vertices', truth_vertices, line[0]),
            ('oracle-vertices-and-lines', truth_vertices, ideal_lines(truth, size)),
        ]:
            dest = case / mode
            dest.mkdir(exist_ok=True)
            vertex_file = dest / 'vertices.json'
            vertex_file.write_text(json.dumps(vertices))
            crease_file = dest / 'crease.f32'
            crease.astype('<f4').tofile(crease_file)
            command = ['target/release/examples/recognition_probe', str(source), str(dest),
                       str(size), str(case / '.unused'), str(vertex_file), str(crease_file),
                       'pixel-direct']
            with (dest / 'decode.log').open('w') as log:
                subprocess.run(command, stdout=log, stderr=log, timeout=60, check=True)
            crease_file.unlink()
            prediction = dest / 'normalized.fold'
            prediction.write_text(json.dumps(normalized_fold(dest / 'recognized.fold')))
            pairs.append(f'{prediction}\t{truth_file}')
            records.append({'key': row['key'], 'mode': mode,
                            'baseline_score': baseline['score']})
        print(json.dumps({'finished': row['key']}), flush=True)
    pair_file = args.out / 'pairs.tsv'
    pair_file.write_text('\n'.join(pairs) + '\n')
    result = subprocess.run(['target/release/examples/strict_diff', str(pair_file), '4'],
                            check=True, capture_output=True, text=True)
    for row, text in zip(records, result.stdout.splitlines(), strict=True):
        row['oracle_score'] = json.loads(text)['metrics']
    (args.out / 'runs.json').write_text(json.dumps(records, indent=2))
    for row in records:
        print(json.dumps({'key': row['key'], 'mode': row['mode'],
                          'baseline': row['baseline_score']['edges'],
                          'oracle': row['oracle_score']['edges']}), flush=True)


if __name__ == '__main__':
    main()
