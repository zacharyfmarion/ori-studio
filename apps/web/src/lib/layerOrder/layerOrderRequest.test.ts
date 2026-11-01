import { describe, expect, it } from 'vitest';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import { DEFAULT_FOLDED_MODEL } from '../orieditaNativeMetadata';
import { DEFAULT_PAPER_STYLE } from '../paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../paper/paperStyleResolve';
import { foldedFigureLayerOrder } from './foldedFigureLayerOrder';
import type { LayerOrderRecord } from './layerOrderRecord';
import type { LayerOrderApplied, LayerOrderRequest } from './layerOrderRequest';

function segment(ax: number, ay: number, bx: number, by: number, color: string): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: 'Inactive0',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  };
}

const RECORD: LayerOrderRecord = {
  faces: [
    { at: [100, 150], area: 20000 },
    { at: [300, 150], area: 20000 },
  ],
  constraints: [[0, 1, 1]],
  order: [],
};

// The contract is types: these say a host can build it from what it has, and
// the dialog can hand back what the host's kernel folds.
describe('the Layer order dialog’s contract', () => {
  it('takes a host’s fold, record and paper, and gives back the fold with the chosen order', () => {
    const request: LayerOrderRequest = {
      source: {
        segments: [segment(-200, 0, 200, 0, 'Red1'), segment(-200, -200, 200, -200, 'Black0')],
        startingFaceId: 1,
        auxSegments: [],
        model: DEFAULT_FOLDED_MODEL,
        digest: 'ring-digest',
      },
      record: RECORD,
      look: {
        style: DEFAULT_PAPER_STYLE,
        policy: PAPER_STYLE_POLICIES['folded-flat'],
        turnDeg: 90,
        side: 'back',
        xray: false,
        lineStyle: 'black-white',
        lineWidth: 2,
      },
    };
    // The side and the turn go together: a step turned over and a quarter turn from its back.
    expect([request.look.side, request.look.turnDeg]).toEqual(['back', 90]);
    const applied: LayerOrderApplied = {
      record: request.record!,
      relations: Uint32Array.from([0, 1]),
      source: request.source,
    };
    expect(applied.source).toBe(request.source);
    expect(Array.from(applied.relations)).toEqual([0, 1]);
  });
});

describe('a figure’s held layer order', () => {
  it('holds a record with the JSON it saves', () => {
    const held = foldedFigureLayerOrder(RECORD);
    expect(held).toEqual({
      ok: true,
      layerOrder: {
        kind: 'record',
        record: RECORD,
        json: '{"v":1,"faces":[{"at":[100,150],"area":20000},{"at":[300,150],"area":20000}],"constraints":[[0,1,1]],"order":[]}',
      },
    });
  });

  it('refuses a record that would not save, as the encoder does', () => {
    expect(foldedFigureLayerOrder({ ...RECORD, constraints: [[0, 0, 1]] })).toEqual({
      ok: false,
      reason: 'invalid',
      part: 'constraints',
    });
  });
});
