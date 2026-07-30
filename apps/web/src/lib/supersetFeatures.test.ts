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

const noneElse = { richText: [] as [], inlineSimulations: [] as [] };

describe('collectExportLossWarnings', () => {
  it('warns about images for every Oriedita-compatible format', () => {
    const presence = { images: [image(), image()], richText: [], inlineSimulations: [] };
    for (const format of ['cp', 'fold', 'ori', 'orh', 'dxf', 'obj', 'svg', 'png'] as const) {
      const warnings = collectExportLossWarnings(format, presence);
      expect(warnings).toEqual([{ id: 'images', label: 'Images', count: 2 }]);
    }
  });

  it('warns that rich-text formatting is dropped on every non-.osf format', () => {
    const presence = {
      images: [],
      richText: [createTextAnnotation({ center: { x: 0, y: 0 } })],
      inlineSimulations: [],
    };
    expect(collectExportLossWarnings('ori', presence)).toEqual([
      { id: 'richText', label: 'Rich text formatting', count: 1 },
    ]);
  });

  it('is empty when there are no superset features', () => {
    expect(collectExportLossWarnings('cp', { images: [], ...noneElse })).toEqual([]);
  });

  it('warns that simulation windows are dropped on every non-.osf format', () => {
    // Placement and the region each window came from; no Oriedita format has
    // anywhere to put either, so they go whole rather than degraded.
    const presence = {
      images: [],
      richText: [] as [],
      inlineSimulations: [
        { id: 'a' } as never,
        { id: 'b' } as never,
      ],
    };
    expect(collectExportLossWarnings('cp', presence)).toEqual([
      { id: 'inlineSimulations', label: 'Simulation windows', count: 2 },
    ]);
    expect(collectExportLossWarnings('fold', presence)).toHaveLength(1);
  });

  it('describes and labels the loss', () => {
    const warnings = collectExportLossWarnings('cp', {
      images: [image(), image(), image()],
      ...noneElse,
    });
    expect(describeExportLoss(warnings)).toBe('Images (3)');
    expect(exportFormatLabel('fold')).toBe('FOLD');
  });
});
