/**
 * What the Fold canvas shows of the fold being located, from the tools and
 * the session's pipeline: the window's preview (the layers at the line and
 * what the seed asks of them), the faces lit on the folded pane, and the
 * canvas's chooser. React-free and store-free, so each reading is tested on
 * its own.
 */
import type { TFunction } from 'i18next';
import type { FoldedFaceInk } from '../../cp-workspace/adapters/cpFoldedToScene';
import type { Rgba } from '../../cp-workspace/renderer/types';
import type { CpToolOptionBounds } from '../../cp-workspace/toolOptions/toolOptionWindow';
import type { Point } from '../../lib/geometry';
import { FOLD_SWIVEL_KINDS, isVertexOp } from '../document/foldSequenceDocument';
import type { FoldFlap, FoldLetter, FoldScene } from '../engine/foldEngineWire';
import type { FoldPendingCreases } from './foldPaneScenes';
import type { FoldCrimpLines } from '../tools/crimp/crimpStep';
import { sameFlap } from '../tools/crossSection';
import { lineAcrossPaper } from '../tools/foldStepBuilder';
import type { FoldPickIndex } from './foldPicking';
import { lineModeInput } from '../tools/foldToolRegistry';
import type { FoldPreview } from '../tools/foldToolWindow';
import type { FoldReverseWindowView } from '../tools/reverse/reverseToolWindow';
import { pocketNames } from '../tools/sink/sinkStep';
import type { FoldSinkWindowView } from '../tools/sink/sinkToolWindow';
import { isSinkRefusalCode } from '../engine/foldEngineSinkWire';
import type { FoldTuckWindowView } from '../tools/tuck/tuckToolWindow';
import { isLocated, locatesTakenLine, type FoldToolState } from '../tools/foldToolState';
import type { FoldExtentMode } from '../tools/precrease/precreaseExtent';
import { isLineTool, isSinkTool, isVertexTool, type FoldKeyLabel } from '../tools/foldToolCatalog';
import { SWIVEL_TARGET_FROM } from '../tools/vertex/vertexInputs';
import { nearestDirection, swivelFoldPick } from '../tools/vertex/vertexStep';
import { swivelReachesNothing } from '../tools/vertex/swivelReach';
import type { FoldVertexWindowView } from '../tools/vertex/vertexToolWindow';
import { boundsOf } from './foldCanvasGeometry';
import type { FoldOverlayAlong } from './foldPaneOverlays';
import type { FoldFreePick, FoldPaneId, FoldPick, FoldPointPick } from './foldPicking';
import type { FoldCanvasChoice } from './useFoldCanvasVerbs';
import type { FoldExtentPreview, FoldToolPreview } from './useFoldToolPreview';

/** Where a flap the engine named elsewhere is among the section's flaps; -1 when it is not there. */
function sectionIndex(section: readonly FoldFlap[], flap: FoldFlap): number {
  return section.findIndex((each) => sameFlap(each, flap));
}

/**
 * The window's preview of a located fold (`foldToolWindow`'s `FoldPreview`):
 * the section, what the seed asks for and what the closure adds, as indices
 * into the section's flaps, and why it does not land; for a woven section,
 * the interval whose stack is shown (`useFoldWovenInterval`). Null while the
 * line is still being located.
 */
