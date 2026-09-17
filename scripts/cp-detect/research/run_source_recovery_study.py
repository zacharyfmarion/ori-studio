#!/usr/bin/env python3
"""Replay source-only Rust recovery. Reference scoring is a separate process."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--binary-dir', type=Path, required=True)
    parser.add_argument('--keys', type=Path)
    parser.add_argument('--refine-border', action='store_true')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    binary = (args.binary_dir / 'solver_research').resolve()
    probe = (args.binary_dir / 'source_line_probe').resolve()
    cases = read('artifacts/cp-solver/S095-ink-recovery-baseline/cases.json')
    allowed = set(read(args.keys)) if args.keys else None
    cases = [r for r in cases if allowed is None or r['key'] in allowed]
    inventory = {r['key']: r for r in read('artifacts/cp-recognition/frozen/inventory.json')['cases']}
    options = dict(timeout_seconds=25, recognition_fallback=True, polish=True,
                   construction_recovery='constructions')
    protocol = dict(script_sha256=sha(__file__), binary_sha256=sha(binary),
                    probe_sha256=sha(probe), keys=[r['key'] for r in cases], options=options,
                    refine_border=args.refine_border)
    protocol_path = args.out / 'protocol.json'
    if protocol_path.exists() and read(protocol_path) != protocol:
        raise ValueError('Protocol changed; use a new experiment directory')
    protocol_path.write_text(json.dumps(protocol, indent=2))
    rows = []
    for i, case in enumerate(cases):
        key = case['key']; name = key.replace('/', '__')
        out = args.out / name; out.mkdir(exist_ok=True)
        if (out / 'complete.json').exists():
            rows.append(read(out / 'complete.json')); continue
        entry = inventory[key]
        source = Path(entry['source'])
        assert sha(source) == entry['source_sha256']
        prior = Path('artifacts/cp-solver') / ('S096-image-fit-pilot' if case['vertices'] <= 150 else 'S097-image-fit-large') / name
        # Frozen border fit used source pixels only; no reference coordinates.
        quad = read(prior / 'fit-report.json')['quad']
        if args.refine_border:
            from score_image_alignment import quad_points
            cache = Path('artifacts/cp-recognition') / ('E013-development' if entry['split'] == 'development' else 'E017-holdout') / name
            quad = quad_points(read(sorted(cache.glob('*/rectification.json'))[0])).tolist()
        row = {k: entry[k] for k in ['key', 'split', 'complexity']}
        row.update(detected_topology_exact=True, detected_assignments_exact=True)
        try:
            with (out / 'fit.log').open('w') as log:
                subprocess.run([str(probe), case['input'], str(source), json.dumps(quad), str(out)]
                               + (['refine-border'] if args.refine_border else []),
                               check=True, stdout=log, stderr=log, timeout=15)
            fit_seconds = read(out / 'fit-report.json')['seconds']
            with (out / 'solve.log').open('w') as log:
                subprocess.run([str(binary), str(out / 'input.json'), str(out / 'solve'),
                                json.dumps({**options, 'timeout_seconds': max(.1, 25 - fit_seconds)})],
                               check=True, stdout=log, stderr=log, timeout=32)
            result = read(out / 'solve/result.json'); solved = result['solved']
            row.update(seconds=fit_seconds + result['seconds'], fit_seconds=fit_seconds,
                       status=solved['status'], accepted=solved['movement_report'].get('accepted', False),
                       prediction=str(out / 'solve/solved.fold'))
            row['solved_25s'] = row['seconds'] <= 25 and row['status'] == 'solved' and row['accepted']
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            row.update(error=type(error).__name__, solved_25s=False)
        (out / 'complete.json').write_text(json.dumps(row, indent=2))
        rows.append(row)
        print(json.dumps(dict(done=i + 1, total=len(cases), **row)), flush=True)
    (args.out / 'runs.json').write_text(json.dumps(rows, indent=2))


if __name__ == '__main__':
    main()
