import { describe, expect, it } from 'vitest';

import {
  FOLDED_APPEARANCE_OPTIONS,
  foldedAppearanceEnabled,
  foldedAppearanceSupport,
  foldedAppearanceVisible,
  type FoldedAppearanceOption,
} from './foldedFigureAppearance';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';

function figure(kind: 'flat' | 'spatial'): OristudioCpFoldedFigureEntry {
  const base = {
    id: 'f',
    title: 'f',
    handle: 1,
    sourceCpRevision: null,
    startingFaceId: 1,
    displayStyle: 'Paper5' as const,
    status: 'ready' as const,
    renderSnapshot: null,
    placement: IDENTITY_FOLDED_PLACEMENT,
    error: null,
  };
  return (
    kind === 'spatial'
      ? { ...base, sourceKind: 'generated-3d', snapshot: null, folded3d: {} }
      : { ...base, sourceKind: 'generated-from-current-cp', snapshot: {} }
  ) as unknown as OristudioCpFoldedFigureEntry;
}

describe('foldedAppearanceSupport', () => {
  it('answers for every option on both kinds of figure', () => {
    // The point of the exhaustiveness: a new option cannot be added without
    // someone deciding what it means for a 3D figure, which is exactly how the
    // silently-ignored ones got there in the first place.
    for (const option of FOLDED_APPEARANCE_OPTIONS) {
      for (const kind of ['flat', 'spatial'] as const) {
        expect(['supported', 'unsupported', 'not-applicable'], `${option}/${kind}`).toContain(
          foldedAppearanceSupport(figure(kind), option)
        );
      }
    }
  });

  it('covers the whole union, so the list cannot drift from the type', () => {
    // `FOLDED_APPEARANCE_OPTIONS` is what callers iterate; a member missing from
    // it is a control that silently disappears from the inspector.
    const all: Record<FoldedAppearanceOption, true> = {
      frontColor: true,
      backColor: true,
      lineColor: true,
      antiAlias: true,
      side: true,
      displayStyle: true,
      shadow: true,
      transparency: true,
      scale: true,
      rotation: true,
    };
    expect([...FOLDED_APPEARANCE_OPTIONS].sort()).toEqual(Object.keys(all).sort());
  });

  it('never offers scale or rotation as a control, on either kind', () => {
    // Not "you cannot scale a folded figure" — the canvas handles do that,
    // through `FoldedFigurePlacement`. This says the *model fields* are not
    // wired to a control, so one figure never carries two transforms.
    for (const kind of ['flat', 'spatial'] as const) {
      for (const option of ['scale', 'rotation'] as const) {
        expect(foldedAppearanceSupport(figure(kind), option)).toBe('not-applicable');
        expect(foldedAppearanceVisible(figure(kind), option)).toBe(false);
      }
    }
  });

  it('offers the colours and anti-alias on a 3D figure, which already honours them', () => {
    for (const option of ['frontColor', 'backColor', 'lineColor', 'antiAlias'] as const) {
      expect(foldedAppearanceEnabled(figure('spatial'), option)).toBe(true);
    }
  });

  it('shows shadow on a 3D figure but disabled, rather than enabled and inert', () => {
    // The distinction the whole module exists for: visible so the control does
    // not vanish between figure kinds, disabled so pressing it cannot do
    // nothing.
    expect(foldedAppearanceSupport(figure('spatial'), 'shadow')).toBe('unsupported');
    expect(foldedAppearanceVisible(figure('spatial'), 'shadow')).toBe(true);
    expect(foldedAppearanceEnabled(figure('spatial'), 'shadow')).toBe(false);
    expect(foldedAppearanceEnabled(figure('flat'), 'shadow')).toBe(true);
  });
});
