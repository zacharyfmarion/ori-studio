import type { SimulatorPickQuery } from '../pickQuery';
import type {
  CssSize,
  SimulatorGesture,
  SimulatorPickFacesIntent,
  SimulatorPullIntent,
  SimulatorToolOptions,
} from './types';

/**
 * What a finished Pin gesture asks for.
 *
 * | Gesture | Pins become |
 * | --- | --- |
 * | box | the faces it reaches (an empty box empties the set, as Box Select does) |
 * | Shift+box | the set plus the faces it reaches |
 * | click | the face in front under the press (a miss empties the set) |
 * | Shift+click | the set with that face toggled |
 * | finger box | the set plus the faces it reaches |
 * | finger tap | the set with that face toggled |
 *
 * A finger never replaces: there is no Shift on a phone, and a tap that missed
 * the paper by a millimetre must not throw away every pin.
 */
export function pinIntentFor(
  gesture: Exclude<SimulatorGesture, { kind: 'pull' }>,
  options: SimulatorToolOptions,
  surface: CssSize
): SimulatorPickFacesIntent {
  const keeps = gesture.shift || gesture.touch;
  if (gesture.kind === 'box') {
    const { left, top, right, bottom } = gesture.rect;
    return {
      kind: 'pick-faces',
      gesture: 'box',
      region: { kind: 'box', left, top, right, bottom },
      reach: options.pinThroughLayers ? 'all-layers' : 'visible',
      mode: keeps ? 'add' : 'replace',
      surface,
    };
  }
  return {
    kind: 'pick-faces',
    gesture: gesture.touch ? 'tap' : 'click',
    region: { kind: 'point', x: gesture.point.x, y: gesture.point.y },
    reach: 'front',
    mode: keeps ? 'toggle' : 'replace',
    surface,
  };
}

/** A step of a pull, measured against the canvas's CSS size when it was made. */
export function pullIntentFor(
  gesture: Extract<SimulatorGesture, { kind: 'pull' }>,
  surface: CssSize
): SimulatorPullIntent {
  return {
    kind: 'pull',
    phase: gesture.phase,
    at: { x: gesture.point.x, y: gesture.point.y, cssWidth: surface.width, cssHeight: surface.height },
    touch: gesture.touch,
  };
}

/** The question a pick intent puts to the renderer that drew the frame. */
export function pickQueryFor(intent: SimulatorPickFacesIntent): SimulatorPickQuery {
  return {
    region: intent.region,
    cssWidth: intent.surface.width,
    cssHeight: intent.surface.height,
    // A point always takes the face in front, whatever this says.
    depth: intent.reach === 'all-layers' ? 'all-layers' : 'visible',
  };
}
