import type {
  OristudioCpActionDefinition,
  OristudioCpCommandActionDefinition,
} from './oristudioCpActions';
import type { OristudioCpCommandDefinition } from './oristudioCpCommands';

export interface OristudioCpToolInstructions {
  intro?: readonly string[];
  steps?: readonly string[];
  notes?: readonly string[];
}

export const ORIEDITA_CP_TOOL_INSTRUCTIONS: Record<string, OristudioCpToolInstructions> = {
  angleBisectorAction: {
    intro: ['Draw angle bisector between lines or points.'],
    steps: [
      'Select 2 segments or 3 points.',
      '3-point method: select 3 points, then select segment to end.',
      '2-line method: select 2 lines, then select segment to end.',
      'Parallel line method: select segment/indicator to end.',
    ],
  },
  As100Action: {
    intro: ['Calculate 100 solutions of folded shape and save them as image files.'],
  },
  axiom5Action: {
    intro: ['Draw a line that places point A to a line while passing through point B.'],
    steps: [
      'Select point A.',
      'Select a line.',
      'Select point B.',
      'Select a target line to extend to, or select the indicator to extend.',
    ],
    notes: [
      'Distance between point A and point B must be equal or greater than projected distance between point B and the line.',
    ],
  },
  axiom7Action: {
    intro: ['Draw a line that places a point to line A, while perpendicular to line B.'],
    steps: [
      'Select a point.',
      'Select lines A and B.',
      'Select a target line to extend to, or select the indicator to extend.',
    ],
    notes: ["The point must not be on line A's span and line B must not be parallel with line A."],
  },
  a1Action: {
    intro: ['Measure angle by selecting points ABC.'],
  },
  a2Action: {
    intro: ['Measure angle by selecting points ABC.'],
  },
  a3Action: {
    intro: ['Measure angle by selecting points ABC.'],
  },
  addColorConstraintAction: {
    intro: ['Add color constraints to folded shape.'],
    steps: ['Select a point on a face on the folded shape to set the color it should have.'],
    notes: [
      'White circles mean the face shows the white side; black circles mean the face shows the color side.',
      'Fold again to use the constraints to find a new solution.',
    ],
  },
  anotherSolutionAction: {
    intro: ['Calculate the next available solution for folded shape.'],
  },
  circleDrawAction: {
    intro: ['Draw circles snapping to grid and vertices.'],
  },
  circleDrawConcentricAction: {
    intro: ['Draw concentric circle.'],
    steps: ['Select circle A to set position.', 'Draw a line to set radius.'],
    notes: [
      'Difference between radii of concentric circle and circle A is equal to length of the line.',
    ],
  },
  circleDrawConcentricSelectAction: {
    intro: ['Draw concentric circle by selecting circles ABC.'],
    steps: ['Select circle A to set position.', 'Select circles B and C to set radius.'],
    notes: [
      'Circle is drawn concentric to circle A.',
      'Difference between radii of concentric circle and circle A is equal to difference between radii of circles B and C.',
    ],
  },
  circleDrawFreeAction: {
    intro: ['Free draw circles.'],
  },
  circleDrawInvertedAction: {
    intro: ['Draw inverted circle by selecting circles or lines.'],
    steps: ['Select a circle or a line.', 'Select inversion circle.'],
  },
  circleDrawSeparateAction: {
    intro: ['Draw a circle by selecting a point and drawing a line.'],
    notes: ['Circle is drawn on selected point and radius is equal to length of drawn line.'],
  },
  circleDrawTangentLineAction: {
    intro: ['Draw tangent line.'],
    steps: ['Select two circles, or select a point and a circle.', 'Select tangent line to draw.'],
  },
  circleDrawThreePointAction: {
    intro: ['Draw a circle passing through 3 selected points.'],
  },
  circleDrawTwoConcentricAction: {
    intro: ['Draw connecting concentric circles by selecting two circles.'],
    notes: ['Differences of radii between concentric and selected circles are equal.'],
  },
  colBlackAction: {
    intro: ['Draw new creases as edge (border) lines.'],
    notes: ['Sets the active line type; it stays in effect until another type is picked.'],
  },
  colBlueAction: {
    intro: ['Draw new creases as valley folds.'],
    notes: ['Sets the active line type; it stays in effect until another type is picked.'],
  },
  colCyanAction: {
    intro: ['Draw new creases as auxiliary (construction) lines.'],
    notes: ['Auxiliary lines are guides — they are not folded.'],
  },
  colRedAction: {
    intro: ['Draw new creases as mountain folds.'],
    notes: ['Sets the active line type; it stays in effect until another type is picked.'],
  },
  lineColorAction: {
    intro: ['Draw new creases as unassigned lines.'],
    notes: ['Unassigned creases have no fold direction yet, so foldability checks skip them.'],
  },
  continuousSymmetricDrawAction: {
    intro: ['Draw a line reflecting through crease lines.'],
    steps: ['Select 2 points to draw a line reflecting and alternating through crease lines.'],
    notes: ['Reflection continues until it hits an edge or a vertex with 3 or more lines.'],
  },
  copy2p2pAction: {
    intro: ['Copy and transform selected lines by selecting origin and target points.'],
    steps: ['Select points AB to set origin.', 'Select points CD to set a target.'],
    notes: [
      'Selected lines are copied and transformed to a new position, scale, and angle based on relation between points AB and CD.',
      'Point A is transformed to point C and point B is transformed to point D.',
    ],
  },
  copyAction: {
    intro: ['Copy selected lines by drawing a line.'],
  },
  deg1Action: {
    intro: ['Draw converging lines with angle offset.'],
    steps: [
      'Set offset by selecting a line or selecting 2 points.',
      'Select intersection of converging lines.',
    ],
  },
  deg2Action: {
    intro: ['Draw angle restricted line with selected angle restriction.'],
  },
  deg3Action: {
    intro: ['Draw angle restricted line with offset.'],
    steps: ['Select 2 points to set angle offset.', 'Select a target line to extend to.'],
  },
  deg4Action: {
    intro: ['Draw angle restricted line with offset.'],
    steps: ['Select 2 points to set angle offset.', 'Select a target line to extend to.'],
  },
  del_lAction: {
    intro: ['Delete all coinciding lines by drawing a line.'],
  },
  del_l_XAction: {
    intro: ['Delete all intersecting lines by drawing a line.'],
  },
  doubleSymmetricDrawAction: {
    intro: ['Reflect contacting lines over the drawn line.'],
    steps: ['Draw a line over the end points of lines to reflect them.'],
  },
  drawBlintzAction: {
    intro: ['Draw a blintz by selecting 2 opposite corner points.'],
  },
  drawBirdBaseAction: {
    intro: ['Draw a bird base by selecting 2 opposite corner points.'],
  },
  drawCreaseFreeAction: {
    intro: ['Free draw straight lines.'],
  },
  drawCreaseRestrictedAction: {
    intro: ['Draw lines snapping to grid and vertices.'],
  },
  drawDoveBaseAction: {
    intro: ['Draw a dove base by selecting 2 opposite corner points.'],
  },
  drawFishBaseAction: {
    intro: ['Draw a fish base by selecting 2 opposite corner points.'],
  },
  drawFrogBaseAction: {
    intro: ['Draw a frog base by selecting 2 opposite corner points.'],
  },
  drawLineSegmentInternalDivisionRatioAction: {
    intro: ['Draw a line divided by the set ratio.'],
  },
  drawTwoColoredCpAction: {
    intro: ['Create two-color crease pattern with selected crease lines.'],
  },
  duplicateFoldedModelAction: {
    intro: ['Duplicate folded shape.'],
  },
  fishBoneDrawAction: {
    intro: ['Draw perpendicular parallel lines alternating in mountain and valley by drawing a line.'],
    notes: ['The interval of the parallel lines will be equal to the width of grid.'],
  },
  foldableLineDrawAction: {
    intro: ['Draw flat foldable line.'],
    steps: [
      'Select vertex with odd number of connecting lines.',
      'Select flat foldable line.',
      'Select a target line to extend to.',
    ],
    notes: ['Draw anywhere to free draw.'],
  },
  foldableLinePlusGridInputAction: {
    intro: ['Draw flat foldable line.'],
    steps: [
      'Select vertex with odd number of connecting lines.',
      'Select flat foldable line.',
      'Select a target line to extend to.',
    ],
    notes: ['Select a line to extend it.'],
  },
  foldAction: {
    intro: ['Calculate folded shape from crease pattern.'],
  },
  foldedFigureMoveAction: {
    intro: ['Move folded shape.'],
  },
  goToFoldedFigureAction: {
    intro: ['Go to specific solution of folded shape.'],
  },
  h_senbun_nyuryokuAction: {
    intro: ['Draw marker lines.'],
    notes: ['Marker lines do not interfere with crease lines.'],
  },
  in_L_col_changeAction: {
    intro: ['Alternate colors of line segments in mountain and valley by drawing a line.'],
  },
  koteimen_siteiAction: {
    intro: ['Set starting face by selecting a face.'],
    notes: ['Folded shape is calculated relative to starting face.'],
  },
  // Upstream's help says only "Display the length between two points"; the
  // grid-units claim these notes used to carry described neither what the kernel
  // computes (a raw model-space distance) nor what is displayed.
  l1Action: {
    intro: ['Measure a distance between two points, or an angle at a vertex.'],
    steps: [
      'Choose distance or angle.',
      'Pick the points, or click a crease to measure it in one click.',
    ],
    notes: [
      'Choose the units the value reads in; the paper edge is 1 by default.',
      'Click the value to copy it at full precision.',
      'Measurements are cleared when you leave the tool.',
    ],
  },
  l2Action: {
    intro: ['Measure length by selecting 2 points.'],
  },
  makeFlatFoldableAction: {
    intro: ['Draw flat foldable line.'],
    steps: [
      'Select vertex with odd number of connecting lines.',
      'Select flat foldable line.',
      'Select a target line to extend to.',
    ],
  },
  lengthenCreaseAction: {
    intro: ['Extend a line with selected color.'],
    steps: [
      'Select or draw a line to select lines.',
      'Select a target line to extend to, or select previous line to extend.',
    ],
  },
  lengthenCrease2Action: {
    intro: ['Extend a line with same color.'],
    steps: [
      'Select or draw a line to select lines.',
      'Select a target line to extend to, or select previous line to extend.',
    ],
  },
  move2p2pAction: {
    intro: ['Transform selected lines by selecting origin and target points.'],
    steps: ['Select points AB to set origin.', 'Select points CD to set a target.'],
    notes: [
      'Selected lines are transformed to a new position, scale, and angle based on relation between points AB and CD.',
      'Point A is transformed to point C and point B is transformed to point D.',
    ],
  },
  moveAction: {
    intro: ['Move selected lines by drawing a line.'],
  },
  o_F_checkAction: {
    intro: ['Check flat foldability inside polygon.'],
    steps: [
      'Click or click and drag to add segments.',
      'Select starting point to close polygon.',
    ],
    notes: [
      'Polygon turns cyan if pattern inside it is flat foldable, otherwise it stays magenta.',
      'If the tool does not work as intended, vertices and segments should not be on crease pattern vertices.',
    ],
  },
  on_L_col_changeAction: {
    intro: ['Alternate colors of intersecting lines in mountain and valley by drawing a line.'],
  },
  operationFrameSelectAction: {
    intro: ['Create operation frame by drawing a rectangle.'],
    notes: ['Operation frame crops the exported image.'],
  },
  oriagari_sousa_2Action: {
    intro: ['Modify folded shape by dragging vertices.'],
  },
  parallelDrawAction: {
    intro: ['Draw parallel line from a point.'],
    steps: [
      'Select a point.',
      'Select a line to make parallel to.',
      'Select a target line to extend to.',
    ],
  },
  perpendicularDrawAction: {
    intro: ['Draw perpendicular line.'],
    steps: ['Select starting point A.', 'Select a target line B.'],
    notes: [
      'A line is drawn from point A to line B perpendicular to line B.',
      'If point A is on line B, select a target line to extend to, or select the indicator to extend.',
    ],
  },
  rabbitEarAction: {
    intro: ['Draw lines toward inner center.'],
    steps: [
      'Select point A.',
      'Select point B.',
      'Select point C.',
      'Three lines toward inner center are drawn.',
    ],
  },
  regularPolygonAction: {
    intro: ['Draw regular polygon by selecting points AB.'],
    notes: ['Points AB will form one side of polygon, which will be drawn clockwise.'],
  },
  reflectAction: {
    intro: ['Reflect selected lines over a line drawn with 2 points.'],
  },
  selectAction: {
    intro: ['Select lines by drawing a rectangle.'],
  },
  select_lXAction: {
    intro: ['Select overlapping lines by drawing a line.'],
  },
  select_polygonAction: {
    intro: ['Select lines by drawing polygon.'],
    notes: ['Lines completely inside polygon are selected.'],
  },
  selectLassoAction: {
    intro: ['Select lines by drawing freehand.'],
  },
  senbun_b_nyuryokuAction: {
    intro: ['Draw segmented line with selected division.'],
  },
  symmetricDrawAction: {
    intro: ['Draw mirror line by selecting points or lines.'],
    steps: [
      'Select points ABC to mirror line AB over line BC.',
      'Or select lines AB to mirror line A over line B.',
    ],
  },
  setParallelDrawWidthAction: {
    intro: ['Draw parallel line by selecting a line.'],
    steps: [
      'Select a line.',
      'Click and drag to set offset width.',
      'Select parallel line to draw.',
    ],
  },
  textAction: {
    intro: ['Add and edit text annotations.'],
    steps: [
      'Click an empty spot to add text there.',
      'Click a label to edit it; drag to move it.',
    ],
    notes: [
      'Press ESC or click away to finish an edit; empty text is discarded.',
      'Right-click a label, or select it and press Delete, to remove it.',
    ],
  },
  unselectAction: {
    intro: ['Deselect lines by drawing a rectangle.'],
  },
  unselect_lXAction: {
    intro: ['Deselect overlapping lines by drawing a line.'],
  },
  unselect_polygonAction: {
    intro: ['Deselect lines by drawing polygon.'],
    notes: ['Lines completely inside polygon are deselected.'],
  },
  unselectLassoAction: {
    intro: ['Deselect lines by drawing freehand.'],
    notes: ['Lines completely inside drawn area are deselected.'],
  },
  v_del_ccAction: {
    intro: ['Delete a vertex on a straight line.'],
  },
  vertexDeleteAction: {
    intro: ['Delete a vertex on a straight line of uniform color.'],
  },
  vertexAddAction: {
    intro: ['Add a vertex.'],
  },
  voronoiAction: {
    intro: ['Draw voronoi pattern by selecting points.'],
    notes: [
      'Selecting points again will cancel them.',
      'Select apply temporary lines to change them to crease lines.',
    ],
  },
};

