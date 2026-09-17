#!/usr/bin/env python3
"""Audit each completed renderer setting against the frozen S093 baseline."""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def read(path):
    return json.loads(path.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('study', type=Path)
    args = parser.parse_args()
    scripts = Path(__file__).parent
    summary = []
    for style in sorted(args.study.iterdir()):
        if not (style / 'runs.json').exists():
            continue
        with (style / 'score.log').open('w') as log:
            for command in [
                ['score_solver_study.py', str(style), '--out', str(style / 'placed')],
                ['audit_exact_recovery.py', str(style / 'placed'), '--out', str(style / 'audit'),
                 '--tolerances', '0', '1e-12', '1e-9'],
                ['compare_image_recovery.py', str(style)],
            ]:
                subprocess.run([sys.executable, str(scripts / command[0]), *command[1:]],
                               stdout=log, stderr=log, check=True)
        runs = read(style / 'runs.json')
        row = {'style': style.name, 'cases': len(runs),
               'solved_25s': sum(r.get('solved_25s', False) for r in runs),
               'max_seconds': max(r.get('seconds', 0) for r in runs),
               'exact': read(style / 'comparison.json')}
        summary.append(row)
        print(json.dumps(row), flush=True)
    (args.study / 'comparison.json').write_text(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
