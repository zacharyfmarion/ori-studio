import type { OristudioCpLineColor } from '../engine/oristudioCpTypes';
import { ORISTUDIO_CP_PRIMARY_LINE_COLOR_PALETTE } from './oristudioCpPalette';
import {
  ORISTUDIO_CP_COMMAND_GROUPS,
  ORISTUDIO_CP_COMMANDS,
  cpCommandByOperation,
  type OristudioCpCommandDefinition,
  type OristudioCpCommandGroupId,
  type OristudioCpCommandPlacement,
  type OristudioCpCommandUiStatus,
  type OristudioCpOperationId,
} from './oristudioCpCommands';

export type OristudioCpActionKind = 'line-type' | 'command';
export type OristudioCpActionId = `cp.action.${string}`;
export type OristudioCpActionGroupId = 'line-type' | 'edit' | OristudioCpCommandGroupId;
export type OristudioCpLineInputMode = 'fold-line' | 'aux-line';
export type OristudioCpActionInputMode = 'point-sequence' | 'drag-path' | 'drag-line' | 'drag-box';
export const DEFAULT_ORISTUDIO_CP_ACTION_ID =
  'cp.action.crease-select' as const satisfies OristudioCpActionId;

export interface OristudioCpActionGroupDefinition {
  id: OristudioCpActionGroupId;
  label: string;
  railLabel: string;
  order: number;
  /** Rail renders the group behind a disclosure, closed until the user opens it. */
  collapsedByDefault?: boolean;
}

export interface OristudioCpBaseActionDefinition {
  id: OristudioCpActionId;
  kind: OristudioCpActionKind;
  label: string;
  railLabel?: string;
  group: OristudioCpActionGroupId;
  placement: OristudioCpCommandPlacement;
  icon: string;
  railOrder?: number;
  upstreamAction: string;
  upstreamMouseMode?: string;
  tooltip: string;
  uiStatus: OristudioCpCommandUiStatus;
  disabledReason: string;
  shortcut?: string;
}

export interface OristudioCpLineTypeActionDefinition
  extends OristudioCpBaseActionDefinition {
  kind: 'line-type';
  group: 'line-type';
  lineColor: OristudioCpLineColor;
  lineInputMode: OristudioCpLineInputMode;
}

export interface OristudioCpCommandActionDefinition
  extends OristudioCpBaseActionDefinition {
  kind: 'command';
  command: OristudioCpCommandDefinition;
  operationId: OristudioCpOperationId;
  toolSteps?: readonly string[];
  inputMode?: OristudioCpActionInputMode;
  lineInputMode?: OristudioCpLineInputMode;
  repeatable?: boolean;
}

export type OristudioCpActionDefinition =
  | OristudioCpLineTypeActionDefinition
  | OristudioCpCommandActionDefinition;

/**
 * Line types that stay out of the rail. Unassigned is a real crease colour —
 * imported patterns carry it and the renderer draws it — but it is not
 * something you reach for while drawing, so it does not earn a chip.
 */
const HIDDEN_LINE_TYPE_IDS = new Set(['unassigned']);

export const ORISTUDIO_CP_LINE_TYPE_ACTIONS = [
  ...ORISTUDIO_CP_PRIMARY_LINE_COLOR_PALETTE.map((entry, index) =>
    lineTypeAction(
      entry.id,
      entry.label,
      entry.shortLabel,
      entry.lineColor,
      upstreamLineColorAction(entry.lineColor),
      `line-type-${entry.cssClass}`,
      // Keep palette order (M, V, E, A) explicit rather than leaning on a
      // stable sort, since the rail sorts every group by `railOrder`.
      index + 1,
      HIDDEN_LINE_TYPE_IDS.has(entry.id) ? 'hidden-ui-only' : 'left-rail'
    )
  ),
] as const satisfies readonly OristudioCpLineTypeActionDefinition[];

const AUXILIARY_DRAW_COMMAND = cpCommandByOperation('DrawCreaseFree');

const ORISTUDIO_CP_EXTRA_ACTION_GROUPS = [
  { id: 'line-type', label: 'Line type', railLabel: 'Type', order: 5 },
  { id: 'edit', label: 'Delete', railLabel: 'Delete', order: 25 },
] as const satisfies readonly OristudioCpActionGroupDefinition[];

