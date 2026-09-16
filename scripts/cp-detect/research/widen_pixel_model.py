#!/usr/bin/env python3
"""E024: widen a synthetic-only PixelVertex checkpoint, preserving its function.

Replicate feature channels and divide their outgoing weights by replication
count. Decoder concatenations need separate channel maps for their two inputs.
Optional small noise breaks symmetry for subsequent synthetic fine-tuning;
the unperturbed transformation's parity is checked and recorded first.
Reference: https://arxiv.org/abs/1511.05641 (Net2Net).
"""
import argparse
import hashlib
import json
from pathlib import Path

import torch

from pixel_vertex import PixelVertex


def widen(original, width):
    old_width = original.width
    if width <= old_width:
        raise ValueError('New width must exceed the original')
    expanded = PixelVertex(width)
    old = original.state_dict(); new = expanded.state_dict()
    decoder_parts = {'dec2': [6, 4], 'dec1': [4, 2], 'dec0': [2, 1]}
    for name, destination in new.items():
        source = old[name]
        if source.ndim == 0:
            new[name] = source.clone()
        elif source.ndim == 1:
            new[name] = source[torch.arange(len(destination)) % len(source)].clone()
        elif source.ndim == 4:
            output_map = torch.arange(destination.shape[0]) % source.shape[0]
            block = name.split('.')[0]
            if name.endswith('.0.weight') and block in decoder_parts:
                mappings = []; offset = 0
                for multiplier in decoder_parts[block]:
                    mappings.append(torch.arange(width * multiplier) % (old_width * multiplier) + offset)
                    offset += old_width * multiplier
                input_map = torch.cat(mappings)
            else:
                input_map = torch.arange(destination.shape[1]) % source.shape[1]
            counts = torch.bincount(input_map, minlength=source.shape[1])
            new[name] = source[output_map][:, input_map].clone() / counts[input_map][None, :, None, None]
        else:
            raise ValueError(f'Unexpected parameter rank: {name}')
    expanded.load_state_dict(new)
    return expanded.eval()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--width', type=int, default=24)
    p.add_argument('--noise', type=float, default=.001)
    p.add_argument('--export', type=Path)
    args = p.parse_args()
    if args.out.exists():
        raise ValueError('Refusing to overwrite checkpoint')
    state = torch.load(args.checkpoint, map_location='cpu', weights_only=False)
    if state['config']['real_training_patterns'] != 0:
        raise ValueError('Synthetic-only parent required')
    torch.set_num_threads(2); torch.manual_seed(991016)
    original = PixelVertex(state['config']['width']).eval()
    original.load_state_dict(state['model'])
    model = widen(original, args.width)
    sample = torch.rand(1, 3, 128, 128)
    with torch.no_grad():
        expected = original(sample)
        difference = float((model(sample) - expected).abs().max())
        if difference > 1e-4:
            raise ValueError(f'Widening is not function preserving: {difference}')
        if args.noise < 0:
            raise ValueError('Noise must be nonnegative')
        for name, parameter in model.named_parameters():
            if parameter.ndim == 4 and not name.startswith('head.'):
                parameter.add_(torch.randn_like(parameter) * parameter.std() * args.noise)
        perturbed_difference = float((model(sample) - expected).abs().max())
    config = {'real_training_patterns': 0, 'width': args.width, 'parent_width': original.width,
              'parent_sha256': hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
              'transform': 'replicate-channels-divide-outgoing-weights', 'noise_fraction': args.noise,
              'unperturbed_max_error': difference, 'perturbed_max_error': perturbed_difference,
              'transform_source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'parameters': sum(p.numel() for p in model.parameters()), 'torch': torch.__version__}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({'model': model.state_dict(), 'config': config, 'step': 0}, args.out)
    args.out.with_suffix('.json').write_text(json.dumps(config, indent=2))
    if args.export:
        args.export.parent.mkdir(parents=True, exist_ok=True)
        torch.onnx.export(model, torch.zeros(1, 3, 512, 512), args.export,
                          input_names=['image'], output_names=['vertices'], opset_version=17,
                          dynamo=False)
    print(json.dumps(config))


if __name__ == '__main__':
    main()
