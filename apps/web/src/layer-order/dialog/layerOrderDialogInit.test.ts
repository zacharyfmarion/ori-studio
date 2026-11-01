import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { FAKE_LAYER_ORDER_SOURCE } from '../engine/layerOrderEngine.fixtures';
import { carried, dispatch, lastOf, openFactsOf, opened } from '../model/layerOrderModel.fixtures';
import { untouchedApplyWrites } from '../model/layerOrderDecisions';
import { layerOrderRequestInit } from './layerOrderDialogInit';

const RECORD: LayerOrderRecord = {
  faces: [
    { at: [0, 0], area: 1 },
    { at: [1, 0], area: 1 },
  ],
  constraints: [[0, 1, 1]],
  order: [],
};

function request(overrides: Partial<LayerOrderRequest> = {}): LayerOrderRequest {
  return {
    surface: 'edit_figure',
    source: FAKE_LAYER_ORDER_SOURCE,
    record: null,
    look: {
      style: DEFAULT_PAPER_STYLE,
      policy: PAPER_STYLE_POLICIES['folded-flat'],
      turnDeg: 0,
      side: 'front',
      xray: false,
      lineStyle: 'color',
      lineWidth: 1,
    },
    ...overrides,
  };
}

/** A record restored whole, on the order it was saved with: what an untouched Apply would otherwise leave alone. */
const RESTORED_WHOLE = openFactsOf({ constraints: [[2, 0, 1]], restore: { outcome: { kind: 'applied' }, carried: [] } });

/** What the reducer's Apply answers on `facts`, opened from `asked` through the shared init. */
function untouchedApply(asked: LayerOrderRequest, facts = RESTORED_WHOLE) {
  const { state } = opened(facts, layerOrderRequestInit(asked));
  return lastOf(dispatch(state, { type: 'apply', at: 2_000 }).effects, 'apply').result.kind;
}

describe('the dialog’s init, read from the host’s request in one place', () => {
  it('makes an untouched Apply write on a stale host’s record (D12), as the shell’s Apply does', () => {
    const stale = request({ record: RECORD, applyRefolds: true });
    expect(layerOrderRequestInit(stale)).toEqual({ hasRecord: true, recordNeedsAttention: true, review: false, xray: false });
    expect(untouchedApply(stale)).toBe('changed');
    // The same record on a host that shows it: untouched, nothing to write (D16).
    expect(untouchedApply(request({ record: RECORD }))).toBe('no_change');
    // A flagged record writes too, so the host can clear its flag (D10).
    expect(untouchedApply(request({ record: { ...RECORD, attention: { reason: 'conflict', count: 1 } } }))).toBe('changed');
  });

  it('leaves an untouched Apply on a stale host with no record as nothing to write: the host’s plain Refold', () => {
    const plain = request({ applyRefolds: true });
    expect(layerOrderRequestInit(plain).recordNeedsAttention).toBe(false);
    expect(untouchedApply(plain, openFactsOf())).toBe('no_change');
    expect(untouchedApplyWrites(null, true)).toBe(false);
    expect(untouchedApplyWrites(RECORD, true)).toBe(true);
  });

  it('opens on the flagged rows from Review… (D14), and on none otherwise', () => {
    const flagged = openFactsOf({
      constraints: [[2, 0, 1]],
      restore: {
        outcome: { kind: 'applied' },
        carried: [carried({ index: 1, status: { status: 'ambiguous' }, subjectState: 'ambiguous', constraint: null })],
      },
    });
    const reviewed = opened(flagged, layerOrderRequestInit(request({ record: RECORD, review: true }))).state;
    expect(reviewed.reviewRows).toEqual([reviewed.rows.carried[0]!.id]);
    expect(opened(flagged, layerOrderRequestInit(request({ record: RECORD }))).state.reviewRows).toBeNull();
  });

  it('carries the host’s X-ray into the view', () => {
    const asked = request({ look: { ...request().look, xray: true } });
    expect(opened(openFactsOf(), layerOrderRequestInit(asked)).state.view.xray).toBe(true);
  });
});
