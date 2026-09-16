import { describe, expect, it } from 'vitest';
import { pixelVertices, runPixelInference, type PixelTensor } from './cpDetectPixelInference';

describe('compact detector geometry', () => {
  it('uses the inset paper frame for boundary coordinates at both resolutions', () => {
    for (const size of [1024, 2048]) {
      const [vertex] = pixelVertices([[32 + (size - 64) / 4, 33, 0.9]], size);
      expect(vertex.boundary_side).toBe('top');
      expect(vertex.y).toBe(32);
      expect(vertex.side_coordinate).toBe(0.25);
    }
  });

  it('keeps close physical junctions while removing duplicate seam votes', () => {
    const vertices = pixelVertices([[200, 200, 0.9], [200.2, 200.2, 0.8], [202, 200, 0.7]], 1024);
    expect(vertices.map(v => v.x)).toEqual([200, 202]);
  });

  it('assigns a seam peak by its offset position and releases every tensor', async () => {
    const n = 512 * 512;
    let calls = 0, disposedInputs = 0, disposedOutputs = 0;
    const session = {
      inputNames: ['image'], outputNames: ['vertices'],
      async run() {
        const data = new Float32Array(5 * n).fill(-20);
        const tile = calls++;
        if (tile < 2) {
          const x = tile === 0 ? 448 : 64;
          const i = 314 * 512 + x;
          data[i] = 10;
          data[n + i] = -0.2 / 3;
          data[2*n + i] = 0;
        }
        return { vertices: { data, dims: [1,5,512,512], dispose() { disposedOutputs++; } } };
      },
    };
    const result = await runPixelInference(session,
      (data, dims): PixelTensor => ({ data, dims, dispose() { disposedInputs++; } }),
      { data: new Uint8ClampedArray(768*768*4).fill(255), width: 768, height: 768 });
    expect(result.vertices).toHaveLength(1);
    expect(result.vertices[0].x).toBeCloseTo(383.8, 3);
    expect(result.vertices[0].y).toBe(250);
    expect(disposedInputs).toBe(4);
    expect(disposedOutputs).toBe(4);
  });
});
