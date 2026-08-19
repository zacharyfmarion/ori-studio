/**
 * The Square tool's params, translated for the kernel.
 *
 * Three jobs, all pure:
 *
 * - **Units.** The user types grid cells or paper edges; the kernel takes model
 *   units and knows about neither. Converting here matches how `ParallelDrawWidth`
 *   already handles its `width`, and keeps the grid out of the kernel's square
 *   code.
 * - **Enum shape.** The kernel's `SquareOrientation` / `SquareAnchor` serialize as
 *   PascalCase variants; the tool options are kebab-case like every other option.
 * - **Line colour.** Square draws in Edge by default, with the active line type as
 *   a param. `resolveCpToolLineColor` is the *one* place that decision is made, so
 *   the payload and the live preview cannot disagree — a square that previewed in
 *   mountain red and committed in edge black would be the obvious bug here.
 */
import type {
  OristudioCpCommandPayload,
  OristudioCpLineColor,
  OristudioCpSquareAnchorPayload,
  OristudioCpSquareOrientationPayload,
} from '../../engine/oristudioCpTypes';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { ORIEDITA_PAPER_SIZE } from '../../lib/creasePatternViewport';
import type {
  OristudioCpSquareAnchor,
  OristudioCpSquareOrientation,
  OristudioCpSquareSizeUnit,
  OristudioCpToolOptions,
} from '../../lib/oristudioCpToolSettings';

/** Oriedita's Edge colour — what a square's edges take unless told otherwise. */
const EDGE_LINE_COLOR: OristudioCpLineColor = 'Black0';

/**
 * How many model units one unit of `unit` is worth.
 *
 * A grid cell is `400 / gridSize` model units, which the caller already has as
 * the active grid width. When there is no usable grid width — no grid metadata,
 * or a degenerate one — grid sizing has nothing to mean, so it falls back to the
 * paper edge rather than silently producing a square of size zero.
 */
export function squareSizeUnitScale(
  unit: OristudioCpSquareSizeUnit,
  gridWidth: number | undefined,
): number {
  if (unit === 'paper') return ORIEDITA_PAPER_SIZE;
  return gridWidth !== undefined && Number.isFinite(gridWidth) && gridWidth > 0
    ? gridWidth
    : ORIEDITA_PAPER_SIZE;
}

/** The square's bounding extent in model units, as the kernel wants it. */
export function squareExtentInModelUnits(
  size: number,
  unit: OristudioCpSquareSizeUnit,
  gridWidth: number | undefined,
): number {
  return size * squareSizeUnitScale(unit, gridWidth);
}

/**
 * The same size expressed in a different unit.
 *
 * Switching the unit should not resize the square. Reinterpreting "4" from four
 * cells to four paper edges would ask for a square 32× too big on a typical
 * grid, which reads as the control being broken rather than as a unit change.
 */
export function convertSquareSize(
  size: number,
  from: OristudioCpSquareSizeUnit,
  to: OristudioCpSquareSizeUnit,
  gridWidth: number | undefined,
): number {
  if (from === to) return size;
  const converted =
    (size * squareSizeUnitScale(from, gridWidth)) / squareSizeUnitScale(to, gridWidth);
  // Cells land on whole or half numbers; paper edges do not. Rounding keeps the
  // stepper showing a number someone would have typed instead of 3.9999999996.
  return Number.isFinite(converted) ? Number(converted.toFixed(4)) : size;
}

/**
 * The Square-specific half of a `SquareGenerate` command payload.
 *
 * Assembled here rather than in the panel's payload builder: translating tool
 * options into kernel fields — units, enum spelling — is this module's whole job,
 * and the panel is a composition site.
 */
export function squareCommandPayload(
  options: Pick<
    OristudioCpToolOptions,
    'squareSize' | 'squareSizeUnit' | 'squareOrientation' | 'squareAnchor'
  >,
  gridWidth: number | undefined,
): Pick<OristudioCpCommandPayload, 'square_extent' | 'square_orientation' | 'square_anchor'> {
  return {
    square_extent: squareExtentInModelUnits(options.squareSize, options.squareSizeUnit, gridWidth),
    square_orientation: squareOrientationPayload(options.squareOrientation),
    square_anchor: squareAnchorPayload(options.squareAnchor),
  };
}

const SQUARE_ORIENTATION_PAYLOAD: Record<
  OristudioCpSquareOrientation,
  OristudioCpSquareOrientationPayload
> = {
  normal: 'Normal',
  diagonal: 'Diagonal',
};

const SQUARE_ANCHOR_PAYLOAD: Record<OristudioCpSquareAnchor, OristudioCpSquareAnchorPayload> = {
  'top-left': 'TopLeft',
  'top-center': 'TopCenter',
  'top-right': 'TopRight',
  'middle-left': 'MiddleLeft',
  center: 'Center',
  'middle-right': 'MiddleRight',
  'bottom-left': 'BottomLeft',
  'bottom-center': 'BottomCenter',
  'bottom-right': 'BottomRight',
};

export function squareOrientationPayload(
  orientation: OristudioCpSquareOrientation,
): OristudioCpSquareOrientationPayload {
  return SQUARE_ORIENTATION_PAYLOAD[orientation];
}

export function squareAnchorPayload(
  anchor: OristudioCpSquareAnchor,
): OristudioCpSquareAnchorPayload {
  return SQUARE_ANCHOR_PAYLOAD[anchor];
}

/**
 * The line colour the active tool will actually draw in.
 *
 * Every tool but Square draws in the active line type, so this returns the
 * active colour unchanged for all of them. Square is the one tool that can
 * override it, and routing *both* the command payload and the preview stroke
 * through this function is what guarantees they agree.
 */
export function resolveCpToolLineColor(
  operationId: OristudioCpOperationId | null | undefined,
  options: Pick<OristudioCpToolOptions, 'squareLineType'>,
  activeLineColor: OristudioCpLineColor,
): OristudioCpLineColor {
  if (operationId !== 'SquareGenerate') return activeLineColor;
  return options.squareLineType === 'edge' ? EDGE_LINE_COLOR : activeLineColor;
}
