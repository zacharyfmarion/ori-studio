#!/usr/bin/env python3
"""Render an evaluation set with unmodified Oriedita Java2D drawing methods.

This preparation command reads reference geometry to render images. The solver
runner consumes only these images and frozen recognition inputs, never truth.
Selection and styles do not depend on image-recovery experiment outcomes.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def read(path): return json.loads(Path(path).read_text())
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--confirmation-from', type=Path, help='Exclude these frozen protocol keys and use new render settings')
    args = p.parse_args(); args.out.mkdir(parents=True, exist_ok=True)
    cases = read('artifacts/cp-solver/S095-ink-recovery-baseline/cases.json')
    selected = []
    excluded = set(read(args.confirmation_from)['keys']) if args.confirmation_from else set()
    counts = [('recovered', 3), ('ink_miss', 2), ('other_miss', 1)] if args.confirmation_from else [('recovered', 9), ('ink_miss', 6), ('other_miss', 3)]
    seed = 'oriedita-confirmation-v1:' if args.confirmation_from else 'oriedita-style-v1:'
    # Equal coverage of small/large graphs; deterministic hash within strata.
    for large in [False, True]:
        for group, count in counts:
            def belongs(c):
                if group == 'recovered': return c['baseline_exact']
                if group == 'ink_miss': return not c['baseline_exact'] and c['previous_ink_favors_reference']
                return not c['baseline_exact'] and not c['previous_ink_favors_reference']
            pool = [c for c in cases if c['key'] not in excluded and (c['vertices'] > 150) == large and belongs(c)]
            pool.sort(key=lambda c: hashlib.sha256((seed + c['key']).encode()).hexdigest())
            selected.extend(pool[:count])
    styles = [
        dict(name='thin', size=1024, width=.75, points=0, aa=True),
        dict(name='markers-small', size=1024, width=1, points=1, aa=True),
        dict(name='markers-medium', size=1024, width=1.5, points=2, aa=True),
        dict(name='thick-markers', size=1024, width=3, points=3, aa=True),
        dict(name='aliased-thin', size=1024, width=1, points=0, aa=False),
        dict(name='aliased-markers', size=1024, width=2, points=2, aa=False),
        dict(name='high-resolution', size=2048, width=2, points=1, aa=True),
        dict(name='color-and-shape', size=1024, width=1, points=1, aa=True, style='COLOR_AND_SHAPE'),
        dict(name='black-gray', size=1024, width=1, points=1, aa=True, style='BLACK_WHITE'),
        dict(name='dark', size=1024, width=1, points=1, aa=True, dark=True),
    ]
    if args.confirmation_from:
        styles = [
            dict(name='hairline', size=1024, width=.5, points=0, aa=True),
            dict(name='wide-small-markers', size=1024, width=2.5, points=1, aa=True),
            dict(name='large-dots', size=1024, width=1.25, points=4, aa=True),
            dict(name='aliased-1536', size=1536, width=1, points=2, aa=False),
        ]
    source = Path('third_party/oriedita')
    source_files = [source / 'oriedita-ui/src/main/java/oriedita/editor/drawing/tools/DrawingUtil.java',
                    source / 'oriedita-data/src/main/java/oriedita/editor/Colors.java',
                    source / 'oriedita-common/src/main/java/oriedita/editor/drawing/tools/Camera.java']
    protocol = dict(keys=[c['key'] for c in selected], styles=styles,
                    renderer_sha256=sha(Path(__file__).with_name('OrieditaCpRenderer.java')),
                    script_sha256=sha(__file__), upstream={str(f): sha(f) for f in source_files},
                    purpose='paired solver evidence test; recognition graph frozen across render styles',
                    selection_seed=seed, excluded_keys=sorted(excluded))
    path = args.out / 'protocol.json'
    if path.exists() and read(path) != protocol: raise ValueError('Protocol changed')
    path.write_text(json.dumps(protocol, indent=2))
    subprocess.run(['bash', str(Path(__file__).with_name('build-oriedita-renderer.sh')), str(args.out / 'classes')], check=True)
    manifest = []
    for c in selected:
        name = c['key'].replace('/', '__')
        truth = Path('artifacts/cp-solver/S093-browser-validation/browser-audit/with_aux') / name / 'truth.fold'
        fold = read(truth)
        coords = fold['vertices_coords']
        cp = args.out / (name + '.cp')
        colors = {'B': 1, 'M': 2, 'V': 3, 'F': 4, 'U': 4}
        cp.write_text(''.join(f'{colors[a]} ' + ' '.join(format(v / 1024, '.17g') for v in coords[e[0]][:2] + coords[e[1]][:2]) + '\n'
                              for e, a in zip(fold['edges_vertices'], fold['edges_assignment'], strict=True)))
        for style in styles:
            out = args.out / 'images' / style['name']; out.mkdir(parents=True, exist_ok=True)
            image = out / (name + '.png')
            subprocess.run(['java', '-Djava.awt.headless=true', '-XX:-UsePerfData', '-cp', str(args.out / 'classes'),
                            'OrieditaCpRenderer', str(cp), str(image), str(style['size']), str(style['width']),
                            str(style['points']), str(style['aa']).lower(), style.get('style', 'COLOR'),
                            'true', str(style.get('dark', False)).lower()], check=True)
            size = style['size']; lo = size / 32; hi = size - lo
            manifest.append(dict(key=c['key'], style=style['name'], input=c['input'], source=str(image),
                                 source_sha256=sha(image), input_sha256=sha(c['input']),
                                 quad=[[lo, lo], [hi, lo], [hi, hi], [lo, hi]]))
        print(c['key'], flush=True)
    (args.out / 'manifest.json').write_text(json.dumps(manifest, indent=2))


if __name__ == '__main__': main()
