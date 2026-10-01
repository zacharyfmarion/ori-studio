/**
 * One 3D figure, one picture: the single place a figure's {@link PaperScene} is
 * built, whoever is asking.
 *
 * Three callers used to be three builders. The export painted the window's mesh
 * through `folded3dPaperScene`; the store and the live orbit painted a *second*
 * geometry through the CPU projector; and the `.osf` kept whatever the second
 * one produced. That is the shape F9 recorded and D5 retired — so this module
 * takes the figure, the render model beside its handle, and a style, and
 * answers the scene. The export, the store writes and the re-projection all
 * call it, and a figure therefore has one drawing.
 *
 * # Two spaces, and why the stored one is not the page's
 *
 * A scene's coordinates are the px of the camera it was built at. The export
 * wants the figure's on-screen size, so it builds at the canvas's px (D3: the
 * default sheet is what the figure measures on screen). The **stored** scene
 * cannot: it is drawn again on every frame of a pan, a zoom and a resize, and
 * `cpFoldedToScene` already carries it through the figure's
 * {@link FoldedFigurePlacement} — so a picture built at the placed size would
 * be scaled by the placement a second time, and a figure resized after its
 * scene was made would draw at the square of its scale.
 *
 * So `'document'` builds at the figure's **local user space**: the frame's side
 * in user units before any placement, shifted so the model's centroid lands on
 * {@link FOLDED_3D_LOCAL_CENTER}, which is exactly where the placement affine
 * expects to find it. A stored scene is then local geometry like a flat
 * figure's `renderSnapshot` after `cpModelToSvg`, and drawing it is a
 * placement and nothing else.
 */

import type { PaperScene, ScenePoint } from '@treemaker/origami-simulator';
import type {
  FoldedFigurePlacement,
  OristudioCpFolded3dAuxLines,
  OristudioCpFolded3dRenderModel,
  OristudioCpFolded3dSnapshot,
  OristudioCpFoldedFigureDisplayStyle,
} from '../../engine/oristudioCpTypes';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import {
  FOLDED_3D_LOCAL_CENTER,
  folded3dLocalFrameSide,
  type FoldedFigureDrawing,
} from '../adapters/cpFoldedToScene';
import { folded3dMesh, type Folded3dMeshResult } from './folded3dMesh';
import { folded3dFigureBoxCssPx, folded3dPaperScene, folded3dSceneCamera } from './folded3dScene';
import { folded3dFrameRadius, type FoldedFigureCamera } from './folded3dCamera';

/**
 * What a scene needs off the figure. Every field is on the entry, and the four
 * a *page* scene needs beyond the document one — the figure's box, which is
 * its placed frame — are optional so a figure still being folded can ask for
 * its stored picture before it is an entry.
 */
export interface Folded3dSceneFigure extends Partial<FoldedFigureDrawing> {
  camera?: FoldedFigureCamera | null;
  displayStyle: OristudioCpFoldedFigureDisplayStyle;
  folded3d?: OristudioCpFolded3dSnapshot | null;
}

export interface Folded3dFigureSceneOptions {
  /** The figure's effective style — the app slot with the figure's pins on top. */
  style: PaperStyle;
  /**
   * Where the picture lands.
   *
   * `'document'` is the figure's local user space, for the stored scene and
   * the canvas. A number is CSS px per user unit at the canvas the figure is
   * on, for a page sized as the figure is on screen.
   */
  space: 'document' | number;
  /**
   * The document's aux lines on the figure (`folded3dAuxLines.ts`), drawn on
   * the layers that show them; none when absent.
   */
  aux?: OristudioCpFolded3dAuxLines | null;
  /**
   * Mark the pieces nothing shows. On for a stored scene, so the canvas can
   * leave buried paper out of every frame while an export that keeps hidden
   * faces still has it; off for a page that keeps them anyway, which is the
   * expensive half of building a scene wasted.
   */
  markHidden?: boolean;
}

/**
 * The scene a figure's window shows, or `null` when there is none to build —
 * no 3D fold, a model past the mesh's vertex budget, or a figure with no frame
 * to size the picture from. `null` is an answer, not a failure: the caller
 * keeps the picture it has.
 *
 * `model` is the render model beside the figure's handle
 * (`folded3dRenderModel`); a figure reopened from a file has none and never
 * reaches here.
 */
export function folded3dFigureScene(
  figure: Folded3dSceneFigure,
  model: OristudioCpFolded3dRenderModel,
  { style, space, markHidden = true, aux = null }: Folded3dFigureSceneOptions
): PaperScene | null {
  const folded3d = figure.folded3d;
  if (!folded3d) return null;
  const built = meshOf(model, aux);
  if (built.kind !== 'mesh') return null;
  const box = sceneBox(figure, model, space);
  if (box === null) return null;

  const camera = folded3dSceneCamera(figure.camera, built.mesh, box.side);
  const scene = folded3dPaperScene(built.mesh, model, camera, {
    style,
    markHidden,
    tolerances: folded3d.diagnostics.tolerances,
    displayStyle: figure.displayStyle,
  });
  if (scene.items.length === 0) return null;
  return box.shift ? shiftScene(scene, box.shift) : scene;
}

/**
 * The square the picture is drawn in, and where it has to end up.
 *
 * `cameraUniforms` centres a model in its box, so a scene comes out spanning
 * `[0, side]` on both axes. The page crops to the scene's own bounds and does
 * not care where that square sits; local user space does, so the document
 * space asks for the shift that puts the box's centre on the pivot the
 * placement turns and scales about.
 */
