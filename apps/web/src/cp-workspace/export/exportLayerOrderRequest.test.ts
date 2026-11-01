import { describe, expect, it } from 'vitest';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { FAKE_LAYER_ORDER_SOURCE } from '../../layer-order/engine/layerOrderEngine.fixtures';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { exportLayerOrderRequest, type ExportLayerOrderRequestParts } from './exportLayerOrderRequest';

const SHOWN = { schema_version: 2, faces: [], subfaces: [] } as unknown as OristudioCpFoldedPaperScene;
const RECORD: LayerOrderRecord = { faces: [{ at: [1, 2], area: 3 }], constraints: [], order: [] };

function parts(overrides: Partial<ExportLayerOrderRequestParts> = {}): ExportLayerOrderRequestParts {
  return {
    surface: 'crease_export',
    source: FAKE_LAYER_ORDER_SOURCE,
    shown: SHOWN,
    region: null,
    record: null,
    style: DEFAULT_PAPER_STYLE,
    side: 'Front0',
    turnDeg: 0,
    xray: false,
    lineStyle: 'color',
    lineWidth: 2,
    name: 'Kabuto',
    ...overrides,
  };
}

describe('exportLayerOrderRequest', () => {
  it('asks on the fold the preview shows, as its own source, in the inset’s look', () => {
    expect(exportLayerOrderRequest(parts())).toEqual({
      surface: 'crease_export',
      source: FAKE_LAYER_ORDER_SOURCE,
      record: null,
      look: {
        style: DEFAULT_PAPER_STYLE,
        policy: PAPER_STYLE_POLICIES['folded-flat'],
        turnDeg: 0,
        side: 'front',
        xray: false,
        lineStyle: 'color',
        lineWidth: 2,
      },
      shown: SHOWN,
      name: 'Kabuto',
    });
  });

  it('reopens on the order last applied, its turn and side, and the sheet the creases lie on', () => {
    const region = { paper: [[{ x: 0, y: 0 }]], auxSegments: [] };
    const request = exportLayerOrderRequest(
      parts({ record: RECORD, side: 'Back1', turnDeg: 90, region, surface: 'share_card' })
    );
    expect(request.record).toBe(RECORD);
    expect(request.region).toBe(region);
    expect(request.surface).toBe('share_card');
    expect(request.look).toMatchObject({ side: 'back', turnDeg: 90 });
  });

  it('opens see-through when the figure is spread, so its stepper walks every order', () => {
    expect(exportLayerOrderRequest(parts({ xray: true })).look.xray).toBe(true);
  });

  it('names the card’s figure by its title, with the author quieter after it', () => {
    const request = exportLayerOrderRequest(parts({ name: 'Crane', byline: 'by Birb', surface: 'share_card' }));
    expect(request).toMatchObject({ name: 'Crane', byline: 'by Birb' });
    expect(exportLayerOrderRequest(parts({ byline: null }))).not.toHaveProperty('byline');
  });

  it('leaves out what it has none of: a scene shown, a sheet', () => {
    const request = exportLayerOrderRequest(parts({ shown: null }));
    expect(request).not.toHaveProperty('shown');
    expect(request).not.toHaveProperty('region');
  });
});
