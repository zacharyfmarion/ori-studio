#!/usr/bin/env python3
"""Compare exact full-graph recovery, keeping gains and regressions separate."""
import argparse
import json
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('studies', type=Path, nargs='+')
    parser.add_argument('--baseline', type=Path,
                        default=Path('artifacts/cp-solver/S093-browser-validation/browser-audit/runs.json'))
    parser.add_argument('--out-name', default='comparison.json')
    parser.add_argument('--clean-only', action='store_true')
    args = parser.parse_args()
    baseline = {r['key']: r for r in read(args.baseline)}
    for study in args.studies:
        rows = read(study / 'audit/runs.json')
        if args.clean_only:
            rows = [r for r in rows if r.get('detected_topology_exact')
                    and r.get('detected_assignments_exact')]
        summary = {}
        for tolerance in ['0', '1e-12', '1e-09']:
            def recovered(row):
                return row['scores']['with_aux'][tolerance]['recovered_within_25s']
            summary[tolerance] = {
                'cases': len(rows),
                'baseline': sum(recovered(baseline[r['key']]) for r in rows),
                'candidate': sum(recovered(r) for r in rows),
                'gains': [r['key'] for r in rows if recovered(r) and not recovered(baseline[r['key']])],
                'losses': [r['key'] for r in rows if not recovered(r) and recovered(baseline[r['key']])],
            }
        (study / args.out_name).write_text(json.dumps(summary, indent=2))
        print(study, json.dumps(summary['1e-09']))


if __name__ == '__main__':
    main()
