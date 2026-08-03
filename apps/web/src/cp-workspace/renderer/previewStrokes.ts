import { OVERLAY_DASH_PATTERN, type Rgba, type StrokeGeometry } from './types';
import type { ToolPreviewSegment } from '../tools/types';

/** A run of preview segments sharing one colour. */
export interface PreviewStrokeGroup {
  segments: readonly ToolPreviewSegment[];
  color: Rgba;
  /**
   * Overrides the call-level dashing for this group, so one geometry can carry
   * both — which is what lets the armed completion candidate read as solid while
   * the alternatives stay dashed proposals.
   */
  dashed?: boolean;
}

/**
 * Pack tool-preview segments (model coords) into stroke geometry, one colour per
 * group.
 *
 * Groups exist because the preview channel carries two different kinds of thing
 * at once, and they do not share a colour:
 *
 * - **Candidate geometry** — what the active tool *would create*. Belongs in the
 *   active crease colour, so the line you see while dragging is the line you get.
 * - **Highlights** — *existing* creases the tool is snapping to or has picked.
 *   Belongs in the selection accent: they are already in the document and are
 *   being pointed at, not drawn.
 *
 * These were concatenated into one array and stroked in one colour, so whichever
 * of the two was right made the other wrong. Painting candidates in the crease
 * colour made a hovered crease read as though the tool had recoloured it.
 *
 * Stroke colour is already per-segment, so grouping costs nothing over the
 * single-colour form.
 */
export function previewGroupsToStrokes(
  groups: readonly PreviewStrokeGroup[],
  dashed = false
): StrokeGeometry {
  const count = groups.reduce((total, group) => total + group.segments.length, 0);
  const a = new Float32Array(count * 2);
  const b = new Float32Array(count * 2);
  const color = new Float32Array(count * 4);
  const widthMul = new Float32Array(count).fill(1);
  // Slot 0 is solid, slot 1 is the dash pattern. Written per segment so a group
  // can opt out of the call-level choice.
  const dashSlot = new Float32Array(count);
  let anyDashed = false;
  let i = 0;
  for (const group of groups) {
    const groupDashed = group.dashed ?? dashed;
    anyDashed = anyDashed || groupDashed;
    for (const segment of group.segments) {
      a[i * 2] = segment.a.x;
      a[i * 2 + 1] = segment.a.y;
      b[i * 2] = segment.b.x;
      b[i * 2 + 1] = segment.b.y;
      color[i * 4] = group.color[0];
      color[i * 4 + 1] = group.color[1];
      color[i * 4 + 2] = group.color[2];
      color[i * 4 + 3] = group.color[3];
      dashSlot[i] = groupDashed ? 1 : 0;
      i += 1;
    }
  }
  return {
    a,
    b,
    color,
    widthMul,
    count,
    dashPatterns: anyDashed ? [OVERLAY_DASH_PATTERN] : [],
    dashSlot,
  };
}

/** Single-colour {@link previewGroupsToStrokes}. */
export function previewSegmentsToStrokes(
  segments: readonly ToolPreviewSegment[],
  color: Rgba,
  dashed = false
): StrokeGeometry {
  return previewGroupsToStrokes([{ segments, color }], dashed);
}
