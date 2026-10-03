import { describe, expect, it } from 'vitest';
import {
  cpLinesByIds,
  foldedSourceFingerprint,
  reselectFoldableLineIds,
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
    expect(choice.creases.clip).toBeNull();
    expect(choice.creases.segment?.id).toBe(left!.id);
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
    expect(choice.status === 'found' && choice.creases.segment?.id).toBe(left!.id);
  });
});

describe('chooseStepCreases, a figure box', () => {
  const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  it('re-chooses its creases by overlap, as Edit refolds, and cuts what it draws to the box', () => {
    const document = cpDocument();
    const choice = chooseStepCreases(document, { kind: 'figure-bounds', bounds: box }, null);
    expect(choice.status).toBe('found');
    if (choice.status !== 'found') return;
    expect(choice.creases.foldLineIds).toEqual(reselectFoldableLineIds(document, box));
    // Overlap is closed, as upstream's: lines that only touch the box count.
    expect(choice.creases.foldLineIds).toContain(2);
    expect(choice.creases.scopedLineIds).toContain(10);
    expect(choice.creases.clip).toEqual(box);
    expect(choice.creases.paper[0]).toHaveLength(4);
  });

  it('is missing when no foldable crease overlaps the box', () => {
    const away = { minX: 500, minY: 500, maxX: 600, maxY: 600 };
    expect(chooseStepCreases(cpDocument(), { kind: 'figure-bounds', bounds: away }, null)).toEqual({
      status: 'missing',
    });
  });
});
