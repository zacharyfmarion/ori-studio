/**
 * ReferenceFinder's diagram elements as the primitives `StepDiagram` draws.
 *
 * The core's `JsonStreamDgmr` emits five element types — `0` point, `1` line,
 * `2` arc, `3` the sheet, `4` label — with numeric style codes from
 * `RefDgmr::LineStyle` / `PointStyle` (`solution.ts`). This maps every code to
 * a name the SVG turns into a CSS class; the picture's colours are then theme
 * tokens, never values carried here. An element or style outside the enum is a
 * wire-shape change and is refused with a typed error rather than drawn as
 * something nearby.
 *
 * Also here: which of a solution's diagrams to show for a step or a card,
 * because the answer depends on the extractor's diagram-indexing rules.
 */
import type { ExtractedSolution } from './referenceFinder/extractor';
import type { Diagram, RawSolution } from './referenceFinder/solution';
import type { DiagramWhiteArrowFill, DiagramWhiteArrowWidth } from './diagram/diagramInk';
import type {
  DiagramArc,
  DiagramCubic,
  DiagramSheet,
  HiddenStretches,
  PathArrowFold,
  WhiteArrowTail,
} from './stepDiagramGeometry';

export type DiagramLineStyleName =
  /** A crease an earlier step made: the paper as it stands. */
  | 'crease'
  /**
   * One of the pattern's own auxiliary lines — ours, never on the RF wire. The
   * same pen and ink as `crease`; its own name because whether it is drawn is
   * the References "Show auxiliary creases" option's, while the creases an
   * earlier step made are always on the paper.
   */
  | 'aux'
  | 'edge'
  | 'highlight'
  /**
   * The step's own fold, as an instruction: fold here, this way. Drawn in the
   * paper style's diagram-crease pens, as are the pinches in a direction.
   */
  | 'valley'
  | 'mountain'
  /**
   * A line of the finished crease pattern — ours, never on the RF wire. The
   * finished card is the pattern rather than a step, so its creases take the
   * fold pens a crease pattern is drawn in, not the diagram-crease pens of an
   * instruction.
   */
  | 'fold-valley'
  | 'fold-mountain'
  | 'arrow'
  | 'dotted'
  | 'pinch'
  /** A pinch in a known direction — ours; the wire's `pinch` carries none. */
  | 'pinch-mountain'
  | 'pinch-valley'
  /** The rest of a fold that is not creased — ours, never on the RF wire. */
  | 'unfolded';

export type DiagramPointStyleName = 'normal' | 'highlight' | 'action';

