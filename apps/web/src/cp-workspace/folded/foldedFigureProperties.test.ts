import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { FIGURE } from '../canvasObjects/canvasObjectKinds.fixtures';
import { buildFoldedFigureProperties } from './foldedFigureProperties';

// Identity `t`, with the one interpolation the subtitle uses.
const t = ((_key: string, fallback: string | { count?: number }, options?: { count?: number }) =>
  typeof fallback === 'string'
    ? fallback.replace('{{count}}', String(options?.count ?? ''))
    : '') as unknown as TFunction;

const READY: OristudioCpFoldedFigureEntry = {
  ...FIGURE,
  title: 'Folded model 1',
  status: 'ready',
  handle: 3,
  snapshot: {
    model: { state: 'Front0' },
    find_another_overlap_valid: true,
    discovered_fold_cases: 3,
    current_fold_case: 2,
  } as OristudioCpFoldedFigureEntry['snapshot'],
};

describe('buildFoldedFigureProperties', () => {
  it('titles the sheet with the figure and its case note', () => {
    const sheet = buildFoldedFigureProperties(
      { kind: 'folded-figure', id: READY.id, figure: READY },
      { t, stale: false, setDisplayStyle: vi.fn() }
    );
    expect(sheet.title).toBe('Folded model 1');
    expect(sheet.subtitle).toBe('Case 2');
    expect(sheet.icon).toBe('folded-figure');
  });

  it('says stale over the case note', () => {
    const sheet = buildFoldedFigureProperties(
      { kind: 'folded-figure', id: READY.id, figure: READY },
      { t, stale: true, setDisplayStyle: vi.fn() }
    );
    expect(sheet.subtitle).toBe('Stale');
  });

  it('sets the display style through the verb', () => {
    const setDisplayStyle = vi.fn();
    const sheet = buildFoldedFigureProperties(
      { kind: 'folded-figure', id: READY.id, figure: READY },
      { t, stale: false, setDisplayStyle }
    );
    const style = sheet.sections[0]?.fields[0];
    if (style?.kind !== 'select') throw new Error('select');
    expect(style.support).toBe('supported');
    expect(style.value).toBe('Paper5');
    expect(style.options.map((o) => o.label)).toEqual(['Paper', 'Transparent', 'Wire']);
    style.commit('Wire2');
    expect(setDisplayStyle).toHaveBeenCalledWith('Wire2');
  });

  it('disables appearance with a reason on a figure that is not ready', () => {
    const sheet = buildFoldedFigureProperties(
      { kind: 'folded-figure', id: FIGURE.id, figure: FIGURE },
      { t, stale: false, setDisplayStyle: vi.fn() }
    );
    const style = sheet.sections[0]?.fields[0];
    expect(style?.support).toBe('unsupported');
    expect(style?.reason).toBe('Refold to change how this figure looks');
    expect(sheet.subtitle).toBe('Folding…');
  });
});
