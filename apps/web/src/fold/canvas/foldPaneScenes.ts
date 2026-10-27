/**
 * The folded form and the crease pattern of a Fold state as paper scenes
 * (plan D11), for the shared painter (`paperSceneToFoldedGeometry` with the
 * `fold` policy), so a pen in the user's paper style means on the canvas what
 * it means in every export — and which creases a crease pattern shows.
 *
 * - **The folded pane** is the engine's scene through `foldedFlatPaperScene`,
 *   the route Edit's flat figure takes: whole faces in painter's order, folds
 *   in the edge pen, flat creases in the aux pen, the layers spread apart as
 *   the step says (`foldStepSpread`). A located fold adds its line in the
 *   diagram-crease pen of its direction, over the paper — a vertex fold its
 *   creases, each in the pen of its own letter (`withFoldCreases`).
 * - **A crease pattern** shows every crease as what it is (`foldPaneCrease`):
 *   the border, a folded crease by its (front-relative) letter, a flat crease.
 *   The creases the step on show made — or, while a fold is previewed, the
 *   creases it would add — are its instruction. The canvas's crease-pattern
 *   pane draws them in Edit's inks (`creasePatternPaneLines`); a Diagram
 *   step keeps them as paper, the instruction in the diagram-crease pens
 *   (`creasePatternPaperScene`).
 *
 * Coordinates: a scene's points are in user space, through
 * `foldUnitToScenePx`, so the folded channel draws them as they are.
 *
 * Pure: no React, no store, no renderer.
 */
