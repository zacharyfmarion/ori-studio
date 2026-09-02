export const ORISTUDIO_CP_COMMAND_GROUPS = [
  {
    id: 'select-edit',
    label: 'Select and edit',
    railLabel: 'Select',
    order: 10,
  },
  {
    id: 'draw',
    label: 'Draw folds and points',
    railLabel: 'Draw',
    order: 20,
  },
  {
    id: 'construct',
    label: 'Construct by geometry',
    railLabel: 'Construct',
    order: 30,
  },
  {
    id: 'transform',
    label: 'Transform and operation frame',
    railLabel: 'Transform',
    order: 40,
  },
  {
    id: 'color',
    label: 'Color, assignment, and repair',
    railLabel: 'Color & Fix',
    order: 50,
  },
  {
    id: 'annotations',
    label: 'Circles, text, and annotations',
    railLabel: 'Annotate',
    order: 60,
  },
  {
    id: 'generators',
    label: 'Generators and base molecules',
    railLabel: 'Generate',
    order: 70,
  },
  {
    id: 'measure',
    label: 'Measure',
    railLabel: 'Measure',
    order: 80,
  },
  {
    id: 'check-fix',
    label: 'Check and fix',
    railLabel: 'Check',
    order: 90,
  },
  {
    id: 'folding',
    label: 'Fold estimate and folded figure',
    railLabel: 'Fold',
    order: 100,
  },
  {
    id: 'file',
    label: 'File import/export',
    railLabel: 'File',
    order: 110,
  },
  {
    id: 'advanced',
    label: 'Advanced tools',
    railLabel: 'Advanced',
    order: 900,
  },
] as const;

export type OristudioCpCommandGroupId = (typeof ORISTUDIO_CP_COMMAND_GROUPS)[number]['id'];

export type OristudioCpCommandPlacement =
  | 'left-rail'
  | 'left-rail-overflow'
  | 'menu'
  | 'palette'
  | 'hidden-ui-only';

export type OristudioCpCommandUiStatus =
  | 'not-implemented'
  | 'porting'
  | 'ready'
  | 'out-of-scope-ui';

export type OristudioCpOperationStatus =
  | 'Unsupported'
  | 'Porting'
  | 'UnitTested'
  | 'OracleTested'
  | 'DocumentedDifference'
  | 'OutOfScopeUi';

export interface OristudioCpCommandDefinition {
  id: `cp.${string}`;
  operationId: OristudioCpOperationId;
  label: string;
  group: OristudioCpCommandGroupId;
  placement: OristudioCpCommandPlacement;
  icon: string;
  upstream: string;
  tooltip: string;
  uiStatus: OristudioCpCommandUiStatus;
  disabledReason: string;
  selectionRequirement?: string;
  shortcut?: string;
  toolSteps?: readonly string[];
  inputMode?: 'point-sequence' | 'drag-path' | 'drag-line' | 'drag-box';
}

type CommandOptionKeys =
  | 'placement'
  | 'selectionRequirement'
  | 'shortcut'
  | 'toolSteps'
  | 'tooltip'
  | 'inputMode';

function notImplemented(
  operationId: OristudioCpOperationId,
  label: string,
  group: OristudioCpCommandGroupId,
  icon: string,
  upstream: string,
  options: Partial<
    Pick<OristudioCpCommandDefinition, CommandOptionKeys>
  > = {}
): OristudioCpCommandDefinition {
  return {
    id: commandId(operationId),
    operationId,
    label,
    group,
    placement: options.placement ?? 'left-rail',
    icon,
    upstream,
    tooltip: options.tooltip ?? label,
    uiStatus: 'not-implemented',
    disabledReason: 'Not implemented in the CP editor yet',
    selectionRequirement: options.selectionRequirement,
    shortcut: options.shortcut,
    toolSteps: options.toolSteps,
    inputMode: options.inputMode,
  };
}

function porting(
  operationId: OristudioCpOperationId,
  label: string,
  group: OristudioCpCommandGroupId,
  icon: string,
  upstream: string,
  options: Partial<
    Pick<OristudioCpCommandDefinition, CommandOptionKeys>
  > = {}
): OristudioCpCommandDefinition {
  return {
    ...notImplemented(operationId, label, group, icon, upstream, options),
    uiStatus: 'porting',
    disabledReason: 'Kernel port is in progress; UI wiring is not implemented yet',
  };
}

function ready(
  operationId: OristudioCpOperationId,
  label: string,
  group: OristudioCpCommandGroupId,
  icon: string,
  upstream: string,
  options: Partial<
    Pick<OristudioCpCommandDefinition, CommandOptionKeys>
  > = {}
): OristudioCpCommandDefinition {
  return {
    ...notImplemented(operationId, label, group, icon, upstream, options),
    uiStatus: 'ready',
    disabledReason: 'Ready',
  };
}

function outOfScopeUi(
  operationId: OristudioCpOperationId,
  label: string,
  group: OristudioCpCommandGroupId,
  icon: string,
  upstream: string,
  tooltip: string
): OristudioCpCommandDefinition {
  return {
    id: commandId(operationId),
    operationId,
    label,
    group,
    placement: 'hidden-ui-only',
    icon,
    upstream,
    tooltip,
    uiStatus: 'out-of-scope-ui',
    disabledReason: 'Handled by the viewport runtime instead of a CP command',
  };
}

function commandId(operationId: string): `cp.${string}` {
  return `cp.${operationId.replace(/[A-Z]/g, (letter, index) => `${index ? '-' : ''}${letter.toLowerCase()}`)}`;
}

