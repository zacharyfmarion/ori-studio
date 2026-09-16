#!/usr/bin/env python3
"""Score completed native/browser studies without invoking or informing a solver.

Optional transform directories correct the S000 probe's omitted FOLD frame
inverse. Original artifacts remain immutable, and point identity is checked.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from run_probes import normalized_fold


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('study', type=Path)
    p.add_argument('--inventory', type=Path, default=Path('artifacts/cp-recognition/frozen/inventory.json'))
    p.add_argument('--transforms', type=Path, nargs='*', default=[])
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--evaluator', type=Path, default=Path('target/release/examples/strict_diff'))
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    inventory = {x['key']: x for x in read(a.inventory)['cases']}
    results = read(a.study/'runs.json')
    pairs, scored, fingerprints = [], [], {}
    for r in results:
        key = r['key']
        row = inventory[key]
        if not row['truth_sha256']:
            continue
        truth = Path(row['source']).parent/'truth.fold'
        if digest(truth) != row['truth_sha256']:
            raise ValueError(f'Frozen truth changed: {key}')
        directory = a.out/key.replace('/', '__')
        directory.mkdir(exist_ok=True)
        target, predicted = directory/'truth.fold', directory/'prediction.fold'
        target.write_text(json.dumps(normalized_fold(truth)))
        candidate = Path(r['prediction']) if r.get('prediction') else None
        if candidate:
            fold = read(candidate)
            fingerprints[key] = {'prediction': digest(candidate), 'truth': digest(truth)}
            if a.transforms:
                original = read(a.study/key.replace('/', '__')/'input.json')
                directory_with_frame = next((d/key.replace('/', '__') for d in a.transforms
                                            if (d/key.replace('/', '__')/'result.json').exists()), None)
                if directory_with_frame is None:
                    raise ValueError(f'Missing transform: {key}')
                rebuilt = read(directory_with_frame/'input.json')
                if [v['point'] for v in original['vertices']] != [v['point'] for v in rebuilt['vertices']]:
                    raise ValueError(f'Frame inputs differ: {key}')
                t = read(directory_with_frame/'result.json')['input_transform']
                fingerprints[key]['transform_report'] = digest(directory_with_frame/'result.json')
                for v in fold['vertices_coords']:
                    x, y = v[0]*t['side'], v[1]*t['side']*t['flip']
                    v[0] = t['origin']['x'] + x*t['ux'][0] + y*t['uy'][0]
                    v[1] = t['origin']['y'] + x*t['ux'][1] + y*t['uy'][1]
            placed = directory/'placed.fold'
            placed.write_text(json.dumps(fold))
            prediction = normalized_fold(placed)
        else:
            prediction = {'vertices_coords': [], 'edges_vertices': [], 'edges_assignment': []}
        predicted.write_text(json.dumps(prediction))
        pairs.append(f'{predicted}\t{target}')
        scored.append(r)
    pair_path = a.out/'pairs.tsv'
    pair_path.write_text('\n'.join(pairs)+'\n')
    score = subprocess.run([str(a.evaluator), str(pair_path), '2'],
                           capture_output=True, text=True, check=True)
    (a.out/'scores.jsonl').write_text(score.stdout)
    for r, line in zip(scored, score.stdout.splitlines(), strict=True):
        r['score'] = json.loads(line)['metrics']
        r['recovered_25s'] = r['solved_25s'] and r['score']['exact_topology_and_assignment']
    groups = []
    for group in ['all', 'small', 'medium', 'large', 'giant', 'detected_topology_exact', 'detected_assignments_exact']:
        selected = [r for r in results if group == 'all' or r['complexity'] == group or r.get(group) is True]
        groups.append({'group': group, 'n': len(selected),
                       'solved_25s': sum(r['solved_25s'] for r in selected),
                       'recovered_25s': sum(r.get('recovered_25s', False) for r in selected),
                       'max_seconds': max((r.get('seconds', 0) for r in selected), default=0),
                       'timeouts': sum(r.get('seconds', 0) > 25 for r in selected)})
    (a.out/'runs.json').write_text(json.dumps(results, indent=2))
    (a.out/'summary.json').write_text(json.dumps(groups, indent=2))
    (a.out/'protocol.json').write_text(json.dumps({'study_runs_sha256': digest(a.study/'runs.json'),
        'inventory_sha256': digest(a.inventory), 'script_sha256': digest(Path(__file__)),
        'normalization_sha256': digest(Path(__file__).with_name('run_probes.py')),
        'evaluator_sha256': digest(a.evaluator),
        'frame_correction': bool(a.transforms), 'inputs': fingerprints}, indent=2))
    print(json.dumps(groups))


if __name__ == '__main__':
    main()
