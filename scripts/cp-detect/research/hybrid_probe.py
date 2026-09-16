#!/usr/bin/env python3
"""E030: source-only conservative choice between cached recognizers.

Development exploration only. Try the old detector only for a compact candidate
with combinatorial defects and <=1500 spans. Adopt only a clean old topology
whose total physical crease length is at least90% of the compact candidate's.
All choices and input hashes are saved before reading any truth.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess

from run_probes import normalized_fold
from run_solve_corpus import find_input


def defects(diagnostic):
    c = diagnostic['combinatorial']
    return len(diagnostic['blockers']) + sum(len(c[k]) for k in [
        'odd_degree_vertices', 'maekawa_failures', 'degenerate_edges',
        'unmodeled_crossings', 'boundary_failures'])


def crease_length(value):
    points = value['vertices_coords']
    return sum(math.dist(points[a][:2], points[b][:2])
               for (a, b), label in zip(value['edges_vertices'], value['edges_assignment'])
               if label not in ['B', 'F'])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory', type=Path, required=True)
    p.add_argument('--recognition', type=Path, required=True)
    p.add_argument('--baseline', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    if (a.out / 'config.json').exists():
        raise ValueError('Refusing to overwrite an experiment')
    a.out.mkdir(parents=True, exist_ok=True)
    rows = [r for r in json.loads(a.inventory.read_text())['cases'] if r['split'] == 'development']
    previous = {r['key']: r for r in json.loads((a.recognition / 'runs.json').read_text())}
    config = {k: str(v) for k, v in vars(a).items()}
    config.update(max_spans=1500, minimum_length_fraction=.9,
                  policy='old must have zero defects; new must have at least one',
                  inventory_sha256=hashlib.sha256(a.inventory.read_bytes()).hexdigest(),
                  script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    (a.out / 'config.json').write_text(json.dumps(config, indent=2))
    decisions = []
    for row in rows:
        key = row['key']; slug = key.replace('/', '__'); out = a.out / slug; out.mkdir()
        pred = previous.get(key, {}).get('prediction')
        record = {'key': key, 'selected': 'compact', 'prediction': pred}
        if pred:
            pred = Path(pred); value = json.loads((pred.parent / 'result.json').read_text())
            input_ = find_input(value)
            record['compact_sha256'] = hashlib.sha256(pred.read_bytes()).hexdigest()
            compact = normalized_fold(pred)
            (out / 'compact.fold').write_text(json.dumps(compact))
            diagnostic = value['report']['quality_report']['compiler_report']['topology_diagnostics']
            record['compact_defects'] = defects(diagnostic)
            old = a.baseline / 'answers' / (slug + '.recognised.fold')
            report = a.baseline / 'answers' / (slug + '.pipeline.report.json')
            if record['compact_defects'] and len(input_['selected_spans']) <= 1500 and old.exists() and report.exists():
                old_input = find_input(json.loads(report.read_text()))
                if old_input:
                    record['baseline_sha256'] = hashlib.sha256(old.read_bytes()).hexdigest()
                    input_file = out / 'old-input.json'; input_file.write_text(json.dumps(old_input))
                    result = subprocess.run(['target/release/examples/analyze_recognition', str(input_file)],
                                            capture_output=True, text=True, check=True, timeout=20)
                    d = json.loads(result.stdout); (out / 'old-diagnostics.json').write_text(result.stdout)
                    old_fold = normalized_fold(old)
                    record['old_defects'] = defects(d)
                    record['length_ratio'] = crease_length(old_fold) / max(crease_length(compact), 1e-12)
                    if record['old_defects'] == 0 and record['length_ratio'] >= .9:
                        record.update(selected='old', prediction=str(old))
            chosen = normalized_fold(Path(record['prediction']))
        else:
            chosen = {'vertices_coords': [], 'edges_vertices': [], 'edges_assignment': []}
        (out / 'selected.fold').write_text(json.dumps(chosen))
        decisions.append(record)
    (a.out / 'decisions.json').write_text(json.dumps(decisions, indent=2))
    # Selection is complete; only now open frozen ground truth.
    pairs, scored = [], []
    by_key = {r['key']: r for r in rows}
    for record in decisions:
        row = by_key[record['key']]
        if not row['topology_sha256']:
            continue
        out = a.out / row['key'].replace('/', '__')
        truth = Path(row['source']).parent / 'topology.fold'
        if hashlib.sha256(truth.read_bytes()).hexdigest() != row['topology_sha256']:
            raise ValueError('Frozen truth changed')
        (out / 'truth.fold').write_text(json.dumps(normalized_fold(truth)))
        pairs.append(f'{out}/selected.fold\t{out}/truth.fold'); scored.append(record)
    pair_file = a.out / 'pairs.tsv'; pair_file.write_text('\n'.join(pairs) + '\n')
    result = subprocess.run(['target/release/examples/strict_diff', str(pair_file), '4'],
                            capture_output=True, text=True, check=True)
    for record, line in zip(scored, result.stdout.splitlines(), strict=True):
        record['score'] = json.loads(line)['metrics']
    (a.out / 'runs.json').write_text(json.dumps(scored, indent=2))
    summary = {'n': len(scored), 'switched': sum(r['selected'] == 'old' for r in scored),
               'exact': sum(r['score']['exact_topology'] for r in scored),
               'exact_assignment': sum(r['score']['exact_topology_and_assignment'] for r in scored),
               'edge_errors': sum(r['score']['edges']['missing_edges'] + r['score']['edges']['extra_edges'] for r in scored)}
    (a.out / 'summary.json').write_text(json.dumps(summary, indent=2)); print(json.dumps(summary))


if __name__ == '__main__':
    main()