export type StepDiagramPrimitive =
  | { kind: 'sheet'; width: number; height: number }
  | {
      kind: 'line';
      from: readonly [number, number];
      to: readonly [number, number];
      style: DiagramLineStyleName;
      /**
       * Where this piece starts along its line's own axis, in sheet units.
       *
       * A crease drawn as several pieces restarts its dash at each one, which
       * is a row of unrelated dashes rather than a dashed line. Set from
       * `dashRulerAlong` so every piece of one line measures from the same
       * zero. Omitted leaves the pattern starting at `from`, which is right for
       * a line drawn whole.
       */
      dashPhase?: number;
    }
  | {
      kind: 'arc';
      center: readonly [number, number];
      radius: number;
      from: number;
      to: number;
      ccw: boolean;
      style: DiagramLineStyleName;
    }
  /**
   * The path the paper takes over a crease and back.
   *
   * Only the outgoing arc: the return that makes it a round trip is the *same*
   * arc bulged further and stopped beside the mark, and how far beside is a
   * length of the drawing's (`foldReturnOffset`) — which a card measures
   * against the paper and a camera view against the pen. So it is derived where
   * the picture is drawn, and this stays the one thing both surfaces agree on.
   */
  | { kind: 'fold-arrow'; out: DiagramArc; hidden?: HiddenStretches }
  /**
   * A fold that is made and kept: the paper goes over along `out` and stays.
   * The head says which way (Yoshizawa–Randlett): a valley fold's is the
   * fold-and-unfold arrow's filled head, a mountain fold's one-sided and
   * hollow. Its size is the drawing's, as the fold arrow's is.
   */
  | { kind: 'one-way-arrow'; out: DiagramArc; fold: 'valley' | 'mountain'; hidden?: HiddenStretches }
  /**
   * A fold arrow shaped by hand rather than an arc: its path, tail first, and
   * which fold it says — a valley's or a mountain's head, as a one-way arrow
   * has, or out and back with the fold-and-unfold arrow's return, which is
   * derived from the path where it is drawn (`pathArrowGeometry`). Its head
   * and return are the drawing's size, as the arc arrows' are.
   */
  | { kind: 'path-arrow'; path: readonly DiagramCubic[]; fold: PathArrowFold; hidden?: HiddenStretches }
  /**
   * Push here — a squash, a sink, a reverse fold's push: a straight hollow
   * arrow with a cleft tail, from `from` to its tip at `to`. Its width is the
   * drawing's.
   */
  | { kind: 'push-arrow'; from: readonly [number, number]; to: readonly [number, number] }
  /**
   * Crimp or pleat here (Phase 15c): a straight arrow from `from` to its tip
   * at `to`, its shaft a lightning bolt with `kinks` Zs, which step to the
   * right of the way it points on the paper or, `mirrored`, to the left, and
   * the valley arrow's head. Its Zs are the drawing's size, as a push arrow's
   * outline is.
   */
  | {
      kind: 'pleat-arrow';
      from: readonly [number, number];
      to: readonly [number, number];
      kinks: number;
      mirrored: boolean;
      hidden?: HiddenStretches;
    }
  /**
   * A white arrow (Phase 14f): a hollow band along a path, tail first, with a
   * straight-backed head at its tip and a tail drawn to a point, cut square or
   * cleft (`whiteArrowOutline`), filled with the ground — or, a solid arrow
   * (15d), with the arrow's ink — and outlined in the arrow's pen. Its width
   * is one of three print sizes, in the drawing's ink, as a push arrow's is.
   */
  | {
      kind: 'white-arrow';
      path: readonly DiagramCubic[];
      width: DiagramWhiteArrowWidth;
      tail: WhiteArrowTail;
      fill: DiagramWhiteArrowFill;
    }
  /**
   * Turn the model round in its plane, centred on `at`: a circle of two
   * arrows going the way it turns, and how far, as a fraction of a turn. Its
   * size is the drawing's, and it is drawn in screen space, as the turn-over
   * glyph is.
   */
  | {
      kind: 'rotate';
      at: readonly [number, number];
      amount: 'eighth' | 'quarter' | 'half';
      direction: 'cw' | 'ccw';
    }
  /**
   * The turn-over glyph, centred on `at`.
   *
   * Its size is the drawing's, not the model's — the same reason a fold arrow
   * carries only its outgoing arc. `axis` is the one the model turns about:
   * a vertical axis (the default, and every References step's) turns it left
   * to right and draws the glyph as it is; a horizontal one turns it top to
   * bottom and draws the glyph a quarter turn round.
   */
  | { kind: 'turn-over'; at: readonly [number, number]; axis?: 'vertical' | 'horizontal' }
  /**
   * A right angle marked at `at`: an open square in the corner, opening
   * toward `toward` — any point along the diagonal into the angle, as only
   * its direction is read. Its size is the drawing's, as a ring's is; its legs
   * mirror with the paper, square to the lines it marks.
   */
  | { kind: 'right-angle'; at: readonly [number, number]; toward: readonly [number, number] }
  /**
   * An angle marked halved (Phase 15b): an arc across the angle at `at`
   * between its two arms — a point along each, only their directions read —
   * with `ticks` across the middle of each half, as a bisector's equal angles
   * are marked. Its size is the drawing's, as a right angle's is; measured
   * after projecting, so it mirrors with the paper.
   */
  | {
      kind: 'angle-mark';
      at: readonly [number, number];
      arms: readonly [readonly [number, number], readonly [number, number]];
      ticks: 1 | 2 | 3;
    }
  /**
   * A stretch of the paper a step works in, as a light fill under the lines:
   * the band a grid step's lines are made in, between the bounds the folder
   * sights them from. A convex polygon, in sheet units.
   */
  | { kind: 'region'; corners: readonly (readonly [number, number])[] }
  | { kind: 'point'; at: readonly [number, number]; style: DiagramPointStyleName; hidden?: HiddenStretches }
  | { kind: 'label'; at: readonly [number, number]; text: string; style: DiagramPointStyleName };

