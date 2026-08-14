import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import {
  FOLDED_FIGURE_STYLE_CHOICES,
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
    resetView: () => {},
    setUpright: () => {},
    clearUpright: () => {},
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

  it('offers model editing to both kinds, and case batching only to the flat one', () => {
    // `editModel` was false for a 3D figure while there was no write path — the
    // model lives on `folded3d`, not in the kernel — which greyed out the whole
    // folded-model menu. `updateOristudioCpFoldedFigureModel` now re-projects
    // instead, so the colours, side and alpha are all reachable.
    //
    // `foldToCase` stays withheld: batching to a numbered solution is a kernel
    // walk, and the 3D stream is stepped rather than indexed.
    expect(foldedFigureCapabilities(spatialFigure)).toMatchObject({
      editModel: true,
      foldToCase: false,
    });
    expect(foldedFigureCapabilities(flatFigure)).toMatchObject({
      editModel: true,
      foldToCase: true,
    });
  });

  it('offers "the other side" on both kinds, by two different mechanisms', () => {
    // A flat figure turns the paper over; a 3D figure moves the eye. Withholding
    // it from 3D left `antipodalCamera` — written and tested — unreachable from
    // the UI, so the reverse of the paper could never be looked at.
    expect(foldedFigureCapabilities(spatialFigure).flip).toBe(true);
    expect(foldedFigureCapabilities(flatFigure).flip).toBe(true);
  });

  it('offers the same style list to both kinds, x-ray included', () => {
    // A 3D figure's picture is never asked of the kernel, so the flat path's
    // `needs_subfaces` constraint does not reach it — and withholding x-ray was
    // what made "Another solution" invisible, since an opaque render of two
    // stackings of the same paper is byte-identical.
    expect(FOLDED_FIGURE_STYLE_CHOICES).toContain('Transparent3');
    expect(foldedFigureCapabilities(spatialFigure).styleChoices).toEqual(
      foldedFigureCapabilities(flatFigure).styleChoices
    );
  });
});

describe('buildFoldedFigureActions, gated', () => {
  it('labels the side verb for what it does to each kind', () => {
    const spatialActions = buildFoldedFigureActions(spatialFigure, deps());
    const flatActions = buildFoldedFigureActions(flatFigure, deps());
    expect(spatialActions.map((action) => action.id)).toContain('flip');
    expect(flatActions.map((action) => action.id)).toContain('flip');
    // Two labels, because a 3D figure's paper is not turned over — the eye
    // moves. Asserting the labels *differ* as well as their values, so a
    // builder returning one constant for both kinds cannot pass.
    const label = (actions: ReturnType<typeof buildFoldedFigureActions>) => {
      const flip = actions.find((action) => action.id === 'flip');
      return flip?.kind === 'command' ? flip.label : null;
    };
    expect(label(flatActions)).toBe('Flip');
    expect(label(spatialActions)).toBe('Other side');
    expect(label(spatialActions)).not.toBe(label(flatActions));
    // Everything else a 3D figure genuinely has stays.
    expect(spatialActions.map((action) => action.id)).toEqual(
      expect.arrayContaining(['display-style', 'another', 'duplicate', 'delete'])
    );
  });

  it('offers a 3D figure the whole style list', () => {
    const choice = buildFoldedFigureActions(spatialFigure, deps()).find(
      (action) => action.id === 'display-style'
    );
    expect(choice?.kind).toBe('choice');
    if (choice?.kind !== 'choice') throw new Error('expected the display-style choice');
    expect(choice.options.map((option) => option.id)).toEqual([
      'display-style-Paper5',
      'display-style-Wire2',
      'display-style-Transparent3',
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
