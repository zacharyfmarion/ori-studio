#!/usr/bin/env python3
"""Reference-only audit of rendered-image recognition, not exact solving."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from audit_exact_recovery import normalize


def read(path): return json.loads(Path(path).read_text())
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('study', type=Path)
    a = p.parse_args(); rows = read(a.study / 'runs.json')
    inventory = {r['key']: r for r in read('artifacts/cp-recognition/frozen/inventory.json')['cases']}
    out = a.study / 'recognition-audit'; out.mkdir(exist_ok=True)
    for mode in ['physical', 'with_aux']:
        pairs = []
        for row in rows:
            entry = inventory[row['key']]; truth_path = Path(entry['source']).parent / 'truth.fold'
            assert sha(truth_path) == entry['truth_sha256']
            directory = out / mode / row['style'] / row['key'].replace('/', '__'); directory.mkdir(parents=True, exist_ok=True)
            truth = normalize(read(truth_path), mode == 'with_aux')
            empty = {'vertices_coords': [], 'edges_vertices': [], 'edges_assignment': []}
            prediction = normalize(read(row['prediction']), mode == 'with_aux') if row['prediction'] else empty
            (directory / 'truth.fold').write_text(json.dumps(truth))
            (directory / 'prediction.fold').write_text(json.dumps(prediction))
            pairs.append(f'{directory / "prediction.fold"}\t{directory / "truth.fold"}')
        pair_path = out / f'{mode}.tsv'; pair_path.write_text('\n'.join(pairs) + '\n')
        raw_path = out / f'{mode}.jsonl'
        with raw_path.open('w') as f:
            subprocess.run(['target/release/examples/strict_diff', str(pair_path), '2'], check=True, stdout=f)
        for row, line in zip(rows, raw_path.read_text().splitlines(), strict=True):
            row.setdefault('recognition_metrics', {})[mode] = json.loads(line)['metrics']
    summary = []
    for style in sorted({r['style'] for r in rows}):
        selected = [r for r in rows if r['style'] == style]
        summary.append(dict(style=style, cases=len(selected), errors=sum(bool(r.get('error')) for r in selected),
                            physical_topology_and_assignment=sum(r['recognition_metrics']['physical']['exact_topology_and_assignment'] for r in selected),
                            including_aux_topology_and_assignment=sum(r['recognition_metrics']['with_aux']['exact_topology_and_assignment'] for r in selected),
                            max_seconds=max(r['seconds'] for r in selected)))
    (out / 'runs.json').write_text(json.dumps(rows, indent=2))
    (out / 'summary.json').write_text(json.dumps(summary, indent=2))
    (out / 'protocol.json').write_text(json.dumps(dict(script_sha256=sha(__file__),
        input_sha256=sha(a.study / 'runs.json'), evaluator_sha256=sha('target/release/examples/strict_diff'),
        pixel_association_tolerance_at_1024=2, purpose='Recognition topology only; not exact coordinate recovery'), indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == '__main__': main()
