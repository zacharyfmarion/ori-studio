/**
 * A hand-built `PrecreaseSequence` for the tests that read one.
 *
 * Small enough to check by eye and shaped like a real plan: a landmark fold
 * that the pinch pass reduced to two spans, two CP rounds, one of them a group
 * of three parallel creases, and a finding the plan could not construct. The
 * crate's own tests cover the planner; these cover what the workspace does
 * with its answer, so the numbers only have to be consistent, not optimal.
 *
 * Test-only: nothing outside `*.test.ts` imports this.
 */
import type {
  PrecreaseDirection,
  PrecreaseGridStepLine,
  PrecreasePlanSegment,
  PrecreaseSequence,
  PrecreaseStep,
  PrecreaseWitness,
} from '../precreaseSequence';

const HORIZONTAL: [number, number] = [0, 1];
const VERTICAL: [number, number] = [1, 0];

function witness(
  axiom: number,
  inputs: PrecreaseWitness['inputs'],
  overrides: Partial<PrecreaseWitness> = {}
): PrecreaseWitness {
  return {
    axiom,
    inputs,
    root: 0,
    who_moves: [0],
    hard: false,
    visible: true,
    skinny: false,
    ease: 0,
    err: 0,
    ...overrides,
  };
}

function step(partial: Partial<PrecreaseStep> & Pick<PrecreaseStep, 'id' | 'line_id'>): PrecreaseStep {
  return {
    kind: 'cp',
    tag: 'cp',
    line: { n: VERTICAL, d: 0.5 },
    segment: [
      [0.5, 0],
      [0.5, 1],
    ],
    extent: { kind: 'full' },
    witnesses: [],
    chosen: null,
    ease: 0,
    hard: false,
    err: 0,
    // Deliberately the neutral value, so a test about mountain or valley ink
    // has to say which it means rather than inheriting a default that happens
    // to match.
    direction: 'unassigned',
    direction_share: 0,
    side: 'front',
    unlocks: [],
    cp_line_ids: [],
    cp_spans: [],
    visible: false,
    witnesses_complete: true,
    marks_exist: true,
    missing_marks: [],
    exact: true,
    pressed_on: [],
    made: [],
    impractical: false,
    hoisted: false,
    ...partial,
  };
}

/**
 * Ids in this fixture: state lines 0–3 are the sheet edges (left, right,
 * bottom, top), 4 is the landmark, 5–7 the CP creases. State points 0–3 are
 * the corners.
 */
