import { describe, expect, it } from 'vitest';
import { conditionDetail, conditionTitle } from './conditionLabels';

describe('condition labels', () => {
  it('labels fixed node and path angle conditions', () => {
    expect(
      conditionTitle({
        type: 'node_fixed',
        node: 3,
        x_fixed: true,
        y_fixed: false,
        x_fix_value: 0.25,
        y_fix_value: 0,
      }),
    ).toBe('Node 3 fixed');
    expect(
      conditionDetail({
        type: 'path_angle_quant',
        node1: 2,
        node2: 5,
        quant: 8,
        quant_offset: 11.25,
      }),
    ).toBe('8 divisions, offset 11.25 deg');
  });
});
