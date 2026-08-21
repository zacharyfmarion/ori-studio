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

/**
 * The dots an undecided crease draws with — ours, not Oriedita's, because
 * `LineColor.NONE` is a state Oriedita never draws (see `cpLineStyleColorKind`).
 *
 * The runs are the `stroke-dasharray: 3 7` the SVG canvas gave
 * `.crease--line-color-unassigned` before the WebGL migration, which dropped it:
 * short marks with wide gaps read as *provisional* next to the mountain chain
 * and the valley dash, and stay distinct from both at every zoom because
 * Oriedita's patterns are screen-space too. Sparse ink is the point — a crease
 * with no angle yet should look like less than a crease — and it costs no
 * reachability, since hit-testing is geometric and never consults the dash.
 */
export const ORISTUDIO_DASH_UNASSIGNED: readonly number[] = [3, 7];

/** Dash slots addressed by {@link cpLineStyleDashSlot}; 0 is always solid. */
export const SOLID_DASH_SLOT = 0;
/** Slot of the mountain chain pattern within {@link cpLineStyleDashPatterns}. */
export const MOUNTAIN_DASH_SLOT = 1;
/** Slot of the valley dash pattern within {@link cpLineStyleDashPatterns}. */
export const VALLEY_DASH_SLOT = 2;
/** Slot of the undecided-crease dots within {@link cpLineStyleDashPatterns}. */
export const UNASSIGNED_DASH_SLOT = 3;

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
 *
 * An undecided crease dashes under **every** style, including the two whose
 * whole premise is that shape carries nothing. That is not an exception to the
 * port so much as a case outside it: Oriedita's styles trade off *which* of
 * mountain and valley a reader can tell apart, and an undecided crease is
 * neither. Leaving it to colour alone is what the monochrome styles cannot
 * afford — `black-white` paints it the same grey as a valley, and the two
 * black-dot styles paint it the same black as a paper edge.
 */
export function cpLineStyleDashSlot(style: OristudioCpLineStyle, color: string): number {
  const kind = cpLineStyleColorKind(color);
  if (kind === 'aux') return SOLID_DASH_SLOT;
  if (kind === 'unassigned') return UNASSIGNED_DASH_SLOT;
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

/** A slot this style leaves solid, so the slots below it keep their numbers. */
const NO_DASH: readonly number[] = [];

/**
 * The pattern each dash slot holds under `style`, ordered so entry `i` is slot
 * `i + 1`.
 *
 * A slot means the same thing under every style — 1 mountain, 2 valley, 3
 * undecided — so a style that dashes nothing for one of them still reserves its
 * place with an empty pattern rather than shifting the rest down. An empty
 * pattern has period 0, which both the shader and the SVG exporter draw solid,
 * so the two solid styles reach the same output through a table instead of
 * through an absence.
 */
export function cpLineStyleDashPatterns(
  style: OristudioCpLineStyle
): readonly (readonly number[])[] {
  switch (style) {
    case 'color':
    case 'black-white':
      return [NO_DASH, NO_DASH, ORISTUDIO_DASH_UNASSIGNED];
    case 'color-and-shape':
    case 'black-one-dot':
      return [ORIEDITA_DASH_ONE_DOT, ORIEDITA_DASH_VALLEY, ORISTUDIO_DASH_UNASSIGNED];
    case 'black-two-dot':
      return [ORIEDITA_DASH_TWO_DOT, ORIEDITA_DASH_VALLEY, ORISTUDIO_DASH_UNASSIGNED];
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
