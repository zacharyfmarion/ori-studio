import { describe, expect, it } from 'vitest';
import { cameraUniforms, projectVertices } from '@treemaker/origami-simulator';
import type { SceneBounds } from '../../lib/paper/paperScene';
import { simulatedCaptureFrame } from './simulatedCaptureFrame';

/** A model that is not flat, so perspective has something to bend. */
const POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0.4, 1, 1, -0.3, 0, 1, 0.8, 0.5, 0.5, 1.2]);
const CENTER: [number, number, number] = [0.5, 0.5, 0.4];
const RADIUS = 1;
const VIEW = { yaw: 0.7, pitch: -0.9, zoom: 1.3 };

function projectedBounds(width: number, height: number): SceneBounds {
  const { screen, count } = projectVertices(POSITIONS, cameraUniforms(VIEW, CENTER, RADIUS, width, height), {
    perspective: true,
  });
  const xs: number[] = [];
  const ys: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    xs.push(screen[vertex * 2]!);
    ys.push(screen[vertex * 2 + 1]!);
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

describe('simulatedCaptureFrame', () => {
  it('carries the capture’s square onto a view of the same camera and framing', () => {
    // To a thousandth of a pixel: the projection is in float32.
    const captured = projectedBounds(512, 512);
    for (const [width, height] of [
      [800, 500],
      [600, 1100],
      [512, 512],
    ] as const) {
      const shown = projectedBounds(width, height);
      const box = simulatedCaptureFrame(captured, 512, width, height)!;
      expect(box.x).toBeCloseTo(shown.minX, 3);
      expect(box.y).toBeCloseTo(shown.minY, 3);
      expect(box.width).toBeCloseTo(shown.maxX - shown.minX, 3);
      expect(box.height).toBeCloseTo(shown.maxY - shown.minY, 3);
    }
  });

  it('is null for an empty view', () => {
    expect(simulatedCaptureFrame({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 512, 0, 300)).toBeNull();
  });
});
