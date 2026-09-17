#!/usr/bin/env python3
"""Source-only recovery across a frozen Oriedita image manifest; no truth reads."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def read(path): return json.loads(Path(path).read_text())
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--binary-dir', type=Path, required=True)
    p.add_argument('--styles', nargs='*')
    p.add_argument('--refine-border', action='store_true')
    a = p.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
    rows = read(a.manifest)
    if a.styles: rows = [r for r in rows if r['style'] in a.styles]
    probe = (a.binary_dir / 'source_line_probe').resolve()
    binary = (a.binary_dir / 'solver_research').resolve()
    inventory = {r['key']: r for r in read('artifacts/cp-recognition/frozen/inventory.json')['cases']}
    options = dict(timeout_seconds=25, recognition_fallback=True, polish=True, construction_recovery='constructions')
    protocol = dict(manifest_sha256=sha(a.manifest), script_sha256=sha(__file__),
                    probe_sha256=sha(probe), binary_sha256=sha(binary), styles=a.styles, options=options,
                    refine_border=a.refine_border)
    pp = a.out / 'protocol.json'
    if pp.exists() and read(pp) != protocol: raise ValueError('Protocol changed')
    pp.write_text(json.dumps(protocol, indent=2))
    results = {}
    for i, row in enumerate(rows):
        key = row['key']; style = row['style']
        out = a.out / style / key.replace('/', '__'); out.mkdir(parents=True, exist_ok=True)
        if (out / 'complete.json').exists():
            results.setdefault(style, []).append(read(out / 'complete.json')); continue
        assert sha(row['source']) == row['source_sha256']
        assert sha(row['input']) == row['input_sha256']
        result = {k: inventory[key][k] for k in ['key', 'split', 'complexity']}
        result.update(detected_topology_exact=True, detected_assignments_exact=True, style=style)
        try:
            with (out / 'fit.log').open('w') as log:
                subprocess.run([str(probe), row['input'], row['source'], json.dumps(row['quad']), str(out)]
                               + (['refine-border'] if a.refine_border else []),
                               check=True, stdout=log, stderr=log, timeout=15)
            fit = read(out / 'fit-report.json')
            with (out / 'solve.log').open('w') as log:
                subprocess.run([str(binary), str(out / 'input.json'), str(out / 'solve'),
                                json.dumps({**options, 'timeout_seconds': max(.1, 25 - fit['seconds'])})],
                               check=True, stdout=log, stderr=log, timeout=32)
            solved = read(out / 'solve/result.json')
            result.update(seconds=fit['seconds'] + solved['seconds'], fit_seconds=fit['seconds'], fitted_lines=fit['lines'],
                          status=solved['solved']['status'], accepted=solved['solved']['movement_report'].get('accepted', False),
                          prediction=str(out / 'solve/solved.fold'))
            result['solved_25s'] = result['seconds'] <= 25 and result['status'] == 'solved' and result['accepted']
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            result.update(error=type(error).__name__, solved_25s=False)
        (out / 'complete.json').write_text(json.dumps(result, indent=2))
        results.setdefault(style, []).append(result)
        print(json.dumps(dict(done=i + 1, total=len(rows), **result)), flush=True)
    for style, records in results.items():
        (a.out / style / 'runs.json').write_text(json.dumps(records, indent=2))


if __name__ == '__main__': main()