export const ORISTUDIO_CP_COMMANDS: OristudioCpCommandDefinition[] = [
  ready('DrawCreaseFree', 'Draw crease', 'draw', 'pen-line', 'MouseHandlerDrawCreaseFree', {
    toolSteps: ['Click or drag to set the crease start', 'Click to set the crease end'],
    inputMode: 'drag-line',
    tooltip: 'Drag a crease using the current line type',
  }),
  outOfScopeUi(
    'MoveCreasePattern',
    'Pan viewport',
    'select-edit',
    'hand',
    'MouseHandlerMoveCreasePattern',
    'Covered by the landed CP viewport pan controls'
  ),
  ready(
    'LineSegmentDelete',
    'Erase crease',
    'select-edit',
    'eraser',
    'MouseHandlerLineSegmentDelete',
    {
      placement: 'left-rail',
      selectionRequirement: 'selected line segment',
      toolSteps: ['Click a crease or drag a box to erase'],
      inputMode: 'drag-box',
      tooltip: 'Click a crease or drag a box to erase creases',
    }
  ),
  ready('ChangeCreaseType', 'Change crease type', 'color', 'paintbrush', 'MouseHandlerChangeCreaseType', {
    // Not in Oriedita's UI — hide entirely (revisit at end).
    placement: 'hidden-ui-only',
    selectionRequirement: 'selected folding lines',
    tooltip: 'Advance selected folding lines through edge, mountain, and valley',
  }),
  ready('LengthenCrease', 'Lengthen crease', 'transform', 'stretch-horizontal', 'MouseHandlerLengthenCrease', {
    toolSteps: ['Select line to extend', 'Select target line'],
    tooltip: 'Extend creases crossed by the guide line to the target crease',
  }),
  ready('SquareBisector', 'Square bisector', 'construct', 'square-dashed', 'MouseHandlerSquareBisector', {
    toolSteps: [
      'Select 2 segments or 3 points',
      'Select 3 points',
      'Select 3 points',
      'Select segment to end',
    ],
  }),
  ready('Inward', 'Inward fold line', 'construct', 'corner-down-left', 'MouseHandlerInward', {
    toolSteps: ['Pick first triangle point', 'Pick second triangle point', 'Pick third triangle point'],
  }),
  ready('PerpendicularDraw', 'Perpendicular draw', 'construct', 'ruler', 'MouseHandlerPerpendicularDraw', {
    toolSteps: ['Pick target point', 'Pick base crease'],
  }),
  ready('SymmetricDraw', 'Symmetric draw', 'construct', 'flip-horizontal', 'MouseHandlerSymmetricDraw', {
    toolSteps: ['Pick source crease', 'Pick mirror crease'],
  }),
  ready('DrawCreaseRestricted', 'Draw restricted crease', 'draw', 'pen-tool', 'MouseHandlerDrawCreaseRestricted', {
    toolSteps: ['Click or drag from an existing point', 'Click another existing point'],
    inputMode: 'drag-line',
  }),
  ready('DrawCreaseSymmetric', 'Reflect selection over line', 'transform', 'flip-horizontal', 'MouseHandlerDrawCreaseSymmetric', {
    selectionRequirement: 'selected creases',
    toolSteps: ['Select 2 points or select a line', 'Pick reflection line end'],
    tooltip: 'Reflect selected creases across a line drawn with two points',
  }),
  ready('DrawCreaseAngleRestricted', 'Angle restricted crease', 'construct', 'drafting-compass', 'MouseHandlerDrawCreaseAngleRestricted', {
    toolSteps: ['Pick base crease or first point', 'Pick base end point', 'Pick convergence point'],
  }),
  ready('DrawPoint', 'Draw point', 'draw', 'circle-dot', 'MouseHandlerDrawPoint', {
    toolSteps: ['Pick point'],
  }),
  // Ori Studio native, and deliberately next to Draw point because the pair is
  // the whole distinction: Oriedita's `DRAW_POINT_14` resolves the *closest*
  // crease and divides that one, so at a crossing it splits one crease and
  // leaves the other whole. That is right for putting a reference point on a
  // crease and wrong for a junction the graph is missing, where one 4-valent
  // crossing costs four missing edges plus two extra ones and is one repair,
  // not four.
  ready(
    'VertexInsertOnCreases',
    'Insert vertex',
    'draw',
    'crosshair',
    'OriStudioVertexInsertOnCreases',
    {
      toolSteps: ['Click where the creases should meet'],
      tooltip: 'Split every crease through the clicked point so they meet at one vertex',
    }
  ),
  ready('DeletePoint', 'Delete point', 'select-edit', 'circle-x', 'MouseHandlerDeletePoint', {
    toolSteps: ['Pick vertex'],
    tooltip: 'Merge same-color creases meeting at the picked vertex',
  }),
  ready('AngleSystem', 'Angle system', 'construct', 'chart-no-axes-combined', 'MouseHandlerAngleSystem', {
    // Not present in Oriedita's UI — hide the rail button (revisit during the
    // Oriedita-parity pass at the end of the migration).
    placement: 'hidden-ui-only',
    toolSteps: ['Pick angle start point', 'Pick angle end point', 'Pick destination crease'],
  }),
  ready('DrawCreaseAngleRestricted3', 'Angle restricted 3 crease', 'construct', 'between-horizontal-start', 'MouseHandlerDrawCreaseAngleRestricted3_2', {
    // Not present in Oriedita's UI — hide the rail button (the now-empty Construct
    // section auto-drops its header). Revisit at end.
    placement: 'hidden-ui-only',
    toolSteps: ['Pick fan start point', 'Pick fan end point', 'Pick angle candidate'],
  }),
  ready('CreaseSelect', 'Select crease', 'select-edit', 'mouse-pointer-2', 'MouseHandlerCreaseSelect', {
    shortcut: 'V',
    toolSteps: ['Drag selection box'],
    inputMode: 'drag-box',
    tooltip: 'Select creases inside a dragged box',
  }),
  ready('CreaseUnselect', 'Unselect crease', 'select-edit', 'mouse-pointer-click', 'MouseHandlerCreaseUnselect', {
    toolSteps: ['Drag selection box'],
    inputMode: 'drag-box',
    tooltip: 'Unselect creases inside a dragged box',
  }),
  ready('CreaseMove', 'Move selected creases', 'transform', 'move', 'MouseHandlerCreaseMove', {
    selectionRequirement: 'selected creases',
    toolSteps: ['Pick source point', 'Pick destination point'],
  }),
  ready('CreaseCopy', 'Copy selected creases', 'transform', 'copy', 'MouseHandlerCreaseCopy', {
    selectionRequirement: 'selected creases',
    toolSteps: ['Pick source point', 'Pick destination point'],
  }),
  ready('CreaseMakeMountain', 'Make mountain', 'color', 'mountain', 'MouseHandlerCreaseMakeMountain', {
    placement: 'menu',
    selectionRequirement: 'selected lines',
    tooltip: 'Make selected lines mountain folds',
  }),
  ready('CreaseMakeValley', 'Make valley', 'color', 'waves', 'MouseHandlerCreaseMakeValley', {
    placement: 'menu',
    selectionRequirement: 'selected lines',
    tooltip: 'Make selected lines valley folds',
  }),
  ready('CreaseMakeEdge', 'Make edge', 'color', 'box-select', 'MouseHandlerCreaseMakeEdge', {
    placement: 'menu',
    selectionRequirement: 'selected lines',
    tooltip: 'Make selected lines edge folds',
  }),
  ready('CreaseSetLineColor', 'Set selected line color', 'color', 'palette', 'OriStudioSetLineColor', {
    placement: 'palette',
    selectionRequirement: 'selected lines',
    tooltip: 'Apply the active line color to selected lines',
  }),
  ready('CreaseSetFoldAngle', 'Set fold angle', 'color', 'palette', 'OriStudioSetFoldAngle', {
    placement: 'palette',
    selectionRequirement: 'selected lines',
    tooltip: 'Set how far the selected creases fold',
  }),
  // `palette`, like its sibling above: both are driven from the context panel's
  // selection controls rather than the rail, and both are worth reaching by
  // name. This one is the only way to hint a crease that is *already*
  // unassigned -- `CreaseMakeUnassigned` reads the direction off the colour it
  // is leaving, so it cannot touch one.
  ready(
    'CreaseSetDirectionHint',
    'Set fold direction hint',
    'color',
    'circle-dashed',
    'OriStudioCreaseSetDirectionHint',
    {
      placement: 'palette',
      selectionRequirement: 'selected lines',
      tooltip: 'Say which way the selected undecided creases folded',
    }
  ),
  outOfScopeUi(
    'BackgroundChangePosition',
    'Move background',
    'select-edit',
    'image',
    'MouseHandlerBackgroundChangePosition',
    'Background image manipulation is UI-only and not part of the CP kernel'
  ),
  ready('LineSegmentDivision', 'Divide line by count', 'draw', 'split', 'MouseHandlerLineSegmentDivision', {
    inputMode: 'drag-line',
    toolSteps: ['Click or drag to start the line to divide', 'Click to end the line'],
  }),
  ready('LineSegmentRatioSet', 'Divide line by ratio', 'draw', 'divide', 'MouseHandlerLineSegmentRatioSet', {
    // Merged into Divided Line, which picks between this and LineSegmentDivision
    // from its divide-mode option. Kept in the registry for parity and for the
    // upstream mouse-mode lookup; no surface of its own. See `cpToolVariants.ts`.
    placement: 'hidden-ui-only',
    inputMode: 'drag-line',
    toolSteps: ['Click or drag to start the line to divide', 'Click to end the line'],
  }),
  ready('PolygonSetNoCorners', 'Regular polygon', 'generators', 'hexagon', 'MouseHandlerPolygonSetNoCorners', {
    toolSteps: ['Pick first corner', 'Pick second corner'],
  }),
  // Ori Studio native. Regular Polygon with four corners draws one *side* from
  // two clicks; this drops a whole square of a size the tool already knows.
  ready('SquareGenerate', 'Square', 'generators', 'square', 'OriStudioSquareGenerate', {
    toolSteps: ['Click to place the square'],
    tooltip: 'Drop a square of a set size in one click',
  }),
  ready('CreaseAdvanceType', 'Advance crease type', 'color', 'list-restart', 'MouseHandlerCreaseAdvanceType', {
    // Not in Oriedita's UI — hide entirely (revisit at end).
    placement: 'hidden-ui-only',
    selectionRequirement: 'selected folding lines',
    tooltip: 'Advance selected folding lines through edge, mountain, and valley',
  }),
  ready('CreaseMove4p', 'Move by four points', 'transform', 'scan-line', 'MouseHandlerCreaseMove4p', {
    selectionRequirement: 'selected creases',
    toolSteps: [
      'Pick source first point',
      'Pick source second point',
      'Pick target first point',
      'Pick target second point',
    ],
  }),
  ready('CreaseCopy4p', 'Copy by four points', 'transform', 'scan-line', 'MouseHandlerCreaseCopy4p', {
    selectionRequirement: 'selected creases',
    toolSteps: [
      'Pick source first point',
      'Pick source second point',
      'Pick target first point',
      'Pick target second point',
    ],
  }),
  ready('FishBoneDraw', 'Fishbone draw', 'construct', 'git-branch', 'MouseHandlerFishBoneDraw', {
    toolSteps: ['Pick spine start point', 'Pick spine end point'],
  }),
  ready('CreaseMakeMv', 'Make alternating M/V', 'color', 'git-branch', 'MouseHandlerCreaseMakeMV', {
    toolSteps: ['Click or drag to start the guide line', 'Click to end the guide line'],
    inputMode: 'drag-line',
    tooltip: 'Assign alternating mountain and valley folds along a guide line',
  }),
  ready('DoubleSymmetricDraw', 'Double symmetric draw', 'construct', 'fold-horizontal', 'MouseHandlerDoubleSymmetricDraw', {
    toolSteps: ['Pick symmetry axis start', 'Pick symmetry axis end'],
  }),
  ready('CreasesAlternateMv', 'Alternate crossing M/V', 'color', 'shuffle', 'MouseHandlerCreasesAlternateMV', {
    toolSteps: ['Click or drag to start the guide line', 'Click to end the guide line'],
    inputMode: 'drag-line',
    tooltip: 'Assign alternating mountain and valley folds to crossings along a guide line',
  }),
  ready('DrawCreaseAngleRestricted5', 'Angle restricted 5 crease', 'construct', 'chart-pie', 'MouseHandlerDrawCreaseAngleRestricted5', {
    toolSteps: ['Pick anchor point', 'Pick snapped endpoint'],
  }),
  ready('VertexMakeAngularlyFlatFoldable', 'Make vertex foldable', 'construct', 'badge-check', 'MouseHandlerVertexMakeAngularlyFlatFoldable', {
    toolSteps: ['Pick vertex', 'Pick the crease to add'],
    tooltip: 'Add the crease that makes a vertex fold consistently, solving its fold angle when the vertex is not flat',
  }),
  ready(
    'PropagateFoldAngles',
    // Named for its *input*, not its output. "Propagate fold angles" read as
    // non-flat-only — in a flat pattern you think in mountain and valley, not
    // angles, even though +/-180 is a fold angle — and the flat case is a first
    // class use: of the answers the isolation fix recovered, 906 of 1,038 came
    // from the flat corpus. A crease is undecided whether its answer turns out
    // to be +/-180 or 70.53, so the input is the one word true in both worlds.
    // "Propagate" also described the algorithm rather than the result; it stays
    // the operation id, where it is the right word.
    'Solve Undecided Creases',
    'construct',
    'angle-propagate',
    'OriStudioPropagateFoldAngles',
    {
      // Two routes, because the tool takes two kinds of scope: a click resolves
      // to the pattern it lands in, a selection is the scope itself. One step
      // naming both beats a step that is wrong half the time.
      toolSteps: ['Click a crease or vertex to solve outward from, or select creases and Apply'],
      tooltip:
        'Work out the creases you have left undecided, within one pattern or within the selection',
    }
  ),
  ready('VertexSolveFoldAngles', 'Solve fold angles', 'construct', 'angle-solve', 'OriStudioSolveVertexFoldAngles', {
    toolSteps: [
      'Pick the first crease to change',
      'Pick the second crease to change',
      'Pick the third crease to change',
    ],
    tooltip:
      'Pick three creases at one vertex and solve their fold angles so the vertex closes, without moving anything',
  }),
  ready('FoldableLineInput', 'Foldable line input', 'construct', 'list-plus', 'MouseHandlerFoldableLineInput', {
    // Not present in Oriedita's UI — hide the rail button (revisit at end).
    placement: 'hidden-ui-only',
    toolSteps: ['Pick start vertex', 'Pick endpoint'],
  }),
  ready('ParallelDraw', 'Parallel draw', 'construct', 'align-justify', 'MouseHandlerParallelDraw', {
    toolSteps: ['Pick target point', 'Pick parallel source crease', 'Pick destination crease'],
  }),
  ready('VertexDeleteOnCrease', 'Delete vertex on crease', 'select-edit', 'scan-x', 'MouseHandlerVertexDeleteOnCrease', {
    // Hidden from the rail: too close to Delete point to tell apart at a glance,
    // and the whole-document sweeps now cover the same intent. The kernel
    // operation stays, so unhiding is a placement change.
    placement: 'hidden-ui-only',
    toolSteps: ['Pick vertex'],
    tooltip: 'Merge adjacent creases at a vertex with Oriedita color-change rules',
  }),
  ready('CircleDraw', 'Draw circle', 'annotations', 'circle', 'MouseHandlerCircleDraw', {
    toolSteps: ['Pick center point', 'Pick radius point'],
  }),
  // The Annotate group keeps only Draw circle and Text; the specialised circle
  // constructions move to the collapsed Advanced group at the bottom of the rail.
  ready('CircleDrawThreePoint', 'Circle through three points', 'advanced', 'circle-dot', 'MouseHandlerCircleDrawThreePoint', {
    toolSteps: ['Pick first point', 'Pick second point', 'Pick third point'],
  }),
  ready('CircleDrawSeparate', 'Separate circle', 'advanced', 'circle-dashed', 'MouseHandlerCircleDrawSeparate', {
    toolSteps: ['Pick center point', 'Pick radius start', 'Pick radius end'],
  }),
  ready('CircleDrawTangentLine', 'Circle tangent line', 'annotations', 'circle-slash', 'MouseHandlerCircleDrawTangentLine', {
    // Not working (single-point mode incomplete) — hide for now; revisit at end.
    placement: 'hidden-ui-only',
    selectionRequirement: 'selected circle(s)',
    tooltip: 'Create tangent lines from two selected circles, or from one selected circle plus a clicked point',
  }),
  ready('CircleDrawInverted', 'Inverted circle', 'advanced', 'refresh-cw', 'MouseHandlerCircleDrawInverted', {
    selectionRequirement: 'selected circle and circle or crease',
    tooltip: 'Invert a selected circle or crease through a selected circle',
  }),
  ready('CircleDrawFree', 'Free circle', 'advanced', 'circle-plus', 'MouseHandlerCircleDrawFree', {
    toolSteps: ['Pick center point', 'Pick radius point'],
  }),
  ready('CircleDrawConcentric', 'Concentric circle', 'advanced', 'circle-dot-dashed', 'MouseHandlerCircleDrawConcentric', {
    selectionRequirement: 'selected circle',
    toolSteps: ['Pick radius start', 'Pick radius end'],
  }),
  // `target` and not `circle-dot`, which is what "Circle through three points"
  // draws two rows above: those were the only two rail tools that rendered the
  // same mark, and neither has an Oriedita glyph to tell them apart. Concentric
  // rings are also just a better picture of the thing.
  ready('CircleDrawConcentricSelect', 'Concentric from selection', 'advanced', 'target', 'MouseHandlerCircleDrawConcentricSelect', {
    selectionRequirement: 'three selected circles',
    tooltip: 'Create a concentric circle from a target circle and two reference circle radii',
  }),
  ready('CircleDrawConcentricTwoCircleSelect', 'Concentric from two circles', 'advanced', 'venetian-mask', 'MouseHandlerCircleDrawConcentricTwoCircleSelect', {
    selectionRequirement: 'two selected circles',
    tooltip: 'Create the two Oriedita concentric offset circles from selected circles',
  }),
  ready('ParallelDrawWidth', 'Parallel draw by width', 'construct', 'between-horizontal-end', 'MouseHandlerParallelDrawWidth', {
    // Not present in Oriedita's UI — hide the rail button (revisit at end).
    placement: 'hidden-ui-only',
    toolSteps: ['Pick source crease', 'Pick width point'],
  }),
  ready('ContinuousSymmetricDraw', 'Continuous symmetric draw', 'construct', 'repeat', 'MouseHandlerContinuousSymmetricDraw', {
    // On the rail, like upstream. This was hidden as an Ori Studio product
    // decision while every other hidden tool is hidden for upstream alignment —
    // Oriedita ships a "reflectThroughLines" button in DrawingTab. Hiding it
    // made the tool unreachable by every route at once: no button, no default
    // chord, and `isShortcutBindable` refuses a hidden action, so neither the
    // Oriedita import nor a manual capture could give it one either. A user
    // arriving with it bound in Oriedita had nowhere to land.
    //
    // Its upstream Ctrl+R chord comes back with it, per the note left on
    // `continuousSymmetricDrawAction` in `keyboard/shortcuts.ts`.
    toolSteps: ['Pick start point', 'Pick through point'],
  }),
  // The two Measure tools. Upstream splits measuring across five operations that
  // differ only in which `MeasuresModel` register they write to; Ori Studio shows
  // one per *question* — length and angle — and hides the other three, which stay
  // `ready` so the kernel, menus, and `.cp` mouse modes keep upstream parity.
  // See cp-workspace/measure.ts.
  ready('DisplayLengthBetweenPoints1', 'Measure Length', 'measure', 'ruler', 'MouseHandlerDisplayLengthBetweenPoints', {
    toolSteps: ['Pick first point', 'Pick second point'],
    tooltip: 'Measure the distance between two points, or click a crease',
  }),
  ready('DisplayLengthBetweenPoints2', 'Measure length 2', 'measure', 'ruler-dimension-line', 'MouseHandlerDisplayLengthBetweenPoints', {
    placement: 'hidden-ui-only',
    toolSteps: ['Pick first point', 'Pick second point'],
  }),
  ready('DisplayAngleBetweenThreePoints1', 'Measure Angle', 'measure', 'angle', 'MouseHandlerDisplayAngleBetweenThreePoints', {
    toolSteps: ['Pick first point', 'Pick vertex point', 'Pick second point'],
    tooltip: 'Measure the angle at a vertex between two points',
  }),
  ready('DisplayAngleBetweenThreePoints2', 'Measure angle 2', 'measure', 'angle', 'MouseHandlerDisplayAngleBetweenThreePoints', {
    placement: 'hidden-ui-only',
    toolSteps: ['Pick first point', 'Pick vertex point', 'Pick second point'],
  }),
  ready('DisplayAngleBetweenThreePoints3', 'Measure angle 3', 'measure', 'angle', 'MouseHandlerDisplayAngleBetweenThreePoints', {
    placement: 'hidden-ui-only',
    toolSteps: ['Pick first point', 'Pick vertex point', 'Pick second point'],
  }),
  // Reverses a *stated* fold direction: a mountain or valley states one in its
  // colour, and an unassigned crease carrying a direction hint states one in the
  // hint (the kernel dispatch runs the port plus a native limb for that — see
  // PORTING.md). A crease with no direction at all is left alone, so the tooltip
  // says "which way it folds" rather than naming mountain and valley, which
  // would exclude the hint by its own wording.
  ready('CreaseToggleMv', 'Toggle mountain/valley', 'color', 'repeat-2', 'MouseHandlerCreaseToggleMV', {
    placement: 'left-rail',
    selectionRequirement: 'selected creases stating a fold direction',
    toolSteps: ['Click a crease or drag a box to flip'],
    inputMode: 'drag-box',
    tooltip: 'Click a crease or drag a box to reverse which way it folds',
  }),
  ready('CircleChangeColor', 'Change circle color', 'annotations', 'palette', 'MouseHandlerCircleChangeColor', {
    placement: 'menu',
    selectionRequirement: 'selected circles or auxiliary lines',
    tooltip: 'Apply the contextual custom color to selected circles and auxiliary lines',
  }),
  // Named for the variant it actually performs. The bare operation keeps the
  // direction — forgetting it needs `forget_direction` in the payload — so a
  // shortcut bound here keeps it, and calling that "Make unassigned" gave the
  // one bindable action the *other* menu item's name. The forgetting variant is
  // bound separately, as a menu shortcut, since one kernel operation cannot
  // produce two entries in a registry keyed on operations.
  ready(
    'CreaseMakeUnassigned',
    'Make unassigned (keep direction)',
    'color',
    'circle-dashed',
    'OriStudioCreaseMakeUnassigned',
    {
      placement: 'menu',
      selectionRequirement: 'selected lines',
      tooltip: 'Forget what the selected lines do, leaving them undecided',
    }
  ),
  ready('CreaseMakeAux', 'Make auxiliary', 'color', 'scan-line', 'MouseHandlerCreaseMakeAux', {
    placement: 'menu',
    selectionRequirement: 'selected folding lines',
    tooltip: 'Convert selected folding lines to auxiliary lines',
  }),
  ready('OperationFrameCreate', 'Operation frame', 'transform', 'frame', 'MouseHandlerOperationFrameCreate', {
    // Hidden per Zach — CP export is handled differently here, so the frame isn't
    // wired to anything user-facing yet. Revisit if export grows a crop step. The
    // WebGL overlay + drag-box create interaction stay in place for when it returns.
    placement: 'hidden-ui-only',
    toolSteps: ['Drag operation frame'],
    // A rubber-band rectangle (two opposite corners), not a freeform path: the kernel
    // builds the axis-aligned frame from the press + release corners.
    inputMode: 'drag-box',
    tooltip: 'Create an Oriedita operation frame by dragging a rectangle on the CP',
  }),
  ready('VoronoiCreate', 'Voronoi', 'generators', 'network', 'MouseHandlerVoronoiCreate', {
    toolSteps: ['Click seed point'],
    tooltip: 'Click seed points to preview a Voronoi diagram, then apply from the contextual panel',
  }),
  ready(
    'FlatFoldableCheck',
    'Flat-foldable boundary check',
    'check-fix',
    'shield-check',
    'MouseHandlerFlatFoldableCheck',
    {
      // Hidden per Zach. Revisit at end.
      placement: 'hidden-ui-only',
      toolSteps: ['Draw a closed boundary loop'],
      inputMode: 'drag-path',
      tooltip: 'Draw a closed Oriedita boundary loop and color the check result',
    }
  ),
  ready('CreaseDeleteOverlapping', 'Delete overlapping creases', 'select-edit', 'combine', 'MouseHandlerCreaseDeleteOverlapping', {
    // Hidden from the rail: Delete intersecting creases is the superset (it
    // takes overlapping *and* intersecting segments along the same drag), so
    // two adjacent buttons differed by a distinction the icons cannot carry.
    placement: 'hidden-ui-only',
    toolSteps: ['Pick drag start point', 'Pick drag end point'],
    tooltip: 'Delete crease segments overlapping a dragged line',
  }),
  ready('CreaseDeleteIntersecting', 'Delete intersecting creases', 'select-edit', 'unlink', 'MouseHandlerCreaseDeleteIntersecting', {
    toolSteps: ['Pick drag start point', 'Pick drag end point'],
    tooltip: 'Delete crease segments intersecting or overlapping a dragged line',
  }),
  ready('SelectPolygon', 'Select polygon', 'select-edit', 'lasso-select', 'MouseHandlerSelectPolygon', {
    // Hidden per Zach — lasso covers the freehand-select case. Revisit at end.
    placement: 'hidden-ui-only',
    toolSteps: ['Drag polygon path'],
    inputMode: 'drag-path',
    tooltip: 'Select creases contained by a freehand polygon',
  }),
  ready('UnselectPolygon', 'Unselect polygon', 'select-edit', 'lasso', 'MouseHandlerUnselectPolygon', {
    // Hidden per Zach — lasso covers the freehand-select case. Revisit at end.
    placement: 'hidden-ui-only',
    toolSteps: ['Drag polygon path'],
    inputMode: 'drag-path',
    tooltip: 'Unselect creases contained by a freehand polygon',
  }),
  ready('SelectLineIntersecting', 'Select intersecting line', 'select-edit', 'scan-search', 'MouseHandlerSelectLineIntersecting', {
    // Not present in Oriedita's UI — hide the rail button (revisit at end).
    placement: 'hidden-ui-only',
    toolSteps: ['Pick drag start point', 'Pick drag end point'],
    tooltip: 'Select crease segments intersecting or overlapping a dragged line',
  }),
  ready('UnselectLineIntersecting', 'Unselect intersecting line', 'select-edit', 'scan-search', 'MouseHandlerUnselectLineIntersecting', {
    // Not present in Oriedita's UI — hide the rail button (revisit at end).
    placement: 'hidden-ui-only',
    toolSteps: ['Pick drag start point', 'Pick drag end point'],
    tooltip: 'Unselect crease segments intersecting or overlapping a dragged line',
  }),
  ready('LengthenCreaseSameColor', 'Lengthen by Same Color', 'draw', 'stretch-horizontal', 'MouseHandlerLengthenCreaseSameColor', {
    // Merged into Extend Line, which picks between this and LengthenCrease from
    // its colour-mode option. Kept in the registry for parity and for the
    // upstream mouse-mode lookup; no surface of its own. See `cpToolVariants.ts`.
    placement: 'hidden-ui-only',
    toolSteps: ['Select line to extend', 'Select target line'],
    tooltip: 'Extend creases crossed by the guide line while preserving original colors',
  }),
  ready('FoldableLineDraw', 'Foldable line draw', 'construct', 'pen-line', 'MouseHandlerFoldableLineDraw', {
    // Not present in Oriedita's UI — hide the rail button (revisit at end).
    placement: 'hidden-ui-only',
    toolSteps: ['Pick start vertex', 'Pick destination'],
  }),
  ready('ReplaceLineTypeSelect', 'Replace selected line type', 'color', 'replace', 'MouseHandlerReplaceTypeSelect', {
    placement: 'menu',
    selectionRequirement: 'selected lines',
    tooltip: 'Replace selected lines matching the active source line type',
  }),
  ready('DeleteLineTypeSelect', 'Delete selected line type', 'color', 'trash-2', 'MouseHandlerDeleteTypeSelect', {
    placement: 'menu',
    selectionRequirement: 'selected lines',
    tooltip: 'Delete selected lines matching the active line type filter',
  }),
  ready('SelectLasso', 'Select lasso', 'select-edit', 'lasso-select', 'MouseHandlerSelectLasso', {
    toolSteps: ['Drag lasso path'],
    inputMode: 'drag-path',
    tooltip: 'Select creases touched by a freehand lasso path',
  }),
  ready('UnselectLasso', 'Unselect lasso', 'select-edit', 'lasso', 'MouseHandlerUnselectLasso', {
    toolSteps: ['Drag lasso path'],
    inputMode: 'drag-path',
    tooltip: 'Unselect creases touched by a freehand lasso path',
  }),
  ready('Text', 'Text annotation', 'annotations', 'text-cursor-input', 'MouseHandlerText', {
    toolSteps: ['Click text position'],
    tooltip: 'Create, select, drag, and edit text annotations',
  }),
  // Ori Studio native: Oriedita checks the whole sheet or nothing, so it has no
  // notion of an area where a theorem is not reported.
  //
  // Grouped with Text and Draw circle rather than with Check/Fix, because what
  // this tool *makes* is a `CanvasAnnotation` — the same union those two write
  // into, with the same select / move / resize / undo — and the rail groups
  // tools by what they produce. The Check group is where the checks it silences
  // are run from, which is a different question.
  //
  // Commits web-side; see {@link cpCommandCommitsWebSide}.
  ready(
    'CheckSuppressionRegionCreate',
    'Check suppression region',
    'annotations',
    'square-dashed',
    'OriStudioCheckSuppressionRegionCreate',
    {
      toolSteps: ['Drag a box over the area to stop checking'],
      inputMode: 'drag-box',
      tooltip: 'Drag a box to stop reporting the selected foldability checks inside it',
    }
  ),
  ready('DrawBlintz', 'Blintz base', 'generators', 'sparkles', 'MouseHandlerDrawBlintz', {
    toolSteps: ['Pick first anchor point', 'Pick second anchor point'],
  }),
  ready('DrawFishBase', 'Fish base', 'generators', 'sparkles', 'MouseHandlerDrawFishBase', {
    toolSteps: ['Pick first anchor point', 'Pick second anchor point'],
  }),
  ready('DrawDoveBase', 'Dove base', 'generators', 'sparkles', 'MouseHandlerDrawDoveBase', {
    toolSteps: ['Pick first anchor point', 'Pick second anchor point'],
  }),
  ready('DrawBirdBase', 'Bird base', 'generators', 'sparkles', 'MouseHandlerDrawBirdBase', {
    toolSteps: ['Pick first anchor point', 'Pick second anchor point'],
  }),
  ready('DrawFrogBase', 'Frog base', 'generators', 'sparkles', 'MouseHandlerDrawFrogBase', {
    toolSteps: ['Pick first anchor point', 'Pick second anchor point'],
  }),
  notImplemented('ModifyCalculatedShape', 'Modify calculated shape', 'folding', 'pen-tool', 'MouseHandlerModifyCalculatedShape', {
    placement: 'hidden-ui-only',
  }),
  notImplemented('MoveCalculatedShape', 'Move calculated shape', 'folding', 'move', 'MouseHandlerMoveCalculatedShape', {
    placement: 'hidden-ui-only',
  }),
  notImplemented('ChangeStandardFace', 'Change standard face', 'folding', 'layers', 'MouseHandlerChangeStandardFace', {
    placement: 'hidden-ui-only',
  }),
  notImplemented('AddFoldingConstraint', 'Add folding constraint', 'folding', 'list-plus', 'MouseHandlerAddFoldingConstraints', {
    placement: 'hidden-ui-only',
  }),
  ready('Axiom5', 'Axiom 5', 'construct', 'compass', 'MouseHandlerAxiom5', {
    // Not present in Oriedita's UI — hide the rail button (revisit at end).
    placement: 'hidden-ui-only',
    toolSteps: ['Pick target point', 'Pick target crease', 'Pick pivot point', 'Pick destination crease'],
  }),
  ready('Axiom7', 'Axiom 7', 'construct', 'compass', 'MouseHandlerAxiom7', {
    // Not present in Oriedita's UI — hide the rail button (revisit at end).
    placement: 'hidden-ui-only',
    toolSteps: ['Pick target point', 'Pick target crease', 'Pick perpendicular crease', 'Pick destination crease'],
  }),
  ready('FixInaccurate', 'Fix inaccurate creases', 'check-fix', 'wrench', 'MouseHandlerCreaseFixInaccurate', {
    placement: 'menu',
    selectionRequirement: 'selected folding lines',
    tooltip: 'Snap inaccurate selected folding lines to Oriedita fix targets',
  }),
  notImplemented('ImportCp', 'Import CP', 'file', 'file-input', 'CpImporter', { placement: 'menu' }),
  notImplemented('ExportCp', 'Export CP', 'file', 'file-output', 'CpExporter', { placement: 'menu' }),
  notImplemented('ImportFold', 'Import FOLD', 'file', 'file-input', 'FoldImporter', { placement: 'menu' }),
  notImplemented('ExportFold', 'Export FOLD', 'file', 'file-output', 'FoldExporter', { placement: 'menu' }),
  notImplemented('ImportOri', 'Import ORI', 'file', 'file-input', 'OriImporter', { placement: 'menu' }),
  notImplemented('ExportOri', 'Export ORI', 'file', 'file-output', 'OriExporter', { placement: 'menu' }),
  notImplemented('ImportOrh', 'Import ORH', 'file', 'file-input', 'OrhImporter', { placement: 'menu' }),
  notImplemented('ExportOrh', 'Export ORH', 'file', 'file-output', 'OrhExporter', { placement: 'menu' }),
  notImplemented('ImportObj', 'Import OBJ', 'file', 'file-input', 'ObjImporter', { placement: 'menu' }),
  notImplemented('ExportDxf', 'Export DXF', 'file', 'file-output', 'DxfExporter', { placement: 'menu' }),
  notImplemented('SaveConvert', 'Convert save', 'file', 'file-cog', 'SaveConverter', { placement: 'palette' }),
  notImplemented('SaveVersionDetect', 'Detect save version', 'file', 'file-search', 'FileVersionTester', {
    placement: 'palette',
  }),
  ready('CheckCamv', 'Check foldability', 'check-fix', 'shield-alert', 'CheckCAMVTask', {
    placement: 'menu',
    tooltip: 'Check every vertex for problems that would stop the pattern folding, without changing it',
  }),
  porting('FoldingEstimate', 'Fold estimate', 'folding', 'origami', 'FoldingEstimateTask', {
    placement: 'hidden-ui-only',
  }),
  porting('FoldingEstimateSpecific', 'Fold to case', 'folding', 'list-ordered', 'FoldingEstimateSpecificTask', {
    placement: 'hidden-ui-only',
  }),
  porting('FoldingEstimateSave100', 'Save 100 simulations', 'folding', 'download', 'FoldingEstimateSave100Task', {
    placement: 'hidden-ui-only',
  }),
  porting('TwoColoredCp', 'Two-color CP', 'folding', 'palette', 'TwoColoredTask', {
    placement: 'hidden-ui-only',
  }),
  notImplemented('Fold', 'Fold', 'folding', 'origami', 'FoldingServiceImpl.fold', {
    placement: 'hidden-ui-only',
  }),
  porting('FoldAnother', 'Another solution', 'folding', 'skip-forward', 'FoldingServiceImpl.foldAnother', {
    placement: 'hidden-ui-only',
  }),
  porting('DuplicateFoldedModel', 'Duplicate folded model', 'folding', 'copy', 'FoldingServiceImpl.duplicate', {
    placement: 'hidden-ui-only',
  }),
  notImplemented('FoldedFigureSetModel', 'Folded figure model', 'folding', 'palette', 'FoldedFigureModel', {
    placement: 'hidden-ui-only',
  }),
  notImplemented(
    'FoldedFigureSetDisplayStyle',
    'Folded display style',
    'folding',
    'layers',
    'FoldedFigureModel.setDisplayStyle',
    { placement: 'hidden-ui-only' }
  ),
  notImplemented('FoldedFigureSetState', 'Folded front/back state', 'folding', 'flip-horizontal', 'FoldedFigureModel.setState', {
    placement: 'hidden-ui-only',
  }),
  notImplemented(
    'FoldedFigureSetStartingFace',
    'Folded starting face',
    'folding',
    'badge-check',
    'MouseHandlerChangeStandardFace',
    { placement: 'hidden-ui-only' }
  ),
  outOfScopeUi(
    'FoldedFigureMoveCamera',
    'Move folded figure camera',
    'folding',
    'move',
    'MouseHandlerMoveCalculatedShape',
    'Handled by the grid viewport camera layer'
  ),
  notImplemented(
    'FoldedFigureSelectCanvasPoint',
    'Folded point selection',
    'folding',
    'circle-dot',
    'FoldedFigureCanvasSelectService',
    { placement: 'hidden-ui-only' }
  ),
  notImplemented(
    'FoldedFigureRenderSnapshot',
    'Folded render snapshot',
    'folding',
    'image',
    'FoldedFigure_Drawer.foldUp_draw',
    { placement: 'hidden-ui-only' }
  ),
  notImplemented(
    'FoldedFigureImportFoldFrame',
    'Import folded FOLD frame',
    'file',
    'file-input',
    'FoldImporter.file_frames',
    { placement: 'hidden-ui-only' }
  ),
  notImplemented(
    'FoldedFigureExportFoldFrames',
    'Export folded FOLD frames',
    'file',
    'file-output',
    'FoldExporter.file_frames',
    { placement: 'hidden-ui-only' }
  ),
  ready('Check1', 'Check overlaps', 'check-fix', 'badge-alert', 'Check1', {
    placement: 'menu',
    tooltip: 'Find overlapping or contained non-auxiliary crease pairs',
  }),
  ready('Check2', 'Check T-junctions', 'check-fix', 'badge-alert', 'Check2', {
    placement: 'menu',
    tooltip: 'Find near T-intersections between non-auxiliary crease pairs',
  }),
  ready('Check3', 'Check vertex foldability', 'check-fix', 'badge-alert', 'Check3', {
    placement: 'menu',
    tooltip: 'Find Oriedita vertex flat-foldability markers',
  }),
  ready('Check4', 'Check Maekawa/BLB', 'check-fix', 'badge-alert', 'Check4', {
    placement: 'menu',
    tooltip: 'Find Maekawa, angle, and big-little-big violations',
  }),
  ready('Fix1', 'Repair overlaps', 'check-fix', 'wrench', 'Fix1', {
    placement: 'menu',
    tooltip: 'Merge exact duplicates and select remaining overlapping creases',
  }),
  ready('Fix2', 'Split T-junctions', 'check-fix', 'wrench', 'Fix2', {
    placement: 'menu',
    tooltip: 'Split near T-intersections using Oriedita tolerances',
  }),
  ready(
    'DeleteExtraVertices',
    'Delete Extra Vertices',
    'check-fix',
    'wrench',
    'v_del_allAction',
    {
      placement: 'left-rail',
      tooltip: 'Merge collinear crease pairs that meet at a vertex, when both are the same type',
    }
  ),
  ready(
    'DeleteExtraVerticesIgnoreColor',
    'Delete Extra Vertices (Ignore Type)',
    'check-fix',
    'wrench',
    'v_del_all_ccAction',
    {
      placement: 'menu',
      tooltip:
        'Merge collinear crease pairs regardless of type — a mountain and a valley merge to an edge',
    }
  ),
  // Not a tool: the sweep above confined to a set of creases, run by an accepted
  // solve over the creases it produced so the user's own creases beside them
  // are left alone. Nothing in the UI reaches it directly.
  ready(
    'DeleteExtraVerticesAmong',
    'Delete Extra Vertices in Pattern',
    'check-fix',
    'wrench',
    'OriStudioDeleteExtraVerticesAmong',
    {
      placement: 'hidden-ui-only',
      tooltip: 'Merge collinear same-type crease pairs among the given creases only',
    }
  ),
  ready('OrganizeCircles', 'Organize circles', 'annotations', 'circle-ellipsis', 'OrganizeCircles', {
    placement: 'menu',
    tooltip: 'Prune invalid zero-radius circles using Oriedita cleanup rules',
  }),
];