export const ORISTUDIO_CP_ACTION_GROUPS: OristudioCpActionGroupDefinition[] = [
  ...ORISTUDIO_CP_EXTRA_ACTION_GROUPS,
  ...ORISTUDIO_CP_COMMAND_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    railLabel: group.railLabel,
    order: group.order,
    collapsedByDefault: group.id === 'advanced',
  })),
].sort((a, b) => a.order - b.order);

const ORIEDITA_RAIL_ACTION_OVERRIDES: Partial<
  Record<OristudioCpOperationId, Partial<OristudioCpCommandActionDefinition>>
> = {
  CreaseSelect: {
    label: 'Box Select',
    upstreamAction: 'selectAction',
    upstreamMouseMode: 'CREASE_SELECT_19',
    railOrder: 10,
  },
  SelectLineIntersecting: {
    label: 'Select Overlapping Lines',
    upstreamAction: 'select_lXAction',
    upstreamMouseMode: 'SELECT_LINE_INTERSECTING_68',
    railOrder: 20,
  },
  SelectPolygon: {
    label: 'Polygon Select',
    upstreamAction: 'select_polygonAction',
    upstreamMouseMode: 'SELECT_POLYGON_66',
    railOrder: 30,
  },
  SelectLasso: {
    label: 'Lasso Select',
    upstreamAction: 'selectLassoAction',
    upstreamMouseMode: 'SELECT_LASSO_74',
    railOrder: 40,
  },
  CreaseUnselect: {
    label: 'Box Deselect',
    upstreamAction: 'unselectAction',
    upstreamMouseMode: 'CREASE_UNSELECT_20',
    railOrder: 50,
  },
  UnselectLineIntersecting: {
    label: 'Deselect Overlapping Lines',
    upstreamAction: 'unselect_lXAction',
    upstreamMouseMode: 'UNSELECT_LINE_INTERSECTING_69',
    railOrder: 60,
  },
  UnselectPolygon: {
    label: 'Polygon Deselect',
    upstreamAction: 'unselect_polygonAction',
    upstreamMouseMode: 'UNSELECT_POLYGON_67',
    railOrder: 70,
  },
  UnselectLasso: {
    label: 'Lasso Deselect',
    upstreamAction: 'unselectLassoAction',
    upstreamMouseMode: 'UNSELECT_LASSO_75',
    railOrder: 80,
  },
  DrawCreaseFree: {
    id: 'cp.action.draw-crease',
    label: 'Line',
    group: 'draw',
    upstreamAction: 'drawCreaseFreeAction',
    upstreamMouseMode: 'DRAW_CREASE_FREE_1',
    railOrder: 10,
  },
  DrawCreaseRestricted: {
    label: 'Grid Restricted Line',
    group: 'draw',
    upstreamAction: 'drawCreaseRestrictedAction',
    upstreamMouseMode: 'DRAW_CREASE_RESTRICTED_11',
    railOrder: 20,
  },
  Inward: {
    label: 'Rabbit Ear',
    group: 'draw',
    upstreamAction: 'rabbitEarAction',
    upstreamMouseMode: 'INWARD_8',
    railOrder: 30,
  },
  VertexMakeAngularlyFlatFoldable: {
    label: 'Foldable Line',
    group: 'draw',
    upstreamAction: 'makeFlatFoldableAction',
    upstreamMouseMode: 'VERTEX_MAKE_ANGULARLY_FLAT_FOLDABLE_38',
    railOrder: 40,
  },
  LengthenCrease: {
    label: 'Extend Line',
    group: 'draw',
    upstreamAction: 'lengthenCreaseAction',
    upstreamMouseMode: 'LENGTHEN_CREASE_5',
    railOrder: 50,
  },
  PerpendicularDraw: {
    label: 'Perpendicular Line',
    group: 'draw',
    upstreamAction: 'perpendicularDrawAction',
    upstreamMouseMode: 'PERPENDICULAR_DRAW_9',
    railOrder: 60,
  },
  DrawCreaseAngleRestricted5: {
    label: 'Angle Restricted Line',
    group: 'draw',
    upstreamAction: 'deg2Action',
    upstreamMouseMode: 'DRAW_CREASE_ANGLE_RESTRICTED_5_37',
    railOrder: 70,
  },
  AngleSystem: {
    label: 'Offset Restricted Line',
    group: 'draw',
    upstreamAction: 'deg3Action',
    upstreamMouseMode: 'ANGLE_SYSTEM_16',
    railOrder: 80,
  },
  DrawCreaseAngleRestricted: {
    label: 'Converging Lines',
    group: 'draw',
    upstreamAction: 'deg1Action',
    upstreamMouseMode: 'DRAW_CREASE_ANGLE_RESTRICTED_13',
    railOrder: 90,
  },
  FoldableLineDraw: {
    label: 'Foldable Line (free)',
    group: 'draw',
    upstreamAction: 'foldableLineDrawAction',
    upstreamMouseMode: 'FOLDABLE_LINE_DRAW_71',
    railOrder: 100,
  },
  FoldableLineInput: {
    label: 'Flat Foldable Line (extend)',
    group: 'draw',
    upstreamAction: 'foldableLinePlusGridInputAction',
    upstreamMouseMode: 'FOLDABLE_LINE_INPUT_39',
    railOrder: 110,
  },
  ParallelDraw: {
    label: 'Parallel Line',
    group: 'draw',
    upstreamAction: 'parallelDrawAction',
    upstreamMouseMode: 'PARALLEL_DRAW_40',
    railOrder: 120,
  },
  SymmetricDraw: {
    label: 'Mirror Line',
    group: 'draw',
    upstreamAction: 'symmetricDrawAction',
    upstreamMouseMode: 'SYMMETRIC_DRAW_10',
    railOrder: 130,
  },
  SquareBisector: {
    label: 'Angle Bisector',
    group: 'draw',
    upstreamAction: 'angleBisectorAction',
    upstreamMouseMode: 'SQUARE_BISECTOR_7',
    railOrder: 140,
  },
  FishBoneDraw: {
    label: 'Parallel Alternating Lines',
    group: 'draw',
    upstreamAction: 'fishBoneDrawAction',
    upstreamMouseMode: 'FISH_BONE_DRAW_33',
    railOrder: 150,
  },
  DoubleSymmetricDraw: {
    label: 'Reflect Over Line',
    group: 'draw',
    upstreamAction: 'doubleSymmetricDrawAction',
    upstreamMouseMode: 'DOUBLE_SYMMETRIC_DRAW_35',
    railOrder: 160,
  },
  ContinuousSymmetricDraw: {
    label: 'Reflect Through Lines',
    group: 'draw',
    upstreamAction: 'continuousSymmetricDrawAction',
    upstreamMouseMode: 'CONTINUOUS_SYMMETRIC_DRAW_52',
    railOrder: 170,
  },
  // One rail tool over two operations, with count-vs-ratio a tool param. See
  // `cpToolVariants.ts`; the ratio variant keeps its action for the upstream
  // mouse-mode lookup, but has no button of its own.
  LineSegmentDivision: {
    label: 'Divided Line',
    group: 'draw',
    // The command's own tooltip names only its half of the merged tool.
    tooltip: 'Draw a line divided by count or ratio',
    upstreamAction: 'senbun_b_nyuryokuAction',
    upstreamMouseMode: 'LINE_SEGMENT_DIVISION_27',
    railOrder: 180,
  },
  LineSegmentRatioSet: {
    label: 'Divided Line (ratio)',
    group: 'draw',
    upstreamAction: 'drawLineSegmentInternalDivisionRatioAction',
    upstreamMouseMode: 'LINE_SEGMENT_RATIO_SET_28',
  },
  PolygonSetNoCorners: {
    label: 'Regular Polygon',
    upstreamAction: 'regularPolygonAction',
    upstreamMouseMode: 'POLYGON_SET_NO_CORNERS_29',
    railOrder: 60,
  },
  VoronoiCreate: {
    upstreamAction: 'voronoiAction',
    upstreamMouseMode: 'VORONOI_CREATE_62',
    railOrder: 70,
  },
  Axiom5: {
    group: 'draw',
    upstreamAction: 'axiom5Action',
    upstreamMouseMode: 'AXIOM_5',
    railOrder: 220,
  },
  Axiom7: {
    group: 'draw',
    upstreamAction: 'axiom7Action',
    upstreamMouseMode: 'AXIOM_7',
    railOrder: 230,
  },
  DrawPoint: {
    upstreamAction: 'vertexAddAction',
    upstreamMouseMode: 'DRAW_POINT_14',
  },
  DrawCreaseSymmetric: {
    label: 'Reflect selection over line',
    group: 'transform',
    upstreamAction: 'reflectAction',
    upstreamMouseMode: 'DRAW_CREASE_SYMMETRIC_12',
  },
  DrawCreaseAngleRestricted3: {
    upstreamAction: 'deg4Action',
    upstreamMouseMode: 'DRAW_CREASE_ANGLE_RESTRICTED_3_18',
  },
  ParallelDrawWidth: {
    upstreamAction: 'setParallelDrawWidthAction',
    upstreamMouseMode: 'PARALLEL_DRAW_WIDTH_51',
  },
  CreaseMove: {
    upstreamAction: 'moveAction',
    upstreamMouseMode: 'CREASE_MOVE_21',
  },
  CreaseCopy: {
    upstreamAction: 'copyAction',
    upstreamMouseMode: 'CREASE_COPY_22',
  },
  CreaseMove4p: {
    upstreamAction: 'move2p2pAction',
    upstreamMouseMode: 'CREASE_MOVE_4P_31',
  },
  CreaseCopy4p: {
    upstreamAction: 'copy2p2pAction',
    upstreamMouseMode: 'CREASE_COPY_4P_32',
  },
  OperationFrameCreate: {
    upstreamAction: 'operationFrameSelectAction',
    upstreamMouseMode: 'OPERATION_FRAME_CREATE_61',
  },
  // Merged into Extend Line above, with the colour mode a tool param. No rail
  // button of its own, but still bindable: a chord naming a variant arms the
  // merged tool in that variant's mode, which is how upstream's `E` keeps
  // meaning "extend, keeping each crease's colour". Labelled for that list.
  LengthenCreaseSameColor: {
    label: 'Extend Line (same color)',
    group: 'draw',
    upstreamAction: 'lengthenCrease2Action',
    upstreamMouseMode: 'LENGTHEN_CREASE_SAME_COLOR_70',
  },
  CreaseToggleMv: {
    label: 'Flip Mountain/Valley',
    group: 'color',
    upstreamAction: 'senbun_henkan2Action',
    upstreamMouseMode: 'CREASE_TOGGLE_MV_58',
  },
  CreaseMakeMv: {
    upstreamAction: 'in_L_col_changeAction',
    upstreamMouseMode: 'CREASE_MAKE_MV_34',
  },
  CreasesAlternateMv: {
    upstreamAction: 'on_L_col_changeAction',
    upstreamMouseMode: 'CREASES_ALTERNATE_MV_36',
  },
  CircleDraw: {
    upstreamAction: 'circleDrawAction',
    upstreamMouseMode: 'CIRCLE_DRAW_42',
  },
  CircleDrawThreePoint: {
    upstreamAction: 'circleDrawThreePointAction',
    upstreamMouseMode: 'CIRCLE_DRAW_THREE_POINT_43',
  },
  CircleDrawSeparate: {
    upstreamAction: 'circleDrawSeparateAction',
    upstreamMouseMode: 'CIRCLE_DRAW_SEPARATE_44',
  },
  CircleDrawTangentLine: {
    upstreamAction: 'circleDrawTangentLineAction',
    upstreamMouseMode: 'CIRCLE_DRAW_TANGENT_LINE_45',
  },
  CircleDrawInverted: {
    upstreamAction: 'circleDrawInvertedAction',
    upstreamMouseMode: 'CIRCLE_DRAW_INVERTED_46',
  },
  CircleDrawFree: {
    upstreamAction: 'circleDrawFreeAction',
    upstreamMouseMode: 'CIRCLE_DRAW_FREE_47',
  },
  CircleDrawConcentric: {
    upstreamAction: 'circleDrawConcentricAction',
    upstreamMouseMode: 'CIRCLE_DRAW_CONCENTRIC_48',
  },
  CircleDrawConcentricSelect: {
    upstreamAction: 'circleDrawConcentricSelectAction',
    upstreamMouseMode: 'CIRCLE_DRAW_CONCENTRIC_SELECT_49',
  },
  CircleDrawConcentricTwoCircleSelect: {
    upstreamAction: 'circleDrawTwoConcentricAction',
    upstreamMouseMode: 'CIRCLE_DRAW_CONCENTRIC_TWO_CIRCLE_SELECT_50',
  },
  Text: {
    upstreamAction: 'textAction',
    upstreamMouseMode: 'TEXT',
  },
  DrawBlintz: {
    upstreamAction: 'drawBlintzAction',
    upstreamMouseMode: 'DRAW_BLINTZ',
    railOrder: 10,
  },
  DrawFishBase: {
    upstreamAction: 'drawFishBaseAction',
    upstreamMouseMode: 'DRAW_FISH_BASE',
    railOrder: 20,
  },
  DrawDoveBase: {
    upstreamAction: 'drawDoveBaseAction',
    upstreamMouseMode: 'DRAW_DOVE_BASE',
    railOrder: 30,
  },
  DrawBirdBase: {
    upstreamAction: 'drawBirdBaseAction',
    upstreamMouseMode: 'DRAW_BIRD_BASE',
    railOrder: 40,
  },
  DrawFrogBase: {
    upstreamAction: 'drawFrogBaseAction',
    upstreamMouseMode: 'DRAW_FROG_BASE',
    railOrder: 50,
  },
  DisplayLengthBetweenPoints1: {
    upstreamAction: 'l1Action',
    upstreamMouseMode: 'DISPLAY_LENGTH_BETWEEN_POINTS_1_53',
  },
  DisplayLengthBetweenPoints2: {
    upstreamAction: 'l2Action',
    upstreamMouseMode: 'DISPLAY_LENGTH_BETWEEN_POINTS_2_54',
  },
  DisplayAngleBetweenThreePoints1: {
    upstreamAction: 'a1Action',
    upstreamMouseMode: 'DISPLAY_ANGLE_BETWEEN_THREE_POINTS_1_55',
  },
  DisplayAngleBetweenThreePoints2: {
    upstreamAction: 'a2Action',
    upstreamMouseMode: 'DISPLAY_ANGLE_BETWEEN_THREE_POINTS_2_56',
  },
  DisplayAngleBetweenThreePoints3: {
    upstreamAction: 'a3Action',
    upstreamMouseMode: 'DISPLAY_ANGLE_BETWEEN_THREE_POINTS_3_57',
  },
  FlatFoldableCheck: {
    upstreamAction: 'o_F_checkAction',
    upstreamMouseMode: 'FLAT_FOLDABLE_CHECK_63',
  },
  ModifyCalculatedShape: {
    upstreamAction: 'oriagari_sousa_2Action',
    upstreamMouseMode: 'MODIFY_CALCULATED_SHAPE_101',
  },
  MoveCalculatedShape: {
    upstreamAction: 'foldedFigureMoveAction',
    upstreamMouseMode: 'MOVE_CALCULATED_SHAPE_102',
  },
  ChangeStandardFace: {
    upstreamAction: 'koteimen_siteiAction',
    upstreamMouseMode: 'CHANGE_STANDARD_FACE_103',
  },
  AddFoldingConstraint: {
    upstreamAction: 'addColorConstraintAction',
    upstreamMouseMode: 'ADD_FOLDING_CONSTRAINT',
  },
  FoldingEstimate: {
    upstreamAction: 'foldAction',
  },
  FoldingEstimateSpecific: {
    upstreamAction: 'goToFoldedFigureAction',
  },
  FoldingEstimateSave100: {
    upstreamAction: 'As100Action',
  },
  TwoColoredCp: {
    upstreamAction: 'drawTwoColoredCpAction',
  },
  Fold: {
    upstreamAction: 'foldAction',
  },
  FoldAnother: {
    upstreamAction: 'anotherSolutionAction',
  },
  DuplicateFoldedModel: {
    upstreamAction: 'duplicateFoldedModelAction',
  },
  FoldedFigureSetModel: {
    upstreamAction: 'foldedFigureModel',
  },
  FoldedFigureSetDisplayStyle: {
    upstreamAction: 'FoldedFigureModel.setDisplayStyle',
  },
  FoldedFigureSetState: {
    upstreamAction: 'FoldedFigureModel.setState',
  },
  FoldedFigureSetStartingFace: {
    upstreamAction: 'koteimen_siteiAction',
    upstreamMouseMode: 'CHANGE_STANDARD_FACE_103',
  },
  FoldedFigureMoveCamera: {
    upstreamAction: 'foldedFigureMoveAction',
    upstreamMouseMode: 'MOVE_CALCULATED_SHAPE_102',
  },
  FoldedFigureSelectCanvasPoint: {
    upstreamAction: 'foldedFigureCanvasSelectService',
  },
  FoldedFigureRenderSnapshot: {
    upstreamAction: 'FoldedFigure_Drawer.foldUp_draw',
  },
  FoldedFigureImportFoldFrame: {
    upstreamAction: 'FoldImporter.file_frames',
  },
  FoldedFigureExportFoldFrames: {
    upstreamAction: 'FoldExporter.file_frames',
  },
  LineSegmentDelete: {
    label: 'Eraser',
    group: 'edit',
    upstreamAction: 'lineSegmentDeleteAction',
    upstreamMouseMode: 'LINE_SEGMENT_DELETE_3',
    railOrder: 5,
  },
  DeletePoint: {
    label: 'Delete Point',
    group: 'edit',
    upstreamAction: 'vertexDeleteAction',
    upstreamMouseMode: 'DELETE_POINT_15',
    railOrder: 10,
  },
  // The one rail entry that is not a mouse tool: a whole-document sweep that
  // runs on click. The same-type variant is the one on the rail because it is
  // the one carrying a keybinding; its ignore-type sibling stays in the Repair
  // menu, where the fuller label has room to say how it differs.
  DeleteExtraVertices: {
    group: 'edit',
    upstreamAction: 'v_del_allAction',
    railOrder: 15,
  },
  VertexDeleteOnCrease: {
    label: 'Delete any Vertex',
    group: 'edit',
    upstreamAction: 'v_del_ccAction',
    upstreamMouseMode: 'VERTEX_DELETE_ON_CREASE_41',
    railOrder: 20,
  },
  CreaseDeleteOverlapping: {
    label: 'Delete Coincident Lines',
    group: 'edit',
    upstreamAction: 'del_lAction',
    upstreamMouseMode: 'CREASE_DELETE_OVERLAPPING_64',
    railOrder: 30,
  },
  CreaseDeleteIntersecting: {
    label: 'Delete Overlapping Lines',
    group: 'edit',
    upstreamAction: 'del_l_XAction',
    upstreamMouseMode: 'CREASE_DELETE_INTERSECTING_65',
    railOrder: 40,
  },
};

