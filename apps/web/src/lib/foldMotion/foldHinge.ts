/**
 * Paper turning about a line, and the rules it is drawn by: the rigid hinge,
 * which face the reader sees, how a tilted face is shaded, and how a crease is
 * named from the other face.
 *
 * Shared by every surface that animates a fold. References' precrease flap
 * curls over a bend whose radius-zero case is exactly this hinge
 * (`cp-workspace/references/fold/foldSurface.ts`).
 *
 * In the hinge's frame — `s` along the line, `u` across it into the moving
 * paper, `z` toward the reader — a point swung by `θ` goes to
 * `(s, u·cos θ, u·sin θ)`, so drawn from straight above it sits at
 * `v = u·cos θ`: on its own place at 0, mirrored across the line at π.
 */
import type { PaperLineRole } from '../paper/paperScene';
import { flipDirection } from '../stepDiagram/diagramModel';
import type { Rgba } from '../../cp-workspace/renderer/types';

/** A point of the paper once posed: its hinge-frame coordinates, its height, and which face is up. */
export interface PlacedPoint {
  s: number;
  v: number;
  z: number;
  /** The surface normal's component toward the reader: how far the paper tilts, for its shading. */
  nz: number;
  /** Which face the reader sees here: 1 the face the reader is on, -1 the other. */
  face: 1 | -1;
}

/** How a flap's paper is placed at a pose: the map from its flat `(s, u)` to space. */
export interface FoldPlacement {
  place(s: number, u: number): PlacedPoint;
}

/**
 * The face paper shows by the side its normal faces: the reader's until it
 * passes edge-on, and at edge-on itself, where it has no width to show either.
 */
export function shownFace(nz: number): 1 | -1 {
  return nz >= 0 ? 1 : -1;
}

/** A hinge with no bend: the paper turns rigidly about the line. */
export function rigidHinge(angle: number): FoldPlacement {
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  return { place: (s, u) => ({ s, v: u * c, z: u * sn, nz: c, face: shownFace(c) }) };
}

/**
 * How a tilted face is shaded on screen: its own colour darkened toward black,
 * by up to a quarter where the paper is edge-on — less light reaches paper
 * turned away from the reader, so a bend reads as rounded in whatever colour
 * the paper is: a grey curl in white paper, a darker yellow in yellow.
 *
 * Black rather than a theme ink. The flap was once the theme's dark ground,
 * shaded toward its light text; the paper is the style's now, and the dark
 * theme's near-white text over light paper shaded nothing at all.
 */
export const PAPER_TILT_SHADE: Rgba = [0, 0, 0, 0.25];

/**
 * How far toward the shade paper tilted to `nz` goes: nothing flat, `strength`
 * edge-on. Exactly 0 at rest, so a face that is not turning is its own colour.
 */
export function tiltShade(nz: number, strength: number = PAPER_TILT_SHADE[3]): number {
  return strength * (1 - Math.min(1, Math.abs(nz)));
}

/**
 * The same, as the light factor a `PaperScene` face carries in `shade`: the
 * painters multiply the paper's colour by it (`paperFaceFill`), which is
 * {@link PAPER_TILT_SHADE}'s darkening toward black exactly.
 */
export function tiltLighting(nz: number): number {
  return 1 - tiltShade(nz);
}

/**
 * A line's role as the other face names it. A mountain seen from the back is
 * a valley, and a step's own instruction swaps within its own pair; an edge,
 * an aux crease or a hidden line names no direction and stays as it is.
 */
export function seenFromOtherFace(role: PaperLineRole): PaperLineRole {
  switch (role) {
    case 'diagram-mountain':
      return 'diagram-valley';
    case 'diagram-valley':
      return 'diagram-mountain';
    default:
      return flipDirection(role);
  }
}