export const ORISTUDIO_CP_SOURCE_MAP_OPERATION_IDS = [
  'DrawCreaseFree',
  'MoveCreasePattern',
  'LineSegmentDelete',
  'ChangeCreaseType',
  'LengthenCrease',
  'SquareBisector',
  'Inward',
  'PerpendicularDraw',
  'SymmetricDraw',
  'DrawCreaseRestricted',
  'DrawCreaseSymmetric',
  'DrawCreaseAngleRestricted',
  'DrawPoint',
  'DeletePoint',
  'AngleSystem',
  'DrawCreaseAngleRestricted3',
  'CreaseSelect',
  'CreaseUnselect',
  'CreaseMove',
  'CreaseCopy',
  'CreaseMakeMountain',
  'CreaseMakeValley',
  'CreaseMakeEdge',
  'CreaseSetLineColor',
  'CreaseSetFoldAngle',
  'VertexSolveFoldAngles',
  'BackgroundChangePosition',
  'LineSegmentDivision',
  'LineSegmentRatioSet',
  'PolygonSetNoCorners',
  'CreaseAdvanceType',
  'CreaseMove4p',
  'CreaseCopy4p',
  'FishBoneDraw',
  'CreaseMakeMv',
  'DoubleSymmetricDraw',
  'CreasesAlternateMv',
  'DrawCreaseAngleRestricted5',
  'VertexMakeAngularlyFlatFoldable',
  'FoldableLineInput',
  'ParallelDraw',
  'VertexDeleteOnCrease',
  'CircleDraw',
  'CircleDrawThreePoint',
  'CircleDrawSeparate',
  'CircleDrawTangentLine',
  'CircleDrawInverted',
  'CircleDrawFree',
  'CircleDrawConcentric',
  'CircleDrawConcentricSelect',
  'CircleDrawConcentricTwoCircleSelect',
  'ParallelDrawWidth',
  'ContinuousSymmetricDraw',
  'DisplayLengthBetweenPoints1',
  'DisplayLengthBetweenPoints2',
  'DisplayAngleBetweenThreePoints1',
  'DisplayAngleBetweenThreePoints2',
  'DisplayAngleBetweenThreePoints3',
  'CreaseToggleMv',
  'CircleChangeColor',
  'CreaseMakeAux',
  'CreaseMakeUnassigned',
  'CreaseSetDirectionHint',
  'PropagateFoldAngles',
  'OperationFrameCreate',
  'VoronoiCreate',
  'FlatFoldableCheck',
  'CreaseDeleteOverlapping',
  'CreaseDeleteIntersecting',
  'SelectPolygon',
  'UnselectPolygon',
  'SelectLineIntersecting',
  'UnselectLineIntersecting',
  'LengthenCreaseSameColor',
  'FoldableLineDraw',
  'ReplaceLineTypeSelect',
  'DeleteLineTypeSelect',
  'SelectLasso',
  'UnselectLasso',
  'Text',
  'CheckSuppressionRegionCreate',
  'DrawBlintz',
  'DrawFishBase',
  'DrawDoveBase',
  'DrawBirdBase',
  'DrawFrogBase',
  'ModifyCalculatedShape',
  'MoveCalculatedShape',
  'ChangeStandardFace',
  'AddFoldingConstraint',
  'Axiom5',
  'Axiom7',
  'FixInaccurate',
  'ImportCp',
  'ExportCp',
  'ImportFold',
  'ExportFold',
  'ImportOri',
  'ExportOri',
  'ImportOrh',
  'ExportOrh',
  'ImportObj',
  'ExportDxf',
  'SaveConvert',
  'SaveVersionDetect',
  'CheckCamv',
  'FoldingEstimate',
  'FoldingEstimateSpecific',
  'FoldingEstimateSave100',
  'TwoColoredCp',
  'Fold',
  'FoldAnother',
  'DuplicateFoldedModel',
  'FoldedFigureSetModel',
  'FoldedFigureSetDisplayStyle',
  'FoldedFigureSetState',
  'FoldedFigureSetStartingFace',
  'FoldedFigureMoveCamera',
  'FoldedFigureSelectCanvasPoint',
  'FoldedFigureRenderSnapshot',
  'FoldedFigureImportFoldFrame',
  'FoldedFigureExportFoldFrames',
  'Check1',
  'Check2',
  'Check3',
  'Check4',
  'Fix1',
  'Fix2',
  'DeleteExtraVertices',
  'DeleteExtraVerticesIgnoreColor',
  'OrganizeCircles',
  // Ori Studio originals — see `isNativeCpOperation`. Appended so this list keeps
  // reading as Oriedita's source map with our additions visible at the end, which
  // is the order the kernel's `OperationId` uses too.
  'SquareGenerate',
  'VertexInsertOnCreases',
  'DeleteExtraVerticesAmong',
] as const;

