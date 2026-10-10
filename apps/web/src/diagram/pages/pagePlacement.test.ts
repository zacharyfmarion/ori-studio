import { beforeAll, describe, expect, it } from 'vitest';
import {
  createDiagram,
  insertSteps,
  setPageSetup,
  type DiagramDocument,
  type DiagramStepPlace,
} from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { FIXTURE_FONTS, fixtureSubsetter } from '../fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../fonts/fontSubset';
import { preparedPages } from './diagramPages';
import { pageOffset, partBox } from './pagePlacement';
import { laneCrosses } from './flowLane';
import { previewPlacement } from './placementPreview';

let subsetter: FontSubsetter;
beforeAll(async () => {
  subsetter = await fixtureSubsetter();
});
function document(place?: DiagramStepPlace): DiagramDocument {
  return setPageSetup(
    insertSteps(
      createDiagram({ title: 'Packing test' }),
      Array.from({ length: 4 }, (_, i) => ({
        ...cpStep(`s${i}`),
        text: `Instruction ${i + 1}`,
        ...(i === 1 && place ? { place } : {}),
      })),
      0,
    ),
    { layout: 'grid', columns: 2, rows: 2 },
  );
}
const prepare = (doc: DiagramDocument) => preparedPages(doc, FIXTURE_FONTS, subsetter);

describe('printed manual placement', () => {
  it('honors a size pin past the room, leaves neighbors unchanged, and retains automatic values', () => {
    const normal = prepare(document());
    const placed = prepare(document({ scale: { mmPerUnit: 130 } }));
    const a = normal.layout.pages[0]!.cells,
      b = placed.layout.pages[0]!.cells;
    expect(b[1]!.mmPerUnit).toBe(130);
    expect(b[1]!.placed?.auto.mmPerUnit).toBeCloseTo(a[1]!.mmPerUnit!, 8);
    for (const i of [0, 2, 3]) {
      expect(b[i]!.mmPerUnit).toBe(a[i]!.mmPerUnit);
      expect(b[i]!.drawMm).toEqual(a[i]!.drawMm);
    }
    expect(b[1]!.drawMm.h).toBeGreaterThan(a[1]!.drawMm.h);
    expect(b[1]!.text.firstBaseline).toBeGreaterThan(a[1]!.text.firstBaseline);
    expect(b[1]!.clashes?.length).toBeGreaterThan(0);
  });
  it('keeps a pin of the other picture kind sleeping', () => {
    const auto = prepare(document()).layout.pages[0]!.cells[1]!;
    const cell = prepare(document({ scale: { frameMm: 80 } })).layout.pages[0]!.cells[1]!;
    expect(cell.mmPerUnit).toBe(auto.mmPerUnit);
    expect(cell.drawMm).toEqual(auto.drawMm);
    expect(cell.placed?.pin).toBe('kind');
  });
  it('moves a frame with all its parts, and a part independently in page axes', () => {
    const auto = prepare(document()).layout.pages[0]!.cells[1]!;
    const cell = prepare(document({ frame: [3, 4], text: [-2, 5] })).layout.pages[0]!.cells[1]!;
    expect(cell.numberAt.x).toBeCloseTo(auto.numberAt.x + 3);
    expect(cell.drawMm.y).toBeCloseTo(auto.drawMm.y + 4);
    expect(cell.text.x).toBeCloseTo(auto.text.x + 1);
    expect(cell.text.firstBaseline).toBeCloseTo(auto.text.firstBaseline + 9);
    expect(pageOffset({ frame: [3, 4] }, 'frame', true)).toEqual([-3, 4]);
    expect(pageOffset({ text: [3, 4] }, 'text', true)).toEqual([3, 4]);
  });
  it('composes only or omits a selected part without changing the ordinary page', () => {
    const pages = prepare(document());
    const normal = pages.compose(0).svg;
    const only = pages.compose(0, { only: { stepId: 's1', part: 'text' } }).svg;
    const omit = pages.compose(0, { omit: { stepId: 's1', part: 'text' } }).svg;
    expect(only).toContain('Instruction 2');
    expect(only).not.toContain('Instruction 1');
    expect(omit).not.toContain('Instruction 2');
    expect(omit).toContain('Instruction 1');
    expect(pages.compose(0).svg).toBe(normal);
  });
  it('previews a move and top-centred resize without mutating the saved layout', () => {
    const pages = prepare(document());
    const original = pages.layout.pages[0]!.cells[1]!;
    const moved = previewPlacement(pages.layout, 's1', 'picture', 7, -2);
    expect(partBox(moved.pages[0]!.cells[1]!, 'picture').x).toBeCloseTo(partBox(original, 'picture').x + 7);
    const resized = previewPlacement(pages.layout, 's1', 'picture', 0, 0, 1.5).pages[0]!.cells[1]!;
    expect(partBox(resized, 'picture').y).toBe(partBox(original, 'picture').y);
    expect(resized.text.firstBaseline - original.text.firstBaseline).toBeCloseTo(partBox(original, 'picture').h * 0.5);
    expect(pages.layout.pages[0]!.cells[1]).toBe(original);
  });
});

it('moves the ribbon through final centres and keeps both sides of the spine level', () => {
  const doc = setPageSetup(
    insertSteps(
      createDiagram(),
      Array.from({ length: 14 }, (_, i) => cpStep(`s${i}`)),
      0,
    ),
    { layout: 'flow', stepsPerPage: 7 },
  );
  const base = prepare(doc).layout;
  const cell = base.pages[0]!.cells.at(-1)!;
  const moved = previewPlacement(base, cell.stepId, 'frame', -9, -7);
  const left = moved.pages[0]!,
    right = moved.pages[1]!;
  const centre = { x: cell.drawMm.x + cell.drawMm.w / 2 - 9, y: cell.drawMm.y + cell.drawMm.h / 2 - 7 };
  expect(left.band!.curves.some((c) => Math.hypot(c.to.x - centre.x, c.to.y - centre.y) < 1e-8)).toBe(true);
  expect(left.flow!.spineOut).toBe(right.flow!.spineIn);
  expect(left.band!.curves.at(-1)!.to.y).toBe(right.band!.from.y);
  // Repeatable adversarial moves: every introduced crossing is reported.
  for (let n = 0; n < 30; n++) {
    const shifted = previewPlacement(base, 's2', 'picture', Math.sin(n * 3.1) * 160, Math.cos(n * 2.7) * 200);
    if (laneCrosses(shifted.pages[0]!.band!))
      expect(shifted.pages[0]!.cells.find((c) => c.stepId === 's2')!.clashes).toContainEqual({ kind: 'path' });
  }
});

it('returns to the identical printed page when a pin and offsets are cleared', () => {
  const doc = document({ scale: { mmPerUnit: 80 }, frame: [3, 4], text: [4, -2] });
  const cleared = { ...doc, steps: doc.steps.map((step) => ({ ...step, place: undefined })) };
  expect(prepare(cleared).compose(0).svg).toBe(prepare(document()).compose(0).svg);
});
