import { describe, expect, it } from 'vitest';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import { foldedFigureLayerOrder, type FoldedFigureLayerOrder } from '../../lib/layerOrder/foldedFigureLayerOrder';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import {
  FOLDED_FIGURE_LAYER_ORDERS_KEY as KEY,
  detachedFoldedFigureLayerOrders,
  figureIdsInFoldedFigureLayerOrders,
  foldedFigureLayerOrderKey,
  foldedFigureLayerOrdersAfterSave,
  foldedFigureRefoldKey,
  linkFoldedFigureLayerOrders,
  withFoldedFigureLayerOrders,
} from './foldedFigureLayerOrders';

const RECORD: LayerOrderRecord = {
  faces: [
    { at: [100, 150], area: 20000 },
    { at: [300, 150], area: 20000 },
  ],
  constraints: [[0, 1, 1]],
  order: [],
};

const RECORD_JSON =
  '{"v":1,"faces":[{"at":[100,150],"area":20000},{"at":[300,150],"area":20000}],"constraints":[[0,1,1]],"order":[]}';

function held(record: LayerOrderRecord = RECORD): FoldedFigureLayerOrder {
  const result = foldedFigureLayerOrder(record);
  if (!result.ok) throw new Error(result.reason);
  return result.layerOrder;
}

/** A flat figure shown at `fold_case`, its order given unless `searched`. */
function figure(
  id: string,
  { fingerprint = 'cs1:fold', foldCase = 1, searched = false } = {}
): OristudioCpFoldedFigureEntry {
  return {
    id,
    title: id,
    handle: null,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: {
      model: DEFAULT_FOLDED_MODEL,
      estimation_step: 'Step5',
      display_style: 'Paper5',
      discovered_fold_cases: foldCase,
      current_fold_case: foldCase,
      find_another_overlap_valid: false,
      text_result: '',
      wireframe: null,
      outcome: 'Solved',
      ...(searched ? {} : { shown_order: 'given' as const }),
    },
    renderSnapshot: null,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    sourceBounds: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
    sourceFingerprint: fingerprint,
    error: null,
  };
}

function withRecord(entry: OristudioCpFoldedFigureEntry, layerOrder = held()): OristudioCpFoldedFigureEntry {
  return { ...entry, layerOrder };
}

/** What the writer puts in the bag, read back the way a file is. */
function saved(extensions: Record<string, unknown>, figures: OristudioCpFoldedFigureEntry[]) {
  return JSON.parse(JSON.stringify(withFoldedFigureLayerOrders(extensions, figures))) as Record<string, unknown>;
}

describe('a figure’s key', () => {
  it('names the source and the case it shows, so another fold of the same id is told apart', () => {
    const key = foldedFigureLayerOrderKey(figure('generated-1'));
    expect(foldedFigureLayerOrderKey(figure('generated-9'))).toBe(key);
    expect(foldedFigureLayerOrderKey(figure('generated-1', { fingerprint: 'cs1:edited' }))).not.toBe(key);
    expect(foldedFigureLayerOrderKey(figure('generated-1', { foldCase: 2 }))).not.toBe(key);
  });

  it('hashes the fingerprint, never copies it: old files hold raw ones of about 50 KB', () => {
    const raw = 'segment;'.repeat(6400);
    const key = foldedFigureLayerOrderKey(figure('generated-1', { fingerprint: raw }));
    expect(key).toMatch(/^fk1:[0-9a-f]{16}$/);
  });
});

describe('a figure’s refold key', () => {
  const base = figure('generated-1');
  const key = foldedFigureRefoldKey(base);

  it('is what a Refold keeps: neither the creases nor the case, which an older build’s refold after an edit changes', () => {
    expect(key).toMatch(/^fr1:[0-9a-f]{16}$/);
    expect(foldedFigureRefoldKey(figure('generated-1', { fingerprint: 'cs1:edited', foldCase: 3, searched: true }))).toBe(key);
    // The region a refold re-derives from the same corners, to the float.
    expect(
      foldedFigureRefoldKey({ ...base, sourceBounds: { minX: 1e-12, minY: -1e-12, maxX: 400 + 1e-10, maxY: 300 } })
    ).toBe(key);
  });

  it('tells another figure apart: its id, title, placement, starting face or region', () => {
    for (const other of [
      figure('generated-2'),
      { ...base, title: 'Renamed' },
      { ...base, placement: { ...base.placement, offset: { x: 40, y: 0 } } },
      { ...base, placement: { ...base.placement, rotation: Math.PI / 2 } },
      { ...base, startingFaceId: 7 },
      { ...base, sourceBounds: { minX: 0, minY: 0, maxX: 200, maxY: 300 } },
    ]) {
      expect(foldedFigureRefoldKey(other)).not.toBe(key);
    }
  });
});

