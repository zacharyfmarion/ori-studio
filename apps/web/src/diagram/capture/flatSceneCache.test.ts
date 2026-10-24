import { expect, it } from 'vitest';
import type { OristudioCpDocumentSnapshot, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { cachedFlatScene, rememberFlatScene } from './flatSceneCache';

it('reuses immutable geometry only for the exact document, creases, side and layer solution', () => {
  const document = {} as OristudioCpDocumentSnapshot;
  const scene = {} as OristudioCpFoldedPaperScene;
  rememberFlatScene(document, '1,2', 'front', 1, scene);
  expect(cachedFlatScene(document, '1,2', 'front', 1)).toBe(scene);
  expect(cachedFlatScene({ ...document }, '1,2', 'front', 1)).toBeNull();
  expect(cachedFlatScene(document, '1,3', 'front', 1)).toBeNull();
  expect(cachedFlatScene(document, '1,2', 'back', 1)).toBeNull();
  expect(cachedFlatScene(document, '1,2', 'front', 2)).toBeNull();
  expect(cachedFlatScene(document, '1,2', 'front', 1, 1)).toBeNull();
  for (const lines of ['3', '4']) rememberFlatScene(document, lines, 'front', 1, scene);
  expect(cachedFlatScene(document, '1,2', 'front', 1)).toBe(scene);
  rememberFlatScene(document, '5', 'front', 1, scene);
  expect(cachedFlatScene(document, '3', 'front', 1)).toBeNull();
  expect(cachedFlatScene(document, '1,2', 'front', 1)).toBe(scene);
});