export type OristudioCpOperationId = (typeof ORISTUDIO_CP_SOURCE_MAP_OPERATION_IDS)[number];

export function cpCommandsForGroup(
  group: OristudioCpCommandGroupId
): OristudioCpCommandDefinition[] {
  return ORISTUDIO_CP_COMMANDS.filter((command) => command.group === group);
}

export function cpCommandByOperation(
  operationId: OristudioCpOperationId
): OristudioCpCommandDefinition | undefined {
  return ORISTUDIO_CP_COMMANDS.find((command) => command.operationId === operationId);
}

/**
 * Operations that are Ori Studio originals rather than Oriedita ports — the
 * frontend's view of the kernel's `OperationOrigin::OriStudio`.
 *
 * Derived from the `upstream` prefix rather than hand-listed, so it cannot fall
 * out of step with the command definitions; `oristudioCpCommands.test.ts` pins
 * the expected set, so a fourth native tool is a deliberate edit in two places
 * rather than a silent change here.
 *
 * See PORTING.md > "Ori Studio native operations" for what the distinction
 * obliges. In short: a port owes its upstream, an original owes nothing.
 */
const CP_NATIVE_OPERATIONS = new Set<OristudioCpOperationId>(
  ORISTUDIO_CP_COMMANDS.filter((command) => command.upstream.startsWith('OriStudio')).map(
    (command) => command.operationId
  )
);

