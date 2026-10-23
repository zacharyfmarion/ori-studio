import { describe, expect, it } from 'vitest';
import { readSheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { storedCpSource } from '../document/diagramFile';
import { cpDocument, twoSquaresIndex } from './capture.fixtures';
import { chooseStepCreases } from './captureCreases';
import { creasesThumbnail } from './captureThumbnail';

describe('creasesThumbnail', () => {
  it('draws every line of the sheet, snapped, and the file reads it back', () => {
    const sheets = twoSquaresIndex();
    const [left] = sheetRegions(sheets);
    const scope = { kind: 'segment' as const, region: regionReferenceFor(left!) };
    const document = cpDocument();
    const choice = chooseStepCreases(document, scope, sheets);
    if (choice.status !== 'found') throw new Error('the left square is a sheet');
    const thumbnail = creasesThumbnail(document, choice.creases);
    // Its four sides, its diagonal and its aux line: the lines drawn, not face edges.
    expect(thumbnail.strokes.map((entry) => entry.role).sort()).toEqual([
      'aux',
      'edge',
      'edge',
      'edge',
      'edge',
      'mountain',
    ]);
    // To a tenth of the box, so the file stays short.
    for (const entry of thumbnail.strokes) {
      for (const value of [entry.x1, entry.y1, entry.x2, entry.y2]) {
        expect(Math.round(value * 10) / 10).toBe(value);
      }
    }
    expect(readSheetThumbnail(thumbnail)).not.toBeNull();
    expect(
      storedCpSource({
        kind: 'cp',
        scope,
        fingerprint: choice.creases.fingerprint,
        thumbnail,
        render: { mode: 'crease-pattern', rotationDeg: 0 },
      })
    ).not.toBeNull();
  });
});
