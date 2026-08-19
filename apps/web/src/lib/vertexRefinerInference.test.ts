import { describe, expect, it } from 'vitest';
import type { CpVertexRefinerModelManifest } from '../engine/cpDetectTypes';
import {
  CP_VERTEX_REFINER_OUTPUT_KEYS,
  parseVertexRefinerModelManifest,
  runVertexRefinerInference,
  vertexRefinerOutputNames,
  type VertexRefinerOnnxSession,
  type VertexRefinerTensorFactory,
} from './vertexRefinerInference';

describe('vertexRefinerInference', () => {
  it('parses and validates a V3 manifest', () => {
    const manifest = parseVertexRefinerModelManifest(JSON.stringify(TEST_MANIFEST));

    expect(manifest.id).toBe('test-v3');
    expect(vertexRefinerOutputNames(manifest.outputs)).toEqual([
      'vertex_heatmap',
      'vertex_offset',
      'vertex_kind',
      'degree',
      'incident_rays',
      'boundary_contact_heatmap',
      'boundary_side',
    ]);
  });

  it('runs a mocked ONNX session with manifest output names', async () => {
    const calls: Array<{ feeds: Record<string, unknown> }> = [];
    const session: VertexRefinerOnnxSession = {
      inputNames: ['refiner_input'],
      async run(feeds) {
        calls.push({ feeds });
        return Object.fromEntries(
          CP_VERTEX_REFINER_OUTPUT_KEYS.map((key) => [
            TEST_MANIFEST.outputs[key],
            { data: new Float32Array([1]), dims: [1, 1, 1, 1] },
          ]),
        );
      },
    };
    const tensorFactory: VertexRefinerTensorFactory = {
      float32(data, dims) {
        return { data, dims };
      },
    };

    const result = await runVertexRefinerInference(
      session,
      tensorFactory,
      new Float32Array(2 * 11 * 96 * 96),
      TEST_MANIFEST,
    );

    expect(result.input).toEqual({
      crop_size: 96,
      crop_count: 2,
      input_name: 'refiner_input',
    });
    expect(calls).toHaveLength(1);
    expect(result.outputs.boundary_side.data[0]).toBe(1);
  });

  it('rejects unsupported input contracts', () => {
    expect(() =>
      parseVertexRefinerModelManifest(
        JSON.stringify({
          ...TEST_MANIFEST,
          inference: { ...TEST_MANIFEST.inference, input_channels: 12 },
        }),
      ),
    ).toThrow(/input_channels/u);
  });
});

const TEST_MANIFEST: CpVertexRefinerModelManifest = {
  schema: 'oristudio/cp-vertex-refiner-model-manifest/v1',
  id: 'test-v3',
  model: { url: 'model.onnx' },
  inference: {
    model_version: 'v3',
    input_version: 'v3',
    onnx_input_name: 'refiner_input',
    crop_size: 96,
    input_channels: 11,
    heatmap_threshold: 0.25,
    boundary_heatmap_threshold: 0.25,
  },
  outputs: {
    vertex_heatmap: 'vertex_heatmap',
    vertex_offset: 'vertex_offset',
    vertex_kind: 'vertex_kind',
    degree: 'degree',
    incident_rays: 'incident_rays',
    boundary_contact_heatmap: 'boundary_contact_heatmap',
    boundary_side: 'boundary_side',
  },
};
