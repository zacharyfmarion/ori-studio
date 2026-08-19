import { describe, expect, it } from 'vitest';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import {
  FOLDED_3D_REPLAY_STEP_LIMIT,
  canRehydrateFolded3dFigure,
  folded3dRehydrationQueue,
  folded3dSolutionReplaySteps,
  sameFolded3dFrame,
} from './folded3dRehydrate';

/**
 * A 3D figure as a file gives it back: a picture, a camera, a frame and a
 * recorded source region, with no kernel handle behind any of it.
 */
function reopened(
  overrides: Partial<OristudioCpFoldedFigureEntry> = {},
): OristudioCpFoldedFigureEntry {
  return {
    id: 'folded-1',
    title: 'Folded model 1',
    handle: null,
    sourceKind: 'generated-3d',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    folded3d: { model: {}, current_fold_case: 1, discovered_fold_cases: 1 } as never,
    renderSnapshot: {} as never,
    camera: { yaw: 0, pitch: 0, zoom: 1 },
    frameRadius: 40,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    sourceBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    sourceFingerprint: 'abc',
    error: null,
    ...overrides,
  } as OristudioCpFoldedFigureEntry;
}

const NONE: ReadonlySet<string> = new Set();

describe('which reopened figures can be made live', () => {
  it('takes a 3D figure with a picture, a frame and a source region', () => {
    expect(canRehydrateFolded3dFigure(reopened())).toBe(true);
  });

  it('leaves a flat figure alone', () => {
    // The flat figure does not change, in any respect — and it never needed a
    // handle to draw in the first place.
    expect(
      canRehydrateFolded3dFigure(
        reopened({
          folded3d: null,
          snapshot: {} as never,
          sourceKind: 'generated-from-current-cp',
        }),
      ),
    ).toBe(false);
  });

  it('leaves a figure that already has its geometry alone', () => {
    expect(canRehydrateFolded3dFigure(reopened({ handle: 7 }))).toBe(false);
  });

  it('leaves a figure that is not ready alone', () => {
    // Mid-fold or errored: there is no settled picture to reproduce, so there is
    // nothing for a rehydrate to be judged against.
    expect(canRehydrateFolded3dFigure(reopened({ status: 'loading' }))).toBe(false);
    expect(canRehydrateFolded3dFigure(reopened({ status: 'error' }))).toBe(false);
  });

  it('leaves a figure with no recorded source region alone', () => {
    // Nothing to refold *from*. The same condition the Refold verb has.
    expect(canRehydrateFolded3dFigure(reopened({ sourceBounds: null }))).toBe(false);
  });

  it('leaves a figure imported from a file alone', () => {
    expect(canRehydrateFolded3dFigure(reopened({ sourceKind: 'imported-folded-form' }))).toBe(
      false,
    );
  });

  it('leaves a figure with no frame alone', () => {
    // Its box is the bounds of its last projection. Giving it a frame now would
    // resize it on screen, which is the one thing a rehydrate must not do.
    expect(canRehydrateFolded3dFigure(reopened({ frameRadius: null }))).toBe(false);
    expect(canRehydrateFolded3dFigure(reopened({ frameRadius: 0 }))).toBe(false);
  });
});

describe('getting back to the solution the figure was saved showing', () => {
  it('needs no steps for a figure nobody cycled', () => {
    expect(folded3dSolutionReplaySteps(reopened())).toBe(0);
  });

  it('needs one step per solution past the first', () => {
    expect(
      folded3dSolutionReplaySteps(reopened({ folded3d: { current_fold_case: 4 } as never })),
    ).toBe(3);
  });

  it('gives up past the step limit rather than spending the load on it', () => {
    const atLimit = reopened({
      folded3d: { current_fold_case: FOLDED_3D_REPLAY_STEP_LIMIT + 1 } as never,
    });
    const pastLimit = reopened({
      folded3d: { current_fold_case: FOLDED_3D_REPLAY_STEP_LIMIT + 2 } as never,
    });
    expect(folded3dSolutionReplaySteps(atLimit)).toBe(FOLDED_3D_REPLAY_STEP_LIMIT);
    expect(folded3dSolutionReplaySteps(pastLimit)).toBeNull();
    expect(canRehydrateFolded3dFigure(pastLimit)).toBe(false);
  });

  it('gives up on a file that never recorded which solution it was showing', () => {
    // Old enough that the index was not written, so landing on the right one
    // could not be checked afterwards.
    expect(folded3dSolutionReplaySteps(reopened({ folded3d: { model: {} } as never }))).toBeNull();
  });
});

describe('judging that a refold reproduced the fold', () => {
  it('accepts geometry that produces the same frame', () => {
    expect(sameFolded3dFrame(40, 40)).toBe(true);
    expect(sameFolded3dFrame(40 + 40 * 1e-10, 40)).toBe(true);
  });

  it('rejects geometry that would be drawn at a different size', () => {
    expect(sameFolded3dFrame(80, 40)).toBe(false);
    expect(sameFolded3dFrame(40 * 1.000001, 40)).toBe(false);
  });

  it('rejects a figure with no frame to compare against', () => {
    expect(sameFolded3dFrame(40, null)).toBe(false);
    expect(sameFolded3dFrame(40, 0)).toBe(false);
    expect(sameFolded3dFrame(Number.NaN, 40)).toBe(false);
  });
});

describe('the order figures are rehydrated in', () => {
  const a = reopened({ id: 'a' });
  const b = reopened({ id: 'b' });
  const c = reopened({ id: 'c' });

  it('is document order when nobody has pressed anything', () => {
    expect(folded3dRehydrationQueue([a, b, c], { staleIds: NONE })).toEqual(['a', 'b', 'c']);
  });

  it('puts the figure the user is looking at first', () => {
    expect(folded3dRehydrationQueue([a, b, c], { staleIds: NONE, priorityId: 'c' })).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('drops stale figures rather than reordering them', () => {
    // Refolding a stale figure would replace what the user is looking at with a
    // different fold. That is the Refold verb's job, and it asks first.
    expect(folded3dRehydrationQueue([a, b, c], { staleIds: new Set(['b']) })).toEqual(['a', 'c']);
  });

  it('drops figures already tried, keyed on the entry rather than the id', () => {
    const tried = new WeakSet<OristudioCpFoldedFigureEntry>([b]);
    expect(
      folded3dRehydrationQueue([a, b, c], {
        staleIds: NONE,
        skip: (figure) => tried.has(figure),
      }),
    ).toEqual(['a', 'c']);
    // A figure rewritten since — refolded, restored by undo, or a different
    // document reusing the id — is a different object, so it is asked again.
    const rewrittenB = { ...b };
    expect(
      folded3dRehydrationQueue([a, rewrittenB, c], {
        staleIds: NONE,
        skip: (figure) => tried.has(figure),
      }),
    ).toEqual(['a', 'b', 'c']);
  });

  it('ignores a priority id that is not in the queue', () => {
    expect(folded3dRehydrationQueue([a, b], { staleIds: NONE, priorityId: 'gone' })).toEqual([
      'a',
      'b',
    ]);
    expect(folded3dRehydrationQueue([a, b], { staleIds: new Set(['a']), priorityId: 'a' })).toEqual(
      ['b'],
    );
  });
});
