import { describe, expect, it } from 'vitest';
import { cubicPoint } from '../../lib/cubicBezier';
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import { ARROW_BEND, pathCubics, type PicturePoint } from './annotationModel';
import { dragPath, pathDragEdit, pathGripAnchor } from './editPathGesture';

const S: KnownDiagramAnnotation = {
  id: 's',
  kind: 'valley-arrow',
  from: [0.1, 0.5],
  to: [0.7, 0.5],
  path: [
    { at: [0.1, 0.5], out: [0.2, 0.3] },
    { at: [0.4, 0.5], in: [0.3, 0.6], out: [0.5, 0.4] },
    { at: [0.7, 0.5], in: [0.6, 0.7] },
  ],
};
const NONE = { shift: false, alt: false };
const angleOf = (from: PicturePoint, to: PicturePoint) => (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;

describe('where a press took hold', () => {
  it('is the node, the handle, or the point on the curve at t', () => {
    expect(pathGripAnchor(S, { part: 'node', node: 1 })).toEqual([0.4, 0.5]);
    expect(pathGripAnchor(S, { part: 'handle', node: 1, side: 'out' })).toEqual([0.5, 0.4]);
    const [x, y] = cubicPoint(pathCubics(S.path!)[0]!, 0.3);
    expect(pathGripAnchor(S, { part: 'segment', segment: 0, t: 0.3 })).toEqual([x, y]);
    expect(pathGripAnchor(S, { part: 'node', node: 7 })).toBeNull();
  });
});

describe('a drag in Edit Path', () => {
  it('moves a node by the pointer’s travel, its handles with it', () => {
    const moved = dragPath(S, { part: 'node', node: 1 }, [0.4, 0.5], [0.02, -0.1], NONE).path![1]!;
    expect(moved.at[0]).toBeCloseTo(0.42, 12);
    expect(moved.at[1]).toBeCloseTo(0.4, 12);
    expect(moved.out![0]).toBeCloseTo(0.52, 12);
  });

  it('with Shift, keeps a node to 0, 45 or 90° from where it started', () => {
    const along = dragPath(S, { part: 'node', node: 1 }, [0.4, 0.5], [0.1, 0.012], { shift: true, alt: false }).path![1]!;
    expect(along.at[1]).toBeCloseTo(0.5, 12);
    const diagonal = dragPath(S, { part: 'node', node: 1 }, [0.4, 0.5], [0.05, -0.04], { shift: true, alt: false }).path![1]!;
    expect(angleOf([0.4, 0.5], diagonal.at)).toBeCloseTo(-45, 9);
  });

  it('turns a smooth node’s other handle with the one dragged, keeping its length', () => {
    const node = dragPath(S, { part: 'handle', node: 1, side: 'out' }, [0.5, 0.4], [0, 0.2], NONE).path![1]!;
    expect(node.out).toEqual([expect.closeTo(0.5, 12), expect.closeTo(0.6, 12)]);
    expect(node.type).toBeUndefined();
    expect(angleOf(node.at, node.in!)).toBeCloseTo(angleOf(node.out!, node.at), 9);
    expect(Math.hypot(node.in![0] - 0.4, node.in![1] - 0.5)).toBeCloseTo(Math.hypot(0.1, 0.1), 12);
  });

  it('with Alt, makes the node a corner and leaves its other handle where it was', () => {
    const node = dragPath(S, { part: 'handle', node: 1, side: 'out' }, [0.5, 0.4], [0, 0.2], { shift: false, alt: true })
      .path![1]!;
    expect(node.type).toBe('corner');
    expect(node.in).toEqual([0.3, 0.6]);
    expect(node.out).toEqual([expect.closeTo(0.5, 12), expect.closeTo(0.6, 12)]);
  });

  it('with Shift, turns a handle in 15° steps about its node', () => {
    const node = dragPath(S, { part: 'handle', node: 1, side: 'out' }, [0.5, 0.4], [0.03, 0.05], { shift: true, alt: false })
      .path![1]!;
    const angle = angleOf(node.at, node.out!);
    expect(Math.abs(angle / 15 - Math.round(angle / 15))).toBeLessThan(1e-9);
  });

  it('bends the curve so the point taken hold of follows the pointer', () => {
    const anchor = pathGripAnchor(S, { part: 'segment', segment: 1, t: 0.4 })!;
    const bent = dragPath(S, { part: 'segment', segment: 1, t: 0.4 }, anchor, [0.01, 0.05], NONE);
    const [x, y] = cubicPoint(pathCubics(bent.path!)[1]!, 0.4);
    expect(x).toBeCloseTo(anchor[0] + 0.01, 12);
    expect(y).toBeCloseTo(anchor[1] + 0.05, 12);
  });

  it('shapes an arc on its first move, and names its undo step and gesture', () => {
    const arc: KnownDiagramAnnotation = { id: 'a', kind: 'mountain-arrow', from: [0.2, 0.5], to: [0.5, 0.5], bend: ARROW_BEND };
    const shaped = dragPath(arc, { part: 'node', node: 1 }, [0.5, 0.5], [0, 0.05], NONE);
    expect(shaped.bend).toBeUndefined();
    expect(shaped.to).toEqual([0.5, expect.closeTo(0.55, 12)]);
    expect(pathDragEdit({ part: 'node', node: 0 })).toEqual({ label: 'Move node', gesture: 'drag_node' });
    expect(pathDragEdit({ part: 'handle', node: 0, side: 'out' })).toEqual({ label: 'Move handle', gesture: 'drag_handle' });
    expect(pathDragEdit({ part: 'segment', segment: 0, t: 0.5 })).toEqual({ label: 'Bend curve', gesture: 'bend' });
  });
});
