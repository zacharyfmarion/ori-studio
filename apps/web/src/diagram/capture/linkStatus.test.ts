import { describe, expect, it } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import type { DiagramCpRender, DiagramCpScope } from '../document/diagramDocument';
import { cpDocument, TWO_SQUARES, twoSquaresSegmentation, type FixtureLine } from './capture.fixtures';
import { chooseStepCreases, creasesFingerprint } from './captureCreases';
import { linkStatus } from './linkStatus';

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);
const regionScope: DiagramCpScope = { kind: 'segment', region: regionReferenceFor(left!) };

const FOLDED: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };
const CREASE_PATTERN: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 0 };

/** The source a capture of `scope` from `document` would record. */
function linked(scope: DiagramCpScope, document = cpDocument(), render: DiagramCpRender = FOLDED) {
  const choice = chooseStepCreases(document, scope, segmentation);
  if (choice.status !== 'found') throw new Error('the scope should be found');
  return { scope, render, fingerprint: creasesFingerprint(choice.creases, render) };
}

/** The left diagonal turned valley. */
const edited = () =>
  cpDocument(TWO_SQUARES.map((line, i): FixtureLine => (i === 7 ? [...line.slice(0, 4), 'Blue2'] as FixtureLine : line)));

describe('linkStatus', () => {
  it('reads a region current against the pattern it was captured from, and stale once its creases change', () => {
    const source = linked(regionScope);
    expect(linkStatus(source, cpDocument(), segmentation)).toBe('current');
    expect(linkStatus(source, edited(), segmentation)).toBe('stale');
  });

  // The aux line in the left square (line 10) is drawn in a crease-pattern
  // picture and folds nothing: moving it changed the picture Refresh would
  // take, while the step read current with Refresh disabled.
  it('reads a region shown as its crease pattern stale when an aux line it draws moves; a fold of it does not', () => {
    const scope = regionScope;
    const movedAux = cpDocument(
      TWO_SQUARES.map((line, i): FixtureLine => (i === 9 ? [0, 60, 50, 60, 'Cyan3'] : line))
    );
    expect(linkStatus(linked(scope, cpDocument(), CREASE_PATTERN), movedAux, segmentation)).toBe('stale');
    expect(linkStatus(linked(scope, cpDocument(), FOLDED), movedAux, segmentation)).toBe('current');
  });

  it('reads a region whose rim is gone missing, before it reads it stale', () => {
    const source = linked(regionScope);
    expect(linkStatus(source, edited(), twoSquaresSegmentation({ wall: false }))).toBe('missing');
  });

  it('cannot say with no pattern open, or a region before the segmentation is ready', () => {
    expect(linkStatus(linked(regionScope), null, segmentation)).toBe('unknown');
    expect(linkStatus(linked(regionScope), cpDocument(), null)).toBe('unknown');
  });
});
