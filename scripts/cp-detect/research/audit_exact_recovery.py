#!/usr/bin/env python3
"""Rescore frozen solver outputs for coordinate recovery, without rerunning solves.

Input directories are completed score_solver_study.py outputs. Their placed.fold
files retain the original exported graph, including AUX. Truth is reopened only
for scoring and checked against the frozen inventory. No coordinate rounding,
grid snapping, or best-fit alignment is performed by this audit.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize(fold, include_aux):
    points, edges = fold['vertices_coords'], fold['edges_vertices']
    assignments = fold.get('edges_assignment', ['U'] * len(edges))
    if not points:
        return {'vertices_coords': [], 'edges_vertices': [], 'edges_assignment': []}
    border = [points[v] for e, a in zip(edges, assignments, strict=True)
              if a == 'B' for v in e]
    if not border:
        raise ValueError('No paper boundary; do not invent a fitted frame')
    lo = [min(v[d] for v in border) for d in range(2)]
    side = max(v[0] for v in border) - lo[0]
    if side <= 0:
        raise ValueError('Degenerate paper boundary')
    # One scale for both axes: independently stretching x and y would hide
    # aspect-ratio errors. 1024 keeps the evaluator in its established units.
    keep = [i for i, a in enumerate(assignments) if include_aux or a != 'F']
    used = sorted({v for i in keep for v in edges[i]})
    indices = {v: i for i, v in enumerate(used)}
    return {
        'vertices_coords': [[(points[v][d] - lo[d]) / side * 1024
                             for d in range(2)] for v in used],
        'edges_vertices': [[indices[v] for v in edges[i]] for i in keep],
        'edges_assignment': [assignments[i] for i in keep],
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('studies', type=Path, nargs='+')
    p.add_argument('--inventory', type=Path,
                   default=Path('artifacts/cp-recognition/frozen/inventory.json'))
    p.add_argument('--evaluator', type=Path, default=Path('target/release/examples/strict_diff'))
    p.add_argument('--out', type=Path, required=True)
    # Show sensitivity, including literal equality. The main numerical precision
    # threshold is 1e-9 of paper width, not the old 2/1024 visual allowance.
    p.add_argument('--tolerances', type=float, nargs='+', default=[0, 1e-12, 1e-9, 1e-6, 2/1024])
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    inventory = {r['key']: r for r in read(a.inventory)['cases']}
    records, pairs, fingerprints = [], {'physical': [], 'with_aux': []}, {}
    seen = set()
    for study in a.studies:
        for r in read(study/'runs.json'):
            key = r['key']
            if key in seen:
                raise ValueError(f'Duplicate case: {key}')
            seen.add(key)
            row = inventory[key]
            if not row['truth_sha256']:
                continue
            truth = Path(row['source']).parent/'truth.fold'
            if digest(truth) != row['truth_sha256']:
                raise ValueError(f'Frozen truth changed: {key}')
            name = key.replace('/', '__')
            candidate = study/name/'placed.fold'
            if r.get('prediction') and not candidate.exists():
                raise ValueError(f'Missing placed output: {key}')
            target = read(truth)
            prediction = read(candidate) if candidate.exists() else {
                'vertices_coords': [], 'edges_vertices': [], 'edges_assignment': []}
            record = {k: r[k] for k in ['key', 'complexity', 'solved_25s',
                       'detected_topology_exact', 'detected_assignments_exact'] if k in r}
            record.update(input_equals_truth=row['topology_sha256'] == row['truth_sha256'],
                          truth_has_aux='F' in target.get('edges_assignment', []),
                          scores={})
            records.append(record)
            fingerprints[key] = {'truth': digest(truth),
                                 'prediction': digest(candidate) if candidate.exists() else None}
            for mode in pairs:
                d = a.out/mode/name
                d.mkdir(parents=True, exist_ok=True)
                t, q = d/'truth.fold', d/'prediction.fold'
                t.write_text(json.dumps(normalize(target, mode == 'with_aux')))
                q.write_text(json.dumps(normalize(prediction, mode == 'with_aux')))
                pairs[mode].append(f'{q}\t{t}')
    summaries = []
    for mode, lines in pairs.items():
        pair_path = a.out/mode/'pairs.tsv'
        pair_path.write_text('\n'.join(lines)+'\n')
        for epsilon in a.tolerances:
            label = f'{epsilon:.12g}'
            raw = a.out/mode/f'scores-{label}.jsonl'
            # Failures produce large diagnostics; stream instead of capturing
            # the whole evaluator output in memory.
            with raw.open('w') as out:
                subprocess.run([str(a.evaluator), str(pair_path), str(epsilon*1024)],
                               stdout=out, check=True)
            with raw.open() as scores:
                for record, line in zip(records, scores, strict=True):
                    value = json.loads(line)
                    if 'metrics' not in value:
                        raise ValueError(value)
                    m = value['metrics']
                    record['scores'].setdefault(mode, {})[label] = {
                        'geometry_and_assignments_match': m['exact_topology_and_assignment'],
                        'recovered_within_25s': m['exact_topology_and_assignment'] and record['solved_25s'],
                        'vertices': m['vertices'], 'edges': m['edges'], 'assignments': m['assignments']}
            for gate in ['all', 'detected_assignments_exact', 'input_equals_truth']:
                selected = [r for r in records if gate == 'all' or r.get(gate)]
                summary = {'mode': mode, 'epsilon_paper_width': epsilon, 'gate': gate,
                           'cases': len(selected),
                           'matches': sum(r['scores'][mode][label]['geometry_and_assignments_match'] for r in selected),
                           'recovered_within_25s': sum(r['scores'][mode][label]['recovered_within_25s'] for r in selected)}
                summaries.append(summary)
                print(json.dumps(summary), flush=True)
    (a.out/'runs.json').write_text(json.dumps(records, indent=2))
    (a.out/'summary.json').write_text(json.dumps(summaries, indent=2))
    (a.out/'protocol.json').write_text(json.dumps({
        'script_sha256': digest(Path(__file__)), 'inventory_sha256': digest(a.inventory),
        'evaluator_sha256': digest(a.evaluator),
        'studies': {str(d): digest(d/'runs.json') for d in a.studies},
        'normalization': 'Boundary origin and one paper-width scale; no fitted rotation, anisotropic scaling or coordinate rounding.',
        'canonicalization': 'Existing strict evaluator splits shared junctions and dissolves redundant collinear degree-two vertices at the SAME numerical tolerance.',
        'main_epsilon_paper_width': 1e-9, 'inputs': fingerprints}, indent=2))


if __name__ == '__main__':
    main()
