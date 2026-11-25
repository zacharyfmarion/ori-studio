import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { DEFAULT_PAPER_EXPORT_SETTINGS } from '../../lib/paperExportSettings';
import { paintPaperExport, paperExportPage, paperExportSceneInput } from '../../paperExport/paperExportSession';
import type { FoldSceneCrease } from '../engine/foldEngineWire';
import { foldStepCreaseDiagram, foldStepIsNumbered, foldStepsExportTarget, type FoldStepPage } from './foldStepPages';

const t = ((_key: string, english: string, values?: Record<string, unknown>) =>
  english.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))) as unknown as TFunction;

const SQUARE: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

let id = 0;
function crease(
  kind: FoldSceneCrease['kind'],
  letter: FoldSceneCrease['letter'],
  madeAt: number,
  from: [number, number],
  to: [number, number]
): FoldSceneCrease {
  id += 1;
  return { id, vertices: [0, 1], from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, kind, letter, made_at: madeAt };
}

/** A book fold made at step 1, a diagonal precrease at step 2, and step 3's valley. */
const CREASES: FoldSceneCrease[] = [
  crease('border', null, 0, [0, 0], [1, 0]),
  crease('fold', 'mountain', 1, [0.5, 0], [0.5, 1]),
  crease('flat', 'valley', 2, [0, 0], [1, 1]),
  crease('fold', 'valley', 3, [0, 0.5], [1, 0.5]),
];

describe('a Fold step as a page', () => {
  it('draws the creases made so far in the fold and crease pens, and the step’s own as the instruction, last', () => {
    const diagram = foldStepCreaseDiagram(CREASES, SQUARE, 3);
    expect(diagram.sheet).toEqual({ width: 1, height: 1, centre: [0.5, 0.5] });
    expect(diagram.primitives).toEqual([
      { kind: 'sheet', width: 1, height: 1 },
      { kind: 'line', from: [0.5, 0], to: [0.5, 1], style: 'fold-mountain' },
      { kind: 'line', from: [0, 0], to: [1, 1], style: 'crease' },
      { kind: 'line', from: [0, 0.5], to: [1, 0.5], style: 'valley' },
    ]);
    // At step 2 the precrease is the instruction, in its letter's pen.
    expect(foldStepCreaseDiagram(CREASES, SQUARE, 2).primitives.at(-1)).toMatchObject({ style: 'valley', to: [1, 1] });
  });

  it('draws every crease a Repeat made as its page’s instruction: all made since the state before it', () => {
    // A Repeat of steps 2 and 3, landing at step 3 from step 1.
    const instructions = foldStepCreaseDiagram(CREASES, SQUARE, 3, 1).primitives.filter(
      (primitive) => primitive.kind === 'line' && (primitive.style === 'valley' || primitive.style === 'mountain')
    );
    expect(instructions).toEqual([
      { kind: 'line', from: [0, 0], to: [1, 1], style: 'valley' },
      { kind: 'line', from: [0, 0.5], to: [1, 0.5], style: 'valley' },
    ]);
  });

  it('carries a polygon sheet’s outline, and not a rectangle’s', () => {
    const rectangle: [number, number][] = [[0, 0], [1, 0], [1, 0.5], [0, 0.5]];
    expect(foldStepCreaseDiagram([], rectangle, 0).sheet).toEqual({ width: 1, height: 0.5, centre: [0.5, 0.25] });
    // A square on its corner has four points too.
    const diamond: [number, number][] = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
    expect(foldStepCreaseDiagram([], diamond, 0).sheet.outline).toEqual(diamond);
  });

  it('numbers every step but a turn or a rotation', () => {
    expect(foldStepIsNumbered({ kind: 'turn', axis: 'vertical' })).toBe(false);
    expect(foldStepIsNumbered({ kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } })).toBe(false);
    expect(
      foldStepIsNumbered({ kind: 'cp-jump', cpJson: '{}', orderJson: '[]', origin: 'sample' })
    ).toBe(true);
  });
});

describe('the steps’ export target', () => {
  const pages: FoldStepPage[] = [1, 2, 3].map((number) => ({
    number,
    diagram: foldStepCreaseDiagram(CREASES, SQUARE, number),
  }));
  const target = foldStepsExportTarget({ pages, current: 1, title: 'Crane', exportStyle: DEFAULT_PAPER_STYLE, t });

  it('is Fold’s surface, a page per step named as References names its step pages', () => {
    expect(target.surface).toBe('fold');
    // A crease pattern has no letters or reference lines for the dialog to offer to leave out.
    expect(target.marks).toEqual([]);
    expect(target.title).toBe('Export step 2');
    expect(target.fileStem).toBe('Crane step 2');
    expect(target.pages).toEqual({
      list: [
        { label: 'Step 1', fileStem: '1 step 1' },
        { label: 'Step 2', fileStem: '2 step 2' },
        { label: 'Step 3', fileStem: '3 step 3' },
      ],
      current: 1,
      title: 'Export all steps',
      zipStem: 'Crane steps',
    });
    expect(foldStepsExportTarget({ pages, current: 0, title: '  ', exportStyle: DEFAULT_PAPER_STYLE, t }).fileStem).toBe(
      'Untitled step 1'
    );
  });

  it('paints a step’s page in the fold pens, the instruction in the diagram-crease pens', async () => {
    const input = paperExportSceneInput(target, DEFAULT_PAPER_STYLE, DEFAULT_PAPER_EXPORT_SETTINGS, 2);
    const scene = await target.buildScene(input);
    expect(scene).not.toBeNull();
    const roles = scene!.items.flatMap((item) => (item.kind === 'line' ? [item.role] : []));
    // The fold earlier, the precrease (a crease, in the aux pen), then the instruction; the sheet's edge.
    expect(roles.filter((role) => role !== 'edge')).toEqual(['mountain', 'aux', 'diagram-valley']);
    const page = paperExportPage(target, DEFAULT_PAPER_EXPORT_SETTINGS);
    const painted = paintPaperExport(target, scene!, DEFAULT_PAPER_STYLE, page);
    expect(painted.svg).toMatch(/^<\?xml/);
    expect(await target.buildScene({ ...input, page: 3 })).toBeNull();
  });
});