export function instructionsForCpAction(
  action: OristudioCpActionDefinition | null | undefined
): OristudioCpToolInstructions | null {
  if (!action) return null;
  const fallbackUpstream =
    isCommandAction(action) ? action.command.upstream : undefined;
  return (
    instructionsForOrieditaAction(action.upstreamAction) ??
    instructionsForOrieditaAction(fallbackUpstream) ??
    fallbackInstructionsForCpAction(action)
  );
}

export function instructionsForCpTool(
  action: OristudioCpActionDefinition | null | undefined,
  command: OristudioCpCommandDefinition | null | undefined
): OristudioCpToolInstructions | null {
  return instructionsForCpAction(action) ?? instructionsForOrieditaAction(command?.upstream);
}

export function instructionsForOrieditaAction(
  upstreamAction: string | null | undefined
): OristudioCpToolInstructions | null {
  if (!upstreamAction) return null;
  return ORIEDITA_CP_TOOL_INSTRUCTIONS[upstreamAction] ?? null;
}

/**
 * The `ORIEDITA_CP_TOOL_INSTRUCTIONS` dictionary key that {@link instructionsForCpTool}
 * would resolve to, or null when it falls back to action-derived instructions. Used to key
 * translations of the (otherwise data-sourced) instruction text.
 */