export const ORISTUDIO_CP_ACTIONS: OristudioCpActionDefinition[] = [
  ...ORISTUDIO_CP_LINE_TYPE_ACTIONS,
  ...ORISTUDIO_CP_COMMANDS.map((command) =>
    commandAction(command, ORIEDITA_RAIL_ACTION_OVERRIDES[command.operationId])
  ),
  ...(AUXILIARY_DRAW_COMMAND
    ? [
        {
          ...commandAction(AUXILIARY_DRAW_COMMAND, {
            id: 'cp.action.draw-auxiliary-line',
            label: 'Draw auxiliary line',
            icon: 'scan-line',
            upstreamAction: 'h_senbun_nyuryokuAction',
            upstreamMouseMode: 'DRAW_CREASE_FREE_1',
            tooltip: 'Draw an Oriedita auxiliary line',
            uiStatus: 'not-implemented',
            disabledReason: 'Auxiliary-line insertion mode is not implemented in the CP kernel yet',
            lineInputMode: 'aux-line',
          }),
          // Not present in Oriedita's UI (and kernel not implemented) — hide the
          // rail button rather than show it disabled. Revisit at end.
          placement: 'hidden-ui-only',
        } satisfies OristudioCpCommandActionDefinition,
      ]
    : []),
];

function lineTypeAction(
  id: string,
  label: string,
  railLabel: string,
  lineColor: OristudioCpLineColor,
  upstreamAction: string,
  icon: string,
  railOrder: number,
  placement: OristudioCpCommandPlacement
): OristudioCpLineTypeActionDefinition {
  return {
    id: `cp.action.line-type.${id}`,
    kind: 'line-type',
    label,
    railLabel,
    group: 'line-type',
    placement,
    icon,
    railOrder,
    upstreamAction,
    tooltip: `Set active line type to ${label.toLowerCase()}`,
    uiStatus: 'ready',
    disabledReason: 'Ready',
    lineColor,
    lineInputMode: 'fold-line',
  };
}

