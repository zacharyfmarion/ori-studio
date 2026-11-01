import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_LAYER_ORDER_SOURCE } from '../../layer-order/engine/layerOrderEngine.fixtures';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderApplied } from '../../lib/layerOrder/layerOrderRequest';
import {
  exportLayerOrderAfter,
  exportLayerOrderFor,
  rememberExportLayerOrder,
  resetExportLayerOrdersForTest,
  type ExportLayerOrder,
} from './exportLayerOrders';

const RECORD: LayerOrderRecord = { faces: [{ at: [1, 2], area: 3 }, { at: [4, 5], area: 6 }], constraints: [[0, 1, 1]], order: [] };
const APPLIED: LayerOrderApplied = { record: RECORD, relations: new Uint32Array([0, 1]), source: FAKE_LAYER_ORDER_SOURCE };

afterEach(() => resetExportLayerOrdersForTest());

describe('exportLayerOrderAfter', () => {
  it('keeps an applied order, with the turn Rotate left', () => {
    const next = exportLayerOrderAfter(null, { kind: 'applied', applied: APPLIED, turnDeg: 90 });
    expect(next?.turnDeg).toBe(90);
    expect(next?.chosen?.applied).toBe(APPLIED);
    // As the dialog's next opening is handed it: the record's own encoding.
    expect(JSON.parse(next?.chosen?.json ?? '{}')).toMatchObject({ v: 1, constraints: [[0, 1, 1]] });
    expect(next?.chosen?.key).toMatch(/^xlo1:/);
  });

  it('keeps the turn that was kept when an Apply did not turn', () => {
    const kept: ExportLayerOrder = { chosen: null, turnDeg: 180 };
    expect(exportLayerOrderAfter(kept, { kind: 'applied', applied: APPLIED })?.turnDeg).toBe(180);
  });

  it('keys two orders apart, and the same order alike', () => {
    const one = exportLayerOrderAfter(null, { kind: 'applied', applied: APPLIED })?.chosen?.key;
    const again = exportLayerOrderAfter(null, { kind: 'applied', applied: { ...APPLIED } })?.chosen?.key;
    const other = exportLayerOrderAfter(null, {
      kind: 'applied',
      applied: { ...APPLIED, record: { ...RECORD, constraints: [[1, 0, 1]] } },
    })?.chosen?.key;
    expect(again).toBe(one);
    expect(other).not.toBe(one);
  });

  it('keeps only the turn of an Apply that changed no order, and the order it had', () => {
    const chosen = exportLayerOrderAfter(null, { kind: 'applied', applied: APPLIED })!.chosen;
    expect(exportLayerOrderAfter({ chosen, turnDeg: 0 }, { kind: 'unchanged', turnDeg: 270 })).toEqual({
      chosen,
      turnDeg: 270,
    });
    expect(exportLayerOrderAfter(null, { kind: 'unchanged', turnDeg: 90 })).toEqual({ chosen: null, turnDeg: 90 });
  });

  it('changes nothing for an Apply with nothing to keep, a Cancel, a busy dialog or none', () => {
    const kept: ExportLayerOrder = { chosen: null, turnDeg: 90 };
    expect(exportLayerOrderAfter(kept, { kind: 'unchanged' })).toBeNull();
    expect(exportLayerOrderAfter(kept, { kind: 'cancelled' })).toBeNull();
    expect(exportLayerOrderAfter(kept, { kind: 'busy' })).toBeNull();
    expect(exportLayerOrderAfter(kept, { kind: 'unavailable' })).toBeNull();
  });
});

describe('the session’s orders', () => {
  it('keeps one per fold’s creases, by digest, for Export and Share alike', () => {
    const entry = exportLayerOrderAfter(null, { kind: 'applied', applied: APPLIED })!;
    rememberExportLayerOrder('fold-a', entry);
    expect(exportLayerOrderFor('fold-a')).toBe(entry);
    expect(exportLayerOrderFor('fold-b')).toBeNull();
  });
});