/** Whether `operationId` is an Ori Studio original with no Oriedita upstream. */
export function isNativeCpOperation(
  operationId: OristudioCpOperationId | null | undefined
): boolean {
  return operationId ? CP_NATIVE_OPERATIONS.has(operationId) : false;
}

/** The Ori Studio originals, sorted, for tests and diagnostics. */
export function nativeCpOperationIds(): OristudioCpOperationId[] {
  return [...CP_NATIVE_OPERATIONS].sort();
}

/**
 * Operations that create creases in the *active* line colour.
 *
 * This is the authoritative answer to "does this tool draw in the crease
 * colour", and it drives two things that must agree: the `line_color` the
 * command payload carries, and the colour its live preview is stroked in. They
 * used to be decided separately -- the payload from this list, the preview from
 * `command.group === 'draw'` -- and the group is a UI taxonomy, not a statement
 * about colour. Only 4 of these 34 operations are grouped `draw`; the other 30
 * (every `construct` and `generators` tool, among them Angle Restricted Line)
 * previewed in the neutral selection accent and then committed in the crease
 * colour, so the line changed colour on release.
 *
 * Absent by design: selection and box/lasso tools, which preview in the accent
 * precisely so a "select creases" box does not read as a red crease; and
 * `LengthenCreaseSameColor`, which by definition keeps the colour of the crease
 * it extends.
 */
