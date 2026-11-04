import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { LayerOrderDialogOutcome } from '../../layer-order/dialog/layerOrderDialogGateway';
import type { LayerOrderApplied, LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import type { FoldImportLayerOrderAsk } from './foldImportFlow';

/**
 * The request Fold's Import CP opens the Layer order dialog on (row H10), and
 * how each of the dialog's answers reaches the import flow, through the
 * dialog's one door, stood in for here.
 */
const dialog = vi.hoisted(() => ({
  requests: [] as LayerOrderRequest[],
  signals: [] as (AbortSignal | undefined)[],
  answer: { kind: 'cancelled' } as LayerOrderDialogOutcome,
}));
const toasts = vi.hoisted(() => ({ shown: [] as string[] }));

vi.mock('../../layer-order/dialog/layerOrderDialogGateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../layer-order/dialog/layerOrderDialogGateway')>();
  return {
    ...actual,
    prefetchLayerOrderDialog: () => {},
    openLayerOrderDialog: async (request: LayerOrderRequest, options?: { signal?: AbortSignal }) => {
      dialog.requests.push(request);
      dialog.signals.push(options?.signal);
      return dialog.answer;
    },
  };
});

vi.mock('sonner', () => ({ toast: (message: string) => toasts.shown.push(message) }));

import { chooseFoldImportLayerOrder, foldImportLayerOrderRequest, foldImportView, type FoldImportView } from './foldImportLayerOrder';

const t = ((_key: string, english: string) => english) as unknown as TFunction;

const SHOWN = { flipped: false, subfaces: [], faces: [] } as unknown as OristudioCpFoldedPaperScene;
const ASK: FoldImportLayerOrderAsk = {
  request: { kind: 'file', name: 'kabuto.fold', source: { format: 'fold', text: '{}' } },
  opening: {
    source: { segments: [], starting_face_id: 1, aux_segments: [], digest: '0123456789abcdef' },
    shown: SHOWN,
    look: { side: 'back', turn_deg: 270 },
  },
};
const VIEW: FoldImportView = { style: DEFAULT_PAPER_STYLE, lineStyle: 'color', lineWidth: 2 };

beforeEach(() => {
  dialog.requests = [];
  dialog.signals = [];
  dialog.answer = { kind: 'cancelled' };
  toasts.shown = [];
});

describe('Import CP’s Layer order request', () => {
  it('asks from Fold’s import, on the engine’s opening, with no record, in Fold’s look, named by its file', () => {
    expect(foldImportLayerOrderRequest(ASK, VIEW)).toEqual({
      surface: 'fold_import',
      source: {
        segments: [],
        startingFaceId: 1,
        auxSegments: [],
        model: DEFAULT_FOLDED_MODEL,
        digest: '0123456789abcdef',
      },
      record: null,
      look: {
        style: DEFAULT_PAPER_STYLE,
        policy: PAPER_STYLE_POLICIES.fold,
        turnDeg: 270,
        side: 'back',
        xray: false,
        lineStyle: 'color',
        lineWidth: 2,
      },
      shown: SHOWN,
      name: 'kabuto.fold',
    });
    // Only a file has a name to give.
    const sample: FoldImportLayerOrderAsk = { ...ASK, request: { kind: 'sample', sample: 'waterbomb-base' } };
    expect(foldImportLayerOrderRequest(sample, VIEW)).not.toHaveProperty('name');
    // An import is its one sheet: the pane frames the source's creases, so no region.
    expect(foldImportLayerOrderRequest(ASK, VIEW)).not.toHaveProperty('region');
  });

  it('reads Fold’s paper and Edit’s pen off the workspace', () => {
    const view = foldImportView({
      foldSequences: [],
      oristudioCpViewport: { lineWidth: 3 } as never,
    });
    expect(view).toMatchObject({ lineWidth: 3 });
    expect(view.style).toBeTruthy();
  });
});

describe('Import CP’s answer from the Layer order dialog', () => {
  const relations = Uint32Array.from([2, 0, 3, 1]);
  const applied = { relations, record: {}, source: { digest: 'fedcba9876543210' } } as unknown as LayerOrderApplied;

  it.each([
    [{ kind: 'applied', applied } as LayerOrderDialogOutcome, { kind: 'applied', relations, digest: 'fedcba9876543210' }],
    [{ kind: 'unchanged' } as LayerOrderDialogOutcome, { kind: 'unchanged' }],
    [{ kind: 'cancelled' } as LayerOrderDialogOutcome, { kind: 'cancelled' }],
    [{ kind: 'unavailable' } as LayerOrderDialogOutcome, { kind: 'fallback' }],
    [{ kind: 'busy' } as LayerOrderDialogOutcome, { kind: 'fallback' }],
  ])('%j answers %j', async (outcome, answer) => {
    dialog.answer = outcome;
    await expect(chooseFoldImportLayerOrder(ASK, VIEW, t)).resolves.toEqual(answer);
    expect(dialog.requests).toHaveLength(1);
    expect(dialog.requests[0]).toMatchObject({ surface: 'fold_import' });
  });

  it('hands the flow’s signal to the gateway, so letting the import go withdraws the dialog', async () => {
    const asked = new AbortController();
    await chooseFoldImportLayerOrder(ASK, VIEW, t, asked.signal);
    expect(dialog.signals).toEqual([asked.signal]);
  });

  it('says why when another Layer order dialog is open; the gateway says so for one that didn’t load', async () => {
    dialog.answer = { kind: 'busy' };
    await chooseFoldImportLayerOrder(ASK, VIEW, t);
    expect(toasts.shown).toEqual([
      'Layer order is already open, so choose this crease pattern’s layer order on the canvas.',
    ]);
    toasts.shown = [];
    for (const kind of ['unavailable', 'cancelled', 'unchanged'] as const) {
      dialog.answer = { kind };
      await chooseFoldImportLayerOrder(ASK, VIEW, t);
    }
    expect(toasts.shown).toEqual([]);
  });
});
