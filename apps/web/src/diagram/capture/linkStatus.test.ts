import { describe, expect, it } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import type { DiagramCpScope } from '../document/diagramDocument';
import { cpDocument, TWO_SQUARES, twoSquaresSegmentation, type FixtureLine } from './capture.fixtures';
import { chooseStepCreases } from './captureCreases';
import { linkStatus } from './linkStatus';

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);
const regionScope: DiagramCpScope = { kind: 'segment', region: regionReferenceFor(left!) };
const boxScope: DiagramCpScope = { kind: 'figure-bounds', bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } };

/** The source a capture of `scope` from `document` would record. */
function linked(scope: DiagramCpScope, document = cpDocument()) {
  const choice = chooseStepCreases(document, scope, segmentation);
  if (choice.status !== 'found') throw new Error('the scope should be found');
  return { scope, fingerprint: choice.creases.fingerprint };
}

/** The left diagonal turned valley. */
const edited = () =>
  cpDocument(TWO_SQUARES.map((line, i): FixtureLine => (i === 7 ? [...line.slice(0, 4), 'Blue2'] as FixtureLine : line)));

describe('linkStatus', () => {
  it.each([
    ['a region', regionScope],
    ['a figure box', boxScope],
  ])('reads %s current against the pattern it was captured from, and stale once its creases change', (_label, scope) => {
    const source = linked(scope);
    expect(linkStatus(source, cpDocument(), segmentation)).toBe('current');
    expect(linkStatus(source, edited(), segmentation)).toBe('stale');
  });

  it('reads a region whose rim is gone missing, before it reads it stale', () => {
    const source = linked(regionScope);
    expect(linkStatus(source, edited(), twoSquaresSegmentation({ wall: false }))).toBe('missing');
  });

  it('reads a box no crease overlaps any more missing', () => {
    const source = linked(boxScope);
    const elsewhere = cpDocument(TWO_SQUARES.map(([ax, ay, bx, by, color]): FixtureLine => [ax + 1000, ay, bx + 1000, by, color]));
    expect(linkStatus(source, elsewhere, segmentation)).toBe('missing');
  });

  it('cannot say with no pattern open, or a region before the segmentation is ready', () => {
    expect(linkStatus(linked(regionScope), null, segmentation)).toBe('unknown');
    expect(linkStatus(linked(regionScope), cpDocument(), null)).toBe('unknown');
    // A box needs no segmentation.
    expect(linkStatus(linked(boxScope), cpDocument(), null)).toBe('current');
  });
});
