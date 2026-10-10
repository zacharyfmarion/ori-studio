import type { DiagramStepPlace } from '../document/diagramDocument';
import type { DiagramPagesLayout, LayoutCell, LayoutPage, LayoutStep, TextSetter } from './diagramPageLayout';

export type PagePart = 'frame' | 'number' | 'picture' | 'text';
export interface PageBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PlacementClash {
  kind: 'step' | 'glyph' | 'margin' | 'paper' | 'path' | 'parts';
  steps?: number[];
}

/** Page axes, even on a page read upward. Only the frame's horizontal component follows reading order. */
export function pageOffset(
  place: DiagramStepPlace | undefined,
  part: PagePart,
  rightToLeft: boolean,
): [number, number] {
  const [x, y] = place?.[part] ?? [0, 0];
  return [part === 'frame' && rightToLeft ? -x : x, y];
}

export function translateCell(cell: LayoutCell, part: PagePart, dx: number, dy: number): LayoutCell {
  if (dx === 0 && dy === 0) return cell;
  const move = <T extends { x: number; y: number }>(value: T): T => ({ ...value, x: value.x + dx, y: value.y + dy });
  const frame = part === 'frame';
  return {
    ...cell,
    cellMm: frame ? move(cell.cellMm) : cell.cellMm,
    pictureMm: frame || part === 'picture' ? move(cell.pictureMm) : cell.pictureMm,
    drawMm: frame || part === 'picture' ? move(cell.drawMm) : cell.drawMm,
    inkMm: cell.inkMm && (frame || part === 'picture') ? move(cell.inkMm) : cell.inkMm,
    numberAt: frame || part === 'number' ? move(cell.numberAt) : cell.numberAt,
    numberMm: cell.numberMm && (frame || part === 'number') ? move(cell.numberMm) : cell.numberMm,
    text:
      frame || part === 'text'
        ? { ...cell.text, x: cell.text.x + dx, firstBaseline: cell.text.firstBaseline + dy }
        : cell.text,
  };
}

/** Add measured hit geometry and apply offsets after the automatic layout has finished sizing. */
export function placeCell(cell: LayoutCell, step: LayoutStep, rightToLeft: boolean, setter: TextSetter): LayoutCell {
  const number = setter.line(String(cell.number), 6.2, 700);
  let next: LayoutCell = {
    ...cell,
    homeMm: { ...cell.cellMm },
    rightToLeft,
    numberMm: { x: cell.numberAt.x, y: cell.numberAt.y - 4.65, w: number.widthMm, h: 6.2 },
  };
  next.homeParts = { number: partBox(next, 'number'), picture: partBox(next, 'picture'), text: partBox(next, 'text') };
  for (const part of ['frame', 'number', 'picture', 'text'] as const) {
    const [dx, dy] = pageOffset(step.place, part, rightToLeft);
    next = translateCell(next, part, dx, dy);
  }
  return next;
}

export function partBox(cell: LayoutCell, part: PagePart): PageBox {
  switch (part) {
    case 'frame': {
      const boxes = [
        partBox(cell, 'number'),
        partBox(cell, 'picture'),
        ...(cell.text.lines.length ? [partBox(cell, 'text')] : []),
      ];
      const x = Math.min(...boxes.map((b) => b.x)),
        y = Math.min(...boxes.map((b) => b.y));
      return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
    }
    case 'number':
      return cell.numberMm ?? { x: cell.numberAt.x, y: cell.numberAt.y - 4.65, w: 10, h: 6.2 };
    case 'picture':
      return cell.inkMm ?? cell.drawMm;
    case 'text':
      return {
        x: cell.text.x,
        y: cell.text.firstBaseline - 3.2,
        w: Math.max(0, ...cell.text.lines.map((line) => line.widthMm)),
        h: cell.text.lines.length ? (cell.text.lines.length - 1) * 4.1 + 4.7 : 0,
      };
  }
}

function intersects(a: PageBox, b: PageBox): boolean {
  return (
    a.w > 0 &&
    a.h > 0 &&
    b.w > 0 &&
    b.h > 0 &&
    a.x < b.x + b.w - 0.01 &&
    a.x + a.w > b.x + 0.01 &&
    a.y < b.y + b.h - 0.01 &&
    a.y + a.h > b.y + 0.01
  );
}

/** Manual placement is honored. Warnings are derived, never stored in the document. */
export function placementClashes(layout: DiagramPagesLayout): void {
  const { widthMm: w, heightMm: h, marginMm: m } = layout.paper;
  for (const page of layout.pages)
    for (const cell of page.cells) {
      if (!cell.placed) continue;
      const boxes = ['number', 'picture', 'text']
        .map((part) => partBox(cell, part as PagePart))
        .filter((b) => b.w > 0 && b.h > 0);
      const clashes: PlacementClash[] = [...(cell.clashes?.filter((c) => c.kind === 'path') ?? [])];
      const outside = (inset: number) =>
        boxes.some((b) => b.x < inset || b.y < inset || b.x + b.w > w - inset || b.y + b.h > h - inset);
      if (outside(0)) clashes.push({ kind: 'paper' });
      else if (outside(m)) clashes.push({ kind: 'margin' });
      if (boxes.some((box, i) => boxes.slice(i + 1).some((other) => intersects(box, other))))
        clashes.push({ kind: 'parts' });
      const steps = page.cells
        .filter(
          (other) =>
            other !== cell &&
            ['number', 'picture', 'text'].some((part) =>
              boxes.some((b) => intersects(b, partBox(other, part as PagePart))),
            ),
        )
        .map((other) => other.number);
      if (steps.length) clashes.push({ kind: 'step', steps });
      const glyphs = [...page.turns, ...page.zoomArrows].map(({ at, box }) => ({
        x: at.x - box.w / 2,
        y: at.y - box.h / 2,
        ...box,
      }));
      if (layout.title) glyphs.push(layout.title.tab);
      if (page.pageNumberAt)
        glyphs.push({
          x: page.pageNumberAt.x - (page.pageNumberAt.anchor === 'end' ? 10 : 0),
          y: page.pageNumberAt.y - 3.4,
          w: 10,
          h: 4,
        });
      if (glyphs.some((g) => boxes.some((b) => intersects(b, g)))) clashes.push({ kind: 'glyph' });
      cell.clashes = clashes.length ? clashes : undefined;
    }
}

export function pageClashingSteps(page: LayoutPage): number[] {
  return page.cells.filter((cell) => cell.clashes?.length).map((cell) => cell.number);
}