describe('saving a figure’s layer order in the bag', () => {
  it('returns a bag with no record to write as it came, the very object', () => {
    const bag = { futureDocFeature: { a: 1 } };
    expect(withFoldedFigureLayerOrders(bag, [figure('generated-1')])).toBe(bag);
    expect(withFoldedFigureLayerOrders(bag, [{ ...figure('generated-1'), layerOrder: null }])).toBe(bag);
  });

  it('writes each figure’s record under its id, keyed to the figure, after the other keys', () => {
    const fig = withRecord(figure('generated-1'));
    const bag = saved({ futureDocFeature: { a: 1 } }, [fig, figure('generated-2')]);
    expect(Object.keys(bag)).toEqual(['futureDocFeature', KEY]);
    expect(bag[KEY]).toEqual({
      figures: {
        'generated-1': { figureKey: foldedFigureLayerOrderKey(fig), refoldKey: foldedFigureRefoldKey(fig), record: RECORD_JSON },
      },
    });
  });

  it('keeps the key where the bag had it, between the other builds’ keys', () => {
    const bag = saved({ first: 1, [KEY]: {}, last: 2 }, [withRecord(figure('generated-1'))]);
    expect(Object.keys(bag)).toEqual(['first', KEY, 'last']);
  });

  it('leaves the key out once no figure has a record and nothing is detached', () => {
    expect(saved({ first: 1, [KEY]: {}, last: 2 }, [figure('generated-1')])).toEqual({ first: 1, last: 2 });
  });

  it('writes back what no figure claims as it came: detached records, other fields, records never linked', () => {
    const value = {
      figures: { 'generated-7': { figureKey: 'fk1:x', record: '{"v":2}' } },
      detached: [{ figureId: 'generated-3', reason: 'figure-missing', figureKey: 'fk1:y', record: '{"v":1}' }],
      laterField: [1],
    };
    expect(saved({ [KEY]: value }, [figure('generated-1')])).toEqual({ [KEY]: value });
    // A figure's own record replaces the one of its id, and the others stay.
    const fig = withRecord(figure('generated-7'));
    expect((saved({ [KEY]: value }, [fig])[KEY] as typeof value).figures['generated-7']!.figureKey).toBe(
      foldedFigureLayerOrderKey(fig)
    );
  });

  it('gives way where the bag holds something under the key that it cannot read', () => {
    expect(saved({ [KEY]: 'garbled' }, [figure('generated-1')])).toEqual({ [KEY]: 'garbled' });
    expect(saved({ [KEY]: 'garbled' }, [withRecord(figure('generated-1'))])[KEY]).toMatchObject({
      figures: { 'generated-1': {} },
    });
  });
});