export function foldWindowPreview(
  tools: FoldToolState,
  preview: FoldToolPreview,
  interval: number | null = null,
  queued = false
): FoldPreview | null {
  if (!isLocated(tools)) return null;
  const section = preview.section;
  const flaps = section?.flaps ?? [];
  // What the step asks for, which is the seed it was built with — the
  // tools', the default top flap resolved — or, along a fold being
  // unfolded, the top flap the step builder took for it.
  const asked = preview.seed;
  const op = preview.step?.op;
  const scope = op && 'seed' in op ? op.seed.scope : asked?.scope;
  const seed: FoldPreview['seed'] =
    scope === 'flaps' && asked?.scope === 'flaps'
      ? asked.flaps.map((flap) => sectionIndex(flaps, flap)).filter((index) => index >= 0)
      : scope === 'all'
        ? 'all'
        : (preview.analysis?.picked ?? []).flatMap((picked) => {
            const flap = preview.analysis?.flaps[picked];
            const index = flap ? sectionIndex(flaps, flap) : -1;
            return index >= 0 ? [index] : [];
          });
  const added = (preview.analysis?.added ?? []).flatMap((index) => {
    const flap = preview.analysis?.flaps[index];
    const at = flap ? sectionIndex(flaps, flap) : -1;
    return at >= 0 ? [at] : [];
  });
  const narrower = preview.refused && preview.seedFix ? preview.seedFix.flaps.map((flap) => sectionIndex(flaps, flap)) : [];
  return {
    section,
    interval,
    seed,
    added,
    refused: preview.refused,
    ...(preview.refused && preview.moverFix ? { movingPoint: true } : {}),
    ...(narrower.length > 0 && narrower.every((index) => index >= 0) ? { narrowerSeed: narrower } : {}),
    landing: preview.landing,
    // The last seed's answers, standing in while this one's are on their way (`foldShownPreview`).
    ...(preview.held ? { held: true } : {}),
    acrossLayers: preview.build.status === 'built' && preview.build.acrossLayers === true && !tools.override,
    ...(queued ? { queued } : {}),
    ...(preview.orderResolution?.waiting && !preview.orderResolution.active ? { searching: true } : {}),
    ...(preview.extent?.state.status === 'incomplete' ? { incomplete: true } : {}),
  };
}

/** A partial precrease's line and points as one pane's overlay draws them (`FoldPaneOverlayInput.along`). */
export type FoldAlongOverlays = Readonly<Record<FoldPaneId, FoldOverlayAlong>>;

/**
 * What each pane draws of a partial precrease being made: the located line
 * on it, the points clicked, and for a segment, the stretch from its first
 * end to the point under the pointer. On the folded pane the line is bright
 * while its points are clicked and faint once they are all in and the fold's
 * picture draws the extent; on the crease pattern always faint, a guide
 * among creases drawn in the same blue as a valley. Null for any other fold.
 */
export function foldAlongOverlay(
  extent: FoldExtentPreview | null,
  mode: FoldExtentMode,
  picks: readonly FoldPointPick[]
): FoldAlongOverlays | null {
  if (!extent) return null;
  const segment = mode === 'segment';
  return {
    folded: { pieces: extent.along.folded.pieces, picks, segment, faint: extent.state.status !== 'incomplete' },
    'crease-pattern': { pieces: extent.along.creasePattern.pieces, picks, segment, faint: true },
  };
}

/**
 * The reverse tool's window view (`reverseToolWindow`): the kind folded and
 * the kinds that land, the ways the tip opens and the orders it leaves, each
 * with the one taken. Absent for every other tool, and while nothing is
 * located.
 */
export function foldReverseWindowView(tools: FoldToolState, preview: FoldToolPreview): FoldReverseWindowView | undefined {
  const reverse = preview.reverse;
  if (tools.tool !== 'inside-reverse') return undefined;
  if (!reverse || !isLocated(tools)) return { kind: tools.compound.reverseKind ?? 'inside', requested: tools.compound.reverseKind, kinds: [], known: false, ways: 0, way: 0, orders: 0, order: 0 };
  const ways = reverse.ways.length;
  const orders = reverse.orders.length;
  return {
    kind: reverse.kind,
    requested: tools.compound.reverseKind,
    truncated: reverse.ways.truncated ?? false,
    kinds: reverse.kinds,
    known: reverse.asked !== null,
    ways,
    way: ways > 0 ? Math.min(tools.compound.opening, ways - 1) : 0,
    orders,
    order: orders > 0 ? Math.min(tools.compound.order, orders - 1) : 0,
  };
}

/**
 * The crimp tool's window view (`crimpToolWindow`), as the reverse tool's:
 * the kind folded on both lines and the kinds that land, the ways the tip
 * opens at ℓ1 and the orders it leaves, each with the one taken. Absent for
 * every other tool, and while its lines are still being located.
 */
export function foldCrimpWindowView(tools: FoldToolState, preview: FoldToolPreview): FoldReverseWindowView | undefined {
  const crimp = preview.crimp;
  if (tools.tool !== 'crimp' || !crimp || !isLocated(tools)) return undefined;
  const ways = crimp.ways.length;
  const orders = crimp.orders.length;
  return {
    kind: crimp.kind,
    kinds: crimp.kinds,
    known: crimp.asked !== null,
    ways,
    way: ways > 0 ? Math.min(tools.compound.opening, ways - 1) : 0,
    orders,
    order: orders > 0 ? Math.min(tools.compound.order, orders - 1) : 0,
  };
}

