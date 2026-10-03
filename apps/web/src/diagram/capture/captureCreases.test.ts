import { describe, expect, it } from 'vitest';
import {
  cpLinesByIds,
  foldedSourceFingerprint,
} from '../../cp-workspace/folded/foldedFigureStaleness';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import type { DiagramCpScope } from '../document/diagramDocument';
import {
  cpDocument,
  LEFT_FOLD_LINE_IDS,
  LEFT_LINE_IDS,
  TWO_SQUARES,
  twoSquaresSegmentation,
} from './capture.fixtures';
import { chooseStepCreases } from './captureCreases';

const segmentation = twoSquaresSegmentation();
const [left, right] = resolveCpSegments(segmentation);
const leftScope: DiagramCpScope = { kind: 'segment', region: regionReferenceFor(left!) };

describe('chooseStepCreases, a region', () => {
  it('finds the region by its rim, and is made of every line inside it', () => {
    const document = cpDocument();
    const choice = chooseStepCreases(document, leftScope, segmentation);
    expect(choice.status).toBe('found');
    if (choice.status !== 'found') return;
    expect(choice.creases.scopedLineIds).toEqual(LEFT_LINE_IDS);
    // The aux line is drawn, never folded, and not fingerprinted.
    expect(choice.creases.foldLineIds).toEqual(LEFT_FOLD_LINE_IDS);
    expect(choice.creases.fingerprint).toBe(
      foldedSourceFingerprint(cpLinesByIds(document, LEFT_FOLD_LINE_IDS))
    );
    expect(choice.creases.paper).toEqual(left!.boundary);
    expect(choice.creases.segment.id).toBe(left!.id);
  });

  it('keeps its fingerprint through an edit to the other region, and changes it for its own', () => {
    const before = chooseStepCreases(cpDocument(), leftScope, segmentation);
    // The right diagonal turns mountain: the left region is untouched.
    const otherEdited = cpDocument(TWO_SQUARES.map((line, i) => (i === 8 ? [...line.slice(0, 4), 'Red1'] as typeof line : line)));
    const after = chooseStepCreases(otherEdited, leftScope, segmentation);
    const ownEdited = cpDocument(TWO_SQUARES.map((line, i) => (i === 7 ? [...line.slice(0, 4), 'Blue2'] as typeof line : line)));
    const own = chooseStepCreases(ownEdited, leftScope, segmentation);
    if (before.status !== 'found' || after.status !== 'found' || own.status !== 'found') {
      throw new Error('every choice should find the region');
    }
    expect(after.creases.fingerprint).toBe(before.creases.fingerprint);
    expect(own.creases.fingerprint).not.toBe(before.creases.fingerprint);
  });

  it('is missing when the region is gone, and unknown before the segmentation is ready', () => {
    // The middle wall stops being a border: the two regions are one.
    expect(chooseStepCreases(cpDocument(), leftScope, twoSquaresSegmentation({ wall: false }))).toEqual({
      status: 'missing',
    });
    expect(chooseStepCreases(cpDocument(), leftScope, null)).toEqual({ status: 'unknown' });
  });

  it('never takes another region for this one, even under its id', () => {
    const lying: DiagramCpScope = {
      kind: 'segment',
      region: { ...regionReferenceFor(left!), segmentIdHint: right!.id },
    };
    const choice = chooseStepCreases(cpDocument(), lying, segmentation);
    expect(choice.status === 'found' && choice.creases.segment.id).toBe(left!.id);
  });
});
