import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type {
  OristudioCpFold3dCrossing,
  OristudioCpFold3dOrderReason,
  OristudioCpFold3dRefusal,
  OristudioCpFold3dVerdict,
  OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import {
  fold3dRefusalMessage,
  foldedFigureNotice,
  foldedFigureSubtitle,
  crossingLineIds,
  foldedFigureSimulationLineIds,
} from './foldedFigureNotice';

/**
 * Every call is `t(key, default)` or `t(key, options)`; return something that
 * shows both which key was chosen and what was interpolated, so a test can
 * assert the sentence rather than the lookup.
 */
const t = ((key: string, second?: unknown, third?: unknown) => {
  const options = (typeof second === 'object' ? second : third) as
    | Record<string, unknown>
    | undefined;
  const fallback =
    typeof second === 'string'
      ? second
      : ((options?.defaultValue_other ?? options?.defaultValue_one ?? key) as string);
  if (!options) return fallback;
  return fallback.replace(/\{\{(\w+)\}\}/gu, (_match, name: string) =>
    String(options[name] ?? '')
  );
}) as unknown as TFunction;

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
    renderSnapshot: null,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
    ...overrides,
  } as OristudioCpFoldedFigureEntry;
}

function spatial(
  verdict: OristudioCpFold3dVerdict,
  extras: {
    crossings?: OristudioCpFold3dCrossing[];
    sourceLineIds?: number[];
    sourceScopedLineIds?: number[];
  } = {}
): OristudioCpFoldedFigureEntry {
  return figure({
    sourceLineIds: extras.sourceLineIds ?? [],
    sourceScopedLineIds: extras.sourceScopedLineIds ?? [],
    folded3d: {
      verdict,
      crossings: extras.crossings ?? [],
      discovered_fold_cases: 1,
      current_fold_case: 1,
    },
  } as unknown as Partial<OristudioCpFoldedFigureEntry>);
}

describe('foldedFigureNotice', () => {
  it('says nothing about a flat figure', () => {
    expect(foldedFigureNotice(t, figure({ snapshot: {} as never }))).toBeNull();
    expect(foldedFigureNotice(t, null)).toBeNull();
  });

  it('says nothing about a 3D figure that folded cleanly', () => {
    // Silence is the right report for success; a chip that always shows is a
    // chip nobody reads.
    expect(foldedFigureNotice(t, spatial({ verdict: 'folded' }))).toBeNull();
  });

  it('names a local crossing and offers the issues overlay', () => {
    const notice = foldedFigureNotice(t, spatial({ verdict: 'local_crossing', vertices: 3 }));
    expect(notice).toMatchObject({
      id: 'local-crossing',
      tone: 'warn',
      detail: 'The paper passes through itself at 3 vertices.',
      action: { id: 'show-issues', lineIds: [] },
    });
  });

  it('names a transversal crossing and selects the creases it names', () => {
    // The wire index is a position in the kernel's ascending, deduped slice —
    // not a document line id. Naming `sourceLineIds[k]` would highlight the
    // wrong crease whenever those ids arrived unsorted.
    const notice = foldedFigureNotice(
      t,
      spatial({ verdict: 'transversal_crossing', crossings: 2 }, {
        sourceLineIds: [9, 2, 5],
        crossings: [
          { code: 'transversal', line: 0, face: 1 },
          { code: 'sheets', line: 2, faces: [1, 2] },
        ],
      })
    );
    expect(notice).toMatchObject({
      id: 'transversal-crossing',
      tone: 'warn',
      action: { id: 'select-creases', lineIds: [2, 9] },
    });
  });

  it('offers no action for a crossing whose creases cannot be named', () => {
    // The kernel lists at most 16 crossings and reports an exact count, so a
    // verdict can arrive with nothing resolvable behind it.
    const notice = foldedFigureNotice(t, spatial({ verdict: 'transversal_crossing', crossings: 40 }));
    expect(notice?.action).toBeNull();
  });

  it('reports no layer order as an error and offers the simulator', () => {
    const reason: OristudioCpFold3dOrderReason = {
      code: 'contradictory_seeds',
      upper: 1,
      lower: 2,
      first_rule: 'wall',
      first_line: 1,
      second_rule: 'full_fold',
      second_line: 0,
    };
    // The action carries the **scoped** ids — what a region is matched by —
    // and not the colour-filtered folded set. Handing the filtered list to
    // `resolveInlineSimulationRegion` is what made the chip fall through to the
    // Simulate panel on any region holding an auxiliary crease.
    const notice = foldedFigureNotice(
      t,
      spatial(
        { verdict: 'no_layer_order', reason },
        { sourceLineIds: [4, 7], sourceScopedLineIds: [4, 7, 11] }
      )
    );
    expect(notice).toMatchObject({
      id: 'no-layer-order',
      tone: 'error',
      detail: 'Two faces each have to be above the other, so no stacking can satisfy both.',
      action: { id: 'simulate-instead', lineIds: [4, 7, 11] },
    });
  });

  it('has a sentence for every order reason', () => {
    const codes: OristudioCpFold3dOrderReason['code'][] = [
      'overlap_without_cell',
      'cell_without_overlap',
      'arrangement_refused',
      'contradictory_seeds',
      'no_layer_order',
      'face_id_out_of_range',
      'search_failed',
      'search_exhausted',
    ];
    for (const code of codes) {
      const notice = foldedFigureNotice(
        t,
        spatial({ verdict: 'no_layer_order', reason: { code } as OristudioCpFold3dOrderReason })
      );
      expect(notice?.detail, code).toBeTruthy();
      expect(notice?.detail, code).not.toContain('panels:');
    }
  });

  /// Giving up is not a finding about the crease pattern, and the sentence has
  /// to keep those apart — the same distinction the kernel draws by giving
  /// `SearchExhausted` its own arm instead of reusing `NoLayerOrder`.
  it('says the search stopped, not that no layer order exists', () => {
    const exhausted = foldedFigureNotice(
      t,
      spatial({
        verdict: 'no_layer_order',
        reason: { code: 'search_exhausted', component: 0, iterations: 1_000_000 },
      })
    );
    const genuine = foldedFigureNotice(
      t,
      spatial({
        verdict: 'no_layer_order',
        reason: { code: 'no_layer_order', component: 0, faces: 12, variables: 30 },
      })
    );

    expect(exhausted?.detail).toBe(
      'Ori Studio stopped searching before it found a layer order for this figure.'
    );
    expect(exhausted?.detail).not.toBe(genuine?.detail);
    // Still offers the way out, because the figure is drawn either way.
    expect(exhausted?.action?.id).toBe('simulate-instead');
  });
});