export function plannerSequenceFixture(): PrecreaseSequence {
  const cornerRefs: PrecreaseWitness['inputs'] = [
    { kind: 'corner', id: 0, corner: 'sw' },
    { kind: 'corner', id: 1, corner: 'se' },
  ];
  const steps: PrecreaseStep[] = [
    // A landmark, pinched at the two marks later steps consume.
    step({
      id: 1,
      line_id: 4,
      kind: 'aux',
      tag: 'aux',
      line: { n: HORIZONTAL, d: 0.5 },
      segment: [
        [0, 0.5],
        [1, 0.5],
      ],
      extent: {
        kind: 'pinches',
        spans: [
          [
            [0, 0.5],
            [0.06, 0.5],
          ],
          [
            [0.94, 0.5],
            [1, 0.5],
          ],
        ],
      },
      witnesses: [witness(2, cornerRefs)],
      chosen: 0,
      unlocks: [2, 3, 4],
      visible: false,
    }),
    // Round 2: three parallel creases from the same axiom and input pattern —
    // one collapsed row with a count chip of 3.
    step({
      id: 2,
      line_id: 5,
      line: { n: VERTICAL, d: 0.25 },
      segment: [
        [0.25, 0],
        [0.25, 1],
      ],
      witnesses: [witness(2, [{ kind: 'corner', id: 0, corner: 'sw' }, { kind: 'point', id: 4 }])],
      chosen: 0,
      cp_line_ids: [1],
    }),
    step({
      id: 3,
      line_id: 6,
      line: { n: VERTICAL, d: 0.5 },
      segment: [
        [0.5, 0],
        [0.5, 1],
      ],
      witnesses: [witness(2, [{ kind: 'corner', id: 0, corner: 'sw' }, { kind: 'point', id: 4 }])],
      chosen: 0,
      cp_line_ids: [2, 3],
    }),
    step({
      id: 4,
      line_id: 7,
      line: { n: VERTICAL, d: 0.75 },
      segment: [
        [0.75, 0],
        [0.75, 1],
      ],
      witnesses: [witness(2, [{ kind: 'corner', id: 0, corner: 'sw' }, { kind: 'point', id: 4 }])],
      chosen: 0,
      cp_line_ids: [4],
    }),
    // Round 3: one crease made against the left edge and the landmark.
    step({
      id: 5,
      line_id: 8,
      line: { n: HORIZONTAL, d: 0.25 },
      segment: [
        [0, 0.25],
        [1, 0.25],
      ],
      witnesses: [
        witness(3, [
          { kind: 'edge', id: 2, side: 'bottom' },
          { kind: 'line', id: 4 },
        ]),
      ],
      chosen: 0,
      cp_line_ids: [5],
    }),
  ];

  return {
    status: 'partial_unsolved',
    certification: 'best_found_to_depth_2',
    sheet: { width: 1, height: 1 },
    landmarks_first: false,
    steps,
    groups: [
      {
        kind: 'aux',
        side: 'front',
        direction_angle: Math.PI / 2,
        axiom: 2,
        pattern: 'O2:cc',
        step_ids: [1],
        count: 1,
      },
      {
        kind: 'cp',
        side: 'front',
        direction_angle: 0,
        axiom: 2,
        pattern: 'O2:cp',
        step_ids: [2, 3, 4],
        count: 3,
      },
      {
        kind: 'cp',
        side: 'front',
        direction_angle: Math.PI / 2,
        axiom: 3,
        pattern: 'O3:el',
        step_ids: [5],
        count: 1,
      },
    ],
    totals: {
      folds: 5,
      cp_lines: 4,
      aux: 1,
      visible_aux: 0,
      grid_lines: 0,
      grid_cp_lines: 0,
      grid_unwanted_length: 0,
      lower_bound: 4,
      free_lines: 2,
      unsolved: 1,
      approximate: 0,
    },
    findings: [
      {
        line: { n: [0.6, 0.8], d: 0.3 },
        segment: [
          [0, 0.375],
          [0.625, 0],
        ],
        cp_line_ids: [6],
        reason: 'unsolved',
        facts: {
          points_on: 1,
          perpendiculars: 0,
          o2_pairs: 0,
          o3_pairs: 0,
          landers: 0,
          landers_computed: true,
        },
      },
    ],
    points: [
      { id: 0, p: [0, 0], lines: [0, 2], on_boundary: true },
      { id: 1, p: [1, 0], lines: [1, 2], on_boundary: true },
      { id: 4, p: [0, 0.5], lines: [0, 4], on_boundary: true },
    ],
    lines: [
      { id: 0, tag: 'edge', step: null },
      { id: 1, tag: 'edge', step: null },
      { id: 2, tag: 'edge', step: null },
      { id: 3, tag: 'edge', step: null },
      { id: 4, tag: 'aux', step: 1 },
      { id: 5, tag: 'cp', step: 2 },
      { id: 6, tag: 'cp', step: 3 },
      { id: 7, tag: 'cp', step: 4 },
      { id: 8, tag: 'cp', step: 5 },
    ],
    exactness: {
      class: 'exact',
      family: null,
      max_displacement_unit: 0,
      max_displacement_model: 0,
      off_lattice_lines: 0,
      off_lattice_vertices: 0,
    },
    diagnostics: {
      closure: { rounds: 3, tier1_sweeps: 3, tier2_sweeps: 1, target_evaluations: 40 },
      stuck_events: 1,
      candidates_evaluated: 30,
      closures_run: 4,
      points: 12,
      lines: 9,
      elapsed_ms: 12,
      budget_hit: false,
      point_cap_hit: false,
      max_depth_searched: 2,
      search_exhausted: true,
      witnesses_incomplete_steps: 0,
      rf_lines_folded: 0,
    },
  };
}

