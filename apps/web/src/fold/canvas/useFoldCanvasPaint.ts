import { useMemo } from 'react';
import type { FoldedSceneInk } from '../../cp-workspace/adapters/cpFoldedToScene';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import type { UserBounds } from '../../cp-workspace/renderer/camera';
import type { FillGeometry } from '../../cp-workspace/renderer/types';
import type { Point } from '../../lib/geometry';
import type { PaperScene } from '../../lib/paper/paperScene';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { FOLD_SHEET_KEY } from '../document/foldStepTree';
import { boundsOf, boundsToUser, transformLine, type Bounds } from './foldCanvasGeometry';
import { refusedFaceInks } from './foldCanvasModel';
import { creasePatternPaneLines, type FoldCreasePatternLines } from './foldCreasePatternLines';
import { foldMovingTint, foldTargetsTint, joinFills } from './foldPaneOverlays';
import {
  foldedDisplayOffset,
  foldedPaneScene,
  withPreviewCreases,
  type FoldPaneDisplay,
  type FoldPendingCreases,
} from './foldPaneScenes';
import type { FoldCanvasInks } from './useFoldCanvasInks';
import type { FoldStateView } from './useFoldStateView';
import type { FoldToolPreview } from './useFoldToolPreview';
import { useFoldVertexCreases } from './vertex/useFoldVertexMarks';
import { swivelRegionsTint } from './vertex/vertexOverlay';

export interface FoldCanvasPaint {
  /** The folded form, as paper in the user's style. */
  folded: {
    scene: PaperScene | null;
    ink: FoldedSceneInk;
    /** In user space: the sheet and the folded form. */
    contentBounds: UserBounds | null;
    /** In user space: the folded form alone, what must still show across a new step (`FoldPane`'s `keepInViewBounds`). */
    formBounds: UserBounds | null;
    /**
     * The step whose form `contentBounds` frames — the sheet's key for the
     * sheet — once the step on screen's own picture is in; null while the
     * last one shown stands in. The pane keeps the form in view when it
     * changes (`FoldPane`'s `keepInViewKey`).
     */
    keepInView: string | null;
    offset: Point;
    /** The moving set, lit over the paper on the pane's overlay fill channel. */
    tint: FillGeometry | null;
  };
  /** The crease pattern, as Edit's document lines (`creasePatternPaneLines`). */
  creasePattern: {
    lines: FoldCreasePatternLines | null;
    /** In user space: the sheet. */
    contentBounds: UserBounds | null;
    /** The step on screen, once its own picture is in: the pane keeps the sheet in view across a new step. */
    keepInView: string | null;
  };
}

/**
 * The spread the folded pane draws: the step's at rest, none once a tool has
 * a pick in hand (`picking`) or has located a fold. A reference is picked on
 * the spread paper where the pane draws it (`useFoldPaneSpread`); from then
 * on the paper lies flat, so the picks, the lines they locate, what moves and
 * the layers a fold is picked through are drawn where they lie.
 */
export function restingSpread(
  spread: LayerSpreadOptions | null,
  preview: Pick<FoldToolPreview, 'action' | 'analysis'>,
  picking = false
): LayerSpreadOptions | null {
  return picking || preview.action !== null || preview.analysis !== null ? null : spread;
}
const NO_OFFSET: Point = { x: 0, y: 0 };

/**
 * Which step's form the folded pane shows — the sheet's key for the sheet —
 * once it is the step on screen's own: the pick index is built from that
 * scene alone, so the scene shown is the index's. Null while the last
 * picture shown stands in for one still on its way.
 */
export function foldedFormKey(view: Pick<FoldStateView, 'cursorId' | 'scene' | 'index'>): string | null {
  const { index, scene } = view;
  return index !== null && scene !== null && index.scene === scene ? (view.cursorId ?? FOLD_SHEET_KEY) : null;
}