export interface StepDiagramModel {
  /** The paper's size, and — off the unit frame — where its middle is and which way it lies. */
  sheet: DiagramSheet;
  /** In drawing order, the sheet first. */
  primitives: StepDiagramPrimitive[];
}

export type StepDiagramAdapterReason =
  | 'missing_sheet'
  | 'unknown_element'
  | 'unknown_line_style'
  | 'unknown_point_style'
  | 'malformed_element';

export class StepDiagramAdapterError extends Error {
  readonly code = 'step_diagram_adapter';

  constructor(
    readonly reason: StepDiagramAdapterReason,
    message: string
  ) {
    super(message);
    this.name = 'StepDiagramAdapterError';
  }
}

/**
 * `RefDgmr::LineStyle` by code. The core's pinch style is directionless, but
 * every fold ReferenceFinder makes is a valley (`refLine.cpp`,
 * `LINESTYLE_VALLEY` for the action line, `LINESTYLE_PINCH` for the same line
 * pressed only where a mark is wanted), so its pinch is a valley pinch and
 * takes the valley's ink — drawn as our own directionless `pinch` it came out
 * in the unassigned grey beside blue valleys, on the card and the canvas
 * alike.
 */
const LINE_STYLE_NAMES: readonly DiagramLineStyleName[] = [
  'crease',
  'edge',
  'highlight',
  'valley',
  'mountain',
  'arrow',
  'dotted',
  'pinch-valley',
];

const POINT_STYLE_NAMES: readonly DiagramPointStyleName[] = ['normal', 'highlight', 'action'];

function lineStyleName(code: unknown, index: number): DiagramLineStyleName {
  const name = typeof code === 'number' ? LINE_STYLE_NAMES[code] : undefined;
  if (!name) {
    throw new StepDiagramAdapterError(
      'unknown_line_style',
      `element ${index} has line style ${String(code)}`
    );
  }
  return name;
}

function pointStyleName(code: unknown, index: number): DiagramPointStyleName {
  const name = typeof code === 'number' ? POINT_STYLE_NAMES[code] : undefined;
  if (!name) {
    throw new StepDiagramAdapterError(
      'unknown_point_style',
      `element ${index} has point style ${String(code)}`
    );
  }
  return name;
}

function point(value: unknown, index: number, field: string): [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number'
  ) {
    throw new StepDiagramAdapterError(
      'malformed_element',
      `element ${index} has no [x, y] in "${field}"`
    );
  }
  return [value[0], value[1]];
}

function finite(value: unknown, index: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new StepDiagramAdapterError(
      'malformed_element',
      `element ${index} has no finite "${field}"`
    );
  }
  return value;
}

