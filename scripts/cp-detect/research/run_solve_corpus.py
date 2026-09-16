#!/usr/bin/env python3
"""Replay exact recognition attachments, then score solved outputs at 2px.

Uses the latest benchmark's 25s refinement/lattice-only >1500-edge policy.
No truth is read before solving. Every selected truth case remains in scoring.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import subprocess
from pathlib import Path

from run_probes import normalized_fold


def find_input(value):
    if isinstance(value, dict):
        if 'exact_solve_input' in value:
            return value['exact_solve_input']
        for child in value.values():
            found = find_input(child)
            if found is not None:
                return found
    return None


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory', type=Path, required=True)
    p.add_argument('--corpus', type=Path)
    p.add_argument('--baseline', type=Path)
    p.add_argument('--uncapped-baseline', type=Path)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--split', choices=['development', 'holdout'], required=True)
    p.add_argument('--jobs', type=int, default=4)
    p.add_argument('--recognition-budget', type=float,
                   help='Opt into bounded recognition fallback with this total solve budget')
    a = p.parse_args()
    if bool(a.corpus) == bool(a.baseline):
        p.error('Choose exactly one of --corpus or --baseline')
    a.out.mkdir(parents=True, exist_ok=True)
    rows = [r for r in json.loads(a.inventory.read_text())['cases'] if r['split'] == a.split and r['truth_sha256']]
    runs = {r['key']: r for r in json.loads((a.corpus / 'runs.json').read_text())} if a.corpus else {}
    config = {'inventory_sha256': hashlib.sha256(a.inventory.read_bytes()).hexdigest(),
              'corpus': str(a.corpus), 'baseline': str(a.baseline), 'split': a.split,
              'budget': 25, 'max_edges': 1500, 'process_timeout': 60}
    if a.recognition_budget is not None:
        if not 0 < a.recognition_budget <= 55:
            p.error('Recognition solve budget must be in (0, 55] seconds')
        config.update(budget=a.recognition_budget, recognition_fallback=True,
                      binary_sha256=hashlib.sha256(Path('target/release/examples/solve_recognition').read_bytes()).hexdigest())
    config_path = a.out / 'config.json'
    if config_path.exists() and json.loads(config_path.read_text()) != config:
        raise ValueError('Output protocol changed')
    config_path.write_text(json.dumps(config, indent=2))

    def process(row):
        key = row['key'].replace('/', '__')
        out = a.out / key
        out.mkdir(exist_ok=True)
        done = out / 'complete.json'
        if done.exists():
            return json.loads(done.read_text())
        record = {'key': row['key'], 'complexity': row['complexity']}
        if a.corpus:
            prediction = runs.get(row['key'], {}).get('prediction')
            report = Path(prediction).parent / 'result.json' if prediction else None
        else:
            report = a.baseline / 'answers' / (key + '.pipeline.report.json')
            if not report.exists() and a.uncapped_baseline:
                report = a.uncapped_baseline / key / 'result.json'
        if report and report.exists():
            input_ = find_input(json.loads(report.read_text()))
            if input_ is not None:
                raw = json.dumps(input_)
                (out / 'input.json').write_text(raw)
                record['input_sha256'] = hashlib.sha256(raw.encode()).hexdigest()
                record['spans'] = len(input_['selected_spans'])
                record['lattice_only'] = record['spans'] > 1500 and a.recognition_budget is None
                command = ['target/release/examples/solve_recognition', str(out / 'input.json'), str(out), str(config['budget'])]
                if a.recognition_budget is not None:
                    command.append('recognition')
                elif record['lattice_only']:
                    command.append('lattice-only')
                try:
                    with (out / 'solve.log').open('w') as log:
                        r = subprocess.run(command, stdout=log, stderr=log, timeout=60)
                    record['exit_code'] = r.returncode
                except subprocess.TimeoutExpired:
                    record['timeout'] = True
                if (out / 'result.json').exists():
                    value = json.loads((out / 'result.json').read_text())
                    record.update(seconds=value['seconds'], accepted=value['solved']['movement_report'].get('accepted', False))
                    record['prediction'] = str(out / 'solved.fold')
            else:
                record['error'] = 'No recognition attachment'
        else:
            record['error'] = 'Recognition did not complete'
        done.write_text(json.dumps(record, indent=2))
        return record

    records = []
    with ThreadPoolExecutor(a.jobs) as pool:
        for future in as_completed([pool.submit(process, row) for row in rows]):
            record = future.result()
            records.append(record)
            print(json.dumps({'done': len(records), 'total': len(rows), **record}), flush=True)
    by_key = {r['key']: r for r in rows}
    pairs = []
    for record in records:
        row = by_key[record['key']]
        out = a.out / row['key'].replace('/', '__')
        truth = Path(row['source']).parent / 'truth.fold'
        if hashlib.sha256(truth.read_bytes()).hexdigest() != row['truth_sha256']:
            raise ValueError('Truth changed')
        (out / 'truth.normalized.fold').write_text(json.dumps(normalized_fold(truth)))
        pred = normalized_fold(Path(record['prediction'])) if record.get('prediction') else {
            'vertices_coords': [], 'edges_vertices': [], 'edges_assignment': []}
        (out / 'prediction.normalized.fold').write_text(json.dumps(pred))
        pairs.append(f'{out / "prediction.normalized.fold"}\t{out / "truth.normalized.fold"}')
    (a.out / 'pairs.tsv').write_text('\n'.join(pairs) + '\n')
    scores = subprocess.run(['target/release/examples/strict_diff', str(a.out / 'pairs.tsv'), '2'], check=True, capture_output=True, text=True)
    (a.out / 'raw.jsonl').write_text(scores.stdout)
    for r, line in zip(records, scores.stdout.splitlines(), strict=True):
        r['score'] = json.loads(line)['metrics']
        r['recovered'] = bool(r.get('accepted') and r['score']['exact_topology_and_assignment'])
    (a.out / 'runs.json').write_text(json.dumps(records, indent=2))
    summary = {'n': len(records), 'completed': sum('prediction' in r for r in records),
               'accepted': sum(bool(r.get('accepted')) for r in records),
               'recovered': sum(r['recovered'] for r in records),
               'edge_errors': sum(r['score']['edges']['extra_edges'] + r['score']['edges']['missing_edges'] for r in records)}
    (a.out / 'summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
