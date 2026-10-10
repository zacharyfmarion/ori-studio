import type { DiagramPagesLayout, LayoutCell } from './diagramPageLayout';
import { flowLane } from './flowLane';
import { partBox, placementClashes, translateCell, type PagePart } from './pagePlacement';

/** Local preview geometry. No font loading, packing, document writes, or history entries. */
export function previewPlacement(
  base: DiagramPagesLayout,
  stepId: string,
  part: PagePart,
  dx: number,
  dy: number,
  factor = 1,
): DiagramPagesLayout {
  const layout: DiagramPagesLayout = {
    ...base,
    pages: base.pages.map((page) => ({ ...page, cells: page.cells.map((cell) => ({ ...cell })) })),
  };
  for (const page of layout.pages) {
    const index = page.cells.findIndex((cell) => cell.stepId === stepId);
    if (index < 0) continue;
    const old = page.cells[index]!;
    let cell = translateCell(old, part, dx, dy);
    if (factor !== 1) cell = scaleCell(cell, factor);
    cell.placed ??= {
      offsets: {},
      pin: null,
      auto: { mmPerUnit: old.mmPerUnit, frameMm: old.frameMm, drawMm: old.drawMm },
    };
    page.cells[index] = cell;
    // Symbols are re-placed on drop, once the final layout is ready.
  }
  // Both sides of a printed spread share the moved spine height.
  const stops = layout.pages.map((page) =>
    page.flow?.stops.map((stop, index) => {
      const cell = page.cells[index];
      if (!cell) return stop;
      return {
        ...stop,
        x: cell.drawMm.x + cell.drawMm.w / 2,
        y: cell.drawMm.y + cell.drawMm.h / 2,
        placed: !!cell.placed,
      };
    }),
  );
  layout.pages.forEach((page, index) => {
    if (!page.flow || !stops[index]) return;
    const shared = (left: number) => {
      const a = stops[left]?.at(-1),
        b = stops[left + 1]?.[0];
      return a && b ? (a.y + b.y) / 2 : null;
    };
    const flow = { ...page.flow, stops: stops[index]!, spineIn: shared(index - 1), spineOut: shared(index) };
    const lane = flowLane(flow);
    page.flow = flow;
    if (page.band) page.band = lane?.lane ?? null;
    for (const n of lane?.warnings ?? []) if (page.cells[n]) page.cells[n]!.clashes = [{ kind: 'path' }];
  });
  placementClashes(layout);
  return layout;
}

export function scaleCell(cell: LayoutCell, factor: number): LayoutCell {
  const picture = partBox(cell, 'picture'),
    cx = picture.x + picture.w / 2,
    cy = picture.y;
  const scaleBox = (box: { x: number; y: number; w: number; h: number }) => ({
    x: cx + (box.x - cx) * factor,
    y: cy + (box.y - cy) * factor,
    w: box.w * factor,
    h: box.h * factor,
  });
  const dy = picture.h * (factor - 1);
  const next = translateCell(cell, 'text', 0, dy);
  return {
    ...next,
    drawMm: scaleBox(cell.drawMm),
    inkMm: cell.inkMm ? scaleBox(cell.inkMm) : undefined,
    pictureMm: {
      x: cx + (cell.pictureMm.x - cx) * factor,
      y: cy + (cell.pictureMm.y - cy) * factor,
      size: cell.pictureMm.size * factor,
    },
    mmPerUnit: cell.mmPerUnit === null ? null : cell.mmPerUnit * factor,
    frameMm: cell.frameMm === null ? null : cell.frameMm * factor,
  };
}
