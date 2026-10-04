import { describe, expect, it } from 'vitest';
import { cameraUniforms, type PickTopology } from '@treemaker/origami-simulator';
import { pickFacesInFrame, type SimulatorPickQuery } from './pickQuery';

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