/**
 * The tuck tool's window view (`tuckToolWindow`): its direction, the layers
 * listed to tuck against with the one taken, and the orders it leaves.
 * Absent for every other tool, and while its line is still being located.
 */
export function foldTuckWindowView(tools: FoldToolState, preview: FoldToolPreview): FoldTuckWindowView | undefined {
  const tuck = preview.tuck;
  if (tools.tool !== 'tuck' || !tuck || !isLocated(tools)) return undefined;
  const orders = tuck.orders.length;
  const faces = tuck.targets.map((target) => target.face);
  return {
    direction: tuck.direction,
    known: tuck.asked !== null,
    targets: faces.length,
    pinned: tools.compound.tuckPinned ?? [],
    target: Math.max(0, faces.indexOf(tuck.target?.face ?? -1)),
    faces,
    orders,
    order: orders > 0 ? Math.min(tools.compound.order, orders - 1) : 0,
  };
}

/**
 * A vertex tool's window view (`vertexToolWindow`): the direction, and what
 * the engine listed with the choices taken — a squash's spine target, a fan's
 * fourth rays and layers, the orders. Absent for every other tool. Before
 * every click is in, only the direction is known.
 */
export function foldVertexWindowView(tools: FoldToolState, preview: FoldToolPreview): FoldVertexWindowView | undefined {
  const { tool } = tools;
  if (!isVertexTool(tool)) return undefined;
  const vertex = preview.vertex;
  const analysis = vertex?.base?.analysis;
  const candidates =
    analysis?.kind === 'rabbit-ear' || analysis?.kind === 'swivel'
      ? analysis.candidates
      : analysis?.kind === 'swivel-by-edge'
        ? analysis.ridges
        : [];
  // Only the fourth creases — a swivel's ridges — that land are offered, numbered among themselves.
  const fourths = vertex?.fourths ?? [];
  const { orders = [], order = null } = vertex ?? {};
  // What the petal fold creases itself, as the engine describes the flap folded.
  const petal = vertex?.answer?.analysis ?? analysis;
  const valleyMountain = tool === 'swivel' && tools.swivelInput === 'valley-mountain';
  const lineBy = tool === 'petal' ? tools.petalHinge : tool === 'swivel' && !valleyMountain ? tools.swivelTarget : null;
  // A swivel whose creases meet on a folded edge has no ridge; every swivel
  // folds the way and kind asked, and offers the others that land.
  const onFold = valleyMountain || swivelFoldPick(tools) !== null;
  const directions = vertex?.directions;
  // A swivel on a folded edge's kind folded, and the kinds that land either way.
  const kinds = vertex?.kinds;
  const swivelKinds = onFold && kinds ? FOLD_SWIVEL_KINDS.filter((_, k) => kinds[k]) : null;
  // A swivel's meeting point nothing can swing from: its next click takes another.
  const nothingSwings = tool === 'swivel' && !valleyMountain && tools.picks.length === 1 && swivelReachesNothing(vertex?.reach ?? null);
  return {
    tool,
    // The way it folds: the folder's, always.
    direction: vertex?.direction ?? tools.vertexDirection,
    ...(onFold ? { onFold } : {}),
    ...(tool === 'swivel'
      ? {
          swivelInput: tools.swivelInput ?? 'edge',
          lineTaken: tools.takenLine !== undefined,
          lineLocated: preview.locatedLine != null,
        }
      : {}),
    ...(tool === 'squash'
      ? {
          squashHinge: tools.squashHinge ?? 'folded',
          lineTaken: tools.takenLine !== undefined,
          lineLocated: preview.locatedLine != null,
        }
      : {}),
    ...(directions && directions.length === 2 ? { directions } : {}),
    // The kind asked, before the engine has answered (or when it refused it) too.
    ...(onFold ? { swivelKind: vertex?.kind ?? tools.compound.swivelKind ?? 'open' } : {}),
    ...(swivelKinds ? { swivelKinds } : {}),
    ...(nothingSwings ? { nothingSwings } : {}),
    described: vertex?.base != null,
    known: preview.step !== null,
    target: tools.compound.squashTarget ? 'point' : 'hinge',
    fourths: fourths.length,
    fourth: Math.max(0, fourths.indexOf(vertex?.emergent ?? -1)),
    fourthElsewhere: vertex?.elsewhere ?? null,
    layers: vertex?.layers ?? 0,
    fanLayers: tools.compound.fanLayers,
    orders: orders.length > 1 ? orders.length : 0,
    order: order ? Math.max(0, orders.indexOf(order)) : 0,
    emergentNumber: (direction) => {
      const k = nearestDirection(candidates, direction);
      const at = k === null ? -1 : fourths.indexOf(k);
      return at < 0 ? null : at + 1;
    },
    ...(lineBy ? { lineBy } : {}),
    ...(analysis?.kind === 'swivel-by-edge' ? { ridge: vertex?.emergent === 1 ? 'end' : 'foot' } : {}),
    ...(petal?.kind === 'petal'
      ? {
          petalScores: {
            hinge: petal.scores_line === true,
            kites: (petal.scores_kites ?? [false, false]).filter(Boolean).length,
          },
        }
      : {}),
  };
}