const CP_ACTIVE_LINE_COLOR_OPERATIONS = new Set<OristudioCpOperationId>([
  'CreaseMakeMv',
  'CreasesAlternateMv',
  'LengthenCrease',
  'DrawCreaseFree',
  'DrawCreaseRestricted',
  'LineSegmentDivision',
  'LineSegmentRatioSet',
  'DrawCreaseSymmetric',
  'DrawCreaseAngleRestricted',
  'DrawCreaseAngleRestricted3',
  'DrawCreaseAngleRestricted5',
  'AngleSystem',
  'SquareBisector',
  'Inward',
  'PerpendicularDraw',
  'SymmetricDraw',
  'FishBoneDraw',
  'DoubleSymmetricDraw',
  'VertexMakeAngularlyFlatFoldable',
  'FoldableLineInput',
  'ParallelDraw',
  'ParallelDrawWidth',
  'ContinuousSymmetricDraw',
  'FoldableLineDraw',
  'Axiom5',
  'Axiom7',
  'PolygonSetNoCorners',
  'DrawBlintz',
  'DrawFishBase',
  'DrawDoveBase',
  'DrawBirdBase',
  'DrawFrogBase',
  'VoronoiCreate',
  'CircleDrawTangentLine',
  // Square draws in a colour the user chose, so it belongs here — but *which*
  // colour is its own tool param (Edge by default), which is why the colour
  // itself is resolved by `resolveCpToolLineColor` before it reaches either the
  // payload or the preview. This set answers "does a colour apply", not "which".
  'SquareGenerate',
]);

