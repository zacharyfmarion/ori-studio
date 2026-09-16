#!/usr/bin/env python3
"""Score both recognizers with the same unrounded strict metric and denominator.

Missing predictions count as empty graphs, not dropped rows. The optional
uncapped baseline supplies runs previously skipped by the old harness. Only
after inference does this program read ground truth; it never selects models.
"""
import argparse
import json
import subprocess
from pathlib import Path

from run_probes import normalized_fold


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory', type=Path, required=True)
    p.add_argument('--baseline', type=Path, required=True)
    p.add_argument('--uncapped-baseline', type=Path)
    p.add_argument('--candidate', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--split', choices=['development', 'holdout'], required=True)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    rows = [r for r in json.loads(args.inventory.read_text())['cases']
            if r['split'] == args.split and r['topology_sha256']]
    runs = {r['key']: r for r in json.loads((args.candidate/'runs.json').read_text())}
    pairs, records = [], []
    for row in rows:
        key = row['key'].replace('/', '__')
        case = args.out/key
        case.mkdir(exist_ok=True)
        truth = case/'truth.fold'
        truth.write_text(json.dumps(normalized_fold(Path(row['source']).parent/'topology.fold')))
        baseline = args.baseline/'answers'/(key+'.recognised.fold')
        if not baseline.exists() and args.uncapped_baseline:
            baseline = args.uncapped_baseline/key/'recognized.fold'
        candidate = Path(runs[row['key']]['prediction']) if runs[row['key']].get('prediction') else None
        for name, path in [('baseline', baseline), ('candidate', candidate)]:
            completed = path is not None and path.exists()
            fold = normalized_fold(path) if completed else {'file_spec': 1.2,
                'vertices_coords': [], 'edges_vertices': [], 'edges_assignment': []}
            output = case/(name+'.fold')
            output.write_text(json.dumps(fold))
            pairs.append(f'{output}\t{truth}')
            records.append({'key': row['key'], 'complexity': row['complexity'],
                            'group': row['key'].split('/')[0], 'method': name, 'completed': completed})
    pair_file = args.out/'pairs.tsv'
    pair_file.write_text('\n'.join(pairs)+'\n')
    result = subprocess.run(['target/release/examples/strict_diff', str(pair_file), '4'],
                            check=True, capture_output=True, text=True)
    (args.out/'raw-scores.jsonl').write_text(result.stdout)
    for record, line in zip(records, result.stdout.splitlines(), strict=True):
        value = json.loads(line)
        if 'metrics' not in value:
            raise ValueError(f'Metric failed: {record["key"]}: {value}')
        m = value['metrics']
        record.update(edges=m['edges'], assignments=m['assignments'],
                      exact=m['exact_topology'], exact_assignment=m['exact_topology_and_assignment'])
    (args.out/'runs.json').write_text(json.dumps(records, indent=2))
    summaries = []
    for group in ['all', 'cpoogle', 'curated', 'small', 'medium', 'large', 'giant']:
        for method in ['baseline', 'candidate']:
            subset = [r for r in records if r['method'] == method and
                      (group == 'all' or r['group'] == group or r['complexity'] == group)]
            if not subset:
                continue
            summaries.append({'group': group, 'method': method, 'n': len(subset),
                'completed': sum(r['completed'] for r in subset),
                'exact': sum(r['exact'] for r in subset),
                'exact_assignment': sum(r['exact_assignment'] for r in subset),
                'edge_errors': sum(r['edges']['missing_edges']+r['edges']['extra_edges'] for r in subset),
                'wrong_assignments': sum(r['assignments']['wrong_edges'] for r in subset),
                'macro_f1': sum(r['edges']['f1'] for r in subset)/len(subset)})
    (args.out/'summary.json').write_text(json.dumps(summaries, indent=2))
    print(json.dumps(summaries, indent=2))


if __name__ == '__main__':
    main()
