import { describe, expect, it } from 'vitest';
import type { PaperItem, PaperScene } from '@treemaker/origami-simulator';
import type { DiagramScenePicture } from '../document/diagramDocument';
import { paintedScene, storedScene } from './storedScene';

const face: PaperItem = {
  kind: 'face',
  face: 0,
  side: 'front',
  rings: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  ],
  shade: 1,
  hidden: false,
};
const edge: PaperItem = { kind: 'line', role: 'edge', a: [0, 0], b: [10, 0], onBoundary: [false, false], hidden: false };
/** On the face, ending on its edge: a capture made before aux lines went under drew it last. */
const aux: PaperItem = { kind: 'line', role: 'aux', a: [5, 0], b: [5, 8], onBoundary: [true, false], hidden: false };

function picture(items: PaperItem[]): DiagramScenePicture {
  const scene: PaperScene = { bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, sheet: 10, items };
  return { kind: 'scene', sceneJson: JSON.stringify(scene), paperScale: null, styleKey: null, key: 'k' };
}

describe('a stored picture as it is painted', () => {
  it('draws a stored aux line beneath the edge it meets, folded or simulated, and keeps what is stored', () => {
    for (const simulated of [false, true]) {
      const stored = picture([face, edge, aux]);
      expect(paintedScene(stored, simulated)?.items).toEqual([face, aux, edge]);
      expect(storedScene(stored)?.items).toEqual([face, edge, aux]);
    }
  });

  it('is the stored scene itself when its aux lines are already beneath', () => {
    const stored = picture([face, aux, edge]);
    expect(paintedScene(stored, false)).toBe(storedScene(stored));
  });
});