export function resolvedOrieditaInstructionKey(
  action: OristudioCpActionDefinition | null | undefined,
  command: OristudioCpCommandDefinition | null | undefined
): string | null {
  if (action) {
    if (action.upstreamAction && ORIEDITA_CP_TOOL_INSTRUCTIONS[action.upstreamAction]) {
      return action.upstreamAction;
    }
    const fallbackUpstream = isCommandAction(action) ? action.command.upstream : undefined;
    if (fallbackUpstream && ORIEDITA_CP_TOOL_INSTRUCTIONS[fallbackUpstream]) {
      return fallbackUpstream;
    }
  }
  if (command?.upstream && ORIEDITA_CP_TOOL_INSTRUCTIONS[command.upstream]) {
    return command.upstream;
  }
  return null;
}

function isCommandAction(
  action: OristudioCpActionDefinition
): action is OristudioCpCommandActionDefinition {
  return action.kind === 'command';
}

function fallbackInstructionsForCpAction(
  action: OristudioCpActionDefinition
): OristudioCpToolInstructions | null {
  if (!isCommandAction(action)) return null;

  const intro =
    action.tooltip && action.tooltip !== action.label
      ? [action.tooltip]
      : [`Use ${action.label}.`];
  const steps = action.toolSteps?.length ? [...action.toolSteps] : undefined;
  const notes =
    action.uiStatus === 'ready' ? undefined : [action.disabledReason];

  return { intro, steps, notes };
}
