import type { DiagramCpRender, DiagramLayerSpread, DiagramScenePicture, DiagramStep } from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { CAPTURE_PX_PER_UNIT } from '../capture/captureGeometry';
import type { PicturePoint } from '../annotate/annotationModel';
import imprints from './__fixtures__/zoomImprint.json';

/**
 * Zach's crane as 16.0's spike captured it (`__fixtures__/zoomImprint.json`,
 * written by `artifacts/revision-2/16c/buildImprintFixtures.mjs` from the
 * spike's own captures), each capture as a flat step stores it: its scene,
 * and its faces in the form 16c keeps (`DiagramPaperFaces`).
 *
 * - `S`: step 22, the crane's last, in its linked pose (front, 157.5°, case 13).
 * - `C`: step 22 refolded with a reverse fold of the neck's tip, folded from
 *   face 18 rather than face 1, shown in S's pose: its fold holds another
 *   face still.
 * - `R21`: step 21, whose own fold holds another face still than step 22's.
 *
 * Each with no spread (`.none`), the default affine spread (`.affine`) and
 * the default depth spread (`.depth`). The cases are 16.0's two whose folds
 * hold different faces still: R (21 → 22) and C (22 → C), each with the frame
 * drawn on S (scene px, as drawn) and the truth — where N's own painter draws
 * the paper under the frame's centre.
 */

interface FixtureCapture {
  sceneJson: string;
  paperFaces: string;
  spread: DiagramLayerSpread | null;
}

export interface ImprintCase {
  label: string;
  /** The capture the frame is drawn on, and the one it lands on. */
  s: string;
  n: string;
  spread: 'none' | 'affine' | 'depth';
  frame: { centre: PicturePoint; radius: number };
  truth: PicturePoint;
}

const captures = imprints.captures as unknown as Record<string, FixtureCapture>;

export const IMPRINT_CASES = imprints.cases as unknown as ImprintCase[];

/** A capture of the crane as a flat step stores it, its faces kept or not. */
export function craneStep(key: string, { faces = true }: { faces?: boolean } = {}): DiagramStep {
  const capture = captures[key];
  if (!capture) throw new Error(`no capture ${key}`);
  const render: DiagramCpRender = {
    mode: 'folded-flat',
    side: 'front',
    rotationDeg: 157.5,
    foldCase: 1,
    ...(capture.spread ? { spread: capture.spread } : {}),
  };
  const picture: DiagramScenePicture = {
    kind: 'scene',
    sceneJson: capture.sceneJson,
    paperScale: CAPTURE_PX_PER_UNIT,
    styleKey: null,
    key: `scene-${key}`,
    ...(faces ? { paperFaces: capture.paperFaces } : {}),
  };
  return cpStep(`step-${key}`, render, picture);
}

export function imprintCase(label: string): ImprintCase {
  const found = IMPRINT_CASES.find((each) => each.label === label);
  if (!found) throw new Error(`no case ${label}`);
  return found;
}