function upstreamLineColorAction(lineColor: OristudioCpLineColor): string {
  switch (lineColor) {
    case 'Red1':
      return 'colRedAction';
    case 'Blue2':
      return 'colBlueAction';
    case 'Black0':
      return 'colBlackAction';
    case 'Cyan3':
      return 'colCyanAction';
    case 'Orange4':
      return 'colOrangeAction';
    case 'Yellow7':
      return 'colYellowAction';
    default:
      return 'lineColorAction';
  }
}

function commandAction(
  command: OristudioCpCommandDefinition,
  overrides: Partial<OristudioCpCommandActionDefinition> = {}
): OristudioCpCommandActionDefinition {
  return {
    id: actionIdForCommand(command),
    kind: 'command',
    label: command.label,
    group: command.group,
    placement: command.placement,
    icon: command.icon,
    upstreamAction: command.upstream,
    tooltip: command.tooltip,
    uiStatus: command.uiStatus,
    disabledReason: command.disabledReason,
    shortcut: command.shortcut,
    command,
    operationId: command.operationId,
    toolSteps: command.toolSteps,
    inputMode: command.inputMode,
    lineInputMode: 'fold-line',
    repeatable:
      command.operationId === 'DrawCreaseFree' ||
      command.operationId === 'DrawCreaseRestricted' ||
      command.operationId === 'LineSegmentDelete' ||
      command.operationId === 'CreaseSelect' ||
      command.operationId === 'CreaseUnselect' ||
      command.operationId === 'SelectPolygon' ||
      command.operationId === 'UnselectPolygon' ||
      command.operationId === 'SelectLineIntersecting' ||
      command.operationId === 'UnselectLineIntersecting' ||
      command.operationId === 'SelectLasso' ||
      command.operationId === 'UnselectLasso',
    ...overrides,
  };
}

