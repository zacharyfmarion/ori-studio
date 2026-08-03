import { describe, expect, it } from 'vitest';
import { dragBoxTool, type DragBoxState } from './dragBoxTool';
import type { ToolInput } from './types';
import { userCameraToView } from '../renderer/camera';
import type { Viewport } from '../renderer/types';

function run(inputs: ToolInput[]) {
  let state: DragBoxState = dragBoxTool.initialState;
  return inputs.map((input) => {
    const out = dragBoxTool.reduce(state, input);
    state = out.state;
    return out;
  });
}

describe('dragBoxTool', () => {
  it('rubber-bands a rectangle (4 edges) while dragging', () => {
    const [, move] = run([
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'move', point: { x: 10, y: 4 } },
    ]);
    // Corner order follows upstream's `Rectangle(p19_a, p19_b, p19_c, p19_d)`:
    // press, then along the cursor's y, then the cursor, then back along its x.
    expect(move.preview?.segments).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 0, y: 4 } },
      { a: { x: 0, y: 4 }, b: { x: 10, y: 4 } },
      { a: { x: 10, y: 4 }, b: { x: 10, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 0, y: 0 } },
    ]);
  });

  it('commits the two opposite corners on release', () => {
    const outs = run([
      { kind: 'down', point: { x: 1, y: 2 } },
      { kind: 'move', point: { x: 5, y: 8 } },
      { kind: 'up', point: { x: 5, y: 8 } },
    ]);
    expect(outs[2].commit).toEqual({ points: [{ x: 1, y: 2 }, { x: 5, y: 8 }] });
    expect(outs[2].state).toEqual({ start: null });
  });

  it('commits a flat box from a straight drag along one axis', () => {
    const outs = run([
      { kind: 'down', point: { x: 1, y: 2 } },
      { kind: 'up', point: { x: 1, y: 9 } }, // same x, zero width
    ]);
    expect(outs[1].commit).toEqual({ points: [{ x: 1, y: 2 }, { x: 1, y: 9 }] });
  });

  it('does not commit a zero-length gesture', () => {
    const outs = run([
      { kind: 'down', point: { x: 1, y: 2 } },
      { kind: 'up', point: { x: 1, y: 2 } },
    ]);
    expect(outs[1].commit).toBeNull();
  });

  it('cancel drops the box', () => {
    const outs = run([
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'cancel', point: { x: 3, y: 3 } },
    ]);
    expect(outs[1].commit).toBeNull();
    expect(outs[1].state).toEqual({ start: null });
  });

  describe('with a view transform', () => {
    const vp: Viewport = { width: 800, height: 600, dpr: 1 };
    const viewAt = (rotation: number) =>
      userCameraToView({ centerX: 0, centerY: 0, zoom: 2, rotation }, vp);

    it('commits four corners, which the kernel reads as a polygon', () => {
      const viewTransform = viewAt(Math.PI / 4);
      const outs = run([
        { kind: 'down', point: { x: 0, y: 0 }, viewTransform },
        { kind: 'up', point: { x: 10, y: 4 }, viewTransform },
      ]);
      const points = outs[1].commit?.points;
      expect(points).toHaveLength(4);
      // The drag's own corners stay the polygon's diagonal.
      expect(points?.[0]).toEqual({ x: 0, y: 0 });
      expect(points?.[2].x).toBeCloseTo(10);
      expect(points?.[2].y).toBeCloseTo(4);
    });

    it('previews the box turned with the view, not with the model', () => {
      const viewTransform = viewAt(Math.PI / 4);
      const [, move] = run([
        { kind: 'down', point: { x: 0, y: 0 }, viewTransform },
        { kind: 'move', point: { x: 10, y: 0 }, viewTransform },
      ]);
      const first = move.preview?.segments[0];
      // A horizontal drag in *model* space would give a zero-height box; turned
      // 45 degrees it is a real quad whose edges run diagonally through the model.
      expect(Math.abs(first!.b.x - first!.a.x)).toBeGreaterThan(1e-6);
      expect(Math.abs(first!.b.y - first!.a.y)).toBeGreaterThan(1e-6);
    });

    it('still commits two points when no view is supplied', () => {
      // The operation frame depends on this: its kernel handler reads the points
      // positionally, so four perimeter corners would make the frame span an edge.
      const outs = run([
        { kind: 'down', point: { x: 1, y: 2 } },
        { kind: 'up', point: { x: 5, y: 8 } },
      ]);
      expect(outs[1].commit?.points).toHaveLength(2);
    });

    it('rejects a zero-length gesture at any rotation', () => {
      const viewTransform = viewAt(1.1);
      const outs = run([
        { kind: 'down', point: { x: 4, y: 4 }, viewTransform },
        { kind: 'up', point: { x: 4, y: 4 }, viewTransform },
      ]);
      expect(outs[1].commit).toBeNull();
    });
  });
});
