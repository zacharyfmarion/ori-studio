import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import {
  FOLDED_3D_STYLE_CHOICES,
  foldedFigureCapabilities,
  isFolded3dFigure,
} from './foldedFigureCapabilities';
import { buildFoldedFigureActions, type FoldedFigureActionDeps } from './foldedFigureActions';

const t = ((key: string, second?: unknown) =>
  typeof second === 'string' ? second : key) as unknown as TFunction;

function figure(
  overrides: Partial<OristudioCpFoldedFigureEntry> = {}
): OristudioCpFoldedFigureEntry {
  return {
    id: 'folded-1',
    title: 'Folded model 1',
    handle: 3,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    renderSnapshot: {} as never,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
    ...overrides,
  } as OristudioCpFoldedFigureEntry;
}

const flatFigure = figure({
  snapshot: {
    model: { state: 'Front0' },
    discovered_fold_cases: 1,
    current_fold_case: 1,
    find_another_overlap_valid: false,
  } as never,
});

const spatialFigure = figure({
  folded3d: {
    verdict: { verdict: 'folded' },
    crossings: [],
    discovered_fold_cases: 1,
    current_fold_case: 1,
    find_another_overlap_valid: false,
  } as never,
});

function deps(): FoldedFigureActionDeps {
  return {
    t,
    flip: () => {},
    setDisplayStyle: () => {},
    foldAnother: () => {},
    duplicate: () => {},
    remove: () => {},
  };
}

describe('foldedFigureCapabilities', () => {
  it('reads the one kind witness', () => {
    expect(isFolded3dFigure(spatialFigure)).toBe(true);
    expect(isFolded3dFigure(flatFigure)).toBe(false);
    expect(isFolded3dFigure(figure({ folded3d: null }))).toBe(false);
    expect(isFolded3dFigure(null)).toBe(false);
  });

  it('withholds flip and model editing from a 3D figure', () => {
    // Not defence in depth: `updateOristudioCpFoldedFigureModel` rejects any
    // figure with a null flat snapshot before the bridge call, so an ungated
    // flip reaches no kernel guard — it produces "No folded model is ready",
    // which is neither true nor about kinds.
    expect(foldedFigureCapabilities(spatialFigure)).toMatchObject({
      flip: false,
      editModel: false,
      foldToCase: false,
    });
    expect(foldedFigureCapabilities(flatFigure)).toMatchObject({
      flip: true,
      editModel: true,
      foldToCase: true,
    });
  });

  it('does not offer a 3D figure the transparent development', () => {
    // It needs the whole-document *flat* arrangement, which a spatial fold never
    // computes. Offering it would promise the flat figure's x-ray.
    expect(FOLDED_3D_STYLE_CHOICES).not.toContain('Transparent3');
    expect(foldedFigureCapabilities(flatFigure).styleChoices).toContain('Transparent3');
  });
});

describe('buildFoldedFigureActions, gated', () => {
  it('drops flip from a 3D figure and keeps it on a flat one', () => {
    const spatialIds = buildFoldedFigureActions(spatialFigure, deps()).map((action) => action.id);
    const flatIds = buildFoldedFigureActions(flatFigure, deps()).map((action) => action.id);
    expect(spatialIds).not.toContain('flip');
    expect(flatIds).toContain('flip');
    // Everything else a 3D figure genuinely has stays.
    expect(spatialIds).toEqual(expect.arrayContaining(['display-style', 'another', 'duplicate', 'delete']));
  });

  it('narrows the style options a 3D figure offers', () => {
    const choice = buildFoldedFigureActions(spatialFigure, deps()).find(
      (action) => action.id === 'display-style'
    );
    expect(choice?.kind).toBe('choice');
    if (choice?.kind !== 'choice') throw new Error('expected the display-style choice');
    expect(choice.options.map((option) => option.id)).toEqual([
      'display-style-Paper5',
      'display-style-Wire2',
    ]);
  });

  it('leads with the verdict when there is one, and with nothing when there is not', () => {
    const clean = buildFoldedFigureActions(spatialFigure, deps());
    expect(clean[0]?.kind).not.toBe('note');

    const crossing = figure({
      folded3d: {
        verdict: { verdict: 'local_crossing', vertices: 2 },
        crossings: [],
        discovered_fold_cases: 1,
        current_fold_case: 1,
        find_another_overlap_valid: false,
      } as never,
    });
    const actions = buildFoldedFigureActions(crossing, { ...deps(), runNoticeAction: () => {} });
    expect(actions[0]?.kind).toBe('note');
    if (actions[0]?.kind !== 'note') throw new Error('expected a note');
    expect(actions[0].notice.id).toBe('local-crossing');
    expect(actions[0].run).toBeTypeOf('function');
  });

  it('leaves the note unrunnable when the surface binds no handler', () => {
    const crossing = figure({
      folded3d: {
        verdict: { verdict: 'local_crossing', vertices: 1 },
        crossings: [],
        discovered_fold_cases: 1,
        current_fold_case: 1,
        find_another_overlap_valid: false,
      } as never,
    });
    const [note] = buildFoldedFigureActions(crossing, deps());
    expect(note?.kind).toBe('note');
    if (note?.kind !== 'note') throw new Error('expected a note');
    expect(note.run).toBeNull();
  });
});