/** Map one diagram. Throws {@link StepDiagramAdapterError}; never draws a guess. */
export function referenceFinderDiagramToPrimitives(diagram: Diagram): StepDiagramModel {
  const first = diagram[0] as { type?: unknown } | undefined;
  if (!first || first.type !== 3) {
    throw new StepDiagramAdapterError(
      'missing_sheet',
      'a diagram must start with its sheet (type 3) element'
    );
  }
  const primitives: StepDiagramPrimitive[] = [];
  let sheet: { width: number; height: number } | null = null;
  diagram.forEach((element, index) => {
    const raw = element as unknown as Record<string, unknown>;
    switch (raw.type) {
      case 3: {
        const width = finite(raw.width, index, 'width');
        const height = finite(raw.height, index, 'height');
        sheet ??= { width, height };
        primitives.push({ kind: 'sheet', width, height });
        return;
      }
      case 1:
        primitives.push({
          kind: 'line',
          from: point(raw.from, index, 'from'),
          to: point(raw.to, index, 'to'),
          style: lineStyleName(raw.style, index),
        });
        return;
      case 2: {
        const arc = {
          center: point(raw.center, index, 'center'),
          radius: finite(raw.radius, index, 'radius'),
          from: finite(raw.from, index, 'from'),
          to: finite(raw.to, index, 'to'),
          // The core prints `0` / `1` for the flag; the type says boolean.
          ccw: Boolean(raw.ccw),
        };
        const style = lineStyleName(raw.style, index);
        // Upstream draws a bare arc and throws its two directions away
        // (`refDgmr.cpp:70-74, 89-90`), so its arrows carry no head at all.
        // Every fold ReferenceFinder describes is made and released, so the
        // symbol for it is the one a diagram uses for that: out and back, with
        // a single head where the paper comes to rest.
        primitives.push(
          style === 'arrow' ? { kind: 'fold-arrow', out: arc } : { kind: 'arc', ...arc, style }
        );
        return;
      }
      case 0:
        primitives.push({
          kind: 'point',
          at: point(raw.pt, index, 'pt'),
          style: pointStyleName(raw.style, index),
        });
        return;
      case 4:
        if (typeof raw.text !== 'string') {
          throw new StepDiagramAdapterError('malformed_element', `element ${index} has no label text`);
        }
        primitives.push({
          kind: 'label',
          at: point(raw.pt, index, 'pt'),
          text: raw.text,
          style: pointStyleName(raw.style, index),
        });
        return;
      default:
        throw new StepDiagramAdapterError(
          'unknown_element',
          `element ${index} has type ${String(raw.type)}`
        );
    }
  });
  if (!sheet) {
    throw new StepDiagramAdapterError('missing_sheet', 'a diagram must carry its sheet');
  }
  return { sheet, primitives };
}

/** How many of a solution's diagrams belong to line steps (the rest are trailing). */
function lineStepCount(solution: ExtractedSolution): number {
  return solution.steps.filter((step) => step.diagramIndex !== null).length;
}

/**
 * The trailing standalone diagram a point query ends on — the one that draws
 * the finished mark.
 *
 * This is the *last* diagram, not `diagrams[lineStepCount]`: `BuildDiagrams`
 * (`third_party/reference-finder/src/core/class/refBase.cpp:172-177`) pushes a
 * `DgmInfo(0, 0)` placeholder ahead of everything when the sequence contains no
 * action line at all, so a mark made only of originals (the sheet centre, whose
 * one step is the O0 intersection of the two diagonals) has
 * `[placeholder, final-mark]` and index `lineStepCount === 0` is the
 * placeholder, not the mark.
 */
export function finalMarkDiagram(raw: RawSolution): Diagram | null {
  return raw.diagrams[raw.diagrams.length - 1] ?? null;
}

/**
 * The diagram for a candidate's card: the finished construction. A point
 * query's trailing mark diagram when the core printed one, otherwise the last
 * line step's, otherwise whatever action-free diagram an original carries.
 */
export function candidateDiagram(raw: RawSolution, solution: ExtractedSolution): Diagram | null {
  if (solution.target.kind === 'point') return finalMarkDiagram(raw);
  const lines = lineStepCount(solution);
  if (lines > 0) return raw.diagrams[lines - 1] ?? null;
  return finalMarkDiagram(raw);
}
