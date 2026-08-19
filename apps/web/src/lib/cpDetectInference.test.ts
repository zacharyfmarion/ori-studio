import { describe, expect, it } from 'vitest';
import type { CpDetectModelManifest } from '../engine/cpDetectTypes';
import {
  CP_DETECT_OUTPUT_KEYS,
  cpDetectOutputNames,
  preprocessCpDetectImage,
  runCpDetectDenseInference,
  type CpDetectOnnxSession,
  type CpDetectTensorFactory,
} from './cpDetectInference';

describe('cpDetectInference', () => {
  it('preprocesses RGBA ImageData into RGB CHW float32', () => {
    const image = testImageData(
      new Uint8ClampedArray([255, 0, 0, 255, 0, 128, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
      2,
      2,
    );

    const tensor = preprocessCpDetectImage(image, 2);

    expect(Array.from(tensor)).toEqual([
      1,
      0,
      0,
      1,
      0,
      expect.closeTo(128 / 255),
      0,
      1,
      0,
      0,
      1,
      1,
    ]);
  });

  it('runs a mocked ONNX session with the manifest output names', async () => {
    const calls: Array<{
      feeds: Record<string, unknown>;
    }> = [];
    const session: CpDetectOnnxSession = {
      inputNames: ['image'],
      async run(feeds) {
        calls.push({ feeds });
        return Object.fromEntries(
          CP_DETECT_OUTPUT_KEYS.map((key) => [
            TEST_MANIFEST.outputs[key],
            { data: new Float32Array([1]), dims: [1, 1, 1, 1] },
          ]),
        );
      },
    };
    const tensorFactory: CpDetectTensorFactory = {
      float32(data, dims) {
        return { data, dims };
      },
    };
    const image = testImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);

    const result = await runCpDetectDenseInference(session, tensorFactory, image, TEST_MANIFEST);

    expect(result.input).toEqual({ image_size: 4, input_name: 'image' });
    expect(calls).toHaveLength(1);
    expect(cpDetectOutputNames(TEST_MANIFEST.outputs)).toContain('line_logits');
    expect(result.outputs.line_logits.dims).toEqual([1, 1, 1, 1]);
    expect(result.outputs.boundary_coord.data[0]).toBe(1);
  });
});

function testImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  return {
    data,
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData;
}

const TEST_MANIFEST: CpDetectModelManifest = {
  schema: 'oristudio/cp-detect-model-manifest/v1',
  id: 'test',
  model: { url: 'model.onnx' },
  inference: {
    image_size: 4,
    threshold: 0.65,
    preprocessing: 'rgb_chw_float32_0_1',
  },
  outputs: {
    line_logits: 'line_logits',
    angle: 'angle',
    junction_logits: 'junction_logits',
    junction_offset: 'junction_offset',
    assignment_logits: 'assignment_logits',
    non_crease_logits: 'non_crease_logits',
    line_style_logits: 'line_style_logits',
    boundary_contact_logits: 'boundary_contact_logits',
    vertex_type_logits: 'vertex_type_logits',
    boundary_side_logits: 'boundary_side_logits',
    boundary_offset: 'boundary_offset',
    boundary_coord: 'boundary_coord',
  },
};