/** Whether `operationId` draws creases in the active line colour. */
export function cpCommandUsesActiveLineColor(
  operationId: OristudioCpOperationId | undefined
): boolean {
  return operationId ? CP_ACTIVE_LINE_COLOR_OPERATIONS.has(operationId) : false;
}

/**
 * Tools whose candidate previews are creases the *kernel* determined, not the
 * active line type.
 *
 * The vertex-completion solver works out both the mountain/valley and the fold
 * angle of the crease that closes a vertex — that answer is the tool's whole
 * output, so its candidates carry it and are stroked and labelled accordingly.
 * Every other tool draws what the user chose, and its preview stays in the
 * active colour.
 */
const CP_KERNEL_DECIDED_CANDIDATE_OPERATIONS = new Set<OristudioCpOperationId>([
  'VertexMakeAngularlyFlatFoldable',
  'FoldableLineDraw',
  'VertexSolveFoldAngles',
  'PropagateFoldAngles',
]);

/** Whether `operationId`'s candidates carry their own crease type and angle. */
export function cpCommandCandidatesCarryCrease(
  operationId: OristudioCpOperationId | undefined
): boolean {
  return operationId ? CP_KERNEL_DECIDED_CANDIDATE_OPERATIONS.has(operationId) : false;
}

/**
 * Tools that resolve an endpoint *inside* the kernel and so do their own
 * close-point search.
 *
 * Angle Restricted Line has to: the point it snaps is the cursor projected onto
 * the angle system, which only the kernel knows. Every other draw tool snaps on
 * the canvas before the command is built, and the kernel sees a resolved point.
 * These are the commands whose payload therefore has to carry the snap policy.
 */
