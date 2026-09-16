#!/usr/bin/env python3
"""Frozen, isolated exact-solver study. No truth enters a solver request.

Modes: repaired topology from the current benchmark, or saved detector input.
Uses one subprocess per case; crashes/timeouts remain failures. Resume requires
identical binary, options, input hashes and case order. Final truth scoring is
separate from solve completion and uses the existing strict evaluator.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

from run_probes import normalized_fold


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory', type=Path, default=Path('artifacts/cp-recognition/frozen/inventory.json'))
    p.add_argument('--binary', type=Path, required=True)
    p.add_argument('--mode', choices=['topology', 'detected'], required=True)
    p.add_argument('--method', choices=['ordinary','projection'], default='ordinary')
    p.add_argument('--split', choices=['development', 'holdout', 'all'], default='development')
    p.add_argument('--keys', type=Path, help='Optional JSON array of explicit keys; recorded in protocol')
    p.add_argument('--options', default='{"timeout_seconds":25,"recognition_fallback":true,"polish":true}')
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    options = json.loads(a.options)
    rows = json.loads(a.inventory.read_text())['cases']
    keys = set(json.loads(a.keys.read_text())) if a.keys else None
    rows = [r for r in rows if (a.split == 'all' or r['split'] == a.split)
            and (keys is None or r['key'] in keys)
            and r['topology_sha256']]
    detector_scores = {}
    for directory in ['E013-development', 'E017-holdout']:
        detector_scores.update({r['key']: r.get('score', {}) for r in json.loads(
            (Path('artifacts/cp-recognition') / directory / 'runs.json').read_text())})
    inputs = {}
    for r in rows:
        if a.mode == 'topology':
            path = Path(r['source']).parent / 'topology.fold'
            if sha(path) != r['topology_sha256']:
                raise ValueError('Frozen topology changed')
        else:
            parent = 'E027-development' if r['split'] == 'development' else 'E027-holdout'
            path = Path('artifacts/cp-recognition') / parent / r['key'].replace('/', '__') / 'input.json'
        inputs[r['key']] = path
    a.out.mkdir(parents=True, exist_ok=True)
    config = {'binary': str(a.binary.resolve()), 'binary_sha256': sha(a.binary),
              'script_sha256': sha(Path(__file__)), 'inventory_sha256': sha(a.inventory),
              'options': options, 'mode': a.mode, 'method': a.method, 'split': a.split, 'jobs': 1,
              'inputs': {key: {'path': str(path), 'sha256': sha(path) if path.exists() else None}
                         for key, path in inputs.items()}}
    protocol = a.out / 'protocol.json'
    if protocol.exists() and json.loads(protocol.read_text()) != config:
        raise ValueError('Refusing to mix protocols')
    protocol.write_text(json.dumps(config, indent=2))
    results = []
    for i, row in enumerate(rows):
        key = row['key']
        out = a.out / key.replace('/', '__')
        out.mkdir(exist_ok=True)
        done = out / 'complete.json'
        if done.exists():
            results.append(json.loads(done.read_text()))
            continue
        r = {k: row[k] for k in ['key', 'split', 'complexity']}
        r['detected_topology_exact'] = detector_scores.get(key, {}).get('exact_topology', False)
        r['detected_assignments_exact'] = detector_scores.get(key, {}).get('exact_topology_and_assignment', False)
        started = time.monotonic()
        if not inputs[key].exists():
            r['error'] = 'missing_detector_input'
        else:
            try:
                with (out / 'solve.log').open('w') as log:
                    command=[str(a.binary.resolve()), str(inputs[key]), str(out), a.options]
                    if a.method=='projection':command.append('projection')
                    completed = subprocess.run(command,
                                               stdout=log, stderr=log, timeout=35)
                r['exit_code'] = completed.returncode
                if completed.returncode != 0:
                    r['error'] = 'solver_process_failed'
            except subprocess.TimeoutExpired:
                r['error'] = 'process_timeout'
        r['process_seconds'] = time.monotonic() - started
        r['solved_25s'] = False
        if not r.get('error'):
            report = json.loads((out / 'result.json').read_text())
            solved = report['solved']
            r.update(seconds=report['seconds'], status=solved['status'],
                     accepted=solved['movement_report'].get('accepted', False))
            r['solved_25s'] = bool(r['accepted'] and r['status'] == 'solved' and r['seconds'] <= 25)
            r['topology'] = report.get('topology')
            r['prediction'] = str(out / 'solved.fold')
            r['after'] = {k: v for k, v in solved['theorem_residual_report'].get('after', {}).items()
                          if k not in ['vertices', 'vertex_diagnostics']}
        done.write_text(json.dumps(r, indent=2))
        results.append(r)
        print(json.dumps({'done': i+1, 'total': len(rows), 'key': key,
                          **{k:r.get(k) for k in ['status', 'seconds', 'solved_25s', 'error']}}), flush=True)
    # The solver has finished before any truth file is opened.
    pairs, scored = [], []
    for row, r in zip(rows, results, strict=True):
        truth = Path(row['source']).parent / 'truth.fold'
        if not row['truth_sha256']:
            continue
        if sha(truth) != row['truth_sha256']:
            raise ValueError('Frozen truth changed')
        out = a.out / row['key'].replace('/', '__')
        target, predicted = out/'truth.normalized.fold', out/'prediction.normalized.fold'
        target.write_text(json.dumps(normalized_fold(truth)))
        predicted.write_text(json.dumps(normalized_fold(Path(r['prediction'])) if r.get('prediction') else
            {'vertices_coords': [], 'edges_vertices': [], 'edges_assignment': []}))
        pairs.append(f'{predicted}\t{target}')
        scored.append(r)
    pair_path = a.out/'pairs.tsv'
    pair_path.write_text('\n'.join(pairs)+'\n')
    metrics = subprocess.run(['target/release/examples/strict_diff', str(pair_path), '2'],
                             capture_output=True, text=True, check=True)
    (a.out/'scores.jsonl').write_text(metrics.stdout)
    for r, line in zip(scored, metrics.stdout.splitlines(), strict=True):
        r['score'] = json.loads(line)['metrics']
        r['recovered_25s'] = bool(r['solved_25s'] and r['score']['exact_topology_and_assignment'])
    (a.out/'runs.json').write_text(json.dumps(results, indent=2))
    summaries = []
    for group in ['all','small','medium','large','giant','detected_topology_exact','detected_assignments_exact']:
        selected = [r for r in results if group == 'all' or r['complexity'] == group or r.get(group) is True]
        summaries.append({'group': group, 'n': len(selected), 'solved_25s':sum(r['solved_25s'] for r in selected),
                          'recovered_25s':sum(r.get('recovered_25s',False) for r in selected),
                          'timeouts':sum(r.get('seconds',0)>25 or r.get('error')=='process_timeout' for r in selected),
                          'max_seconds':max((r.get('seconds',0) for r in selected),default=0)})
    (a.out/'summary.json').write_text(json.dumps(summaries, indent=2))
    print(json.dumps(summaries), flush=True)


if __name__ == '__main__':
    main()
