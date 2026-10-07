import type {
  DiagramCpRender,
  DiagramLayerSpread,
  DiagramPaperFaces,
  DiagramScenePicture,
  DiagramStep,
} from '../document/diagramDocument';
import { storedSceneJson } from '../document/diagramFile';
import { cpStep } from '../document/diagramSteps.fixtures';
import { CAPTURE_PX_PER_UNIT, sceneBoundsOf } from '../capture/captureGeometry';
import { storedScene } from '../pictures/pictureFrame';
import { turnClockwise } from '../../lib/geometry';
import type { PaperItem, PaperScene, ScenePoint } from '../../lib/paper/paperScene';
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

/** A capture turned by `degrees` about the scene's origin, as a pose turns it: its scene and its unspread places. */
export function turnedCapture(step: DiagramStep, degrees: number): DiagramStep {
  if (step.picture?.kind !== 'scene' || step.source?.kind !== 'cp') throw new Error('a linked scene');
  const turn = turnClockwise(degrees);
  const at = ([x, y]: ScenePoint): ScenePoint => {
    const p = turn({ x, y });
    return [p.x, p.y];
  };
  const scene = storedScene(step.picture)!;
  const items = scene.items.map((item): PaperItem => {
    if (item.kind === 'face') return { ...item, rings: item.rings.map((ring) => ring.map(at)) };
    if (item.kind === 'line') {
      return { ...item, a: at(item.a), b: at(item.b), ...(item.whole ? { whole: { ...item.whole, a: at(item.whole.a), b: at(item.whole.b) } } : {}) };
    }
    return item;
  });
  const turned: PaperScene = { ...scene, items, bounds: sceneBoundsOf(items) };
  const faces = step.picture.paperFaces ? (JSON.parse(step.picture.paperFaces) as DiagramPaperFaces) : null;
  const paperFaces = faces && JSON.stringify({ ...faces, points: faces.points.map(([px, py, u, v]) => [px, py, ...at([u, v])]) });
  const render = step.source.render.mode === 'folded-flat' ? { ...step.source.render, rotationDeg: (step.source.render.rotationDeg + degrees) % 360 } : step.source.render;
  return {
    ...step,
    source: { ...step.source, render },
    picture: { ...step.picture, sceneJson: storedSceneJson(turned)!, key: `${step.picture.key}-turned`, ...(paperFaces ? { paperFaces } : {}) },
  };
}
