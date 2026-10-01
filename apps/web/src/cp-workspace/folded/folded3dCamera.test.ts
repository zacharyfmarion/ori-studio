/**
 * The camera vocabulary a 3D figure's document state is written in.
 *
 * These assertions were made against the CPU projector's exports until it
 * retired (§11 of `implementation-plans/unified-paper-style-and-export.md`);
 * they are about the camera and the frame, not about any drawing, so they
 * moved here with the symbols. The payloads are the kernel's own
 * `Folded3dRenderModel` fixtures, as everywhere else in this directory.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  OristudioCpFold3dTolerances,
  OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';
import {
  DEFAULT_FOLDED_3D_CAMERA,
  antipodalCamera,
  defaultFolded3dCamera,
  folded3dCoplanarEpsilon,
  folded3dEyeDirection,
  folded3dFrameRadius,
  foldedFigureOtherSideCamera,
} from './folded3dCamera';
import { modelCentroid } from './folded3dModelReader';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function fixture(name: string): OristudioCpFolded3dRenderModel {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.rendermodel.json`), 'utf8'));
}

/** The kernel's shipped `Fold3dTolerances::DEFAULT`. */
const TOLERANCES: OristudioCpFold3dTolerances = {
  angle_radians: 1e-7,
  distance_relative: 1e-6,
  flat_snap_degrees: 1e-6,
  overlap_area_relative: 1e-9,
};

describe('the camera a figure is shown at', () => {
  it('is a pure function of the payload and the side', () => {
    const model = fixture('spikes_small');
    expect(defaultFolded3dCamera(model)).toEqual(defaultFolded3dCamera(model));
    expect(defaultFolded3dCamera(model)).toEqual(DEFAULT_FOLDED_3D_CAMERA);
    const back = defaultFolded3dCamera(model, 'Back1');
    // `π − pitch`, not `−pitch`. Negating the pitch alone leaves the eye exactly
    // where it was once the yaw has turned too, so the "back" view would be the
    // front view and nothing would look wrong enough to notice.
    expect(back.pitch).toBeCloseTo(Math.PI - DEFAULT_FOLDED_3D_CAMERA.pitch, 12);
    expect(back.yaw).toBeCloseTo(DEFAULT_FOLDED_3D_CAMERA.yaw + Math.PI, 12);
    expect(back).toEqual(antipodalCamera(DEFAULT_FOLDED_3D_CAMERA));
    // `Both2` is the flat figure's side-by-side pair and has no 3D reading.
    expect(defaultFolded3dCamera(model, 'Both2')).toEqual(defaultFolded3dCamera(model, 'Front0'));
  });

  it('turns to the other side and back again', () => {
    // The verb a 3D figure offers where a flat one offers Flip. It has to be an
    // involution — press twice, same view — or the button walks the figure round
    // in circles instead of toggling it.
    const there = foldedFigureOtherSideCamera(DEFAULT_FOLDED_3D_CAMERA);
    expect(there).toEqual(antipodalCamera(DEFAULT_FOLDED_3D_CAMERA));
    const back = foldedFigureOtherSideCamera(there);
    expect(Math.cos(back.yaw)).toBeCloseTo(Math.cos(DEFAULT_FOLDED_3D_CAMERA.yaw), 12);
    expect(Math.sin(back.yaw)).toBeCloseTo(Math.sin(DEFAULT_FOLDED_3D_CAMERA.yaw), 12);
    for (const [axis, component] of folded3dEyeDirection(back).entries()) {
      expect(component).toBeCloseTo(folded3dEyeDirection(DEFAULT_FOLDED_3D_CAMERA)[axis]!, 12);
    }
    // A figure with no recorded camera is shown at the default, so turning it
    // over is the antipode of that rather than a refusal.
    expect(foldedFigureOtherSideCamera(null)).toEqual(there);
  });

  it('points the eye the other way for the antipode, and nowhere else', () => {
    // The unit-length third row of the view rotation. Negated by the antipode
    // and by nothing else — a `−pitch` that left it alone is the bug above.
    const camera = { yaw: 0.4, pitch: -0.9, zoom: 1 };
    const eye = folded3dEyeDirection(camera);
    expect(Math.hypot(...eye)).toBeCloseTo(1, 12);
    for (const [axis, component] of folded3dEyeDirection(antipodalCamera(camera)).entries()) {
      expect(component).toBeCloseTo(-eye[axis]!, 12);
    }
  });
});

describe('the frame a 3D figure is drawn inside', () => {
  it('is the model’s bounding sphere, so it takes no camera at all', () => {
    // A frame that moved with the eye is the resizing chrome the sphere exists
    // to stop: turning the model must not resize or shift the box its handles
    // and its click polygon are drawn from.
    for (const name of ['hinge_90', 'box_90', 'spikes_small']) {
      const model = fixture(name);
      const radius = folded3dFrameRadius(model);
      const centre = modelCentroid(model);
      expect(radius).toBeGreaterThan(0);
      // Every point of the model is inside it, and at least one is on it.
      let furthest = 0;
      const count = Math.floor(model.cell_points.length / 3);
      for (let i = 0; i < count; i += 1) {
        furthest = Math.max(
          furthest,
          Math.hypot(
            (model.cell_points[i * 3] ?? 0) - centre[0],
            (model.cell_points[i * 3 + 1] ?? 0) - centre[1],
            (model.cell_points[i * 3 + 2] ?? 0) - centre[2]
          )
        );
      }
      expect(furthest, name).toBeCloseTo(radius, 9);
    }
  });
});

describe('the coplanarity tolerance a drawing treats as “in the same plane”', () => {
  it('is a distance, not an angle', () => {
    const model = fixture('box_90');
    const epsilon = folded3dCoplanarEpsilon(model, TOLERANCES);
    // Well above `bsp.ts`'s own 1e-7, and still a millionth of the span.
    expect(epsilon).toBeGreaterThan(1e-6);
    expect(epsilon).toBeLessThan(model.span * 1e-5);
    // It scales with the offset tolerance, which an angle would not.
    expect(
      folded3dCoplanarEpsilon(model, { ...TOLERANCES, distance_relative: 1e-5 })
    ).toBeGreaterThan(epsilon * 5);
  });
});
