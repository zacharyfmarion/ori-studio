import { describe, expect, it } from 'vitest';
import { CP_MODEL_TO_CSS } from '../../cp-workspace/snapRadius';
import { CP_COARSE_POINTER_SNAP_RADIUS, CP_DEFAULT_SNAP_RADIUS } from '../../lib/cpSnapRadiusSetting';
import { placePoint, snapOutcome, snapRadiusCss, snapRadiusUnits, snapsWhenPlaced, type SnapContext } from './annotateSnap';
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
  it('is a circle, a right angle’s corner and an arrow’s or a line’s ends, never a sign or a label', () => {
    const snapping = ANNOTATION_KINDS.filter(snapsWhenPlaced);
    expect([...snapping].sort()).toEqual(
      [
        'circle',
        'right-angle',
        'fold-unfold-arrow',
        'hidden-line',
        'mountain-arrow',
        'mountain-line',
        'push-arrow',
        'valley-arrow',
        'valley-line',
        'white-arrow',
      ].sort()
    );
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
    expect(snapOutcome('push-arrow', { enabled: true, free: false, snapped: false })).toBe('nothing_near');
    expect(snapOutcome('label', { enabled: true, free: false, snapped: false })).toBe('none');
  });
});