describe('crossingLineIds / foldedFigureSimulationLineIds', () => {
  it('maps both lines of a chord pair', () => {
    expect(
      crossingLineIds({ sourceLineIds: [9, 2, 5] }, [
        { code: 'chords', lines: [0, 2], faces: [1, 2, 3, 4] },
      ])
    ).toEqual([2, 9]);
  });

  it('simulates from the scoped ids, never the colour-filtered ones', () => {
    expect(
      foldedFigureSimulationLineIds({ sourceLineIds: [1, 2], sourceScopedLineIds: [1, 2, 3] })
    ).toEqual([1, 2, 3]);
  });

  it('falls back to the folded ids for a figure recorded before scoping', () => {
    // An `.osf` written before the field existed. Still the best answer there
    // is, and no worse than what that build did.
    expect(foldedFigureSimulationLineIds({ sourceLineIds: [1, 2] })).toEqual([1, 2]);
    expect(
      foldedFigureSimulationLineIds({ sourceLineIds: [1, 2], sourceScopedLineIds: [] })
    ).toEqual([1, 2]);
    expect(foldedFigureSimulationLineIds({})).toEqual([]);
  });
});

describe('fold3dRefusalMessage', () => {
  it('has a sentence for every refusal arm', () => {
    const refusals: OristudioCpFold3dRefusal[] = [
      { code: 'no_faces' },
      { code: 'faces_unresolved' },
      { code: 'disconnected', reached: 1, unreached: 2 },
      { code: 'non_crease_join', line: 0 },
      { code: 'interior_cut', line: 0, point: { x: 0, y: 0 } },
      { code: 'flat_foldability', point: { x: 0, y: 0 }, rule: 'maekawa' },
      { code: 'vertex_indeterminate', point: { x: 0, y: 0 }, cause: 'unassigned_crease' },
      { code: 'vertex_indeterminate', point: { x: 0, y: 0 }, cause: 'unsplit_junction' },
      { code: 'vertex_closure', point: { x: 0, y: 0 }, residual_degrees: 12.3456 },
      { code: 'loop_not_closed', worst_edge: 1, gap_radians: 0.1, gap_offset: 0.2 },
      {
        code: 'tolerance_window_closed',
        faces: [1, 2],
        normal_radians: 0,
        offset_relative: 0,
        min_inter_separation: null,
      },
    ];
    for (const refusal of refusals) {
      const message = fold3dRefusalMessage(t, refusal);
      expect(message, refusal.code).toBeTruthy();
      expect(message, refusal.code).not.toContain('{{');
    }
  });

  it('words a flat-foldability refusal the way the foldability panel does', () => {
    // The same theorem failing must not read two ways depending on which check
    // found it — and these phrases are already translated in every locale.
    expect(fold3dRefusalMessage(t, { code: 'flat_foldability', point: { x: 0, y: 0 }, rule: 'angles' })).toBe(
      'Incorrect angles'
    );
    expect(
      fold3dRefusalMessage(t, {
        code: 'flat_foldability',
        point: { x: 0, y: 0 },
        rule: 'number_of_folds',
      })
    ).toBe('Odd number of folds');
  });

  it('rounds a closure residual rather than publishing it', () => {
    expect(
      fold3dRefusalMessage(t, {
        code: 'vertex_closure',
        point: { x: 0, y: 0 },
        residual_degrees: 12.3456789,
      })
    ).toContain('12.35');
  });
});

describe('foldedFigureSubtitle', () => {
  it('translates every status rather than printing the identifier', () => {
    expect(foldedFigureSubtitle(t, figure({ status: 'loading' }), false)).toBe('Folding…');
    expect(foldedFigureSubtitle(t, figure({ status: 'error' }), false)).toBe('Failed');
    expect(foldedFigureSubtitle(t, figure({ status: 'stale' }), false)).toBe('Stale');
  });

  it('prefers stale, then the verdict, then the solution', () => {
    const crossing = spatial({ verdict: 'local_crossing', vertices: 1 });
    expect(foldedFigureSubtitle(t, crossing, true)).toBe('Stale');
    expect(foldedFigureSubtitle(t, crossing, false)).toBe('Passes through itself');
    expect(foldedFigureSubtitle(t, spatial({ verdict: 'folded' }), false)).toBe('Case 1');
  });
});