describe('attaching saved layer orders at install', () => {
  function bagFor(figures: OristudioCpFoldedFigureEntry[], extra: Record<string, unknown> = {}) {
    return saved({ futureDocFeature: { a: 1 }, ...extra }, figures);
  }

  it('attaches a record to its figure when the figure shows the order it was saved with', () => {
    const bag = bagFor([withRecord(figure('generated-1'))]);
    const linked = linkFoldedFigureLayerOrders(bag, [figure('generated-1'), figure('generated-2')]);
    expect(linked.figures[0]!.layerOrder).toEqual(held());
    expect(linked.figures[1]!.layerOrder).toBeUndefined();
    // The key stays where it was, holding what is left: nothing.
    expect(linked.extensions).toEqual({ futureDocFeature: { a: 1 }, [KEY]: {} });
    // And saved again, it is the bag it came from.
    expect(saved(linked.extensions, linked.figures)).toEqual(bag);
  });

  it('attaches a 3D figure’s record by its key alone, which names 3D: no flat snapshot says it was given (D13)', () => {
    const waiting = held({ ...RECORD, attention: { reason: 'route-3d', count: 1 } });
    const spatial = (fingerprint = 'cs1:fold'): OristudioCpFoldedFigureEntry => ({
      ...figure('generated-1', { fingerprint }),
      sourceKind: 'generated-3d',
      snapshot: null,
      folded3d: { current_fold_case: 1, discovered_fold_cases: 1 } as OristudioCpFoldedFigureEntry['folded3d'],
    });
    const bag = bagFor([withRecord(spatial(), waiting)]);
    const linked = linkFoldedFigureLayerOrders(bag, [spatial()]);
    expect(linked.figures[0]!.layerOrder).toEqual(waiting);
    expect(saved(linked.extensions, linked.figures)).toEqual(bag);

    // Folded in 3D again from other creases, or a flat figure on the id: another key.
    for (const [other, reason] of [
      [spatial('cs1:edited'), 'figure-changed'],
      [figure('generated-1'), 'figure-changed'],
    ] as const) {
      const detached = linkFoldedFigureLayerOrders(bag, [other]);
      expect(detached.figures[0]!.layerOrder, reason).toBeUndefined();
      expect(detachedFoldedFigureLayerOrders(detached.extensions).map((entry) => entry.reason)).toEqual([reason]);
    }
  });

  it('leaves a bag without the key, or with one it cannot read, as it came', () => {
    const figures = [figure('generated-1')];
    for (const bag of [{ futureDocFeature: { a: 1 } }, { [KEY]: [1, 2] }]) {
      const linked = linkFoldedFigureLayerOrders(bag, figures);
      expect(linked.extensions).toBe(bag);
      expect(linked.figures).toBe(figures);
    }
  });

  it.each([
    ['its figure is gone', [] as OristudioCpFoldedFigureEntry[], 'figure-missing'],
    // An older build refolded it, or deleted it and folded the same creases on the reused id.
    ['its figure’s order was searched', [figure('generated-1', { searched: true })], 'order-not-given'],
    ['its figure shows another case', [figure('generated-1', { foldCase: 2 })], 'figure-changed'],
    ['its figure was folded from other creases', [figure('generated-1', { fingerprint: 'cs1:edited' })], 'figure-changed'],
  ])('detaches a record when %s, and keeps it', (_label, figures, reason) => {
    const bag = bagFor([withRecord(figure('generated-1'))]);
    const record = ((bag[KEY] as { figures: Record<string, { record: string }> }).figures['generated-1']!).record;
    const refoldKey = foldedFigureRefoldKey(figure('generated-1'));
    const linked = linkFoldedFigureLayerOrders(bag, figures);
    expect(linked.figures.every((entry) => entry.layerOrder === undefined)).toBe(true);
    expect(detachedFoldedFigureLayerOrders(linked.extensions)).toEqual([{ figureId: 'generated-1', reason, refoldKey, record }]);
    // Written back where it is now, and never attached again, whatever takes the id.
    const again = saved(linked.extensions, linked.figures);
    expect(detachedFoldedFigureLayerOrders(again)).toEqual([{ figureId: 'generated-1', reason, refoldKey, record }]);
    expect(linkFoldedFigureLayerOrders(again, [figure('generated-1')]).figures[0]!.layerOrder).toBeUndefined();
  });

  describe('a detached record, shown for review (the “Detached by an older build” frame)', () => {
    /**
     * The bag as this build saved it, then the figure as a released build
     * leaves it: its creases edited and the figure folded again, so its
     * source fingerprint is another and its snapshot has no `shown_order`;
     * the bag carried as it came.
     */
    const refoldedByAnOlderBuild = () => {
      const bag = bagFor([withRecord(figure('generated-1'))]);
      return { bag, figures: [figure('generated-1', { searched: true, fingerprint: 'cs1:edited' })] };
    };

    it('holds it on its figure for review, never as the figure’s own, and keeps its entry', () => {
      const { bag, figures } = refoldedByAnOlderBuild();
      const linked = linkFoldedFigureLayerOrders(bag, figures);
      expect(linked.figures[0]!.layerOrder).toBeUndefined();
      expect(linked.figures[0]!.detachedLayerOrder).toEqual({ record: RECORD, json: RECORD_JSON });
      expect(detachedFoldedFigureLayerOrders(linked.extensions).map((entry) => entry.reason)).toEqual(['order-not-given']);
      // Saved again, unsettled: the entry as it was, and nothing on the figure.
      expect(saved(linked.extensions, linked.figures)).toEqual(saved(linked.extensions, figures));
    });

    it('shows nothing on a figure the older build moved, renamed or made again, a missing figure, or a 3D one, and keeps every entry', () => {
      const { bag, figures } = refoldedByAnOlderBuild();
      const refolded = figures[0]!;
      const others: OristudioCpFoldedFigureEntry[][] = [
        [{ ...refolded, placement: { ...refolded.placement, offset: { x: 40, y: 0 } } }],
        [{ ...refolded, title: 'Renamed' }],
        [{ ...refolded, sourceBounds: { minX: 0, minY: 0, maxX: 200, maxY: 300 } }],
        [figure('generated-2', { searched: true })],
        [{ ...refolded, snapshot: null, folded3d: { current_fold_case: 1 } as OristudioCpFoldedFigureEntry['folded3d'] }],
      ];
      for (const reopened of others) {
        const linked = linkFoldedFigureLayerOrders(bag, reopened);
        expect(linked.figures.every((entry) => entry.detachedLayerOrder === undefined)).toBe(true);
        expect(detachedFoldedFigureLayerOrders(saved(linked.extensions, linked.figures))).toHaveLength(1);
      }
    });

    it.each(['reattached', 'dismissed'] as const)('drops its entry once %s, and keeps it when that is undone', (settled) => {
      const { bag, figures } = refoldedByAnOlderBuild();
      const linked = linkFoldedFigureLayerOrders(bag, figures);
      const shown = linked.figures[0]!;
      const after = {
        ...shown,
        ...(settled === 'reattached' ? { layerOrder: held() } : {}),
        detachedLayerOrder: { ...shown.detachedLayerOrder!, settled },
      };
      const written = saved(linked.extensions, [after]);
      expect(detachedFoldedFigureLayerOrders(written)).toEqual([]);
      if (settled === 'reattached') {
        expect((written[KEY] as { figures: Record<string, unknown> }).figures['generated-1']).toMatchObject({ record: RECORD_JSON });
      } else {
        expect(written[KEY]).toBeUndefined();
      }
      // The figure as it was before: the entry stays.
      expect(detachedFoldedFigureLayerOrders(saved(linked.extensions, [shown]))).toHaveLength(1);
    });

    it('keys its entry to the figure as this build leaves it, so a reload shows it again after a refold, a move or a rename', () => {
      const { bag, figures } = refoldedByAnOlderBuild();
      const shown = linkFoldedFigureLayerOrders(bag, figures);
      const changed = {
        ...shown.figures[0]!,
        title: 'Renamed',
        placement: { offset: { x: 40, y: 0 }, scale: 2, rotation: 1 },
        sourceFingerprint: 'cs1:edited-again',
      };
      const written = saved(shown.extensions, [changed]);
      expect(detachedFoldedFigureLayerOrders(written)).toMatchObject([
        { reason: 'order-not-given', refoldKey: foldedFigureRefoldKey(changed) },
      ]);
      const { detachedLayerOrder: _held, ...reopened } = changed;
      expect(linkFoldedFigureLayerOrders(written, [reopened]).figures[0]!.detachedLayerOrder).toEqual({
        record: RECORD,
        json: RECORD_JSON,
      });
    });

    it('marks its entry figure-missing once its figure is gone, shown or taken up, so a figure on the reused id is never shown it', () => {
      const { bag, figures } = refoldedByAnOlderBuild();
      const linked = linkFoldedFigureLayerOrders(bag, figures);
      const shown = linked.figures[0]!;
      // Taken up and saved: the file drops the entry, and the bag in memory still holds it.
      const taken = { ...shown, layerOrder: held(), detachedLayerOrder: { ...shown.detachedLayerOrder!, settled: 'reattached' as const } };
      expect(detachedFoldedFigureLayerOrders(saved(linked.extensions, [taken]))).toEqual([]);
      // Then deleted — or deleted while it showed the flag, the same bag — and saved.
      const written = saved(linked.extensions, []);
      expect(detachedFoldedFigureLayerOrders(written).map((entry) => entry.reason)).toEqual(['figure-missing']);
      // The same creases folded again on the reused id, saved and reopened: nothing shown.
      const fresh = figure('generated-1', { searched: true, fingerprint: 'cs1:edited' });
      const reopened = linkFoldedFigureLayerOrders(saved(written, [fresh]), [fresh]);
      expect(reopened.figures[0]!.detachedLayerOrder).toBeUndefined();
      expect(detachedFoldedFigureLayerOrders(reopened.extensions).map((entry) => entry.reason)).toEqual(['figure-missing']);
      // The Delete undone before the save: the figure is back, and so is its claim.
      expect(detachedFoldedFigureLayerOrders(saved(linked.extensions, [shown])).map((entry) => entry.reason)).toEqual([
        'order-not-given',
      ]);
    });

    describe('the session’s bag after a save', () => {
      it('drops what the save dropped, so a settled entry is not back as missing once its figure is deleted', () => {
        const { bag, figures } = refoldedByAnOlderBuild();
        const linked = linkFoldedFigureLayerOrders(bag, figures);
        const shown = linked.figures[0]!;
        for (const settled of ['reattached', 'dismissed'] as const) {
          const after = {
            ...shown,
            ...(settled === 'reattached' ? { layerOrder: held() } : {}),
            detachedLayerOrder: { ...shown.detachedLayerOrder!, settled },
          };
          const session = foldedFigureLayerOrdersAfterSave(linked.extensions, [after]);
          // Holds no figure's own record: each figure holds its own, as after a link.
          expect(session[KEY] ?? {}).not.toHaveProperty('figures');
          expect(detachedFoldedFigureLayerOrders(session)).toEqual([]);
          // Deleted, saved: nothing.
          expect(detachedFoldedFigureLayerOrders(saved(session, [])), settled).toEqual([]);
          // The settling undone, saved: its entry again, keyed to the figure.
          expect(detachedFoldedFigureLayerOrders(saved(session, [shown])), settled).toEqual([
            { figureId: 'generated-1', reason: 'order-not-given', refoldKey: foldedFigureRefoldKey(shown), record: RECORD_JSON },
          ]);
        }
      });

      it('keeps a figure-missing mark, which the figure claims back when its Delete is undone', () => {
        const { bag, figures } = refoldedByAnOlderBuild();
        const linked = linkFoldedFigureLayerOrders(bag, figures);
        const session = foldedFigureLayerOrdersAfterSave(linked.extensions, []);
        expect(detachedFoldedFigureLayerOrders(session).map((entry) => entry.reason)).toEqual(['figure-missing']);
        expect(detachedFoldedFigureLayerOrders(saved(session, [linked.figures[0]!]))).toMatchObject([
          { figureId: 'generated-1', reason: 'order-not-given' },
        ]);
      });

      it('is the bag as it came when nothing changed', () => {
        const bag = { futureDocFeature: { a: 1 } };
        expect(foldedFigureLayerOrdersAfterSave(bag, [figure('generated-1')])).toBe(bag);
      });
    });
  });

  it('names every figure id the bag holds, its records’ and its detached entries’', () => {
    const bag = {
      [KEY]: {
        figures: { 'generated-4': { figureKey: 'fk1:a', record: RECORD_JSON } },
        detached: [{ figureId: 'generated-7', reason: 'figure-missing', record: RECORD_JSON }, 'damage'],
      },
    };
    expect(figureIdsInFoldedFigureLayerOrders(bag)).toEqual(['generated-4', 'generated-7']);
    expect(figureIdsInFoldedFigureLayerOrders({ [KEY]: 'garbled' })).toEqual([]);
  });

  it('attaches a development build’s entry, keyed with `sourceKey`, as a record of its own: never a newer build’s lock', () => {
    const fig = figure('generated-1');
    const bag = { [KEY]: { figures: { 'generated-1': { figureKey: foldedFigureLayerOrderKey(fig), sourceKey: 'fs1:abc', record: RECORD_JSON } } } };
    const linked = linkFoldedFigureLayerOrders(bag, [fig]);
    expect(linked.figures[0]!.layerOrder).toEqual(held());
    // Saved again, keyed as this build keys it.
    expect((saved(linked.extensions, linked.figures)[KEY] as { figures: Record<string, unknown> }).figures['generated-1']).toEqual({
      figureKey: foldedFigureLayerOrderKey(fig),
      refoldKey: foldedFigureRefoldKey(fig),
      record: RECORD_JSON,
    });
  });

  it('holds a newer build’s record as it came, keyed as that build keyed it', () => {
    const fig = figure('generated-1');
    const entries = [
      { figureKey: foldedFigureLayerOrderKey(fig), record: '{"v":2,"constraints":"by name"}' },
      { figureKey: foldedFigureLayerOrderKey(fig), record: '{"v":1}', solvedBy: 'clauses' },
    ];
    for (const entry of entries) {
      const bag = { [KEY]: { figures: { 'generated-1': entry } } };
      const linked = linkFoldedFigureLayerOrders(bag, [fig]);
      expect(linked.figures[0]!.layerOrder).toEqual({ kind: 'newer', saved: entry });
      // Saved again as it came, even once the figure has changed: a newer build judges it.
      const changed = { ...linked.figures[0]!, sourceFingerprint: 'cs1:edited' };
      expect(saved(linked.extensions, [changed])).toEqual(bag);
    }
  });

  it('drops only damage: an entry that is not one, or a record that does not read', () => {
    const fig = figure('generated-1');
    const bag = {
      [KEY]: {
        figures: {
          'generated-1': { figureKey: foldedFigureLayerOrderKey(fig), record: '{"v":1,"faces":"none"}' },
          'generated-2': 'not an entry',
          'generated-3': { record: '{"v":1}' },
        },
      },
    };
    const linked = linkFoldedFigureLayerOrders(bag, [fig]);
    expect(linked.figures[0]!.layerOrder).toBeUndefined();
    expect(linked.extensions).toEqual({ [KEY]: {} });
  });
});