/**
 * A sink tool's window view (`sinkToolWindow`): what fits of the point, its
 * pockets and the orders it leaves, each with the one taken, its depth, and
 * an unsink's sunk points. `flipped` is the view's: whether the viewer sees
 * the model's underside, which names the pockets front and back. Absent for
 * every other tool, and while nothing is located.
 */
export function foldSinkWindowView(
  tools: FoldToolState,
  preview: FoldToolPreview,
  flipped: boolean
): FoldSinkWindowView | undefined {
  const sink = preview.sink;
  if (!isSinkTool(tools.tool) || !sink || !isLocated(tools)) return undefined;
  const point = sink.point?.analysis ?? null;
  const open = sink.point?.open?.refusal.code ?? null;
  const names = pocketNames(sink.pockets, flipped);
  return {
    tool: sink.tool,
    known: sink.tool === 'unsink' ? sink.sunk !== null : point !== null,
    openRefusal: open !== null && isSinkRefusalCode(open) ? open : null,
    pocketsFound: point?.pockets.length ?? 0,
    pockets: sink.pockets.length,
    pocket: sink.pocket,
    pocketName: names[sink.pocket] ?? null,
    orders: sink.orders,
    order: sink.order,
    depth: point?.apex
      ? Math.abs(point.line.n[0] * point.apex[0] + point.line.n[1] * point.apex[1] - point.line.d)
      : null,
    sunk: sink.sunk?.points.length ?? 0,
  };
}

/** How strongly the faces a refusal names are tinted over their paper. */
const REFUSED_TINT = 0.32;

/**
 * Where each face is in a scene, by its id: the engine names faces by id in
 * an analysis, a refusal and a section, and the scene lists them in id order
 * (`lineage`), which after a split is no longer the ids themselves.
 */
export function sceneFaceIndex(scene: FoldScene): ReadonlyMap<number, number> {
  return new Map(scene.lineage.map((face, index) => [face.id, index]));
}

/**
 * The folded pane's per-face overrides (plan D11, D12), by the scene's face
 * index: when a fold is refused, the faces the refusal names — a collision's
 * layers, a sliver's face — tinted whole in the danger accent over their
 * paper, never in place of it. The moving set of a fold that lands is lit by
 * `foldMovingTint` instead, cut to the moving side, since the line cuts the
 * faces it moves.
 */
export function refusedFaceInks(
  scene: FoldScene,
  preview: FoldToolPreview,
  danger: Rgba
): ReadonlyMap<number, FoldedFaceInk> | undefined {
  if (!preview.refused) return undefined;
  const index = sceneFaceIndex(scene);
  const [r, g, b] = danger;
  const faces = new Map<number, FoldedFaceInk>();
  for (const id of preview.refused.faces) {
    const at = index.get(id);
    if (at !== undefined) faces.set(at, { tint: [r, g, b, REFUSED_TINT] });
  }
  return faces.size > 0 ? faces : undefined;
}

/**
 * While a line is being drawn through two clicks, its first end, which the
 * live line runs from to where a click would end it: a free fold line's, a
 * crimp's second line drawn free after its first, or the line through two
 * points a swivel lays its edge on. Null otherwise. (A petal fold's hinge by
 * its ends is a crease the fold makes: the paper draws it in its pen,
 * `useFoldPetalMarks`.)
 */