/**
 * One line of an axis-aligned grid family, creased edge to edge across the
 * unit sheet: `x = d` for the vertical family, `y = d` for the horizontal.
 */
function gridLine(
  lineId: number,
  normal: [number, number],
  d: number,
  index: number,
  direction: PrecreaseDirection,
  pattern: { ids: number[]; spans: PrecreasePlanSegment[]; direction: PrecreaseDirection } | null
): PrecreaseGridStepLine {
  const segment: PrecreasePlanSegment =
    normal[0] !== 0
      ? [
          [d, 0],
          [d, 1],
        ]
      : [
          [0, d],
          [1, d],
        ];
  return {
    line_id: lineId,
    line: { n: normal, d },
    segment,
    spans: [],
    index,
    direction,
    pattern_direction: pattern?.direction ?? 'unassigned',
    pattern_share: pattern ? 1 : 0,
    cp_line_ids: pattern?.ids ?? [],
    cp_spans: pattern?.spans ?? [],
  };
}

/** A grid step over `lines`, shaped as the crate builds one (`planner.rs`, `grid_steps`). */
function gridStep(
  id: number,
  family: number,
  normal: [number, number],
  lines: PrecreaseGridStepLine[]
): PrecreaseStep {
  const first = lines[0]!;
  return step({
    id,
    kind: 'grid',
    tag: 'grid',
    line: first.line,
    line_id: first.line_id,
    segment: first.segment,
    visible: true,
    cp_line_ids: lines.flatMap((line) => line.cp_line_ids),
    cp_spans: lines.flatMap((line) => line.cp_spans),
    grid: {
      kind: 'box',
      family,
      n: 4,
      normal,
      spacing: 0.25,
      cells: 4,
      level: 4,
      pleat: true,
      regions: [],
      lines,
      in_pattern: lines.filter((line) => line.cp_line_ids.length > 0).length,
      reversed: lines.filter(
        (line) => line.pattern_direction !== 'unassigned' && line.pattern_direction !== line.direction
      ).length,
    },
  });
}

/**
 * A box-pleated plan that opens with its grid: a 4-grid on the unit sheet,
 * two families of three interior lines each, then one fold sighted from a
 * grid line that is not its family's first.
 *
 * Ids: state lines 0–3 are the sheet edges, 4–6 the vertical family (x = ¼,
 * ½, ¾), 7–9 the horizontal (y = ¼, ½, ¾), 10 the diagonal. The pattern
 * contains x = ¼, x = ½ (cut in two at the middle) and y = ½ — and wants
 * y = ½ the other way from the pleat. The remaining three lines are the
 * grid's own. Apart from `plannerSequenceFixture`, whose counts other tests
 * pin.
 */