function sceneBox(
  figure: Folded3dSceneFigure,
  model: OristudioCpFolded3dRenderModel,
  space: 'document' | number
): { side: number; shift: ScenePoint | null } | null {
  if (space !== 'document') {
    const { placement } = figure;
    if (!placement) return null;
    const side = folded3dFigureBoxCssPx(
      { ...figure, placement, renderSnapshot: figure.renderSnapshot ?? null },
      space
    );
    return side === null ? null : { side, shift: null };
  }
  // The stored frame when there is one, so the picture fills the box the
  // canvas draws chrome around; the model's own otherwise, which is the number
  // a fold records as `frameRadius` in the first place.
  const frameRadius = figure.frameRadius ?? folded3dFrameRadius(model);
  if (!(frameRadius > 0)) return null;
  const side = folded3dLocalFrameSide(frameRadius);
  if (!(side > 0)) return null;
  return {
    side,
    shift: [FOLDED_3D_LOCAL_CENTER.x - side / 2, FOLDED_3D_LOCAL_CENTER.y - side / 2],
  };
}

/**
 * A stored scene in the space a *page* scene is built in: local user units
 * scaled to the CSS px the figure covers on the canvas.
 *
 * For a figure with no live kernel, which is the one that cannot rebuild. A
 * page scene is in the CSS px its live build measures its pens in
 * (`widestPenCssPx`), so the stored scene is brought into them and the two
 * builds of one figure are one scene. The factor is `placement.scale ×
 * cssPerUserUnit`, because a page scene's box is the local frame side through
 * both ({@link folded3dFigureBoxCssPx} over `foldedFigureBox`).
 *
 * How heavy its creases read on the page no longer turns on it: the painter
 * sizes a figure by its own longer side (`PaperSizeMeasure`), whatever units
 * the scene is in. It did while a page could be drawn at the scene's own
 * scale, when a document scene painted as a page one exported its creases
 * that factor too heavy against the paper.
 */
export function folded3dStoredSceneInCssPx(
  scene: PaperScene,
  placement: FoldedFigurePlacement,
  cssPerUserUnit: number
): PaperScene {
  const factor = placement.scale * cssPerUserUnit;
  if (!(factor > 0) || !Number.isFinite(factor) || factor === 1) return scene;
  return scaleScene(scene, factor);
}

/** Every point of a scene moved by `shift`; `sheet` is a length and does not. */
function shiftScene(scene: PaperScene, [dx, dy]: ScenePoint): PaperScene {
  const move = ([x, y]: ScenePoint): ScenePoint => [x + dx, y + dy];
  return {
    sheet: scene.sheet,
    bounds: {
      minX: scene.bounds.minX + dx,
      minY: scene.bounds.minY + dy,
      maxX: scene.bounds.maxX + dx,
      maxY: scene.bounds.maxY + dy,
    },
    items: scene.items.map((item) => {
      if (item.kind === 'face') {
        return { ...item, rings: item.rings.map((ring) => ring.map(move)) };
      }
      if (item.kind === 'line') {
        return {
          ...item,
          a: move(item.a),
          b: move(item.b),
          ...(item.whole
            ? { whole: { ...item.whole, a: move(item.whole.a), b: move(item.whole.b) } }
            : {}),
        };
      }
      return {
        ...item,
        bounds: {
          minX: item.bounds.minX + dx,
          minY: item.bounds.minY + dy,
          maxX: item.bounds.maxX + dx,
          maxY: item.bounds.maxY + dy,
        },
      };
    }),
  };
}

/**
 * Every length of a scene multiplied by `factor`, `sheet` included: erode is
 * measured against the sheet, so a scene that scaled its points and not its
 * sheet would pull its creases back by a different fraction of the paper.
 *
 * Markup carries its own already-drawn SVG and cannot be rescaled from here —
 * the mesh producer emits none, so a 3D figure's scene never holds one, and
 * only its bounds are carried (as {@link shiftScene} carries them).
 */
function scaleScene(scene: PaperScene, factor: number): PaperScene {
  const grow = ([x, y]: ScenePoint): ScenePoint => [x * factor, y * factor];
  const growBounds = (bounds: PaperScene['bounds']): PaperScene['bounds'] => ({
    minX: bounds.minX * factor,
    minY: bounds.minY * factor,
    maxX: bounds.maxX * factor,
    maxY: bounds.maxY * factor,
  });
  return {
    sheet: scene.sheet * factor,
    bounds: growBounds(scene.bounds),
    items: scene.items.map((item) => {
      if (item.kind === 'face') {
        return { ...item, rings: item.rings.map((ring) => ring.map(grow)) };
      }
      if (item.kind === 'line') {
        return {
          ...item,
          a: grow(item.a),
          b: grow(item.b),
          ...(item.whole
            ? { whole: { ...item.whole, a: grow(item.whole.a), b: grow(item.whole.b) } }
            : {}),
        };
      }
      return { ...item, bounds: growBounds(item.bounds) };
    }),
  };
}

/**
 * The mesh a render model makes, once per model.
 *
 * An unwindowed figure rebuilds its picture on every pointermove of a turn,
 * and the mesh is the half of that which the camera does not change: packing
 * it per frame would be the model's whole geometry walked sixty times a second
 * to hand the scene producer the same buffers each time. Keyed on the model
 * object, which the kernel replaces whenever the geometry does.
 */
const meshes = new WeakMap<
  OristudioCpFolded3dRenderModel,
  { aux: OristudioCpFolded3dAuxLines | null; built: Folded3dMeshResult }
>();

/** The same, for the aux lines it was built with: new ones are a new mesh. */
function meshOf(
  model: OristudioCpFolded3dRenderModel,
  aux: OristudioCpFolded3dAuxLines | null
): Folded3dMeshResult {
  const cached = meshes.get(model);
  if (cached && cached.aux === aux) return cached.built;
  const built = folded3dMesh(model, aux);
  meshes.set(model, { aux, built });
  return built;
}
