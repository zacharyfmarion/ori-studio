import { describe, expect, it } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { segmentSheetThumbnail } from '../../cp-workspace/sheets/segmentSheet';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { cpStep } from '../document/diagramSteps.fixtures';
import { twoSquaresSegmentation } from './capture.fixtures';
import { linkedSheet } from './useDiagramPatternSheets';

const segmentation = twoSquaresSegmentation();
const sheets = resolveCpSegments(segmentation).map((segment) => ({
  segment,
  thumbnail: segmentSheetThumbnail(segmentation.fold, segment),
}));

describe('linkedSheet', () => {
  it('finds the pattern a step shows by its rim, whatever its id says', () => {
    const [, right] = sheets;
    const step = {
      ...cpStep('step-1'),
      source: {
        ...cpStep('step-1').source!,
        scope: { kind: 'segment' as const, region: { ...regionReferenceFor(right!.segment), segmentIdHint: 99 } },
      },
    };
    expect(linkedSheet(step, sheets)).toBe(right);
  });

  it('finds none for a step whose pattern is gone', () => {
    // The fixture step's rim is a unit square, which is no region of this pattern.
    expect(linkedSheet(cpStep('step-1'), sheets)).toBeNull();
  });
});
