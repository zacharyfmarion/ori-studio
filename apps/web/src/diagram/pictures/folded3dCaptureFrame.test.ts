import { describe, expect, it } from 'vitest';
import { cameraUniforms, projectVertices } from '@treemaker/origami-simulator';
import { FOLDED_3D_LOCAL_CENTER, folded3dLocalFrameSide } from '../../cp-workspace/adapters/cpFoldedToScene';
import { folded3dSceneCamera } from '../../cp-workspace/folded/folded3dScene';
import { folded3dFrameFillZoom, folded3dWindowView } from '../../cp-workspace/folded/folded3dWindow';
import { folded3dCaptureFrame } from './folded3dCaptureFrame';

/**
 * The capture's projection (`folded3dSceneCamera` into the document box, then
 * the shift onto the local centre) against the live view's (the window view
 * at the frame-fill zoom, into the canvas), through the real camera code: a
 * point of the model lands where the frame says, on a wide and a tall view.
 */
describe('folded3dCaptureFrame', () => {
  const mesh = { center: [0.3, -0.2, 0.1] as [number, number, number], radius: 1.7 };
  const frameRadius = 1.9;
  const camera = { yaw: 0.6, pitch: -0.7, zoom: 1.3 };
  const points = new Float32Array([0.3, -0.2, 0.1, 1.2, 0.4, -0.5, -0.9, -1.1, 0.6, 0.1, 1.4, 0.2]);

  function captured(): Float32Array {
    const side = folded3dLocalFrameSide(frameRadius);
    const { screen } = projectVertices(points, folded3dSceneCamera(camera, mesh, side));
    const shift = [FOLDED_3D_LOCAL_CENTER.x - side / 2, FOLDED_3D_LOCAL_CENTER.y - side / 2];
    return screen.map((value, index) => value + shift[index % 2]!);
  }

  function live(width: number, height: number): Float32Array {
    const view = folded3dWindowView(camera);
    const uniforms = cameraUniforms(
      { ...view, zoom: view.zoom * folded3dFrameFillZoom(width, height) },
      mesh.center,
      mesh.radius,
      width,
      height
    );
    return projectVertices(points, uniforms).screen;
  }

  it.each([
    [1600, 900],
    [700, 1200],
  ])('carries the capture onto a %i × %i view', (width, height) => {
    const scene = captured();
    const view = live(width, height);
    const xs = [scene[0]!, scene[2]!, scene[4]!, scene[6]!];
    const ys = [scene[1]!, scene[3]!, scene[5]!, scene[7]!];
    const bounds = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    const frame = folded3dCaptureFrame(bounds, frameRadius, width, height)!;
    const k = frame.width / (bounds.maxX - bounds.minX);
    // To a hundredth of a px: the projection's screen arrays are Float32.
    for (let i = 0; i < 4; i += 1) {
      expect(frame.x + (scene[i * 2]! - bounds.minX) * k).toBeCloseTo(view[i * 2]!, 2);
      expect(frame.y + (scene[i * 2 + 1]! - bounds.minY) * k).toBeCloseTo(view[i * 2 + 1]!, 2);
    }
  });

  it('has no frame on an empty view or for a figure with no frame', () => {
    const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    expect(folded3dCaptureFrame(bounds, 1, 0, 100)).toBeNull();
    expect(folded3dCaptureFrame(bounds, 0, 100, 100)).toBeNull();
  });
});
