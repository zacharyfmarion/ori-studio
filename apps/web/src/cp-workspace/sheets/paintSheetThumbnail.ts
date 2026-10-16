import type { SheetStrokeRole, SheetThumbnail } from './sheetThumbnail';

/** Same ordered paths and non-scaling hairlines as the SVG sheet badges. */
export function paintSheetThumbnail(
  context: CanvasRenderingContext2D,
  thumbnail: SheetThumbnail,
  width: number,
  height: number,
  colors: Record<SheetStrokeRole, string>
): void {
  const box = thumbnail.viewBox.trim().split(/\s+/).map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite) || box[2]! <= 0 || box[3]! <= 0) return;
  const scale = Math.min(width / box[2]!, height / box[3]!);
  context.save();
  context.translate((width - box[2]! * scale) / 2 - box[0]! * scale, (height - box[3]! * scale) / 2 - box[1]! * scale);
  context.scale(scale, scale);
  let role: SheetStrokeRole | null = null;
  for (const stroke of thumbnail.strokes) {
    if (![stroke.x1, stroke.y1, stroke.x2, stroke.y2].every(Number.isFinite) || !Object.hasOwn(colors, stroke.role)) continue;
    if (role !== stroke.role) {
      if (role !== null) context.stroke();
      role = stroke.role;
      context.beginPath();
      context.strokeStyle = colors[role];
      context.lineWidth = (role === 'edge' ? 1.6 : 1.1) / scale;
    }
    context.moveTo(stroke.x1, stroke.y1);
    context.lineTo(stroke.x2, stroke.y2);
  }
  if (role !== null) context.stroke();
  context.restore();
}
