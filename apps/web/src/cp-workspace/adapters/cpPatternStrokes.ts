/**
 * A crease pattern drawn as Edit's canvas draws one, for a pane that is not
 * Edit's canvas: Fold's crease-pattern pane (`useFoldCreasePatternStrokes`)
 * and the Layer order dialog's (`implementation-plans/layer-order-dialog.md`,
 * U7).
 *
 * - Each line takes its ink and dash from Edit's line-style table
 *   (`createCpLineAppearanceResolver`, for the line style given) and is
 *   packed by Edit's builder (`cpSnapshotToScene`), on the crease channel.
 * - An instruction over it is drawn as Edit draws a tool's line: in the
 *   colour of the crease it makes, solid (`previewGroupsToStrokes`), wider
 *   than the pattern by its own multiplier, on the preview channel.
 * - Every stroke is measured from Edit's crease width over the line width
 *   given (`cpCreaseStrokeWidthPx`), which the result carries for the pane.
 *
 * The line style and width are arguments: whose view they are is the
 * caller's. The inks are the theme's, read off `element`.
 *
 * Pure: no React, no store.
 */
import type { OristudioCpLineStyle } from '../../lib/creasePatternViewport';
import type { Point } from '../../lib/geometry';
import { cpLineStyleDashPatterns } from '../../lib/oristudioCpLineStyle';
import { previewGroupsToStrokes, type PreviewStrokeGroup } from '../renderer/previewStrokes';
import type { StrokeGeometry } from '../renderer/types';
import { resolveCpLineColor } from './cpLineColor';
import { createCpLineAppearanceResolver } from './cpLineStyle';
import { cpSnapshotToScene, type CpLineSegmentInput } from './cpSnapshotToScene';

/** The view settings a pattern is drawn in. */
export interface CpPatternStyle {
  /** Each line's ink and dash. */
  lineStyle: OristudioCpLineStyle;
  /** A crease is drawn at Edit's crease width over it. */
  lineWidth: number;
}

/** Lines over the pattern that make one kind of crease. */
export interface CpPatternInstructionGroup {
  /** Edit's line colour of the crease they make (`Red1`, `Blue2`): what they are drawn in. */
  color: string;
  segments: readonly { a: Point; b: Point }[];
}

/** Lines drawn over the pattern as a tool's line is: a step's own creases, or a fold's to come. */
export interface CpPatternInstruction {
  /** In drawing order, each over the one before. */
  groups: readonly CpPatternInstructionGroup[];
  /** How many times a crease's width they are drawn at. */
  widthMul: number;
}

/** A pattern's strokes, for a pane's channels. */
export interface CpPatternStrokes {
  /** The pattern, for the crease channel. */
  creases: StrokeGeometry;
  /** The instruction, for the preview channel; null for none. */
  instruction: StrokeGeometry | null;
  /** The line width a crease is drawn at over (`cpCreaseStrokeWidthPx`). */
  lineWidth: number;
}

/** The strokes of `creases` (Edit's document lines, in painter's order) and of an instruction over them. */
export function cpPatternStrokes(
  creases: readonly CpLineSegmentInput[],
  element: Element,
  style: CpPatternStyle,
  instruction: CpPatternInstruction | null = null
): CpPatternStrokes {
  const appearanceFor = createCpLineAppearanceResolver(style.lineStyle, 'mvf', element);
  const pattern = cpSnapshotToScene(creases, appearanceFor, cpLineStyleDashPatterns(style.lineStyle)).strokes;
  const groups: PreviewStrokeGroup[] = (instruction?.groups ?? []).flatMap((group) =>
    group.segments.length > 0 ? [{ segments: group.segments, color: resolveCpLineColor(group.color, 'mvf', element) }] : []
  );
  let over: StrokeGeometry | null = null;
  if (instruction && groups.length > 0) {
    over = previewGroupsToStrokes(groups);
    over.widthMul.fill(instruction.widthMul);
  }
  return { creases: pattern, instruction: over, lineWidth: style.lineWidth };
}
