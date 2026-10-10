import { describe, expect, it } from 'vitest';

import { diagramLayoutSteps } from '../pages/diagramPages';
import frozen from './__fixtures__/diagram-v1.json';
import { isKnownAnnotation, isTurn, snapshotDiagramStyle, type DiagramStep } from './diagramDocument';
import { readDiagram, writeDiagram } from './diagramFile';

/**
 * A diagram as the Diagram workspace launched with it (format v1, frozen
 * 2026-10-10; the plan's Contracts › The v1 file): every kind of step, picture,
 * render, turn and mark it writes — linked steps shown each way, a spread, a
 * remembered pose, uploads, References steps with their pulled marks, turns,
 * an enlarged step and its area, a step placed by hand, a label with every
 * option, a mark behind a flap — in one diagram on a set-up page, as this
 * build wrote it.
 *
 * Every saved diagram is read by today's reader. A change that reads this file
 * otherwise, or writes it back otherwise, changes what saved diagrams mean, and
 * fails here first. Regenerate it only for a change to the format meant as
 * one, with the reader for this shape kept beside the new one.
 */
describe('a diagram saved at launch (format v1)', () => {
  const read = () => readDiagram(JSON.parse(JSON.stringify(frozen)))!;
  const steps = (document: { steps: readonly unknown[] }) =>
    (document.steps as Parameters<typeof isTurn>[0][]).filter((entry): entry is DiagramStep => !isTurn(entry));

  it('opens editable, with nothing carried as a newer build’s', () => {
    const { document, readOnly } = read();
    expect(readOnly).toBe(false);
    expect(document.newer).toBeUndefined();
    expect(document.steps.filter((entry) => entry.unknown !== undefined)).toEqual([]);
    for (const step of steps(document)) {
      expect(step.annotations.every(isKnownAnnotation), step.id).toBe(true);
    }
    expect(Object.values(document.assets).every((asset) => !('unknown' in asset))).toBe(true);
  });

  it('holds what it was frozen to hold', () => {
    const { document } = read();
    const all = steps(document);
    expect(document.steps.filter(isTurn).map((turn) => turn.kind)).toEqual(['turn-over', 'rotate']);
    const sources = new Set(all.map((step) => step.source?.kind ?? 'none'));
    expect([...sources].sort()).toEqual(['cp', 'none', 'references-step', 'upload']);
    const renders = new Set(all.flatMap((step) => (step.source?.kind === 'cp' ? [step.source.render.mode] : [])));
    expect([...renders].sort()).toEqual(['crease-pattern', 'folded-3d', 'folded-flat', 'simulated']);
    const pictures = new Set(all.flatMap((step) => (step.picture ? [step.picture.kind] : [])));
    expect([...pictures].sort()).toEqual(['asset', 'fixed', 'scene', 'step-diagram']);
    expect(all.filter((step) => step.zoom !== undefined)).toHaveLength(1);
    expect(all.filter((step) => step.place !== undefined)).toHaveLength(1);
    const marks = new Set(all.flatMap((step) => step.annotations.flatMap((mark) => (isKnownAnnotation(mark) ? [mark.kind] : []))));
    expect(marks.size).toBeGreaterThanOrEqual(25);
  });

  it('only adds the explicit preset snapshot migration, preserving the frozen legacy file', () => {
    const written = JSON.parse(JSON.stringify(writeDiagram(read().document)));
    expect(written).toEqual({ ...frozen, style: snapshotDiagramStyle(read().document.style) });
    expect(writeDiagram(readDiagram(written)!.document)).toEqual(written);
  });

  it('lays out every step, the placed one where it was put', () => {
    const { document } = read();
    const layout = diagramLayoutSteps(document);
    expect(layout).toHaveLength(steps(document).length);
    const placed = steps(document).find((step) => step.place !== undefined)!;
    expect(layout.find((step) => step.id === placed.id)?.place).toEqual(placed.place);
  });
});
