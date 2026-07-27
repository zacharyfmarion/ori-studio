/**
 * Oriedita's `LineStyle` (oriedita.editor.canvas.LineStyle), ported.
 *
 * A line style repaints and re-dashes the crease pattern without touching the
 * document: each crease keeps its own `LineColor`, and the style decides what
 * ink and dash pattern that colour draws with. The rules come from
 * `DrawingUtil.drawCpLine` plus the two things its caller establishes:
 *
 * - `CreasePattern_Worker_Impl` sets the graphics colour to black before the CP
 *   pass, which is why the two "black" styles — whose `drawCpLine` branches
 *   never call `setColor` — paint every crease black.
 * - The same loop routes `CYAN_3` auxiliary creases to `drawAuxLine`, which has
 *   no line-style branch at all, so auxiliaries keep their own colour and stay
 *   solid under every style.
 *
 * `SvgExporter.exportSvgWithCamera` restates the identical table for export,
 * which is why both the canvas and the export path resolve style here.
 */
import { cpLineStyleColorKind, type OristudioCpLineStyle } from './creasePatternViewport';

/**
 * Dash patterns from `DrawingUtil`, as alternating on/off run lengths. Upstream
 * applies them as device-pixel `BasicStroke` dashes, so they do not scale with
 * zoom; here they are CSS px for the same reason.
 */
export const ORIEDITA_DASH_ONE_DOT: readonly number[] = [10, 3, 3, 3]; // dash_M1, 一点鎖線
export const ORIEDITA_DASH_TWO_DOT: readonly number[] = [10, 3, 3, 3, 3, 3]; // dash_M2, 二点鎖線
export const ORIEDITA_DASH_VALLEY: readonly number[] = [8, 8]; // dash_V, 破線

/** Dash slots addressed by {@link cpLineStyleDashSlot}; 0 is always solid. */
export const SOLID_DASH_SLOT = 0;
/** Slot of the mountain chain pattern within {@link cpLineStyleDashPatterns}. */
export const MOUNTAIN_DASH_SLOT = 1;
/** Slot of the valley dash pattern within {@link cpLineStyleDashPatterns}. */
export const VALLEY_DASH_SLOT = 2;

/** Which ink a crease draws with once the line style has had its say. */
export type CpLineInk = 'own' | 'black' | 'grey';

/**
 * The stroke colour a line colour paints with under `style`: its own colour, the
 * monochrome ink, or Oriedita's `GREY_10` (`#A2A2A2`).
 */
export function cpLineStyleInk(style: OristudioCpLineStyle, color: string): CpLineInk {
  const kind = cpLineStyleColorKind(color);
  if (kind === 'aux') return 'own';
  switch (style) {
    case 'color':
    case 'color-and-shape':
      return 'own';
    case 'black-white':
      if (kind === 'edge' || kind === 'mountain') return 'black';
      return kind === 'valley' ? 'grey' : 'own';
    case 'black-one-dot':
    case 'black-two-dot':
      return 'black';
  }
}

/**
 * The dash slot a line colour draws with under `style`, indexing the table
 * {@link cpLineStyleDashPatterns} returns for that same style.
 */
export function cpLineStyleDashSlot(style: OristudioCpLineStyle, color: string): number {
  const kind = cpLineStyleColorKind(color);
  if (kind === 'aux') return SOLID_DASH_SLOT;
  switch (style) {
    case 'color':
    case 'black-white':
      return SOLID_DASH_SLOT;
    case 'color-and-shape':
    case 'black-one-dot':
    case 'black-two-dot':
      if (kind === 'mountain') return MOUNTAIN_DASH_SLOT;
      return kind === 'valley' ? VALLEY_DASH_SLOT : SOLID_DASH_SLOT;
  }
}

/**
 * The dash patterns `style` puts in play, ordered so entry `i` is slot `i + 1`.
 * Empty for the two solid styles.
 */
export function cpLineStyleDashPatterns(
  style: OristudioCpLineStyle
): readonly (readonly number[])[] {
  switch (style) {
    case 'color':
    case 'black-white':
      return [];
    case 'color-and-shape':
    case 'black-one-dot':
      return [ORIEDITA_DASH_ONE_DOT, ORIEDITA_DASH_VALLEY];
    case 'black-two-dot':
      return [ORIEDITA_DASH_TWO_DOT, ORIEDITA_DASH_VALLEY];
  }
}

/** The dash pattern a line colour draws with under `style`, or `null` if solid. */
export function cpLineStyleDashPattern(
  style: OristudioCpLineStyle,
  color: string
): readonly number[] | null {
  const slot = cpLineStyleDashSlot(style, color);
  return slot === SOLID_DASH_SLOT ? null : cpLineStyleDashPatterns(style)[slot - 1];
}
