import { expect, it } from 'vitest';
import { DEFAULT_FOLDED_3D_CAMERA } from '../cp-workspace/folded/folded3dCamera';
import { NEWER } from '../lib/documentFile';
import { readPaperFaces, storedPaperFaces, NEWER_PAPER_FACES } from '../diagram/document/paperFacesFile';
import { readSpreadPresentation } from './presentation';
it('keeps the remembered camera and edge-on side even in diagram presentation', () => {
  const value = {
    kind: 'diagram',
    camera: { ...DEFAULT_FOLDED_3D_CAMERA, zoom: 1.3, orient: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    orderSide: 'back',
  };
  expect(readSpreadPresentation(JSON.parse(JSON.stringify(value)))).toEqual(value);
  expect(readSpreadPresentation(undefined)).toBeUndefined();
  expect(readSpreadPresentation({ ...value, camera: { ...value.camera, zoom: NaN } })).toBeNull();
  expect(readSpreadPresentation({ ...value, kind: 'future' })).toBe(NEWER);
  expect(readSpreadPresentation({ ...value, camera: { ...value.camera, future: 1 } })).toBe(NEWER);
});
it('round-trips the actual triangulated drawing and rejects invalid annotation indices', () => {
  const faces = {
    points: [
      [0, 0, 0, 0],
      [1, 0, 1, 0],
      [1, 1, 1, 1],
      [0, 1, 0, 1],
    ] as [number, number, number, number][],
    rings: [[0, 1, 2, 3]],
    levels: [0],
    triangles: [
      [
        [0, 1, 2],
        [0, 2, 3],
      ] as [number, number, number][],
    ],
    drawn: [
      [
        [0, 0],
        [1, 0],
        [1.1, 1.2],
        [0, 1],
      ] as [number, number][],
    ],
  };
  expect(readPaperFaces(storedPaperFaces(faces))).toEqual({ faces, json: JSON.stringify(faces) });
  expect(readPaperFaces(JSON.stringify({ ...faces, triangles: [[[0, 1, 4]]] }))).toBeNull();
  expect(readPaperFaces(JSON.stringify({ ...faces, drawn: [[[0, 0]]] }))).toBeNull();
  expect(readPaperFaces(JSON.stringify({ ...faces, future: true }))).toBe(NEWER_PAPER_FACES);
});
