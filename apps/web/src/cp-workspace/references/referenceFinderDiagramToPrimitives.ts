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
import { foldAndUnfoldFromArc, type FoldUnfoldArrow } from './stepDiagramGeometry';

export type DiagramLineStyleName =
  | 'crease'
  | 'edge'
  | 'highlight'
  | 'valley'
  | 'mountain'
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
   * The path the paper takes over a crease and back — one stroke out, one
   * back, one head. See {@link foldAndUnfoldArrow}.
   */
  | ({ kind: 'fold-arrow' } & FoldUnfoldArrow)
  /** The turn-over glyph, centred on `at` and `size` wide in sheet units. */
  | { kind: 'turn-over'; at: readonly [number, number]; size: number }
  | { kind: 'point'; at: readonly [number, number]; style: DiagramPointStyleName }
  | { kind: 'label'; at: readonly [number, number]; text: string; style: DiagramPointStyleName };

export interface StepDiagramModel {
  sheet: { width: number; height: number };
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

const LINE_STYLE_NAMES: readonly DiagramLineStyleName[] = [
  'crease',
  'edge',
  'highlight',
  'valley',
  'mountain',
  'arrow',
  'dotted',
  'pinch',
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
        const arrow = style === 'arrow' && sheet ? foldAndUnfoldFromArc(arc, sheet) : null;
        primitives.push(arrow ? { kind: 'fold-arrow', ...arrow } : { kind: 'arc', ...arc, style });
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
function finalMarkDiagram(raw: RawSolution): Diagram | null {
  return raw.diagrams[raw.diagrams.length - 1] ?? null;
}

/**
 * The diagram to show for step `index`.
 *
 * A line step has its own. A mark step has none (`extractor.ts`), so it borrows
 * the diagram of the next line step — which highlights that mark as an input —
 * or, for a final mark, the trailing standalone diagram the core prints for a
 * point query. Null when the solution has no diagram to offer.
 */
export function stepDiagram(
  raw: RawSolution,
  solution: ExtractedSolution,
  index: number
): Diagram | null {
  const step = solution.steps[index];
  if (!step) return null;
  if (step.diagramIndex !== null) return raw.diagrams[step.diagramIndex] ?? null;
  for (let i = index + 1; i < solution.steps.length; i += 1) {
    const later = solution.steps[i].diagramIndex;
    if (later !== null) return raw.diagrams[later] ?? null;
  }
  // Only reachable for a point solution: `resolveLineTarget` refuses a line
  // solution whose last step is not a line step, so the scan above always finds
  // one there.
  return finalMarkDiagram(raw);
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
