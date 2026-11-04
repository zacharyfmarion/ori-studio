import { beforeEach, describe, expect, it } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { resetFoldedFigureHandles } from './foldedFigureHandles';
import { foldPressMoved, markFoldPress } from './foldPress';

const opened = (loadSerial: number) => ({ loadSerial }) as OristudioCpDocumentState;

describe('a Layer order press’s mark', () => {
  beforeEach(async () => {
    await resetFoldedFigureHandles();
  });

  const state = { oristudioCpRevision: 3, oristudioCpDocument: opened(1) };

  it('holds while nothing moved, a selection or a figure’s verb included', () => {
    const press = markFoldPress(state);
    expect(foldPressMoved(press, { ...state })).toBe(false);
  });

  it.each([
    ['a crease edited', { ...state, oristudioCpRevision: 4 }],
    ['another load of a crease pattern', { ...state, oristudioCpDocument: opened(2) }],
    ['the crease pattern closed', { ...state, oristudioCpDocument: null }],
  ])('moves on %s', (_what, now) => {
    expect(foldPressMoved(markFoldPress(state), now)).toBe(true);
  });

  it('moves when the handles were torn down, even on the same numbers', async () => {
    const press = markFoldPress(state);
    await resetFoldedFigureHandles();
    expect(foldPressMoved(press, state)).toBe(true);
  });
});
