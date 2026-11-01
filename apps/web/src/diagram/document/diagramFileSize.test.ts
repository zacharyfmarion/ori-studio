import { describe, expect, it } from 'vitest';
import { fitSheetThumbnail, type SheetStroke } from '../../cp-workspace/sheets/sheetThumbnail';
import { createNativeProjectFile, serializeNativeProjectFile } from '../../lib/nativeProjectFile';
import { craneStep } from '../zoom/zoom.fixtures';
import { LAYER_ORDER_RECORD_MAX_BYTES, encodeLayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import { layerOrderRecordOfSize } from '../../lib/layerOrder/layerOrderRecord.fixtures';
import { createDiagram, insertSteps, type DiagramCpSource, type DiagramStep } from './diagramDocument';
import { readDiagram, writeDiagram } from './diagramFile';

/**
 * What a diagram costs in the project file (decision 4 of the launch review,
 * 2026-10-09). Fifty steps linked to one dense sheet wrote its thumbnail
 * fifty times, pretty-printed a line per coordinate: 25 MB. The thumbnails
 * table writes it once, as one string.
 */

/** `count` lines of a pattern, as a capture hands them to the thumbnail: in model space, every role. */
function strokes(count: number): SheetStroke[] {
  let state = 1;
  const random = () => ((state = (state * 16807) % 2147483647) / 2147483647) * 400 - 200;
  const roles = ['edge', 'mountain', 'valley', 'aux'] as const;
  return Array.from({ length: count }, (_, index) => ({
    x1: random(),
    y1: random(),
    x2: random(),
    y2: random(),
    role: roles[index % roles.length]!,
  }));
}

describe('what a diagram costs in the file', () => {
  it('writes fifty steps linked to a 2,000-crease sheet in under a megabyte, its thumbnail once', () => {
    const thumbnail = fitSheetThumbnail(strokes(2000))!;
    const steps = Array.from({ length: 50 }, (_, index) => {
      const step = craneStep('S.none');
      return { ...step, id: `step-${index}`, source: { ...(step.source as DiagramCpSource), thumbnail } };
    });
    const written = writeDiagram(insertSteps(createDiagram({ title: 'Dense' }), steps, 0));
    const file = serializeNativeProjectFile(
      createNativeProjectFile({ workspaceTitle: 'Dense', filename: 'd.osf', path: null, designs: [], diagrams: [written], appVersion: '0' })
    );
    expect(Object.keys(written.thumbnails as object)).toHaveLength(1);
    expect(file.length).toBeLessThan(1024 * 1024);
    // And it reads back as it was.
    const read = readDiagram(JSON.parse(JSON.stringify(written)))!;
    expect(read.document.steps).toHaveLength(50);
    expect(read.document.steps.every((step) => (step as { source: DiagramCpSource }).source.thumbnail.strokes.length === 2000)).toBe(true);
  });

  it('writes a step’s layer order as one string: a record at the budget costs about its own size', () => {
    const encoded = encodeLayerOrderRecord(layerOrderRecordOfSize(LAYER_ORDER_RECORD_MAX_BYTES));
    if (!encoded.ok) throw new Error(encoded.reason);
    const step = craneStep('S.none');
    const constrained = { ...step, source: { ...(step.source as DiagramCpSource), layerOrder: encoded.json } };
    const fileOf = (steps: DiagramStep[]) =>
      serializeNativeProjectFile(
        createNativeProjectFile({
          workspaceTitle: 'Constrained',
          filename: 'c.osf',
          path: null,
          designs: [],
          diagrams: [writeDiagram(insertSteps(createDiagram({ title: 'Constrained' }), steps, 0))],
          appVersion: '0',
        })
      );
    // Never a line per number: the record's own bytes, and a backslash before each of its quotes.
    const grown = fileOf([constrained]).length - fileOf([step]).length;
    expect(grown).toBeGreaterThan(LAYER_ORDER_RECORD_MAX_BYTES);
    expect(grown).toBeLessThan(LAYER_ORDER_RECORD_MAX_BYTES * 1.2);
    const read = readDiagram(JSON.parse(fileOf([constrained])).workspace.diagrams[0])!;
    expect((read.document.steps[0] as { source: DiagramCpSource }).source.layerOrder).toBe(encoded.json);
  });
});
