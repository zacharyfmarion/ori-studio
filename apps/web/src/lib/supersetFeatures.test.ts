import { describe, expect, it } from 'vitest';
import { createCpImage, type CpImage } from '../cp-workspace/images/cpImage';
import {
  collectExportLossWarnings,
  describeExportLoss,
  exportFormatLabel,
} from './supersetFeatures';

function image(): CpImage {
  return createCpImage({
    src: 'data:image/png;base64,AAAA',
    naturalWidth: 10,
    naturalHeight: 10,
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
  });
}

describe('collectExportLossWarnings', () => {
  it('warns about images for every Oriedita-compatible format', () => {
    const presence = { images: [image(), image()] };
    for (const format of ['cp', 'fold', 'ori', 'orh', 'dxf', 'obj', 'svg', 'png'] as const) {
      const warnings = collectExportLossWarnings(format, presence);
      expect(warnings).toEqual([{ id: 'images', label: 'Images', count: 2 }]);
    }
  });

  it('is empty when there are no images', () => {
    expect(collectExportLossWarnings('cp', { images: [] })).toEqual([]);
  });

  it('describes and labels the loss', () => {
    const warnings = collectExportLossWarnings('cp', { images: [image(), image(), image()] });
    expect(describeExportLoss(warnings)).toBe('Images (3)');
    expect(exportFormatLabel('fold')).toBe('FOLD');
  });
});
