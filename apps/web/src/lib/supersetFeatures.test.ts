import { describe, expect, it } from 'vitest';
import { createCpImage, type CpImage } from '../cp-workspace/images/cpImage';
import { createTextAnnotation } from '../cp-workspace/annotations/textAnnotation';
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

const noText = { richText: [] as [] };

describe('collectExportLossWarnings', () => {
  it('warns about images for every Oriedita-compatible format', () => {
    const presence = { images: [image(), image()], richText: [] };
    for (const format of ['cp', 'fold', 'ori', 'orh', 'dxf', 'obj', 'svg', 'png'] as const) {
      const warnings = collectExportLossWarnings(format, presence);
      expect(warnings).toEqual([{ id: 'images', label: 'Images', count: 2 }]);
    }
  });

  it('warns that rich-text formatting is dropped on every non-.osf format', () => {
    const presence = {
      images: [],
      richText: [createTextAnnotation({ center: { x: 0, y: 0 } })],
    };
    expect(collectExportLossWarnings('ori', presence)).toEqual([
      { id: 'richText', label: 'Rich text formatting', count: 1 },
    ]);
  });

  it('is empty when there are no superset features', () => {
    expect(collectExportLossWarnings('cp', { images: [], ...noText })).toEqual([]);
  });

  it('describes and labels the loss', () => {
    const warnings = collectExportLossWarnings('cp', {
      images: [image(), image(), image()],
      ...noText,
    });
    expect(describeExportLoss(warnings)).toBe('Images (3)');
    expect(exportFormatLabel('fold')).toBe('FOLD');
  });
});