const CP_KERNEL_SNAPPED_OPERATIONS = new Set<OristudioCpOperationId>([
  'DrawCreaseAngleRestricted5',
]);

/** Whether `operationId` snaps its own endpoint kernel-side. */
export function cpCommandSnapsKernelSide(
  operationId: OristudioCpOperationId | undefined
): boolean {
  return operationId ? CP_KERNEL_SNAPPED_OPERATIONS.has(operationId) : false;
}

/**
 * Tools the kernel has never heard of: they arm and gesture like any other tool,
 * but what they commit is web state, so neither their commit nor their live
 * preview may be sent to `executeOristudioCpCommand` / `previewOristudioCpCommand`.
 *
 * This matters at *two* call sites, and only one of them is obvious. The commit
 * path is the one anybody thinks of. The other is the per-pointer-move preview:
 * `previewOristudioCpCommand` catches a kernel refusal into `oristudioCpError`
 * rather than throwing, so an unrecognised operation does not crash — it raises
 * an error banner on **every mouse move** of the drag, and the tool otherwise
 * appears to work. One predicate for both, so a third web-side tool cannot be
 * wired into the commit and forgotten in the preview.
 *
 * Not the same question as {@link isNativeCpOperation}: `SquareGenerate` and
 * `VertexSolveFoldAngles` are equally native and both very much do reach the
 * kernel. This asks who *stores the result*.
 */
const CP_WEB_SIDE_COMMIT_OPERATIONS = new Set<OristudioCpOperationId>([
  'CheckSuppressionRegionCreate',
]);

/** Whether `operationId` is committed by the web app rather than by the kernel. */
export function cpCommandCommitsWebSide(
  operationId: OristudioCpOperationId | null | undefined
): boolean {
  return operationId ? CP_WEB_SIDE_COMMIT_OPERATIONS.has(operationId) : false;
}

export function cpRailCommands(): OristudioCpCommandDefinition[] {
  return ORISTUDIO_CP_COMMANDS.filter(
    (command) => command.placement === 'left-rail' || command.placement === 'left-rail-overflow'
  );
}
