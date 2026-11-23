import type { SheetStrokeRole, SheetThumbnail } from './sheetThumbnail';
import { sheetStrokeInk, type SheetThumbnailInks } from './sheetStrokeInk';

/**
 * Same ordered paths and non-scaling hairlines as the SVG sheet badges, each
 * stroke in its ink (`sheetStrokeInk`). Strokes in a row that share a role and
 * an ink go in one path, so a pattern with no crease folded short of 180° is
 * painted path for path as it was before fold angles reached it.
 */
export function paintSheetThumbnail(
  context: CanvasRenderingContext2D,
  thumbnail: SheetThumbnail,
  width: number,
  height: number,
  inks: SheetThumbnailInks
): void {
  const box = thumbnail.viewBox.trim().split(/\s+/).map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite) || box[2]! <= 0 || box[3]! <= 0) return;
  const scale = Math.min(width / box[2]!, height / box[3]!);
  context.save();
  context.translate((width - box[2]! * scale) / 2 - box[0]! * scale, (height - box[3]! * scale) / 2 - box[1]! * scale);
  context.scale(scale, scale);
  let role: SheetStrokeRole | null = null;
  let stroke = '';
  let opacity = 1;
  for (const line of thumbnail.strokes) {
    if (![line.x1, line.y1, line.x2, line.y2].every(Number.isFinite) || !Object.hasOwn(inks.colors, line.role)) continue;
    const ink = sheetStrokeInk(line, inks);
    if (role !== line.role || stroke !== ink.stroke || opacity !== ink.opacity) {
      if (role !== null) context.stroke();
      role = line.role;
      stroke = ink.stroke;
      opacity = ink.opacity;
      context.beginPath();
      context.strokeStyle = stroke;
      context.globalAlpha = opacity;
      context.lineWidth = (role === 'edge' ? 1.6 : 1.1) / scale;
    }
    context.moveTo(line.x1, line.y1);
    context.lineTo(line.x2, line.y2);
  }
  if (role !== null) context.stroke();
  context.restore();
}