function union(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a || !b) return a ?? b;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * What each pane of the Fold canvas paints (plan D11): the folded form of the
 * state on screen — or, with Rotate in hand, of that state turned as the
 * rotation lands it (`preview.turned`) — with a located fold's line — a crimp's two, a vertex
 * fold's creases, a vertex tool's pending creases (`pending`: a rabbit ear's
 * given creases from their clicks on, `useFoldFanMarks`; a petal fold's
 * hinge and the flap under the pointer, `useFoldPetalMarks`) — in the paper
 * style's diagram-crease pen of its letter, and its moving set lit over the
 * paper (a swivel's moving regions, its turning wedge brightest), a tuck's
 * listed targets lit too, through the shared paper painter
 * (`paperSceneToFoldedGeometry`, which the pane calls) with the `fold`
 * policy; and the crease pattern — of the previewed fold's landed state while
 * there is one, the creases it adds its instruction, else the pending
 * creases its instruction — as the lines Edit's document would hold, which
 * the canvas inks as Edit does (`useFoldCreasePatternStrokes`).
 *
 * The folded form's layers are spread by `spread`: the step's
 * (`foldStepSpread`) while the pane is at rest, none once a tool picks or
 * locates a fold (`restingSpread`) — the line, the moving set lit over it and
 * the layers it is picked through are the engine's, unspread, and must lie on
 * the paper they describe. Under either kind of spread most faces move, a
 * face on top of its stack among them, so what is picked and hovered on the
 * spread paper is found and drawn where the spread puts it
 * (`useFoldPaneSpread`), not here.
 */
export function useFoldCanvasPaint(
  view: FoldStateView,
  preview: FoldToolPreview,
  display: FoldPaneDisplay,
  hoveredFlap: number | null,
  inks: FoldCanvasInks | null,
  spread: LayerSpreadOptions | null = null,
  pending: FoldPendingCreases | null = null,
  resolvedScene: import('../engine/foldEngineWire').FoldScene | null = null
): FoldCanvasPaint {
  const { summary, index } = view;
  // Rotate's preview: the model turned as it will be, in place of the state
  // on screen, turning about the sheet's middle as the offset places it. The
  // crease pattern, front up, stays the state on screen's.
  const scene = resolvedScene ?? preview.turned ?? view.scene;
  const sheet = summary?.sheet;
  const offset = useMemo(() => (scene && sheet ? foldedDisplayOffset(scene, sheet) : NO_OFFSET), [scene, sheet]);
  const sheetBounds = useMemo(() => (sheet ? boundsOf(sheet.map(([x, y]) => ({ x, y }))) : null), [sheet]);

  // A crimp's second line, beside its picture's first: the other letter on
  // the near layer, as a pleat's two creases are. A vertex tool's pending
  // creases, each by its letter as the viewer sees it, until the engine's
  // own take their place.
  const secondLine = preview.action ? (preview.crimp?.lines.second ?? preview.pleatLines?.second ?? null) : null;
  const pendingFolded = pending?.folded ?? null;
  const pendingSheet = pending?.creasePattern;
  const vertexCreases = useFoldVertexCreases(index, preview.vertex);
  const foldedScene = useMemo(() => {
    if (!scene) return null;
    const base = foldedPaneScene(scene, display, offset, spread);
    if (resolvedScene) return base;
    return withPreviewCreases(
      base,
      { action: preview.action, second: secondLine, vertex: vertexCreases, pending: pendingFolded },
      offset
    );
  }, [scene, resolvedScene, display, offset, spread, preview.action, secondLine, vertexCreases, pendingFolded]);
  const foldedInk = useMemo<FoldedSceneInk>(
    () => ({
      policy: PAPER_STYLE_POLICIES.fold,
      faces: inks && scene ? refusedFaceInks(scene, preview, inks.danger) : undefined,
    }),
    [scene, preview, inks]
  );
  const { analysis, refused, section } = preview;
  // While the reverse fold's opening is being chosen — or a crimp's at its
  // first line — the way it opens is lit instead: its blocks over the paper,
  // the upper block lit again.
  const opens = preview.reverse ?? preview.crimp;
  const opening = opens && opens.ways.length > 1 ? opens.way : null;
  // A tuck's targets: every layer listed to tuck against, the one taken brightest.
  const tuck = preview.tuck;
  // A swivel's paper that moves, once the engine has described it: what the
  // turn carries, lit as a fold's moving set is.
  const swivel = preview.vertex?.answer?.analysis ?? preview.vertex?.base?.analysis ?? null;
  const tint = useMemo(() => {
    if (!index || !inks) return null;
    if (swivel?.kind === 'swivel-by-edge' || swivel?.kind === 'swivel-valley-mountain') return swivelRegionsTint(index, swivel, inks.accent);
    const targets = tuck
      ? foldTargetsTint(
          index,
          { listed: tuck.targets.map((target) => target.face), taken: tuck.target?.face ?? null, additional: tuck.additional?.map((target) => target.face) },
          inks.accent
        )
      : null;
    if (!analysis || refused) return targets;
    const lit = opening
      ? {
          faces: opening.openings.flatMap((each) => [...each.lower, ...each.upper]),
          hovered: opening.openings.flatMap((each) => each.upper),
        }
      : {
          faces: analysis.moving,
          hovered: hoveredFlap === null ? [] : (section?.flaps[hoveredFlap]?.faces ?? []),
        };
    const moving = foldMovingTint(
      index,
      {
        line: transformLine(index.scene.view_transform, analysis.line),
        sign: analysis.side === 'positive' ? 1 : -1,
        ...lit,
      },
      inks.accent
    );
    return joinFills(targets, moving);
  }, [index, inks, analysis, refused, section, hoveredFlap, opening, tuck, swivel]);
  const { foldedBounds, formBounds } = useMemo(() => {
    const form = scene
      ? boundsOf(scene.subfaces.flatMap((cell) => cell.polygon.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }))))
      : null;
    const framed = union(sheetBounds, form);
    return { foldedBounds: framed ? boundsToUser(framed) : null, formBounds: form ? boundsToUser(form) : null };
  }, [scene, offset, sheetBounds]);

  const landed = preview.landed;
  const cpSource = resolvedScene ?? landed?.scene ?? view.scene;
  const cpSummary = landed?.summary ?? summary;
  // The step on screen's own creases: all a Repeat made, not only its last operation's.
  const since = landed ? null : view.since;
  // An Import CP step's own creases are the whole pattern: there is nothing
  // for them to stand out of, so they are drawn as the pattern is, at Edit's
  // width, rather than as an instruction over it.
  const pattern = !landed && view.imported;
  const cpLines = useMemo(() => {
    if (!cpSource || !cpSummary) return null;
    const lines = creasePatternPaneLines(cpSource, {
      display: pattern ? { ...display, stepCreases: false } : display,
      step: cpSummary.step,
      ...(since !== null ? { since } : {}),
      instruction: landed?.added ?? null,
    });
    // Until a fold lands and draws its own, a vertex tool's pending creases
    // are the instruction: on each layer, by the letter each has from the front.
    if (landed || !pendingSheet || pendingSheet.length === 0) return lines;
    return { ...lines, instruction: [...lines.instruction, ...pendingSheet] };
  }, [cpSource, cpSummary, since, display, pattern, landed, pendingSheet]);
  const cpBounds = useMemo(() => (sheetBounds ? boundsToUser(sheetBounds) : null), [sheetBounds]);

  // A turned preview is another form: the pane keeps it in view as it keeps a new step's.
  const formKey = foldedFormKey(view);
  const turned = preview.turned;
  const keepInView = formKey !== null && turned ? `${formKey}|turned:${turned.view_transform.join(',')}` : formKey;

  return {
    folded: { scene: foldedScene, ink: foldedInk, contentBounds: foldedBounds, formBounds, keepInView, offset, tint: resolvedScene ? null : tint },
    creasePattern: { lines: cpLines, contentBounds: cpBounds, keepInView: formKey },
  };
}
