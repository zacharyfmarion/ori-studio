#!/usr/bin/env python3
"""E026 development-only partial-lattice proposals with unchanged-solve fallback.

An accepted proposal replaces the existing bounded-solve result; a refusal
retains it. No truth is opened until all proposal solves have finished.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import subprocess
from pathlib import Path

from partial_lattice_probe import propose
from run_probes import normalized_fold


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory', type=Path, required=True)
    p.add_argument('--baseline-solve', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--jobs', type=int, default=4)
    args = p.parse_args()
    rows = [r for r in json.loads(args.inventory.read_text())['cases']
            if r['split'] == 'development' and r['truth_sha256']]
    baseline = {r['key']: r for r in json.loads((args.baseline_solve / 'runs.json').read_text())}
    args.out.mkdir(parents=True, exist_ok=True)
    config = {'inventory_sha256': hashlib.sha256(args.inventory.read_bytes()).hexdigest(),
              'baseline_solve': str(args.baseline_solve), 'noise_px': 1.5,
              'coordinate_fraction': .95, 'projection': None, 'timeout': 25,
              'source_sha256': {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in [Path(__file__), Path(__file__).with_name('partial_lattice_probe.py')]}}
    config_path = args.out / 'config.json'
    if config_path.exists() and json.loads(config_path.read_text()) != config:
        raise ValueError('Refusing to mix protocols')
    config_path.write_text(json.dumps(config, indent=2))

    def process(row):
        key = row['key'].replace('/', '__'); out = args.out / key
        out.mkdir(exist_ok=True)
        done = out / 'complete.json'
        if done.exists():
            return json.loads(done.read_text())
        old = baseline[row['key']]
        record = {'key': row['key'], 'baseline': old,
                  'prediction': old.get('prediction'), 'accepted': old.get('accepted', False)}
        source = args.baseline_solve / key / 'input.json'
        if source.exists():
            original = json.loads(source.read_text())
            candidate, proposal = propose(original)
            record['proposal'] = proposal
            if proposal['proposed']:
                (out / 'input.json').write_text(json.dumps(candidate))
                try:
                    with (out / 'solve.log').open('w') as log:
                        subprocess.run(['target/release/examples/solve_recognition',
                                        str(out / 'input.json'), str(out), '25'],
                                       stdout=log, stderr=log, timeout=40, check=True)
                    result = json.loads((out / 'result.json').read_text())
                    record['proposal_seconds'] = result['seconds']
                    solved = result['solved']
                    record['proposal_accepted'] = bool(solved['movement_report'].get('accepted'))
                    if record['proposal_accepted']:
                        record.update(prediction=str(out / 'solved.fold'), accepted=True)
                except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
                    record['proposal_error'] = type(error).__name__
        done.write_text(json.dumps(record, indent=2))
        return record

    records = []
    with ThreadPoolExecutor(args.jobs) as pool:
        for future in as_completed([pool.submit(process, row) for row in rows]):
            record = future.result(); records.append(record)
            print(json.dumps({'done': len(records), 'total': len(rows), 'key': record['key'],
                              'proposed': record.get('proposal', {}).get('proposed'),
                              'accepted': record.get('proposal_accepted'),
                              'seconds': record.get('proposal_seconds')}), flush=True)
    by_key = {r['key']: r for r in rows}; pairs = []
    for r in records:
        row = by_key[r['key']]; out = args.out / r['key'].replace('/', '__')
        truth = Path(row['source']).parent / 'truth.fold'
        if hashlib.sha256(truth.read_bytes()).hexdigest() != row['truth_sha256']:
            raise ValueError('Frozen truth changed')
        target = out / 'truth.fold'; pred = out / 'prediction.fold'
        target.write_text(json.dumps(normalized_fold(truth)))
        pred.write_text(json.dumps(normalized_fold(Path(r['prediction'])) if r.get('prediction')
                                   else {'vertices_coords': [], 'edges_vertices': [], 'edges_assignment': []}))
        pairs.append(f'{pred}\t{target}')
    pair_file = args.out / 'pairs.tsv'; pair_file.write_text('\n'.join(pairs) + '\n')
    result = subprocess.run(['target/release/examples/strict_diff', str(pair_file), '2'],
                            capture_output=True, text=True, check=True)
    for row, text in zip(records, result.stdout.splitlines(), strict=True):
        row['score'] = json.loads(text)['metrics']
        row['recovered'] = bool(row['accepted'] and row['score']['exact_topology_and_assignment'])
    (args.out / 'runs.json').write_text(json.dumps(records, indent=2))
    summary = {'n': len(records), 'proposals': sum(r.get('proposal', {}).get('proposed', False) for r in records),
               'accepted_proposals': sum(r.get('proposal_accepted', False) for r in records),
               'baseline_recovered': sum(r['baseline']['recovered'] for r in records),
               'recovered': sum(r['recovered'] for r in records),
               'gains': [r['key'] for r in records if r['recovered'] and not r['baseline']['recovered']],
               'regressions': [r['key'] for r in records if r['baseline']['recovered'] and not r['recovered']]}
    (args.out / 'summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
