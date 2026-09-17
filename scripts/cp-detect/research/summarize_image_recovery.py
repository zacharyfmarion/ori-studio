#!/usr/bin/env python3
"""Summarize completed image-recovery gates without rerunning or selecting cases."""
import argparse
import json
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('study', type=Path)
    args = parser.parse_args()
    cases = read('artifacts/cp-solver/S095-ink-recovery-baseline/cases.json')
    favorable = {r['key'] for r in cases if r['previous_ink_favors_reference'] and not r['baseline_exact']}
    summary = {'remaining_previous_ink_favorable': len(favorable), 'gates': {}}
    names = ['original-native', 'region-browser', 'region-baseline']
    if (args.study / 'direct-browser/audit/runs.json').exists():
        names.append('direct-browser')
    for name in names:
        root = args.study / name
        runs = read(root / 'runs.json')
        audit = read(root / 'audit/runs.json')
        clean = [r for r in audit if r.get('detected_topology_exact') and r.get('detected_assignments_exact')]
        clean_keys = {r['key'] for r in clean}
        times = sorted(r['seconds'] for r in runs if r['key'] in clean_keys)
        gate = {
            'cases': len(clean),
            'solved_25s': sum(r['solved_25s'] for r in clean),
            'max_seconds': max(times),
            'median_seconds': times[len(times) // 2],
            'p95_seconds': times[int(.95 * (len(times) - 1))],
            'controls': [r for r in runs if r['key'] not in clean_keys],
            'exact_including_aux': {},
        }
        for t in ['0', '1e-12', '1e-09']:
            recovered = {r['key'] for r in clean if r['scores']['with_aux'][t]['recovered_within_25s']}
            gate['exact_including_aux'][t] = {
                'recovered': len(recovered),
                'converted_previous_ink_favorable': sorted(recovered & favorable),
            }
        summary['gates'][name] = gate
    summary['oriedita_fixed_graph'] = read(args.study / 'oriedita/comparison.json')
    summary['oriedita_recognition'] = read('artifacts/cp-solver/S110-oriedita-recognition/study/recognition-audit/summary.json')
    confirmation = args.study.parent / 'S115-oriedita-confirmation/study/comparison.json'
    if confirmation.exists():
        summary['oriedita_confirmation'] = read(confirmation)
    summary['candidate_coverage'] = read(args.study / 'candidate-coverage.json')
    summary['knight_no_gt'] = read(args.study / 'knight-region/comparison.json')
    (args.study / 'summary.json').write_text(json.dumps(summary, indent=2))
    for name, gate in summary['gates'].items():
        print(name, json.dumps({k: v for k, v in gate.items() if k not in ['controls', 'exact_including_aux']}),
              {t: v['recovered'] for t, v in gate['exact_including_aux'].items()})


if __name__ == '__main__':
    main()
