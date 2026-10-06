import { describe, expect, it } from 'vitest';
import { cameraUniforms, type PickTopology } from '@treemaker/origami-simulator';
import {
  pickFacesInFrame,
  pullHitInFrame,
  pullRayInFrame,
  pullStartFor,
  type SimulatorPickQuery,
} from './pickQuery';

/**
 * Two stacked squares seen straight on (yaw = pitch = 0 looks down world y):
 * the front one (7) over the middle, the back one (9) wider and showing as a
 * strip on the right.
 */
function square(x0: number, x1: number, y: number): number[] {
  return [x0, y, -0.5, x1, y, -0.5, x1, y, 0.5, x0, y, 0.5];
}
const positions = new Float32Array([...square(-0.5, 0.5, 0.2), ...square(-0.5, 0.9, -0.2)]);
const topology: PickTopology = {
  indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
  faceGroups: new Int32Array([7, 7, 9, 9]),
};

// The drawing buffer is twice the CSS size, as at a devicePixelRatio of 2.
const camera = cameraUniforms({ yaw: 0, pitch: 0, zoom: 1 }, [0, 0, 0], 1, 800, 800);
const CSS = { cssWidth: 400, cssHeight: 400 };

function query(region: SimulatorPickQuery['region'], depth: SimulatorPickQuery['depth'] = 'all-layers'): SimulatorPickQuery {
  return { region, depth, ...CSS };
}

describe('pickFacesInFrame', () => {
  it('scales a CSS point into the drawn frame before picking', () => {
    // The centre of the canvas is the front face, in CSS pixels as in device ones.
    expect(pickFacesInFrame(positions, topology, camera, true, query({ kind: 'point', x: 200, y: 200 }))).toEqual([7]);
  });

  it('reaches every layer centred in a box, through all layers', () => {
    const box = query({ kind: 'box', left: 150, top: 150, right: 250, bottom: 250 });
    expect(pickFacesInFrame(positions, topology, camera, true, box).sort()).toEqual([7, 9]);
  });

  it('reaches only what shows in a box, with layers off', () => {
    const box = query({ kind: 'box', left: 150, top: 150, right: 250, bottom: 250 }, 'visible');
    expect(pickFacesInFrame(positions, topology, camera, true, box)).toEqual([7]);
  });

  it('takes the frontmost face for a point, whatever the depth asks', () => {
    const point = query({ kind: 'point', x: 200, y: 200 }, 'all-layers');
    expect(pickFacesInFrame(positions, topology, camera, true, point)).toEqual([7]);
  });

  it('answers nothing for a press off the model', () => {
    expect(pickFacesInFrame(positions, topology, camera, true, query({ kind: 'point', x: 5, y: 5 }))).toEqual([]);
  });
});

describe('pulling in a drawn frame', () => {
  const at = (x: number, y: number) => ({ x, y, ...CSS });

  it('grips the front face under a CSS point, scaled into the frame', () => {
    const hit = pullHitInFrame(positions, topology, camera, true, at(200, 200));
    expect(hit?.face).toBe(7);
    expect(pullHitInFrame(positions, topology, camera, true, at(5, 5))).toBeNull();
  });

  it('casts the cursor’s line of sight through the same scaled point', () => {
    // Straight on at the centre, the line of sight is world -y through the centre.
    const ray = pullRayInFrame(camera, true, at(200, 200));
    expect(ray.direction[1]).toBeCloseTo(-1, 9);
    expect(ray.origin[0]).toBeCloseTo(0, 9);
    expect(ray.origin[2]).toBeCloseTo(0, 9);
  });

  it('pulls only with something pinned, and never a pinned face', () => {
    const hit = pullHitInFrame(positions, topology, camera, true, at(200, 200));
    const none = null;
    const pinnedFront = new Uint8Array(8);
    pinnedFront.set([1, 1, 1, 1], 0);
    const pinnedBack = new Uint8Array(8);
    pinnedBack.set([1, 1, 1, 1], 4);

    expect(pullStartFor(hit, none)).toBe('no-pins');
    expect(pullStartFor(null, pinnedBack)).toBe('missed');
    expect(pullStartFor(hit, pinnedFront)).toBe('pinned-face');
    expect(pullStartFor(hit, pinnedBack)).toBe('pulling');
  });
});
