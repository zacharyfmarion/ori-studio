#!/usr/bin/env python3
"""Compare full-graph reference audits, retaining every baseline case and loss."""
import argparse
import hashlib
import json
from pathlib import Path


def read(path):
    return json.loads(path.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--study', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    before = {r['key']: r for r in read(args.baseline / 'runs.json')}
    after = {r['key']: r for r in read(args.candidate / 'runs.json')}
    study = {r['key']: r for r in read(args.study / 'runs.json')}
    if before.keys() != after.keys() or after.keys() != study.keys():
        raise ValueError('Refusing comparisons with added or dropped cases')
    keys = sorted(k for k, r in before.items() if r['detected_assignments_exact'])
    if keys != sorted(k for k, r in after.items() if r['detected_assignments_exact']):
        raise ValueError('The recognition gate changed')
    thresholds = {}
    for epsilon in ['0', '1e-12', '1e-09']:
        previous = {k for k in keys if before[k]['scores']['with_aux'][epsilon]['recovered_within_25s']}
        current = {k for k in keys if after[k]['scores']['with_aux'][epsilon]['recovered_within_25s']}
        thresholds[epsilon] = dict(baseline=len(previous), candidate=len(current),
            gains=sorted(current - previous), losses=sorted(previous - current),
            split_counts={split: dict(cases=sum(study[k]['split'] == split for k in keys),
                                     matches=sum(study[k]['split'] == split for k in current))
                          for split in sorted({study[k]['split'] for k in keys})})
    times = sorted(study[k]['seconds'] for k in keys)
    timing = dict(max_seconds=max(times), median_seconds=times[len(times) // 2],
                  p95_seconds=times[int(.95 * (len(times) - 1))],
                  accepted_within_25s=sum(study[k]['solved_25s'] for k in keys),
                  failures=[k for k in keys if not study[k]['solved_25s']])
    controls = [k for k in study if k not in keys]
    paths = [args.baseline / 'runs.json', args.candidate / 'runs.json', args.study / 'runs.json']
    result = dict(cases=len(keys), controls=len(controls), thresholds=thresholds, timing=timing,
                  solved_controls=[k for k in controls if study[k].get('solved_25s')],
                  control_statuses={k: study[k].get('status') for k in controls},
                  source_sha256={str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({**result, 'thresholds': {e: {**v, 'gains': len(v['gains']),
                          'losses': len(v['losses'])} for e, v in thresholds.items()}}))


if __name__ == '__main__':
    main()
