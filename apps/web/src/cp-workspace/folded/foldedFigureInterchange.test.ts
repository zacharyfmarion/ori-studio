import { describe, expect, it } from 'vitest';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { detachedFolded3dFigures, folded3dExportHandles } from './foldedFigureInterchange';

function figure(
  id: string,
  kind: 'flat' | 'spatial',
  handle: number | null,
): OristudioCpFoldedFigureEntry {
  return {
    id,
    handle,
    status: 'ready',
    snapshot: kind === 'flat' ? ({} as never) : null,
    folded3d: kind === 'spatial' ? ({} as never) : null,
  } as unknown as OristudioCpFoldedFigureEntry;
}

describe('folded3dExportHandles', () => {
  it('names the 3D figures with a live session, in canvas order', () => {
    expect(
      folded3dExportHandles([
        figure('a', 'spatial', 7),
        figure('b', 'flat', 3),
        figure('c', 'spatial', 2),
      ]),
    ).toEqual([7, 2]);
  });

  it('never names a flat figure — the kernel would answer a kind mismatch', () => {
    expect(folded3dExportHandles([figure('a', 'flat', 1), figure('b', 'flat', 2)])).toEqual([]);
  });

  it('drops a 3D figure with no handle rather than sending null to the kernel', () => {
    expect(
      folded3dExportHandles([figure('a', 'spatial', null), figure('b', 'spatial', 4)]),
    ).toEqual([4]);
  });

  it('treats handle 0 as a handle — it is a slot index, not a flag', () => {
    expect(folded3dExportHandles([figure('a', 'spatial', 0)])).toEqual([0]);
  });
});

describe('detachedFolded3dFigures', () => {
  it('finds the 3D figures a .fold export cannot describe', () => {
    const detached = detachedFolded3dFigures([
      figure('a', 'spatial', 7),
      figure('b', 'spatial', null),
      figure('c', 'flat', null),
    ]);
    expect(detached.map((entry) => entry.id)).toEqual(['b']);
  });
});
