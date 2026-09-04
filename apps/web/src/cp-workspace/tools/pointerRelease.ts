/**
 * Pointer-release routing for the CP canvas: given the gesture flags a press left
 * behind, which handler owns this `pointerup` / `pointercancel`?
 *
 * This lived as an if/else chain inside the canvas' pointer effect, where each
 * tool-mode branch had to remember to exclude the gestures that override it. One
 * did not: the Angle Restricted Line branch matched on `!panning` alone, so a
 * right-button erase started while that tool was active never reached the erase
 * handler. The box never committed, and — because the branch that clears
 * `erasing` was the one being skipped — the flag stayed set for the life of the
 * canvas, feeding every later drag to a stale erase runtime.
 *
 * Routing is a pure function here so the precedence rule is stated once and
 * checked by tests over *every* tool mode, rather than re-derived per branch.
 */
import type { ToolInputMode } from './registry';

/**
 * Draw modes the canvas routes: the drag engines, the click-based persistent
 * `sequence` mode (every step collects a point), `line-entity` (each click picks
 * an existing crease by id and commits line ids), and `lengthen` (drag a
 * selection line to pick the crease(s) to extend, then click the target).
 */
export type ActiveToolMode =
  | ToolInputMode
  | 'sequence'
  | 'line-entity'
  | 'lengthen'
  // Angle Restricted Line (DrawCreaseAngleRestricted5): press-drag-release like the
  // Line tool, but the endpoint is angle-system-snapped (kernel-previewed live).
  | 'angle-drag'
  // Text annotation tool: existing texts are selected/dragged via the DOM overlay
  // (it owns the real glyph bounds); the canvas only reports an empty-space click's
  // model point so the panel can start an inline-edit draft there.
  | 'text';

/**
 * Every mode, as data. Typed as a total `Record`, so adding a member to
 * {@link ActiveToolMode} without listing it here fails typecheck — which is what
 * keeps the exhaustive precedence tests in `pointerRelease.test.ts` honest as new
 * tools land.
 */
const ALL_MODES: Record<ActiveToolMode, true> = {
  'drag-line': true,
  'drag-box': true,
  'drag-path': true,
  'drag-vertex': true,
  sequence: true,
  'line-entity': true,
  lengthen: true,
  'angle-drag': true,
  text: true,
};

export const CP_ACTIVE_TOOL_MODES = Object.keys(ALL_MODES) as readonly ActiveToolMode[];

/**
 * Which modes resolve the cursor onto a grid point / vertex before feeding the draw
 * engine — and which must therefore do so on *every* phase.
 *
 * Their engines' click-vs-drag test measures the release against the start, so a
 * phase left unsnapped makes the snap displacement itself read as pointer travel:
 * Angle Restricted Line snapped only its press, and a stationary click near a vertex
 * committed a crease from the vertex to the cursor. Stated once here, over the mode
 * vocabulary, so a new draw mode has to answer the question rather than inherit the
 * omission.
 *
 * Selection / erase boxes and freehand paths follow the raw cursor instead, so a
 * rubber-band select doesn't jump to nearby points.
 */
export function toolModeSnapsDrawPoint(mode: ActiveToolMode | null): boolean {
  return mode === 'drag-line' || mode === 'angle-drag' || mode === 'drag-vertex';
}

/**
 * Which modes park a start point *between* gestures, and therefore share one
 * persistent `dragLineTool` runtime rather than opening a fresh engine per press.
 *
 * This was the same list as {@link toolModeSnapsDrawPoint} until Move Vertex, and
 * the two questions only looked identical: that tool snaps its destination like a
 * draw tool but has no click-to-place arming, so answering the snapping question
 * for it would also have handed it the *drag-line engine* through `drawRuntime` and
 * had it draw creases. One predicate per question.
 */
export function toolModeArmsDrawStart(mode: ActiveToolMode | null): boolean {
  return mode === 'drag-line' || mode === 'angle-drag';
}

/** Which handler a release belongs to. `'none'` ends the gesture with no action. */
export type CpReleaseRoute =
  | 'erase'
  | 'sequence-drag-commit'
  | 'lengthen'
  | 'angle-drag'
  | 'text'
  | 'draw'
  | 'move-selection'
  | 'select'
  | 'none';

/** The gesture flags a press left behind, read at release time. */
export interface CpReleaseState {
  toolMode: ActiveToolMode | null;
  /** A right-button erase gesture is in flight (set on press, button 2). */
  erasing: boolean;
  /** Middle-button / accel / hand-tool pan is in flight. */
  panning: boolean;
  /** A drag-engine draw is in flight. */
  drawing: boolean;
  /** A press on an already-selected crease is translating the selection. */
  movingSelection: boolean;
  /** A plain press with no tool active: click-select or marquee. */
  selecting: boolean;
  /** The pointer travelled past the click threshold since the press. */
  moved: boolean;
  /** The release arrived as `pointercancel` rather than `pointerup`. */
  cancelled: boolean;
  /** Point count of the active sequence tool's transform, when it has one. */
  transformPointCount: number | null;
  /** Index of the sequence step currently awaiting input. */
  sequenceStep: number;
}

/**
 * Resolve the owning handler. Precedence, highest first:
 *
 * 1. **Erase.** The right button overrides whatever tool is active — the press
 *    handler cancels that tool's in-progress state to claim the gesture — so its
 *    release must reach the erase handler unconditionally. Testing this first
 *    makes the rule structural: a tool mode added below cannot forget to exclude
 *    an in-flight erase, because it never gets the chance to match.
 * 2. **Tool-mode releases**, when not panning. A pan claims the gesture the same
 *    way the right button does, and the tool declines it.
 * 3. **The plain-canvas gestures** (draw / move / select) the press started.
 */
export function cpPointerReleaseRoute(state: CpReleaseState): CpReleaseRoute {
  if (state.erasing) return 'erase';
  if (!state.panning) {
    // Oriedita's two-point move/copy are press-drag-release, not click-click
    // (BaseMouseHandlerLineTransform commits on mouseReleased): a release after a
    // drag places the destination point, so both gestures work.
    if (
      state.toolMode === 'sequence' &&
      state.transformPointCount === 2 &&
      state.sequenceStep === 1 &&
      state.moved &&
      !state.cancelled
    ) {
      return 'sequence-drag-commit';
    }
    if (state.toolMode === 'lengthen') return 'lengthen';
    if (state.toolMode === 'angle-drag') return 'angle-drag';
    if (state.toolMode === 'text') return 'text';
  }
  if (state.drawing) return 'draw';
  if (state.movingSelection) return 'move-selection';
  if (state.selecting) return 'select';
  return 'none';
}