import type { Point } from '../../lib/geometry';
import type { PaperItem, PaperLineItem, PaperLineRole, PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { creaseRuns, runEnds, type CreaseRun } from '../../cp-workspace/folded/foldedCreaseRuns';
import { foldedFlatPaperScene, type FoldedFlatPaperSceneOptions } from '../../cp-workspace/folded/foldedFlatScene';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import type { FoldDirection } from '../document/foldSequenceDocument';
import type {
  FoldActionGeometry,
  FoldLetter,
  FoldScene,
  FoldSceneCrease,
  FoldSceneCreaseMark,
} from '../engine/foldEngineWire';
import { applyIsometry, FOLD_USER_PER_UNIT, foldUnitToScenePx, toPoint } from './foldCanvasGeometry';
import type { FoldInstructionLine } from './foldCreasePatternLines';

/** The pane toggles on the viewport toolbar (the design's "Step creases | Precreases"). */
export interface FoldPaneDisplay {
  /** Draw the creases the step on show made as its instruction: in the diagram-crease pens. */
  stepCreases: boolean;
  /** Draw flat creases: precreases, and creases a flap was unfolded along. */
  precreases: boolean;
}

export const FOLD_PANE_DISPLAY_DEFAULT: FoldPaneDisplay = { stepCreases: true, precreases: true };

const ORIGIN: Point = { x: 0, y: 0 };

/** A scene with no flat crease in it: what "Precreases" off hides, on both panes. */
function withoutFlatCreases(scene: PaperScene): PaperScene {
  const items: PaperItem[] = [];
  for (const item of scene.items) {
    if (item.kind === 'line' && item.role === 'aux') continue;
    if (item.kind === 'face' && item.outline === 'aux') {
      const { outline: _aux, ...face } = item;
      items.push(face);
      continue;
    }
    items.push(item);
  }
  return { ...scene, items };
}

/**
 * Where the folded pane shows the scene frame: shifted so the view turns and
 * mirrors the model about the sheet's middle rather than the frame's origin.
 *
 * The engine's view is linear (`View::transform`: "the display places the
 * camera"), so a turn-over takes a square sheet from x ∈ [0, 1] to [−1, 0]
 * and a quarter turn swings it round the corner. Shown as it is, either would
 * leave the camera on empty ground; shifted by `c − V(c)` for the sheet's
 * middle `c`, the model turns over in place, as paper does on a table.
 */
export function foldedDisplayOffset(scene: FoldScene, sheet: readonly (readonly [number, number])[]): Point {
  const xs = sheet.map(([x]) => x);
  const ys = sheet.map(([, y]) => y);
  const middle = xs.length
    ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
    : { x: 0.5, y: 0.5 };
  const seen = applyIsometry(scene.view_transform, middle);
  return { x: middle.x - seen.x, y: middle.y - seen.y };
}

const shifted = (offset: Point) => (point: Point): ScenePoint =>
  foldUnitToScenePx({ x: point.x + offset.x, y: point.y + offset.y });

/**
 * A spread as the folded pane applies it to an engine scene, so that it draws
 * what the Diagram draws of the same state with the same spread. The Diagram
 * spreads a Fold state in pattern units, y down (`foldScenePattern`); the
 * engine's frame is y up, its mirror image, so an affine spread's axis — an
 * angle from the sheet's +x toward its +y — names the same line at −θ here.
 * A depth spread's direction is on the screen, after the pane places the
 * scene, and is the same in both; so is every amount, a share of the model.
 */
export function foldFrameSpread(spread: LayerSpreadOptions | null): LayerSpreadOptions | null {
  if (!spread || spread.kind === 'depth') return spread;
  return { ...spread, axisDeg: (180 - spread.axisDeg) % 180 };
}

/**
 * Where the folded pane places a state's folded form: `foldedFlatPaperScene`'s
 * options at the pane's display offset, its layers spread by `spread` — the
 * step's (`foldStepSpread`), none for null.
 */
export function foldedPanePlacement(
  offset: Point = ORIGIN,
  spread: LayerSpreadOptions | null = null
): FoldedFlatPaperSceneOptions {
  const spreadHere = foldFrameSpread(spread);
  return {
    // The canvas shows what the window shows; a buried face is never seen —
    // unless the layers are spread, and one peeks out from under another.
    markHidden: spreadHere === null,
    toScenePx: shifted(offset),
    scale: FOLD_USER_PER_UNIT,
    ...(spreadHere ? { spread: spreadHere } : {}),
  };
}

/**
 * The folded form of a state, as the folded pane paints it, shifted by the
 * pane's display offset, its layers spread by `spread` (none for null).
 */
export function foldedPaneScene(
  scene: FoldScene,
  display: FoldPaneDisplay,
  offset: Point = ORIGIN,
  spread: LayerSpreadOptions | null = null
): PaperScene {
  const painted = foldedFlatPaperScene(scene, foldedPanePlacement(offset, spread));
  return display.precreases ? painted : withoutFlatCreases(painted);
}

/** How far a fold line runs past the paper, as a share of its length: enough to read past the edge. */
const FOLD_LINE_OVERHANG = 0.06;

/** The diagram-crease role a direction is drawn in. */
export function diagramRole(direction: FoldDirection | FoldLetter): PaperLineRole {
  return direction === 'mountain' ? 'diagram-mountain' : 'diagram-valley';
}

function lineItem(
  role: PaperLineRole,
  a: Point,
  b: Point,
  face?: number,
  offset: Point = ORIGIN,
  place: (point: Point) => ScenePoint = shifted(offset)
): PaperLineItem {
  return {
    kind: 'line',
    role,
    a: place(a),
    b: place(b),
    onBoundary: [false, false],
    ...(face !== undefined ? { face } : {}),
    hidden: false,
  };
}

/**
 * A crease a tool previews on the folded pane, in the scene frame: a stretch
 * of paper and the letter it folds by as the viewer sees it, which picks its
 * pen — the user's mountain or valley diagram crease (`withFoldCreases`) —
 * or, when it lies behind paper the viewer sees, the diagram's hidden-line
 * pen, dotted.
 */
export interface FoldPaneCreaseLine {
  line: readonly [Point, Point];
  letter: FoldLetter;
  hidden?: true;
}

/**
 * A scene with a tool's creases over the paper, each in the diagram-crease
 * pen of its letter as the viewer sees it, a hidden one in the hidden-line
 * pen — the instruction, drawn with the pens the Diagram and References draw
 * theirs with. Each runs as given, from end to end; shown at `offset`, as the
 * scene is.
 */
export function withFoldCreases(
  scene: PaperScene,
  creases: readonly FoldPaneCreaseLine[],
  offset: Point = ORIGIN
): PaperScene {
  if (creases.length === 0) return scene;
  const items = creases.map(({ line: [a, b], letter, hidden }) =>
    lineItem(hidden ? 'diagram-hidden' : diagramRole(letter), a, b, undefined, offset)
  );
  return { ...scene, items: [...scene.items, ...items] };
}

/**
 * A scene with a located fold's line over it, in the diagram-crease pen of
 * its direction as the viewer sees it, run a little past the paper at both
 * ends. `line` is in the scene frame, shown at `offset`; null leaves the
 * scene as it is.
 */
export function withFoldLine(
  scene: PaperScene,
  line: readonly [Point, Point] | null,
  direction: FoldDirection,
  offset: Point = ORIGIN
): PaperScene {
  if (!line) return scene;
  const [a, b] = line;
  const dx = (b.x - a.x) * FOLD_LINE_OVERHANG;
  const dy = (b.y - a.y) * FOLD_LINE_OVERHANG;
  const past: FoldPaneCreaseLine = {
    line: [
      { x: a.x - dx, y: a.y - dy },
      { x: b.x + dx, y: b.y + dy },
    ],
    letter: direction,
  };
  return withFoldCreases(scene, [past], offset);
}

/**
 * A vertex tool's creases from its clicks, before the engine has described
 * its fold: a rabbit ear's given creases (`useFoldFanMarks`), a petal fold's
 * hinge and the creases of the flap under the pointer (`useFoldPetalMarks`).
 * The folded pane draws them in the diagram-crease pens, the crease pattern
 * as its instruction, until a preview draws the fold's own.
 */
export interface FoldPendingCreases {
  /** On the folded pane, in the scene frame, each by its letter as the viewer sees it. */
  folded: readonly FoldPaneCreaseLine[];
  /** On the crease pattern, in sheet coordinates, each by its letter from the front. */
  creasePattern: readonly FoldInstructionLine[];
}

/** What a tool's preview draws as creases on the folded pane (`withPreviewCreases`). */
export interface FoldPanePreviewCreases {
  /** The located fold's picture: its line, by its direction as the viewer sees it. Null while none is located. */
  action: Pick<FoldActionGeometry, 'line' | 'direction'> | null;
  /** A crimp's second line, beside its picture's first: the other letter. */
  second: readonly [Point, Point] | null;
  /** A vertex fold's own creases, each by its letter (`vertexCreaseLines`); null for every other tool. */
  vertex: readonly FoldPaneCreaseLine[] | null;
  /**
   * A vertex tool's pending creases (`FoldPendingCreases.folded`) — a fan's
   * given creases from the moment their clicks are in, a petal fold's hinge
   * and the flap under the pointer — each by its letter as the viewer sees
   * it: drawn until the engine has described the fold, whose own creases then
   * take their place.
   */
  pending?: readonly FoldPaneCreaseLine[] | null;
}

/**
 * The folded pane's scene with a tool's preview over it, every crease in the
 * diagram-crease pen of its letter as the viewer sees it: a fold's line —
 * a plain fold's, a precrease's or its extent's, a reverse fold's, a sink's,
 * a tuck's — by its direction, a crimp's second line the other way, and a
 * vertex fold's creases each by its own. A vertex fold's creases are its
 * picture: its action's line is one of them, run across the whole paper in
 * one letter, so it is not drawn as well. Until the engine has described a
 * fan, its given creases are drawn pending in their place, each from end to
 * end (a crease, unlike a fold line, stops where the paper does).
 */
export function withPreviewCreases(
  scene: PaperScene,
  { action, second, vertex, pending = null }: FoldPanePreviewCreases,
  offset: Point = ORIGIN
): PaperScene {
  if (vertex && vertex.length > 0) return withFoldCreases(scene, vertex, offset);
  const waiting = withFoldCreases(scene, pending ?? [], offset);
  if (vertex || !action) return waiting;
  const along = withFoldLine(waiting, action.line, action.direction, offset);
  return second ? withFoldLine(along, second, action.direction === 'valley' ? 'mountain' : 'valley', offset) : along;
}

/** Which creases a state's crease pattern shows, and which of them are the instruction. */
export interface FoldPaneCreaseOptions {
  display: FoldPaneDisplay;
  /** Which step the state is: the creases it made are its own (`made_at`). */
  step: number;
  /**
   * How many steps led to the state the step folds from (`since` < `made_at`
   * ≤ `step` are its own): a Repeat lands several operations as one step, so
   * every crease made after the state before it is the Repeat's, and so is
   * every precrease of a run a Diagram step draws as one. One step before
   * `step` when unsaid.
   */
  since?: number;
  /**
   * The creases a previewed fold would add, by the landed state's edge ids:
   * the instruction in place of the step's own. Null when nothing is previewed.
   */
  instruction: ReadonlySet<number> | null;
}

/** Whether a crease or a crease mark made at `madeAt` is the step's own: made after the state it folds from. */
export function madeByStep(madeAt: number, { step, since }: Pick<FoldPaneCreaseOptions, 'step' | 'since'>): boolean {
  return step > 0 && madeAt > (since ?? step - 1) && madeAt <= step;
}

/**
 * What a crease is in a state's crease pattern, before any pen or ink: the
 * paper's edge; the instruction — the step's own creases (Step creases on),
 * or a previewed fold's — by the way it folds; a fold, by its letter from the
 * front; or a flat crease, with the letter it remembers. Null when the
 * pattern leaves it out (Precreases off). The one rule both pictures of a
 * crease pattern read: the pane's, in the paper's pens
 * (`creasePatternPaneLines`), and the paper's (`creasePatternPaperScene`).
 */
export type FoldPaneCrease =
  | { as: 'edge' }
  | { as: 'instruction'; letter: FoldLetter }
  | { as: 'fold'; letter: FoldLetter }
  | { as: 'flat'; letter: FoldLetter | null };

export function foldPaneCrease(crease: FoldSceneCrease, options: FoldPaneCreaseOptions): FoldPaneCrease | null {
  const { display, instruction } = options;
  if (crease.kind === 'border') return { as: 'edge' };
  // The step's own creases are its instruction: the ink of what they are now
  // would say the same line twice.
  const instructs = instruction ? instruction.has(crease.id) : display.stepCreases && madeByStep(crease.made_at, options);
  if (instructs && crease.letter) return { as: 'instruction', letter: crease.letter };
  // A folded crease always has a letter; one without is drawn as context, as a flat one is.
  if (crease.kind === 'flat' || !crease.letter) return display.precreases ? { as: 'flat', letter: crease.letter } : null;
  return { as: 'fold', letter: crease.letter };
}

/**
 * What a crease mark — a pinch's, a segment's — is in a state's crease
 * pattern, by the same rule as a crease: the instruction when the step on
 * show made it (or the previewed fold would), by its letter; otherwise a
 * flat crease remembering its letter, as the precrease of part of its line
 * it is — never folded, and sent to Edit as an auxiliary line. Left out with
 * Precreases off, as every flat crease is.
 */
export function foldPaneMark(
  mark: FoldSceneCreaseMark,
  options: FoldPaneCreaseOptions
): Extract<FoldPaneCrease, { as: 'instruction' | 'flat' }> | null {
  const { display, step, instruction } = options;
  // A previewed fold's marks are the landed state's newest, whatever the switch.
  const instructs = instruction ? mark.made_at === step : display.stepCreases && madeByStep(mark.made_at, options);
  if (instructs) return { as: 'instruction', letter: mark.letter };
  return display.precreases ? { as: 'flat', letter: mark.letter } : null;
}

/** What a crease is drawn as in the paper picture of a crease pattern, or null when it is left out. */
export function creaseRole(crease: FoldSceneCrease, options: FoldPaneCreaseOptions): PaperLineRole | null {
  return paneCreaseRole(foldPaneCrease(crease, options));
}

function paneCreaseRole(shown: FoldPaneCrease | null): PaperLineRole | null {
  if (!shown) return null;
  switch (shown.as) {
    case 'edge':
      return 'edge';
    case 'instruction':
      return diagramRole(shown.letter);
    case 'flat':
      return 'aux';
    case 'fold':
      return shown.letter;
  }
}

export interface CreasePatternPaperOptions extends Omit<FoldPaneCreaseOptions, 'instruction'> {
  /** The sheet's outline, counter-clockwise, in sheet coordinates (`FoldStateSummary.sheet`). */
  sheet: readonly (readonly [number, number])[];
  /**
   * The creases a previewed fold would add (its step summary's `diff.added`,
   * by the landed state's edge ids): drawn as the instruction in place of the
   * step's own. Null when nothing is previewed.
   */
  instruction?: ReadonlySet<number> | null;
  /**
   * Where the sheet goes: a map from sheet coordinates to scene px, and how
   * many scene px the sheet's longer side is. User space by default
   * (`foldUnitToScenePx`); a Diagram step places it at the capture scale.
   */
  place?: { toScenePx: (point: Point) => ScenePoint; sheetPx: number };
  /** The paper's colour: the front's, or the back's (a Diagram step's Front | Back). The front by default. */
  side?: 'front' | 'back';
}

/**
 * The crease pattern of a state as paper, in the user's style — what a
 * Diagram step keeps of a Fold step (`foldStepPicture`): the sheet front up,
 * filled with the front's paper — or, asked, the back's, nothing else
 * changed — and its creases in their pens, the instruction in the
 * diagram-crease pens, the border over them so a crease that ends on the
 * edge never breaks the outline (`diagramToPaperScene`'s order). The canvas's
 * crease-pattern pane keeps the instruction on a separate renderer channel
 * (`creasePatternPaneLines`).
 */
export function creasePatternPaperScene(scene: FoldScene, options: CreasePatternPaperOptions): PaperScene {
  const { display, step, since } = options;
  const instruction = options.instruction ?? null;
  const shown: FoldPaneCreaseOptions = { display, step, instruction, ...(since !== undefined ? { since } : {}) };
  const toScenePx = options.place?.toScenePx ?? foldUnitToScenePx;
  const ring: ScenePoint[] = options.sheet.map(([x, y]) => toScenePx({ x, y }));
  const side = options.side ?? 'front';
  const items: PaperItem[] = [{ kind: 'face', face: 0, side, rings: [ring], shade: 1, hidden: false }];
  const border: PaperLineItem[] = [];
  const aux: PaperLineItem[] = [];
  const folds: PaperLineItem[] = [];
  const roles = scene.creases.map((crease) => creaseRole(crease, shown));
  const runs = sheetCreaseRuns(scene.creases, roles, options.sheet);
  scene.creases.forEach((crease, k) => {
    const role = roles[k];
    if (!role) return;
    const item = lineItem(role, crease.from, crease.to, 0, ORIGIN, toScenePx);
    if (role === 'edge') border.push(item);
    else if (role === 'aux') aux.push({ ...item, ...runEnds(item.a, item.b, runs[k]!) });
    else folds.push(item);
  });
  // The crease marks, in the aux pen as the flat creases they are, or the instruction they are.
  for (const mark of scene.crease_marks ?? []) {
    const role = paneCreaseRole(foldPaneMark(mark, shown));
    if (!role) continue;
    const item = lineItem(role, mark.from, mark.to, 0, ORIGIN, toScenePx);
    if (role === 'aux') aux.push({ ...item, onBoundary: onSheetEnds(mark, options.sheet) });
    else folds.push(item);
  }
  // Context under the folds, the instruction's dashes over both.
  items.push(...aux, ...folds.filter((item) => !isDiagram(item)), ...folds.filter(isDiagram), ...border);
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  return {
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    sheet: options.place?.sheetPx ?? FOLD_USER_PER_UNIT,
    items,
  };
}

function isDiagram(item: PaperLineItem): boolean {
  return item.role === 'diagram-mountain' || item.role === 'diagram-valley';
}

/** How far off a line, in sheet units, a point still lies on it: the engine's points are exact to far better. */
const ON_LINE = 1e-9;

/** Which ends of an aux crease lie on the sheet's edge, where erode pulls them back. */
function onSheetEnds(crease: { from: Point; to: Point }, sheet: readonly (readonly [number, number])[]): [boolean, boolean] {
  return [onSheetEdge(crease.from, sheet), onSheetEdge(crease.to, sheet)];
}

function onSheetEdge(point: Point, sheet: readonly (readonly [number, number])[]): boolean {
  return sheet.some((corner, k) => {
    const next = sheet[(k + 1) % sheet.length]!;
    const a = toPoint(corner);
    const b = toPoint(next);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) return false;
    const cross = ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / length;
    return Math.abs(cross) < ON_LINE;
  });
}

/**
 * Per crease of a crease pattern, the run of flat creases it is a piece of,
 * for each drawn in the aux pen; null for the rest. The pattern's creases are
 * cut at every vertex, but erode pulls back the crease — one straight line
 * from end to end, through every crossing, as References draws it — and only
 * where it meets the sheet's edge (`onSheetEnds`), so a piece between the
 * edge and a crossing keeps what the pull leaves of it.
 */
function sheetCreaseRuns(
  creases: readonly FoldSceneCrease[],
  roles: readonly (PaperLineRole | null)[],
  sheet: readonly (readonly [number, number])[]
): (CreaseRun | null)[] {
  const at = new Map<number, Point>();
  for (const { vertices, from, to } of creases) {
    at.set(vertices[0], from);
    at.set(vertices[1], to);
  }
  const edges = creases.map(({ vertices: [u, v], from, to }, k) => ({ u, v, from, to, joins: roles[k] === 'aux' }));
  return creaseRuns(edges, (vertex) => onSheetEdge(at.get(vertex)!, sheet), ON_LINE);
}