export function foldFreeLineStart(tools: FoldToolState): FoldFreePick | FoldPointPick | null {
  // Repeat's axis, drawn as a free line.
  if (tools.tool === 'repeat') {
    const pick = tools.picks.length === 1 ? tools.picks[0] : undefined;
    return pick?.kind === 'free' ? pick : null;
  }
  const valleyMountain = tools.tool === 'swivel' && tools.swivelInput === 'valley-mountain';
  if (tools.tool === 'swivel' && !valleyMountain) {
    const pick = tools.swivelTarget === 'points' && tools.picks.length === SWIVEL_TARGET_FROM + 1 ? tools.picks.at(-1) : undefined;
    return pick?.kind === 'point' ? pick : null;
  }
  const first = lineModeInput(tools.lineMode).steps.length;
  const [mode, from] =
    (tools.tool === 'crimp' || tools.tool === 'pleat') && tools.picks.length > first ? [tools.secondLineMode, first] : [tools.lineMode, 0];
  const pick = (isLineTool(tools.tool) || valleyMountain) && mode === 'free' && tools.picks.length === from + 1 ? tools.picks[from] : undefined;
  return pick?.kind === 'free' ? pick : null;
}

/**
 * The picks the panes draw: every one clicked, but a swivel's pivot and
 * target once the engine has described its fold — the creases meet where the
 * pivot sits moved onto the bisector of the edge and the target, which the
 * vertex overlay draws in its place, never the click (owner feedback,
 * 2026-10-12), and the edge's landing on the target is drawn bold where the
 * target lies. The edge it moves stays lit. So too while a swivel is
 * previewed under the pointer before its last click (`hovering`): its
 * meeting point gives way to the vertex the preview draws.
 */
export function foldShownPicks(
  tools: FoldToolState,
  preview: Pick<FoldToolPreview, 'vertex'>,
  hovering = false
): readonly FoldPick[] {
  const described = hovering || (preview.vertex?.answer ?? preview.vertex?.base)?.analysis.kind === 'swivel-by-edge';
  return tools.tool === 'swivel' && described ? tools.picks.slice(1, SWIVEL_TARGET_FROM) : tools.picks;
}

/**
 * The lines the tools have located that no fold's picture draws yet: a
 * crimp's first line while its second is being located. The picture, once
 * in, draws both (`useFoldCanvasPaint`).
 */
export function foldLocatedLines(
  tool: FoldToolState['tool'],
  pictured: boolean,
  lines: FoldCrimpLines | null
): readonly (readonly [Point, Point])[] {
  if ((tool !== 'crimp' && tool !== 'pleat') || pictured || !lines) return [];
  return [lines.first, lines.second].filter((line): line is [Point, Point] => line !== null);
}

/**
 * The lines a construction locates with the line modes, before the engine
 * has described its fold, across the paper on the folded pane, each in its
 * letter's diagram pen, as the fold will crease them. A swivel by its valley
 * and mountain: the valley taken, and the line the picks locate now — the
 * valley until it is taken, then the mountain. A squash's drawn hinge, as it
 * is located and once taken, in its direction's pen: the flap's upper layer
 * folds along it. Null for any other tool, and with no line in.
 */
export function takenLinesPending(
  index: FoldPickIndex | null,
  tools: Pick<FoldToolState, 'tool' | 'swivelInput' | 'squashHinge' | 'takenLine' | 'vertexDirection'>,
  located: FoldToolPreview['locatedLine']
): FoldPendingCreases | null {
  if (!index || !locatesTakenLine(tools)) return null;
  const { takenLine } = tools;
  const lines: [FoldToolState['takenLine'] | null | undefined, FoldLetter][] =
    tools.tool === 'squash'
      ? [[takenLine ?? located, tools.vertexDirection]]
      : [
          [takenLine, 'valley'],
          [located, takenLine ? 'mountain' : 'valley'],
        ];
  const folded = lines.flatMap(([line, letter]) => {
    const segment = line ? lineAcrossPaper(index, line.sceneLine) : null;
    return segment ? [{ line: segment, letter }] : [];
  });
  return folded.length > 0 ? { folded, creasePattern: [] } : null;
}

