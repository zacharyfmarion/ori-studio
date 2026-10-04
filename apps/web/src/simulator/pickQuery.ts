import {
  facesVisibleIn,
  facesWithCentreIn,
  frontmostFaceAt,
  scaleRect,
  type CameraUniforms,
  type PickTopology,
} from '@treemaker/origami-simulator';

/** Which faces a box reaches: every layer centred inside it, or only what shows. */
export type SimulatorPickDepth = 'all-layers' | 'visible';

/** A press or a box on the canvas, in CSS pixels from its top-left corner. */
export type SimulatorPickRegion =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'box'; left: number; top: number; right: number; bottom: number };

/**
 * A pick, in the one unit both renderers can be handed: the canvas's CSS pixels.
 * Each renderer scales it into the pixels it drew in — the worker's drawing
 * buffer, or the canvas-2D fallback's — so the question means the same thing
 * whichever of them answers it.
 */
export interface SimulatorPickQuery {
  region: SimulatorPickRegion;
  /** The canvas's CSS size when the gesture ended. */
  cssWidth: number;
  cssHeight: number;
  /** Which faces a box reaches. A point always takes the frontmost face. */
  depth: SimulatorPickDepth;
}

/**
 * Answer a pick against a drawn frame: the positions it drew and the camera it
 * drew them with. The faces are source-face ids (`sourceFaceGroups`).
 */
export function pickFacesInFrame(
  positions: Float32Array,
  topology: PickTopology,
  camera: CameraUniforms,
  perspective: boolean,
  query: SimulatorPickQuery
): number[] {
  const css = { width: query.cssWidth, height: query.cssHeight };
  const drawn = { width: camera.width, height: camera.height };
  const { region } = query;
  if (region.kind === 'point') {
    const at = scaleRect({ left: region.x, right: region.x, top: region.y, bottom: region.y }, css, drawn);
    const face = frontmostFaceAt(positions, topology, camera, { x: at.left, y: at.top }, { perspective });
    return face === null ? [] : [face];
  }
  const rect = scaleRect(region, css, drawn);
  if (query.depth === 'all-layers') {
    return facesWithCentreIn(positions, topology, camera, rect, { perspective });
  }
  // One sample per CSS pixel: what the screen itself resolves.
  const sampleStep = query.cssWidth > 0 ? camera.width / query.cssWidth : 1;
  return facesVisibleIn(positions, topology, camera, rect, { perspective, sampleStep });
}