export function plannerSequenceWithGridFixture(): PrecreaseSequence {
  const vertical = [
    gridLine(4, VERTICAL, 0.25, 1, 'mountain', {
      ids: [1],
      spans: [
        [
          [0.25, 0],
          [0.25, 1],
        ],
      ],
      direction: 'mountain',
    }),
    gridLine(5, VERTICAL, 0.5, 2, 'valley', {
      ids: [2, 3],
      spans: [
        [
          [0.5, 0],
          [0.5, 0.5],
        ],
        [
          [0.5, 0.5],
          [0.5, 1],
        ],
      ],
      direction: 'valley',
    }),
    gridLine(6, VERTICAL, 0.75, 3, 'mountain', null),
  ];
  const horizontal = [
    gridLine(7, HORIZONTAL, 0.25, 1, 'mountain', null),
    gridLine(8, HORIZONTAL, 0.5, 2, 'valley', {
      ids: [4],
      spans: [
        [
          [0, 0.5],
          [1, 0.5],
        ],
      ],
      direction: 'mountain',
    }),
    gridLine(9, HORIZONTAL, 0.75, 3, 'mountain', null),
  ];
  const steps: PrecreaseStep[] = [
    gridStep(1, 0, VERTICAL, vertical),
    gridStep(2, 1, HORIZONTAL, horizontal),
    // The left edge folded onto y = ½ — the horizontal family's second line —
    // along the bisector from (0, ½) to (½, 1).
    step({
      id: 3,
      line_id: 10,
      line: { n: [Math.SQRT1_2, -Math.SQRT1_2], d: -0.5 * Math.SQRT1_2 },
      segment: [
        [0, 0.5],
        [0.5, 1],
      ],
      witnesses: [
        witness(3, [
          { kind: 'edge', id: 0, side: 'left' },
          { kind: 'line', id: 8 },
        ]),
      ],
      chosen: 0,
      direction: 'valley',
      direction_share: 1,
      cp_line_ids: [5],
      cp_spans: [
        [
          [0, 0.5],
          [0.5, 1],
        ],
      ],
    }),
  ];

  return {
    status: 'complete',
    certification: 'best_found_to_depth_2',
    sheet: { width: 1, height: 1 },
    landmarks_first: false,
    grid: { kind: 'box', n: 4, families: 2, steps: 2, lines: 6, cp_lines: 3 },
    steps,
    groups: [
      {
        kind: 'grid',
        side: 'front',
        direction_angle: 0,
        axiom: 0,
        pattern: 'grid',
        step_ids: [1],
        count: 1,
      },
      {
        kind: 'grid',
        side: 'front',
        direction_angle: Math.PI / 2,
        axiom: 0,
        pattern: 'grid',
        step_ids: [2],
        count: 1,
      },
      {
        kind: 'cp',
        side: 'front',
        direction_angle: Math.PI / 4,
        axiom: 3,
        pattern: 'O3:el',
        step_ids: [3],
        count: 1,
      },
    ],
    totals: {
      folds: 7,
      cp_lines: 4,
      aux: 0,
      visible_aux: 0,
      grid_lines: 6,
      grid_cp_lines: 3,
      grid_unwanted_length: 0,
      lower_bound: 4,
      free_lines: 0,
      unsolved: 0,
      approximate: 0,
    },
    findings: [],
    points: [
      { id: 0, p: [0, 0], lines: [0, 2], on_boundary: true },
      { id: 1, p: [1, 0], lines: [1, 2], on_boundary: true },
      { id: 4, p: [0.5, 0.5], lines: [5, 8], on_boundary: false },
    ],
    lines: [
      { id: 0, tag: 'edge', step: null },
      { id: 1, tag: 'edge', step: null },
      { id: 2, tag: 'edge', step: null },
      { id: 3, tag: 'edge', step: null },
      { id: 4, tag: 'cp', step: 1 },
      { id: 5, tag: 'cp', step: 1 },
      { id: 6, tag: 'grid', step: 1 },
      { id: 7, tag: 'grid', step: 2 },
      { id: 8, tag: 'cp', step: 2 },
      { id: 9, tag: 'grid', step: 2 },
      { id: 10, tag: 'cp', step: 3 },
    ],
    exactness: {
      class: 'exact',
      family: null,
      max_displacement_unit: 0,
      max_displacement_model: 0,
      off_lattice_lines: 0,
      off_lattice_vertices: 0,
    },
    diagnostics: {
      closure: { rounds: 1, tier1_sweeps: 1, tier2_sweeps: 0, target_evaluations: 4 },
      stuck_events: 0,
      candidates_evaluated: 0,
      closures_run: 1,
      points: 20,
      lines: 11,
      elapsed_ms: 3,
      budget_hit: false,
      point_cap_hit: false,
      max_depth_searched: 0,
      search_exhausted: true,
      witnesses_incomplete_steps: 0,
      rf_lines_folded: 0,
    },
  };
}