/**
 * The keys that step the canvas's chooser, as the user's shortcuts name them
 * (`fold.previousCandidate`, `fold.nextCandidate`): what its note offers
 * beside its arrows. None on a finger, which has no keys to press, or while
 * either is unbound.
 */
export function chooserKeys(keyLabel: FoldKeyLabel, coarse: boolean): string | null {
  if (coarse) return null;
  const previous = keyLabel('fold.previousCandidate');
  const next = keyLabel('fold.nextCandidate');
  return previous && next ? `${previous} / ${next}` : null;
}

/**
 * What the canvas's chooser says of the choice it steps through: with the
 * keys that step it (`chooserKeys`), or — none to offer — its arrows alone.
 * Whole sentences each, never a clause joined on.
 */
export function foldChoiceNote(t: TFunction, kind: FoldCanvasChoice['kind'], keys: string | null): string {
  return keys === null ? choiceNoteNoKeys(t, kind) : choiceNoteWithKeys(t, kind, keys);
}

function choiceNoteWithKeys(t: TFunction, kind: FoldCanvasChoice['kind'], keys: string): string {
  switch (kind) {
    case 'pocket':
      return t(
        'tools:fold.chooser.withKeys.pocket',
        'The point can sink into more than one pocket between its layers. Step through them, or press {{keys}}.',
        { keys }
      );
    case 'target':
      return t(
        'tools:fold.chooser.withKeys.target',
        'More than one layer takes the tuck: the brightest is the one taken. Step through them, or press {{keys}}.',
        { keys }
      );
    // The vertex folds'.
    case 'emergent':
      return t(
        'tools:fold.chooser.withKeys.emergent',
        'More than one fourth crease lets these creases lie flat. Step through them, or press {{keys}}.',
        { keys }
      );
    case 'ridge':
      return t(
        'tools:fold.chooser.withKeys.ridge',
        'Either ridge lets the swivel lie flat. Step through them, or press {{keys}}.',
        { keys }
      );
    case 'root':
      return t(
        'tools:fold.chooser.withKeys.root',
        'This axiom has more than one fold here. Step through them, or press {{keys}}.',
        { keys }
      );
    case 'opening':
      return t(
        'tools:fold.chooser.withKeys.opening',
        'The flap opens more than one way: the lit layers stay together. Step through them, or press {{keys}}.',
        { keys }
      );
    case 'order':
      return t(
        'tools:fold.chooser.withKeys.order',
        'The layers can land stacked more than one way. Step through them, or press {{keys}}.',
        { keys }
      );
  }
}

function choiceNoteNoKeys(t: TFunction, kind: FoldCanvasChoice['kind']): string {
  switch (kind) {
    case 'pocket':
      return t(
        'tools:fold.chooser.noKeys.pocket',
        'The point can sink into more than one pocket between its layers. Step through them.'
      );
    case 'target':
      return t(
        'tools:fold.chooser.noKeys.target',
        'More than one layer takes the tuck: the brightest is the one taken. Step through them.'
      );
    case 'emergent':
      return t('tools:fold.chooser.noKeys.emergent', 'More than one fourth crease lets these creases lie flat. Step through them.');
    case 'ridge':
      return t('tools:fold.chooser.noKeys.ridge', 'Either ridge lets the swivel lie flat. Step through them.');
    case 'root':
      return t('tools:fold.chooser.noKeys.root', 'This axiom has more than one fold here. Step through them.');
    case 'opening':
      return t(
        'tools:fold.chooser.noKeys.opening',
        'The flap opens more than one way: the lit layers stay together. Step through them.'
      );
    case 'order':
      return t('tools:fold.chooser.noKeys.order', 'The layers can land stacked more than one way. Step through them.');
  }
}

/**
 * Where the canvas chooser frames: round the fold line on the folded pane, or the paper when there is none
 * yet. A vertex fold folds along no one line: its picture's line is a single crease from its center, too
 * short to hang the chooser on, so a vertex fold's chooser frames the paper.
 */
export function chooserBounds(preview: FoldToolPreview, scene: FoldScene | null): CpToolOptionBounds | null {
  const vertexFold = Boolean(preview.vertex) || (preview.step ? isVertexOp(preview.step.op) : false);
  const line = vertexFold ? null : preview.action?.line;
  if (line) return boundsOf(line);
  return scene ? boundsOf(scene.subfaces.flatMap((cell) => cell.polygon)) : null;
}
