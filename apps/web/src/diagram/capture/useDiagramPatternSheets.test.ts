import { describe, expect, it } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { segmentSheetThumbnail } from '../../cp-workspace/sheets/segmentSheet';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { cpStep } from '../document/diagramSteps.fixtures';
import { cpDocument, movedLines, TWO_SQUARES, twoSquaresSegmentation } from './capture.fixtures';
import { chooseStepCreases, creasesFingerprint } from './captureCreases';
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
    expect(linkedSheet(step, sheets, cpDocument(), segmentation)).toBe(right);
  });

  it('finds none for a step whose pattern is gone', () => {
    // The fixture step's rim is a unit square, which is no region of this pattern.
    expect(linkedSheet(cpStep('step-1'), sheets, cpDocument(), segmentation)).toBeNull();
  });

  it('marks the pattern where it moved to, its creases unchanged', () => {
    const [, right] = sheets;
    const scope = { kind: 'segment' as const, region: regionReferenceFor(right!.segment) };
    const choice = chooseStepCreases(cpDocument(), scope, segmentation);
    if (choice.status !== 'found') throw new Error('found');
    const render = { mode: 'crease-pattern' as const, rotationDeg: 0 };
    const step = {
      ...cpStep('step-1'),
      source: { ...cpStep('step-1').source!, scope, render, fingerprint: creasesFingerprint(choice.creases, render) },
    };
    const moved = twoSquaresSegmentation({ dx: 300, dy: 40 });
    const movedSheets = resolveCpSegments(moved).map((segment) => ({ segment, thumbnail: null }));
    expect(linkedSheet(step, movedSheets, cpDocument(movedLines(TWO_SQUARES, 300, 40)), moved)).toBe(movedSheets[1]);
  });
});
