import { describe, expect, it } from 'vitest';
import { CP_MODEL_TO_CSS } from '../../cp-workspace/snapRadius';
import { CP_COARSE_POINTER_SNAP_RADIUS, CP_DEFAULT_SNAP_RADIUS } from '../../lib/cpSnapRadiusSetting';
import {
  placePoint,
  snapOutcome,
  snapRadiusCss,
  snapRadiusUnits,
  snapsEnd,
  snapsWhenPlaced,
  type SnapContext,
} from './annotateSnap';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import { ANNOTATION_KINDS } from './annotationModel';
import { annotation, uploadStep } from './pictureSnap.fixtures';

describe('the snap radius (decision 10)', () => {
  it('is Edit’s setting as Edit reaches at 100%, in CSS px: 14.7 for a mouse, 22 for a finger', () => {
    expect(snapRadiusCss(CP_DEFAULT_SNAP_RADIUS)).toBeCloseTo(14.7, 1);
    expect(snapRadiusCss(CP_COARSE_POINTER_SNAP_RADIUS)).toBeCloseTo(22.05, 2);
    expect(snapRadiusCss(1)).toBe(CP_MODEL_TO_CSS);
  });

  it('reaches as far on screen at any zoom: half as many picture units at twice the zoom', () => {
    // A 1000 px frame at 100% and at 200%.
    expect(snapRadiusUnits(10, 1000)).toBeCloseTo(0.0147, 4);
    expect(snapRadiusUnits(10, 2000)).toBeCloseTo(snapRadiusUnits(10, 1000) / 2, 12);
    // Not laid out: nothing to reach.
    expect(snapRadiusUnits(10, 0)).toBe(0);
    expect(snapRadiusUnits(10, Number.NaN)).toBe(0);
  });
});

describe('what snaps (decision 9)', () => {
  it('is a circle, a right angle’s corner, a line’s ends, a callout’s point, an angle mark’s points and the ends equal divisions measure, never an arrow, a sign or a label', () => {
    const snapping = ANNOTATION_KINDS.filter(snapsWhenPlaced);
    expect([...snapping].sort()).toEqual(
      ['angle-mark', 'callout', 'circle', 'divisions', 'right-angle', 'hidden-line', 'mountain-line', 'solid-line', 'valley-line'].sort()
    );
    // An arrow is drawn where it is drawn (Zach, 2026-10-05).
    for (const arrow of ['valley-arrow', 'mountain-arrow', 'fold-unfold-arrow', 'push-arrow', 'white-arrow'] as const) {
      expect(snapsWhenPlaced(arrow), arrow).toBe(false);
    }
  });

  it('snaps a callout’s point, never its box, and either end of anything else that snaps', () => {
    expect(snapsEnd('callout', 'from')).toBe(true);
    expect(snapsEnd('callout', 'to')).toBe(false);
    for (const kind of ANNOTATION_KINDS.filter((each) => each !== 'callout')) {
      expect(snapsEnd(kind, 'from'), kind).toBe(snapsWhenPlaced(kind));
      expect(snapsEnd(kind, 'to'), kind).toBe(snapsWhenPlaced(kind));
    }
  });
});

describe('placePoint', () => {
  const line = annotation({ kind: 'valley-line', from: [0.2, 0.2], to: [0.6, 0.2] });
  const upload = uploadStep();
  const context = (overrides: Partial<SnapContext> = {}): SnapContext => ({
    step: upload.step,
    assets: upload.assets,
    annotations: [line],
    enabled: true,
    radius: 0.02,
    style: DEFAULT_DIAGRAM_STYLE,
    ...overrides,
  });

  it('lands on the nearest target within the radius, and where it was put past it', () => {
    expect(placePoint(context(), [0.61, 0.21], { free: false })).toEqual({
      at: [0.6, 0.2],
      target: { at: [0.6, 0.2], kind: 'annotation' },
    });
    expect(placePoint(context(), [0.63, 0.21], { free: false })).toEqual({ at: [0.63, 0.21], target: null });
  });

  it('lands a line’s end on a point dividing equal divisions, as the sketch’s valley starts from the first quarter (Revision 2)', () => {
    const divisions = annotation({ kind: 'divisions', from: [0.2, 0.5], to: [0.6, 0.5], parts: 4, offset: 2.5 });
    expect(placePoint(context({ annotations: [divisions] }), [0.305, 0.51], { free: false })).toEqual({
      at: [0.3, 0.5],
      target: { at: [0.3, 0.5], kind: 'annotation' },
    });
  });

  it('lands where it was put with ⌘ held, with the switch off, or on the annotation in hand', () => {
    expect(placePoint(context(), [0.61, 0.21], { free: true }).target).toBeNull();
    expect(placePoint(context({ enabled: false }), [0.61, 0.21], { free: false }).target).toBeNull();
    expect(placePoint(context(), [0.61, 0.21], { free: false, ignore: line.id }).target).toBeNull();
  });
});

describe('snapOutcome', () => {
  it('says a mark snapped before it says how it did not, and a sign never snaps', () => {
    expect(snapOutcome('circle', { enabled: true, free: false, snapped: true })).toBe('snapped');
    expect(snapOutcome('valley-line', { enabled: true, free: true, snapped: true })).toBe('snapped');
    expect(snapOutcome('valley-line', { enabled: true, free: true, snapped: false })).toBe('free');
    expect(snapOutcome('valley-line', { enabled: false, free: true, snapped: false })).toBe('off');
    expect(snapOutcome('hidden-line', { enabled: true, free: false, snapped: false })).toBe('nothing_near');
    expect(snapOutcome('label', { enabled: true, free: false, snapped: false })).toBe('none');
    expect(snapOutcome('push-arrow', { enabled: true, free: false, snapped: false })).toBe('none');
  });
});
