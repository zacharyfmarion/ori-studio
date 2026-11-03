"""Build an entirely local, precomputed experiment from external user files."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

from solver import Prepared, solve, metrics
from topology import transverse_crossings

ROOT = Path(__file__).resolve().parents[3]
CASES = [
    ('strip', 'Joined strip', '--strip'),
    ('waterbomb', 'Waterbomb', 'known-good/waterbombBase.fold'),
    ('three-plane', 'Three-plane stacks', 'non-flat-test.osf'),
    ('spikes', 'Spikes', 'personal/non-flat-harder_final.osf'),
    ('penguin', 'Penguin', 'fold-angle-3d/penguin_freeform.fold'),
    ('cylinder', 'Kirigami cylinder', 'kirigami/kirigami-cylinder.fold'),
    ('rectangles', 'Separated rectangles', 'personal/stacked_rectangles.fold'),
    ('airplane', 'Airplane — unresolved order', 'known-good/airplane.fold'),
    ('unclosed', 'Unclosed example', 'simple_example.osf'),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--corpus', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=ROOT/'artifacts/spatial-spread-prototype')
    parser.add_argument('--only', nargs='*')
    args = parser.parse_args()
    site = args.out/'site'
    sources = args.out/'sources'
    site.mkdir(parents=True, exist_ok=True)
    sources.mkdir(parents=True, exist_ok=True)
    cases = []
    for slug, name, relative in CASES:
        if args.only and slug not in args.only:
            continue
        entry = {'id': slug, 'name': name, 'source': relative}
        try:
            source = str(args.corpus/relative) if relative != '--strip' else relative
            if relative.endswith('.osf'):
                converted = subprocess.run(['node', str(ROOT/'scripts/osf-fold-projection.mjs'), source],
                                           capture_output=True, text=True, check=True, timeout=15)
                source = sources/f'{slug}.fold'
                source.write_text(converted.stdout)
            raw = subprocess.run([str(ROOT/'target/release/examples/fold3d_spread_source'), str(source)],
                                 capture_output=True, text=True, check=True, timeout=25).stdout
            (sources/f'{slug}.json').write_text(raw)
            payload = json.loads(raw)
            prepared = Prepared(payload)
            entry.update({
                'positions': prepared.p.tolist(), 'faces': prepared.faces,
                'triangles': prepared.triangles.tolist(), 'triangleFaces': prepared.triangle_faces,
                'edges': prepared.edges, 'baseTriangles': prepared.base_triangles,
                'baseLines': prepared.base_lines, 'depth': prepared.depth,
                'orderPlanes': prepared.render_order(),
                'planeCount': payload['render']['plane_count'], 'variants': {},
            })
            baseline = set(map(tuple, transverse_crossings(prepared.p, prepared.triangles, prepared.triangle_faces)))
            entry['baselineCrossings'] = len(baseline)
            for label, rigidity in [('balanced', 3.), ('firm', 15.), ('open', 0.6)]:
                d, report = solve(prepared, rigidity)
                entry['variants'][label] = {
                    'displacements': d.tolist(), 'solve': report,
                    'metrics': [metrics(prepared, d, a) for a in [0., .1, .25, .5, .75, 1.]],
                }
                entry['variants'][label]['crossingSamples'] = [
                    {'amount': a, 'new_face_pairs': len(set(map(tuple, transverse_crossings(
                        prepared.p+a*d, prepared.triangles, prepared.triangle_faces)))-baseline)}
                    for a in [.25, .5, 1.]
                ]
                print(json.dumps({'case': slug, 'variant': label, **report,
                                  'at_100': entry['variants'][label]['metrics'][-1]}), flush=True)
            entry['status'] = 'ready'
        except (ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            message = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) else str(error)
            if 'VertexClosure' in message:
                message = 'These crease angles do not close into a consistent 3D figure. No spread was generated.'
            # The UI only needs the reason, not local filesystem paths.
            entry.update({'status': 'unavailable', 'reason': message})
            print(json.dumps({'case': slug, 'status': 'unavailable', 'reason': message}), flush=True)
        cases.append(entry)
    result = {'version': 1, 'cases': cases}
    (site/'examples.json').write_text(json.dumps(result, separators=(',', ':'), allow_nan=False))
    (args.out/'report.json').write_text(json.dumps({'cases': [
        {k: v for k, v in case.items() if k in ['id', 'source', 'status', 'reason', 'planeCount', 'depth']} |
        {'variants': {label: {k: v for k, v in variant.items() if k != 'displacements'}
                      for label, variant in case.get('variants', {}).items()}}
        for case in cases]}, indent=2, allow_nan=False))
    for name in ['index.html', 'viewer.js', 'viewer.css', 'order.mjs', 'renderer.mjs',
                 'render-check.html', 'render-check.mjs']:
        source = Path(__file__).parent/name
        if source.exists():
            shutil.copyfile(source, site/name)
    print(f'Viewer: {site}', flush=True)


if __name__ == '__main__':
    main()
