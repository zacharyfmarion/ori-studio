import { describe, expect, it } from 'vitest';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { LayerOrderApplied } from '../../lib/layerOrder/layerOrderRequest';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import type { FoldAdjustOrderOpening } from '../engine/foldEngineIoWire';
import type { FoldImportView } from '../io/foldImportLayerOrder';
import { foldAdjustOrderChosen, foldAdjustOrderRequest } from './adjustOrderRequest';

/** What Adjust order asks the Layer order dialog, and what of its answer the step takes. */
const SHOWN = { flipped: false, subfaces: [], faces: [] } as unknown as OristudioCpFoldedPaperScene;
const OPENING: FoldAdjustOrderOpening = {
  source: { segments: [], starting_face_id: 1, aux_segments: [], digest: '0123456789abcdef' },
  shown: SHOWN,
  look: { side: 'back', turn_deg: 225 },
};
const VIEW: FoldImportView = { style: DEFAULT_PAPER_STYLE, lineStyle: 'color', lineWidth: 2, foldAngleDisplay: 'opacity' };

describe('Adjust order’s Layer order request', () => {
  it('opens on the step’s own order, in Fold’s look, with no record and no Rotate', () => {
    const request = foldAdjustOrderRequest(OPENING, VIEW);
    expect(request).toMatchObject({
      surface: 'fold_adjust_order',
      record: null,
      shown: SHOWN,
      rotate: false,
      look: {
        style: DEFAULT_PAPER_STYLE,
        policy: PAPER_STYLE_POLICIES.fold,
        side: 'back',
        turnDeg: 225,
        xray: false,
        lineStyle: 'color',
        lineWidth: 2,
        foldAngleDisplay: 'opacity',
      },
    });
    expect(request.source).toMatchObject({ digest: '0123456789abcdef', startingFaceId: 1, model: DEFAULT_FOLDED_MODEL });
  });

  it('takes Apply’s relations and their digest, never a turn, and nothing from any other answer', () => {
    const relations = Uint32Array.from([1, 0, 2, 1]);
    const applied = { relations, source: { digest: 'cafe' } } as unknown as LayerOrderApplied;
    expect(foldAdjustOrderChosen({ kind: 'applied', applied, turnDeg: 90 })).toEqual({ digest: 'cafe', relations });
    for (const outcome of [
      { kind: 'unchanged', turnDeg: 90 },
      { kind: 'cancelled' },
      { kind: 'busy' },
      { kind: 'unavailable' },
    ] as const) {
      expect(foldAdjustOrderChosen(outcome), outcome.kind).toBeNull();
    }
  });
});
