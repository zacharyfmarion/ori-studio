/**
 * A step's picture frame (D8): the box its annotations are measured in.
 *
 * - An upload, or a capture kept as a bitmap: the asset as it is posed.
 * - A captured scene: the scene's bounds, which are the posed picture's.
 * - A fixed picture: the whole of it.
 * - A References step: its sheet, not its drawing, whose bounds move as its
 *   letters are laid out round it.
 *
 * Pure: no DOM, no store.
 */
import type { PaperScene } from '@treemaker/origami-simulator';
import { readPaperScene } from '../../lib/paper/paperSceneValidate';
import type { DiagramAsset, DiagramScenePicture, DiagramStep } from '../document/diagramDocument';
import { frameOf, type PictureFrame } from '../annotate/annotationModel';
import { mmToCssPx, pagePtPerPx, PT_PER_CSS_PX } from '../../lib/paper/paperSvg';
import {
  poseTransform,
  sceneMeasure,
  STEP_CARD_PADDING_MM,
  stepPictureSource,
  stepScenePage,
  type StepPictureSource,
} from './paintDiagramStep';

const scenes = new WeakMap<DiagramScenePicture, PaperScene | null>();

/** A stored scene, read once per picture object; null for one that does not read. */
export function storedScene(picture: DiagramScenePicture): PaperScene | null {
  if (scenes.has(picture)) return scenes.get(picture)!;
  let scene: PaperScene | null;
  try {
    scene = readPaperScene(JSON.parse(picture.sceneJson));
  } catch {
    scene = null;
  }
  scenes.set(picture, scene);
  return scene;
}

/**
 * Whether a step can be annotated: made by this build, with a picture this
 * build draws — what Annotate draws on. The detail shows Pose for any other.
 */
export function stepCanBeAnnotated(step: DiagramStep, assets: Readonly<Record<string, DiagramAsset>>): boolean {
  return stepPictureSource(step, assets) !== null;
}

/** The step's picture frame, its longer side one unit; null for a step with no picture to draw. */
export function stepPictureFrame(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>
): PictureFrame | null {
  const source = stepPictureSource(step, assets);
  if (!source) return null;
  switch (source.kind) {
    case 'asset': {
      const posed = poseTransform(source.asset.widthPx, source.asset.heightPx, source.pose);
      return frameOf(posed.widthPx, posed.heightPx);
    }
    case 'scene': {
      const bounds = storedScene(source.picture)?.bounds;
      return bounds ? frameOf(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) : null;
    }
    case 'fixed':
      return frameOf(source.picture.widthPx, source.picture.heightPx);
    case 'step-diagram':
      return frameOf(source.picture.model.sheet.width, source.picture.model.sheet.height);
  }
}

/**
 * The longer side of a source's frame as `paintSource` paints it at a scale
 * of one, in CSS px, worked out without painting it — a scene read once per
 * picture ({@link storedScene}): every source's frame grows in step with the
 * scale it is painted at, so this times a scale is its frame there. Null for
 * a scene that does not read.
 */
export function paintedFrameLongerPx(source: StepPictureSource): number | null {
  switch (source.kind) {
    case 'asset': {
      const posed = poseTransform(source.asset.widthPx, source.asset.heightPx, source.pose);
      return Math.max(posed.widthPx, posed.heightPx);
    }
    case 'fixed':
      return Math.max(source.picture.widthPx, source.picture.heightPx);
    case 'scene': {
      const scene = storedScene(source.picture);
      if (!scene) return null;
      const { minX, minY, maxX, maxY } = scene.bounds;
      const ptPerPx = pagePtPerPx(scene, stepScenePage(STEP_CARD_PADDING_MM), sceneMeasure(source.pattern));
      return (Math.max(maxX - minX, maxY - minY) * ptPerPx) / PT_PER_CSS_PX;
    }
    case 'step-diagram':
      // Built at its sheet's size and painted at the screen's ratio: its sheet is the page's.
      return mmToCssPx(stepScenePage(STEP_CARD_PADDING_MM).sheet.mm);
  }
}
