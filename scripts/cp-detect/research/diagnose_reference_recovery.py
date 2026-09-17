#!/usr/bin/env python3
"""Post-solve diagnostics; reference geometry is never used by the solver.

Nearest-neighbor distances diagnose error scales only. Official recovery remains
the independent full-graph strict evaluator, including AUX and assignments.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--audit', type=Path, required=True)
    p.add_argument('--study', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    rows = []
    for r in read(a.audit / 'runs.json'):
        if not r['detected_assignments_exact']:
            continue
        name = r['key'].replace('/', '__')
        d = a.audit / 'with_aux' / name
        truth, prediction = read(d / 'truth.fold'), read(d / 'prediction.fold')
        gt = np.array(truth['vertices_coords']) / 1024
        pred = np.array(prediction['vertices_coords']) / 1024
        distances, indices = cKDTree(gt).query(pred)
        reverse, _ = cKDTree(pred).query(gt)
        report = read(a.study / name / 'result.json')['solved']['movement_report']
        row = {'key': r['key'], 'complexity': r['complexity'],
               'vertices': len(pred), 'gt_vertices': len(gt),
               'matches': {k: v['recovered_within_25s'] for k, v in r['scores']['with_aux'].items()},
               'max_nearest_error': float(max(distances.max(), reverse.max())),
               'median_nearest_error': float(np.median(distances)),
               'p95_nearest_error': float(np.quantile(distances, .95)),
               'within_1e9': int((distances <= 1e-9).sum()),
               'within_1e12': int((distances <= 1e-12).sum()),
               'termination': report.get('termination'),
               'polish_stop': report.get('polish', {}).get('stop_reason'),
               'projection': report.get('recognition_projection', {}).get('adopted', False),
               'partial_grid': report.get('recognition_fallback'),
               'polish': report.get('polish'),
               'worst_vertices': [{'pred': pred[i].tolist(), 'truth': gt[indices[i]].tolist(),
                                   'error': float(distances[i])}
                                  for i in np.argsort(distances)[-3:][::-1]]}
        # Reference-only characterization: how much precision does a genuinely
        # rational grid in this file retain? This is NOT a proposed solve.
        fits = []
        for n in range(2, 257):
            err = np.abs(gt - np.round(gt * n) / n)
            fits.append((float(np.quantile(err, .95)), float(err.max()), n))
        row['truth_best_grid_p95'], row['truth_best_grid_max'], row['truth_best_grid_cells'] = min(fits)
        rows.append(row)
    (a.out / 'cases.json').write_text(json.dumps(rows, indent=2) + '\n')
    missing = [r for r in rows if not r['matches']['1e-09']]
    result = {'cases': len(rows), 'primary_failures': len(missing),
              'error_scales_cumulative': {str(e): sum(r['max_nearest_error'] <= e for r in missing)
                                         for e in [1e-12, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, .01, 1]},
              'termination': dict(Counter(r['termination'] for r in missing)),
              'polish_stop': dict(Counter(r['polish_stop'] for r in missing)),
              'projection': sum(r['projection'] for r in missing),
              'partial_grid': sum(bool(r['partial_grid']) for r in missing)}
    (a.out / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
    (a.out / 'protocol.json').write_text(json.dumps({
        'script_sha256': digest(Path(__file__)), 'audit': str(a.audit),
        'audit_sha256': digest(a.audit / 'protocol.json'), 'study': str(a.study),
        'purpose': 'Post-solve error attribution only; no reference-informed solve.'}, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