function actionIdForCommand(command: OristudioCpCommandDefinition): OristudioCpActionId {
  return `cp.action.${command.id.replace(/^cp\./u, '')}`;
}

export function cpActionsForGroup(group: OristudioCpActionGroupId): OristudioCpActionDefinition[] {
  return sortActionsForRail(ORISTUDIO_CP_ACTIONS.filter((action) => action.group === group));
}

export function cpActionById(
  actionId: OristudioCpActionId
): OristudioCpActionDefinition | undefined {
  return ORISTUDIO_CP_ACTIONS.find((action) => action.id === actionId);
}

export function cpActionByOperation(
  operationId: OristudioCpOperationId
): OristudioCpCommandActionDefinition | undefined {
  return ORISTUDIO_CP_ACTIONS.find(
    (action): action is OristudioCpCommandActionDefinition =>
      action.kind === 'command' && action.operationId === operationId
  );
}

export function cpActionByUpstreamMouseMode(
  mouseMode: string
): OristudioCpCommandActionDefinition | undefined {
  return ORISTUDIO_CP_ACTIONS.find(
    (action): action is OristudioCpCommandActionDefinition =>
      action.kind === 'command' && action.upstreamMouseMode === mouseMode
  );
}

export function cpRailActions(): OristudioCpActionDefinition[] {
  return sortActionsForRail(
    ORISTUDIO_CP_ACTIONS.filter(
      (action) => action.placement === 'left-rail' || action.placement === 'left-rail-overflow'
    )
  );
}

/**
 * Actions deliberately kept off every surface. They stay in the registry so the
 * kernel, upstream-action lookups, and `.cp` mouse-mode round-tripping keep
 * parity — which is exactly why none of them may hold a default chord. The
 * chord would still dispatch (see `handleShortcutKeyDown`), selecting a tool
 * with no rail button to show it is active. Asserted in shortcutRegistry.test.
 */
export function cpHiddenActions(): OristudioCpActionDefinition[] {
  return ORISTUDIO_CP_ACTIONS.filter((action) => action.placement === 'hidden-ui-only');
}

function sortActionsForRail(
  actions: OristudioCpActionDefinition[]
): OristudioCpActionDefinition[] {
  return [...actions].sort((a, b) => {
    const groupA = actionGroupOrder(a.group);
    const groupB = actionGroupOrder(b.group);
    if (groupA !== groupB) return groupA - groupB;
    return actionOrder(a) - actionOrder(b);
  });
}

function actionGroupOrder(group: OristudioCpActionGroupId): number {
  return ORISTUDIO_CP_ACTION_GROUPS.find((definition) => definition.id === group)?.order ?? 999;
}

function actionOrder(action: OristudioCpActionDefinition): number {
  return action.railOrder ?? 10_000;
}
