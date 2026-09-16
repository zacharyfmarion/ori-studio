#!/usr/bin/env python3
"""Reproduce and verify the compact research model; optionally enable local preview.

Does not modify current-model.json or publish a production registry. The ignored
local registry is a preview override; remove it to return to the stable model.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

from pixel_vertex import PixelVertex

ROOT = Path(__file__).resolve().parents[3]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--candidate', type=Path, default=ROOT / 'research/cp-recognition/candidate.json')
    p.add_argument('--checkpoint', type=Path)
    p.add_argument('--preview', action='store_true')
    p.add_argument('--install-current', action='store_true', help='Copy the verified export to the current product asset directories')
    args = p.parse_args()
    config = json.loads(args.candidate.read_text())
    checkpoint = args.checkpoint or ROOT / config['checkpoint']['path']
    if digest(checkpoint) != config['checkpoint']['sha256']:
        raise ValueError('Checkpoint does not match the selected candidate')
    state = torch.load(checkpoint, map_location='cpu', weights_only=False)
    if state['config']['real_training_patterns'] != 0:
        raise ValueError('Synthetic-only training provenance required')
    model = PixelVertex(state['config']['width']).eval()
    model.load_state_dict(state['model'])
    torch.set_num_threads(2)
    folder = ROOT / config['asset_dir']
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / 'model.onnx'
    torch.onnx.export(model, torch.zeros(1, 3, 512, 512), path,
                      input_names=['image'], output_names=['vertices'], opset_version=17, dynamo=False)
    if digest(path) != config['onnx']['sha256'] or path.stat().st_size != config['onnx']['size_bytes']:
        raise ValueError('ONNX bytes differ from the evaluated export; inspect toolchain versions')
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(str(path), options, providers=['CPUExecutionProvider'])
    sample = np.random.default_rng(9127).random((1, 3, 512, 512), dtype=np.float32)
    with torch.no_grad():
        expected = model(torch.from_numpy(sample)).numpy()
    actual = session.run(None, {'image': sample})[0]
    error = float(abs(expected - actual).max())
    if error > 1e-4:
        raise ValueError(f'ONNX parity failed: maximum absolute difference {error}')
    manifest = {'schema':'oristudio/cp-detect-model-manifest/v1', 'id':config['model_id'],
                'created_at':config['created_at'],
                'model':{'url':'model.onnx','sha256':digest(path),'size_bytes':path.stat().st_size,'format':'onnx'},
                'inference':config['inference'],'outputs':config['outputs']}
    (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    if args.install_current:
        current = json.loads((ROOT / 'scripts/cp-detect/current-model.json').read_text())
        if current['model_id'] != config['model_id'] or current['model_sha256'] != digest(path):
            raise ValueError('Research export is not the current product model')
        for key in ['stable_model_asset_dir', 'versioned_model_asset_dir']:
            target = ROOT / current[key]
            target.mkdir(parents=True, exist_ok=True)
            for name in ['model.onnx', 'manifest.json']:
                if (folder / name).resolve() != (target / name).resolve():
                    shutil.copyfile(folder / name, target / name)
    if args.preview:
        public = ROOT / 'apps/web/public'
        registry_path = public / 'models/registry-pixel-v1.json'
        registry = json.loads(registry_path.read_text()) if registry_path.exists() else {
            'schema':'oristudio/cp-detect-model-registry/v1', 'families':{}}
        if registry['schema'] != 'oristudio/cp-detect-model-registry/v1':
            raise ValueError('Unexpected local registry schema')
        family = registry['families'].setdefault('cp-detector', {'current':'', 'versions':[]})
        previous = [v for v in family['versions'] if v['id'] != config['model_id']]
        version = max([v['version'] for v in previous], default=0) + 1
        url = '/' + folder.relative_to(public).as_posix()
        entry = {'id':config['model_id'],'version':version,'released':config['created_at'],
                 'size_bytes':path.stat().st_size,'sha256':digest(path),
                 'manifest_url':url+'/manifest.json','model_url':url+'/model.onnx',
                 'note':'Local synthetic-only research preview'}
        family.update(current=config['model_id'], versions=previous+[entry])
        registry_path.write_text(json.dumps(registry, indent=2) + '\n')
    print(json.dumps({'model':str(path), 'sha256':digest(path), 'max_onnx_error':error,
                      'local_preview':args.preview}))


if __name__ == '__main__':
    main()
