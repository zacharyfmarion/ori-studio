import { describe, expect, it } from 'vitest';
import type { PageBox } from './pagePlacement';
import { PRINT_PAPER_MM } from './printPaper';
import {
  DEFAULT_DIAGRAM_STYLE,
  DEFAULT_PAGE_SETUP,
  removeStepPicture,
  removeSteps,
  setTitleBlockContent,
  TITLE_BLOCK_ART_SIZE_DEFAULTS,
  TITLE_BLOCK_ART_SIZE_RANGE,
  type DiagramCpSource,
  type DiagramDocument,
  type DiagramFoldStepSource,
  type DiagramPageSetup,
} from '../document/diagramDocument';
import type { SheetStroke, SheetStrokeRole, SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import type { PaperScene } from '../../lib/paper/paperScene';
import { readDiagram, writeDiagram } from '../document/diagramFile';
import { cpStep, referencesStep } from '../document/diagramSteps.fixtures';
import { estimateTextSetter } from './estimateTextSetter';
import {
  OTHER_PATTERN,
  emptyStep,
  foldPatternStep,
  lockedStep,
  patternStep,
  titleBlockDiagram,
  titleBlockGeometry,
  turnOver,
  uploadStep,
} from './titleBlock.fixtures';
import {
  autoModelStep,
  autoPatternStep,
  drawsPattern,
  missingTitleBlockParts,
  modelRoom,
  patternScene,
  resolveTitleBlock,
  titleBlockLook,
  type ModelRoom,
} from './titleBlockContent';
import { wholePictureRoom } from './pagePictures';
import { emptyTitleBlockLook, setTitleBlock, type TitleBlockLook } from './titleBlockColumn';

/**
 * What the first page's title block shows (`implementation-plans/
 * diagram-title-block.md`, sections 4 and 5, Phase 1c): Auto, a chosen step,
 * or none, for the model and the pattern alike; the words it prints of its
 * own; and what the Pages view marks.
 */

/** A linked step shown folded, on a pattern of its own. */
const folded = (id: string) => patternStep(id, OTHER_PATTERN, { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 0 });

/** Each part as where it comes from and its step's id. */
function shown(document: DiagramDocument) {
  const { model, pattern } = resolveTitleBlock(document);
  return { model: [model.from, model.step?.id ?? null], pattern: [pattern.from, pattern.step?.id ?? null] };
}

describe('resolveTitleBlock', () => {
  it('finds the last step with a picture for the model, and the last linked step for the pattern, by Auto', () => {
    const pattern = folded('s2');
    const document = titleBlockDiagram([cpStep('s1'), pattern, uploadStep('s3')]);
    expect(shown(document)).toEqual({ model: ['auto', 's3'], pattern: ['auto', 's2'] });
    // Shown folded, a link still names its pattern: the lines are its stored thumbnail's.
    expect(resolveTitleBlock(document).pattern.scene).toEqual(patternScene(pattern.source as DiagramCpSource));
  });

  it('passes over turns, empty steps and a newer build’s steps, so a diagram ending in a turn still finds its model', () => {
    const document = titleBlockDiagram([cpStep('s1'), cpStep('s2'), lockedStep('s3'), emptyStep('s4'), turnOver('t1')]);
    expect(shown(document)).toEqual({ model: ['auto', 's2'], pattern: ['auto', 's2'] });
  });

  it('finds no pattern where no step is linked to a crease pattern: a References step’s sheet is not the model’s pattern', () => {
    const document = titleBlockDiagram([referencesStep('r1'), emptyStep('s2')]);
    expect(shown(document)).toEqual({ model: ['auto', 'r1'], pattern: ['auto', null] });
    expect(resolveTitleBlock(document).pattern.scene).toBeNull();
    expect(shown(titleBlockDiagram([]))).toEqual({ model: ['auto', null], pattern: ['auto', null] });
  });

  it('shows a chosen step, and none where none is chosen', () => {
    const steps = [cpStep('s1'), folded('s2'), cpStep('s3')];
    expect(shown(titleBlockDiagram(steps, { model: { kind: 'step', stepId: 's1' }, pattern: { kind: 'step', stepId: 's2' } }))).toEqual({
      model: ['step', 's1'],
      pattern: ['step', 's2'],
    });
    const none = titleBlockDiagram(steps, { model: { kind: 'none' }, pattern: { kind: 'none' } });
    expect(shown(none)).toEqual({ model: ['none', null], pattern: ['none', null] });
    expect(resolveTitleBlock(none).pattern.scene).toBeNull();
  });

  it('reads a chosen step that is gone, or a newer build’s now, as Auto: its id left as it is', () => {
    const chosen = titleBlockDiagram([cpStep('s1'), cpStep('s2'), cpStep('s3')], {
      model: { kind: 'step', stepId: 's1' },
      pattern: { kind: 'step', stepId: 's1' },
    });
    const removed = removeSteps(chosen, ['s1']);
    expect(removed.titleBlockContent).toEqual(chosen.titleBlockContent);
    expect(shown(removed)).toEqual({ model: ['auto', 's3'], pattern: ['auto', 's3'] });
    const newer = { ...chosen, steps: chosen.steps.map((entry) => (entry.id === 's1' ? lockedStep('s1') : entry)) };
    expect(shown(newer)).toEqual({ model: ['auto', 's3'], pattern: ['auto', 's3'] });
    // A turn has no number and no picture: never the model, though its id be chosen.
    const turned = titleBlockDiagram([cpStep('s1'), turnOver('t1')], { model: { kind: 'step', stepId: 't1' } });
    expect(shown(turned).model).toEqual(['auto', 's1']);
  });

  it('shows nothing for a chosen step that can no longer give its part, and says which step that is', () => {
    const chosen = titleBlockDiagram([cpStep('s1'), cpStep('s2'), emptyStep('s3')], {
      model: { kind: 'step', stepId: 's1' },
      pattern: { kind: 'step', stepId: 's3' },
    });
    const pictureless = removeStepPicture(chosen, 's1');
    const { model, pattern } = resolveTitleBlock(pictureless);
    expect([model.from, model.step?.id, model.step?.picture]).toEqual(['step', 's1', null]);
    expect([pattern.from, pattern.step?.id, pattern.scene]).toEqual(['step', 's3', null]);
  });

  it('shows Auto for a part only a newer build reads', () => {
    const written = JSON.parse(JSON.stringify(writeDiagram(titleBlockDiagram([cpStep('s1'), cpStep('s2')], { pattern: { kind: 'none' } }))));
    written.titleBlockContent = { ...written.titleBlockContent, model: { kind: 'own', step: { id: 'title-model' } } };
    const { document } = readDiagram(written)!;
    expect(shown(document)).toEqual({ model: ['auto', 's2'], pattern: ['none', null] });
  });

  it('names what Auto finds whatever is chosen, for the Page pane to offer', () => {
    const document = titleBlockDiagram([cpStep('s1'), folded('s2'), emptyStep('s3')], { model: { kind: 'none' }, pattern: { kind: 'step', stepId: 's1' } });
    expect(autoModelStep(document)?.id).toBe('s2');
    expect(autoPatternStep(document)?.id).toBe('s2');
  });

  it('passes over a linked step whose pattern draws nothing for Auto, and draws nothing for one chosen', () => {
    const blank = patternStep('s2', []);
    expect(shown(titleBlockDiagram([cpStep('s1'), blank])).pattern).toEqual(['auto', 's1']);
    const chosen = resolveTitleBlock(titleBlockDiagram([cpStep('s1'), blank], { pattern: { kind: 'step', stepId: 's2' } })).pattern;
    expect([chosen.from, chosen.step?.id, chosen.scene]).toEqual(['step', 's2', null]);
  });

  it('gives the pattern’s lines as the painter draws them, none where it gives none', () => {
    const pattern = folded('s2');
    const { scene } = resolveTitleBlock(titleBlockDiagram([cpStep('s1'), pattern])).pattern;
    expect(scene).toEqual(patternScene(pattern.source as DiagramCpSource));
    expect(resolveTitleBlock(titleBlockDiagram([cpStep('s1')], { pattern: { kind: 'none' } })).pattern.scene).toBeNull();
  });

  describe('from a Fold sequence', () => {
    /** A third Fold step's state: a mountain added to the default's valley. */
    const LATER: SheetStroke[] = [...OTHER_PATTERN, { x1: 0, y1: 100, x2: 100, y2: 0, role: 'mountain' }];

    it('finds the last Fold step for the pattern by Auto, drawn from its state’s crease pattern', () => {
      const last = foldPatternStep('f3', LATER, { step: 'fstep-3' });
      const document = titleBlockDiagram([foldPatternStep('f1', OTHER_PATTERN, { step: 'fstep-1' }), foldPatternStep('f2'), last, turnOver('t1')]);
      expect(shown(document)).toEqual({ model: ['auto', 'f3'], pattern: ['auto', 'f3'] });
      expect(autoPatternStep(document)?.id).toBe('f3');
      const { scene } = resolveTitleBlock(document).pattern;
      expect(scene).toEqual(patternScene(last.source as DiagramFoldStepSource));
      expect(scene?.items.map((item) => (item.kind === 'line' ? item.role : item.kind))).toEqual(['valley', 'mountain']);
    });

    it('shows a Fold step chosen for the pattern', () => {
      const chosen = foldPatternStep('f1', OTHER_PATTERN, { step: 'fstep-1' });
      const document = titleBlockDiagram([chosen, foldPatternStep('f2', LATER)], { pattern: { kind: 'step', stepId: 'f1' } });
      expect(shown(document).pattern).toEqual(['step', 'f1']);
      expect(resolveTitleBlock(document).pattern.scene).toEqual(patternScene(chosen.source as DiagramFoldStepSource));
    });

    it('draws a run of steps drawn as one from its thumbnail, the state its last step lands', () => {
      // The capture keeps the run's last step's state as the thumbnail (`foldRunCapture`).
      const run = foldPatternStep('f2', LATER, { step: 'fstep-2', through: 'fstep-3' });
      const document = titleBlockDiagram([foldPatternStep('f1'), run]);
      expect(shown(document).pattern).toEqual(['auto', 'f2']);
      expect(resolveTitleBlock(document).pattern.scene).toEqual(patternScene(run.source as DiagramFoldStepSource));
    });

    it('passes over a Fold step whose capture found no line for Auto, and draws nothing for one chosen', () => {
      const blank = foldPatternStep('f2', [], { step: 'fstep-3' });
      expect(shown(titleBlockDiagram([foldPatternStep('f1'), blank])).pattern).toEqual(['auto', 'f1']);
      expect(shown(titleBlockDiagram([blank])).pattern).toEqual(['auto', null]);
      const chosen = resolveTitleBlock(titleBlockDiagram([foldPatternStep('f1'), blank], { pattern: { kind: 'step', stepId: 'f2' } })).pattern;
      expect([chosen.from, chosen.step?.id, chosen.scene]).toEqual(['step', 'f2', null]);
    });

    it('takes the last of Edit’s links and Fold’s, whichever is later, and passes over a newer build’s Fold step', () => {
      const lockedFold = { ...foldPatternStep('f9', LATER), unknown: { id: 'f9' } };
      expect(shown(titleBlockDiagram([cpStep('s1'), foldPatternStep('f1'), lockedFold])).pattern).toEqual(['auto', 'f1']);
      expect(shown(titleBlockDiagram([foldPatternStep('f1'), cpStep('s1'), uploadStep('s2')])).pattern).toEqual(['auto', 's1']);
      // A References card between them is no pattern.
      expect(shown(titleBlockDiagram([cpStep('s1'), foldPatternStep('f1'), referencesStep('r1')])).pattern).toEqual(['auto', 'f1']);
    });
  });
});

describe('patternScene', () => {
  const stroke = (role: SheetStrokeRole, y: number) => ({ x1: 0, y1: y, x2: 100, y2: y, role });
  const linked = (thumbnail: SheetThumbnail) => ({ kind: 'cp' as const, thumbnail });
  const folded = (thumbnail: SheetThumbnail) => ({ kind: 'fold-step' as const, thumbnail });
  const lines = (scene: PaperScene | null) => scene?.items.map((item) => (item.kind === 'line' ? [item.role, item.a, item.b] : item.kind));

  it('draws a thumbnail’s lines in the pattern’s own pens, an unassigned one as aux, and leaves its aux lines out', () => {
    const thumbnail: SheetThumbnail = {
      viewBox: '0 0 100 100',
      strokes: [stroke('aux', 10), stroke('unassigned', 20), stroke('mountain', 30), stroke('valley', 40), stroke('edge', 0)],
    };
    const scene = patternScene(linked(thumbnail))!;
    expect(scene.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(scene.sheet).toBe(100);
    expect(lines(scene)).toEqual([
      ['aux', [0, 20], [100, 20]],
      ['mountain', [0, 30], [100, 30]],
      ['valley', [0, 40], [100, 40]],
      ['edge', [0, 0], [100, 0]],
    ]);
    // No paper: the pattern sits on the page.
    expect(scene.items.some((item) => item.kind === 'face')).toBe(false);
  });

  it('draws a Fold state’s flat creases in the aux pen, as its Crease pattern picture does: they are creases, not construction lines', () => {
    // A precrease lying flat, a valley folded, the sheet's edge: `foldStateFrame`'s pattern.
    const thumbnail: SheetThumbnail = { viewBox: '0 0 100 100', strokes: [stroke('aux', 10), stroke('valley', 40), stroke('edge', 0)] };
    expect(lines(patternScene(folded(thumbnail)))).toEqual([
      ['aux', [0, 10], [100, 10]],
      ['valley', [0, 40], [100, 40]],
      ['edge', [0, 0], [100, 0]],
    ]);
    // A state of precreases only draws them.
    expect(patternScene(folded({ viewBox: '0 0 100 100', strokes: [stroke('aux', 50)] }))).not.toBeNull();
  });

  it('is none for a thumbnail with no line to draw', () => {
    expect(patternScene(linked({ viewBox: '0 0 100 100', strokes: [] }))).toBeNull();
    expect(patternScene(linked({ viewBox: '0 0 100 100', strokes: [stroke('aux', 50)] }))).toBeNull();
    expect(patternScene(linked({ viewBox: '0 0 0 0', strokes: [stroke('edge', 0)] }))).toBeNull();
    // A Fold capture that found no line keeps the empty thumbnail (`storedSheetThumbnail(null)`).
    expect(patternScene(folded({ viewBox: '0 0 100 100', strokes: [] }))).toBeNull();
    expect(patternScene(folded({ viewBox: '0 0 0 0', strokes: [stroke('valley', 0)] }))).toBeNull();
  });

  it('is drawn exactly where drawsPattern says a thumbnail draws: the one answer the pane and the page read', () => {
    const thumbnails: SheetThumbnail[] = [
      { viewBox: '0 0 100 100', strokes: [] },
      { viewBox: '0 0 100 100', strokes: [stroke('aux', 50)] },
      { viewBox: '0 0 100 100', strokes: [stroke('aux', 50), stroke('unassigned', 20)] },
      { viewBox: '0 0 0 0', strokes: [stroke('edge', 0)] },
      { viewBox: 'none', strokes: [stroke('valley', 0)] },
      { viewBox: '-5 -5 110 110', strokes: [stroke('mountain', 0)] },
    ];
    const sources = [...thumbnails.map(linked), ...thumbnails.map(folded)];
    expect(sources.map(drawsPattern)).toEqual([false, false, true, false, false, true, false, true, true, false, false, true]);
    expect(sources.map((source) => patternScene(source) !== null)).toEqual(sources.map(drawsPattern));
  });
});


describe('titleBlockLook', () => {
  it('prints the subtitle and the labels in capitals, the live count as the last numbered step’s number, and the sizes', () => {
    const document = titleBlockDiagram([cpStep('s1'), turnOver('t1'), cpStep('s2'), uploadStep('s3')], {
      subtitle: 'Origami diagram',
      note: 'Use thin paper.',
      modelSize: 0.5,
    });
    const credited = [
      { op: 'add' as const, credit: { label: 'Author', value: 'Traditional' } },
      { op: 'add' as const, credit: { label: 'Steps', value: { kind: 'step-count' as const } } },
      { op: 'add' as const, credit: { label: 'Größe', value: '' } },
    ].reduce((made, credits) => setTitleBlockContent(made, { credits }), document);
    expect(titleBlockLook(credited)).toEqual({
      subtitle: 'ORIGAMI DIAGRAM',
      credits: [
        { label: 'AUTHOR', value: 'Traditional' },
        // Three steps; the turn is not numbered.
        { label: 'STEPS', value: '3' },
        { label: 'GRÖSSE', value: '' },
      ],
      note: 'Use thin paper.',
      sizes: { modelSize: 0.5, patternSize: TITLE_BLOCK_ART_SIZE_DEFAULTS.patternSize },
    });
    // The count follows the steps.
    expect(titleBlockLook(removeSteps(credited, ['s1'])).credits[1]).toEqual({ label: 'STEPS', value: '2' });
    // CJK as it is; none said, none printed.
    expect(titleBlockLook(setTitleBlockContent(credited, { subtitle: '折り紙の折り図' })).subtitle).toBe('折り紙の折り図');
    expect(titleBlockLook(titleBlockDiagram([cpStep('s1')]))).toEqual({ subtitle: '', credits: [], note: '', sizes: TITLE_BLOCK_ART_SIZE_DEFAULTS });
  });
});

describe('modelRoom', () => {
  const geometry = titleBlockGeometry({ ...DEFAULT_PAGE_SETUP, layout: 'flow' }, 11, 8, TITLE_BLOCK_ART_SIZE_DEFAULTS)!;

  it('stands the model on the pattern’s corner where one is drawn, and at its own size in the pattern’s place where none is', () => {
    expect(modelRoom(geometry, resolveTitleBlock(titleBlockDiagram([cpStep('s1')])))).toEqual({ box: geometry.model, align: geometry.modelAlign });
    const { block, model } = geometry;
    const alone = { box: { ...model, x: block.x + block.w - model.w, y: block.y + block.h - model.h }, align: { x: 1, y: 1 } };
    expect(modelRoom(geometry, resolveTitleBlock(titleBlockDiagram([cpStep('s1')], { pattern: { kind: 'none' } })))).toEqual(alone);
    expect(modelRoom(geometry, resolveTitleBlock(titleBlockDiagram([uploadStep('s1')])))).toEqual(alone);
  });

  it('draws the model’s picture over the pattern’s lower-left corner, whatever its shape and both sizes, on every paper and share (Zach, 2026-10-15)', () => {
    // Pictures tall, square, wide and the crane's 539 × 492, linked to a pattern drawn behind them.
    const pictures = [
      [1, 2],
      [1, 1],
      [2, 1],
      [539, 492],
    ].map(([widthPx, heightPx], index) => {
      const asset = { id: `asset-${index}`, kind: 'raster' as const, src: 'data:image/png;base64,AAAA', widthPx: widthPx! * 100, heightPx: heightPx! * 100, bytes: 4 };
      const step = { ...cpStep(`s${index}`), picture: { kind: 'asset' as const, assetId: asset.id, paperScale: null, key: `raster-${asset.id}` } };
      return { asset, step };
    });
    const stops = Array.from({ length: 8 }, (_, index) => Math.round(30 + 10 * index) / 100).concat(1);
    const papers = Object.keys(PRINT_PAPER_MM).flatMap((size) => (['portrait', 'landscape'] as const).map((orientation) => ({ size, orientation })));
    let drawn = 0;
    for (const paper of papers) {
      for (const heightShare of [0.15, 0.23, 0.5]) {
        for (const modelSize of stops) {
          for (const patternSize of stops) {
            const setup = { ...DEFAULT_PAGE_SETUP, ...paper, layout: 'flow', titleBlock: { enabled: true, heightShare } } as DiagramPageSetup;
            const shape = titleBlockGeometry(setup, 11, 8, { modelSize, patternSize })!;
            const corner = { x: shape.pattern.x, y: shape.pattern.y + shape.pattern.h };
            for (const { asset, step } of pictures) {
              const content = resolveTitleBlock(titleBlockDiagram([step]));
              expect(content.pattern.scene).not.toBeNull();
              const room = modelRoom(shape, content);
              const picture = wholePictureRoom(step, { [asset.id]: asset }, DEFAULT_DIAGRAM_STYLE, room.box, room.align)!;
              const label = JSON.stringify({ ...paper, heightShare, modelSize, patternSize, asset: [asset.widthPx, asset.heightPx] });
              // The corner a fifth of the picture at least inside each of its sides.
              for (const share of [(corner.x - picture.x) / picture.w, (corner.y - picture.y) / picture.h]) {
                expect(share, label).toBeGreaterThanOrEqual(0.2 - 1e-9);
                expect(share, label).toBeLessThanOrEqual(0.8 + 1e-9);
              }
              drawn += 1;
            }
          }
        }
      }
    }
    expect(drawn).toBeGreaterThan(0);
  });
});

describe('missingTitleBlockParts', () => {
  const geometry = titleBlockGeometry({ ...DEFAULT_PAGE_SETUP, layout: 'flow' }, 11, 8, TITLE_BLOCK_ART_SIZE_DEFAULTS)!;
  const set = (title = 'Crane', block: Partial<TitleBlockLook> = {}) =>
    setTitleBlock(geometry, { title, block: { ...emptyTitleBlockLook(), ...block } }, estimateTextSetter);
  const missing = (document: DiagramDocument, title = 'Crane') =>
    missingTitleBlockParts(set(title), resolveTitleBlock(document), null).map(({ room, box, missing: parts }) => [
      room,
      box,
      parts.map(({ part, step, number }) => [part, step?.id ?? null, number]),
    ]);

  it('marks nothing where every part prints', () => {
    expect(missing(titleBlockDiagram([cpStep('s1'), cpStep('s2')]))).toEqual([]);
  });

  it('marks a part no step gives in the room it would print in, naming the step, and no box for a missing title', () => {
    // No linked step and no picture: the pattern and the model would both stand in the pattern's square, one room.
    // No title: no room either — an empty title prints nothing, and is not marked (Zach, 2026-10-15).
    expect(missing(titleBlockDiagram([emptyStep('s1')]), '')).toEqual([
      ['square', geometry.pattern, [['pattern', null, null], ['model', null, null]]],
    ]);
    // A chosen step that can no longer give its part names it, numbered as the pages number it, turns left out.
    const chosen = titleBlockDiagram([cpStep('s1'), turnOver('t1'), uploadStep('s2')], {
      model: { kind: 'step', stepId: 's1' },
      pattern: { kind: 'step', stepId: 's2' },
    });
    expect(missing(removeStepPicture(chosen, 's1'))).toEqual([['square', geometry.pattern, [['pattern', 's2', 2], ['model', 's1', 1]]]]);
    // The model alone missing, in front of a pattern drawn: its own box.
    const pictureless = titleBlockDiagram([cpStep('s1'), cpStep('s2')], { model: { kind: 'step', stepId: 's2' } });
    expect(missing(removeStepPicture(pictureless, 's2'))).toEqual([['model', geometry.model, [['model', 's2', 2]]]]);
    // The pattern alone missing: the model stands in its place, and its square says why there is no pattern.
    expect(missing(titleBlockDiagram([uploadStep('s1')]))).toEqual([['square', geometry.pattern, [['pattern', null, null]]]]);
    expect(missing(titleBlockDiagram([emptyStep('s1')], { pattern: { kind: 'none' } }))).toEqual([['square', geometry.pattern, [['model', null, null]]]]);
  });

  it('marks nothing for a diagram made from Fold, whose last step gives the pattern, and names a Fold step chosen that draws none', () => {
    expect(missing(titleBlockDiagram([foldPatternStep('f1'), foldPatternStep('f2', OTHER_PATTERN, { step: 'fstep-3' })]))).toEqual([]);
    const blank = titleBlockDiagram([foldPatternStep('f1'), foldPatternStep('f2', [], { step: 'fstep-3' })], {
      pattern: { kind: 'step', stepId: 'f2' },
    });
    expect(missing(blank)).toEqual([['square', geometry.pattern, [['pattern', 'f2', 2]]]]);
  });

  it('marks no credit with an empty value, nor an empty note: an empty part is simply not drawn (Zach, 2026-10-15)', () => {
    const content = resolveTitleBlock(titleBlockDiagram([cpStep('s1')]));
    const block = set('Crane', {
      credits: [
        { label: 'AUTHOR', value: '' },
        { label: 'STEPS', value: '9' },
        { label: '', value: '' },
      ],
      note: '',
    });
    expect(missingTitleBlockParts(block, content, null)).toEqual([]);
  });

  it('marks credits left out by a tag under the block’s foot, over nothing it prints, and never a note cut with “…” (Zach, 2026-10-15)', () => {
    const content = resolveTitleBlock(titleBlockDiagram([cpStep('s1')]));
    const long = set('Crane', { note: Array.from({ length: 30 }, (_, index) => `Line ${index + 1}`).join('\n') });
    expect(long.note!.cut).toBe(true);
    expect(missingTitleBlockParts(long, content, null)).toEqual([]);
    // Credits left out on the shortest block, and the whole note under them: the credits alone are marked.
    const short = titleBlockGeometry(
      { ...DEFAULT_PAGE_SETUP, layout: 'flow', size: 'a5', orientation: 'landscape', titleBlock: { enabled: true, heightShare: 0.15 } },
      11,
      8,
      TITLE_BLOCK_ART_SIZE_DEFAULTS
    )!;
    const many = Array.from({ length: 12 }, (_, index) => ({ label: `CREDIT ${index + 1}`, value: 'Traditional design' }));
    const cramped = setTitleBlock(short, { title: 'Crane', block: { ...emptyTitleBlockLook(), credits: many, note: 'Use thin paper.' } }, estimateTextSetter);
    const marks = missingTitleBlockParts(cramped, content, null).filter(({ room }) => room === 'cut');
    expect(marks.map(({ missing: parts }) => parts.map(({ part }) => part))).toEqual([['credits']]);
    expect(marks[0]!.box).toEqual({ x: short.column.x, y: short.block.y + short.block.h, w: short.column.w, h: 5 });
  });

  it('hangs a cut’s tag under the block, never over a line it prints, on every paper, share and grid', () => {
    const content = resolveTitleBlock(titleBlockDiagram([cpStep('s1')]));
    const papers = Object.keys(PRINT_PAPER_MM).flatMap((size) => (['portrait', 'landscape'] as const).map((orientation) => ({ size, orientation })));
    const layouts = [{ layout: 'flow' as const }, ...[2, 3, 6].map((rows) => ({ layout: 'grid' as const, columns: 3, rows }))];
    const credits = Array.from({ length: 9 }, (_, index) => ({ label: `CREDIT ${index + 1}`, value: 'Traditional design' }));
    const note = Array.from({ length: 12 }, () => 'Use thin paper and crease each fold well.').join(' ');
    let cuts = 0;
    for (const paper of papers) {
      for (const heightShare of [0.15, 0.23, 0.5]) {
        for (const layout of layouts) {
          const setup = { ...DEFAULT_PAGE_SETUP, ...paper, ...layout, titleBlock: { enabled: true, heightShare } } as DiagramPageSetup;
          const shape = titleBlockGeometry(setup, 11, 8, TITLE_BLOCK_ART_SIZE_DEFAULTS)!;
          for (const look of [{ note }, { credits, note }]) {
            const block = setTitleBlock(shape, { title: 'Crane', block: { ...emptyTitleBlockLook(), ...look } }, estimateTextSetter);
            const cut = missingTitleBlockParts(block, content, null).find(({ room }) => room === 'cut');
            if (!cut) continue;
            cuts += 1;
            const label = JSON.stringify({ ...paper, ...layout, heightShare, credits: 'credits' in look });
            expect(cut.box.y, label).toBeCloseTo(shape.block.y + shape.block.h, 9);
            expect([cut.box.x, cut.box.w], label).toEqual([shape.column.x, shape.column.w]);
          }
        }
      }
    }
    expect(cuts).toBeGreaterThan(0);
  });

  it('keeps the square’s mark clear of a model drawn in it: the strip it leaves, else the column under what it prints', () => {
    const block = set('Crane');
    const content = resolveTitleBlock(titleBlockDiagram([uploadStep('s1')]));
    const square = geometry.pattern;
    const near = ({ x, y, w, h }: PageBox) => [x, y, w, h].map((value) => expect.closeTo(value, 9));
    const mark = (model: PageBox | null, on = block) =>
      missingTitleBlockParts(on, content, model).map(({ room, box: { x, y, w, h } }) => [room, [x, y, w, h]]);
    // Taller than wide, a portrait upload: the strip beside it.
    const tall = { x: square.x + square.w / 4, y: square.y, w: (3 * square.w) / 4, h: square.h };
    expect(mark(tall)).toEqual([['square', near({ ...square, w: square.w / 4 })]]);
    // Wider than tall: the strip above it.
    const wide = { x: square.x, y: square.y + square.h / 4, w: square.w, h: (3 * square.h) / 4 };
    expect(mark(wide)).toEqual([['square', near({ ...square, h: square.h / 4 })]]);
    // Filling it: in the column, under the band — and under the credits where there are some.
    const { column } = geometry;
    const foot = column.y + column.h;
    const under = (top: number) => near({ x: column.x, y: top, w: column.w, h: foot - top });
    expect(mark(square)).toEqual([['square', under(block.band.y + block.band.h)]]);
    const credited = set('Crane', { credits: [{ label: 'STEPS', value: '9' }] });
    const row = credited.credits!.columns[0]!;
    expect(mark(square, credited)).toEqual([['square', under(row.valueBaseline + 0.24 * credited.credits!.valueSizeMm)]]);
    // No model drawn: the square.
    expect(mark(null)).toEqual([['square', near(square)]]);
  });

  it('marks nothing the author set to none', () => {
    expect(missing(titleBlockDiagram([emptyStep('s1')], { model: { kind: 'none' }, pattern: { kind: 'none' } }))).toEqual([]);
  });

  it('never stands one box of the overlay on another, on any paper, share, grid or size', () => {
    const right = (box: PageBox) => box.x + box.w;
    const foot = (box: PageBox) => box.y + box.h;
    const overlap = (a: PageBox, b: PageBox) =>
      Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x)) * Math.max(0, Math.min(foot(a), foot(b)) - Math.max(a.y, b.y));
    const pictureless = titleBlockDiagram([cpStep('s1'), cpStep('s2')], { model: { kind: 'step', stepId: 's2' } });
    const contents = [
      titleBlockDiagram([cpStep('s1')]),
      titleBlockDiagram([uploadStep('s1')]),
      titleBlockDiagram([emptyStep('s1')]),
      removeStepPicture(pictureless, 's2'),
      titleBlockDiagram([uploadStep('s1')], { pattern: { kind: 'none' } }),
      titleBlockDiagram([emptyStep('s1')], { pattern: { kind: 'none' } }),
      titleBlockDiagram([cpStep('s1')], { model: { kind: 'none' } }),
    ].map(resolveTitleBlock);
    const looks: Partial<TitleBlockLook>[] = [
      {},
      {
        subtitle: 'ORIGAMI DIAGRAM',
        credits: [
          { label: 'AUTHOR', value: '' },
          { label: 'RECOMMENDED SIZE', value: '' },
          { label: 'STEPS', value: '28' },
        ],
        note: 'Use thin paper. The neck and the tail are reverse folded at the same angle.',
      },
    ];
    const papers = Object.keys(PRINT_PAPER_MM).flatMap((size) => (['portrait', 'landscape'] as const).map((orientation) => ({ size, orientation })));
    const layouts = [{ layout: 'flow' as const }, ...[2, 3, 6].map((rows) => ({ layout: 'grid' as const, columns: 3, rows }))];
    const { min, max } = TITLE_BLOCK_ART_SIZE_RANGE;
    const sizes = [TITLE_BLOCK_ART_SIZE_DEFAULTS, { modelSize: max, patternSize: min }, { modelSize: min, patternSize: max }];
    /** A picture of `aspect` fitted to its room's box, standing where the room says, as `wholePicture` draws it. */
    const standing = ({ box, align }: ModelRoom, aspect: number): PageBox => {
      const w = Math.min(box.w, box.h * aspect);
      const h = w / aspect;
      return { x: box.x + align.x * (box.w - w), y: box.y + align.y * (box.h - h), w, h };
    };
    let rooms = 0;
    for (const paper of papers) {
      for (const heightShare of [0.15, 0.23, 0.5]) {
        for (const layout of layouts) {
          for (const size of sizes) {
            const setup = { ...DEFAULT_PAGE_SETUP, ...paper, ...layout, titleBlock: { enabled: true, heightShare } } as DiagramPageSetup;
            const label = JSON.stringify({ ...paper, ...layout, heightShare, ...size });
            const shape = titleBlockGeometry(setup, 11, 8, size)!;
            for (const content of contents) {
              const room = modelRoom(shape, content);
              for (const look of looks) {
                for (const title of ['', 'Crane']) {
                  const block = setTitleBlock(shape, { title, block: { ...emptyTitleBlockLook(), ...look, sizes: size } }, estimateTextSetter);
                  // The model as drawn where it is: tall, square or wide, standing where its room says.
                  for (const aspect of [3 / 4, 1, 4 / 3]) {
                    const drawn = content.model.step?.picture ? standing(room, aspect) : null;
                    const marks = missingTitleBlockParts(block, content, drawn);
                    const boxes = marks.map(({ box }) => box);
                    rooms += boxes.length;
                    boxes.forEach((a, index) => boxes.slice(index + 1).forEach((b) => expect(overlap(a, b), label).toBeLessThan(1e-9)));
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(rooms).toBeGreaterThan(0);
  });
});
