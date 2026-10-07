import {
  createDiagram,
  createStep,
  createTurn,
  insertSteps,
  setPageSetup,
  uploadPictureKey,
  type DiagramDocument,
  type DiagramEntry,
  type DiagramPageSetup,
  type DiagramRasterAsset,
  type DiagramStep,
  type DiagramStepZoom,
  type DiagramTurn,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { cpStep, referencesStep } from '../document/diagramSteps.fixtures';

/**
 * Whole diagrams whose pages take every path the layout has for splitting
 * steps into pages and cells: the grid and the flow (its steps per page
 * filling every cell, or leaving a short last row), a page break, turns at
 * a row's end and after the last step, spreads from either side, enlarged
 * steps (with their arrow, and one waiting for its picture), a newer build's
 * steps and turns, empty steps, uploads and References cards, and a diagram
 * of none. A `.fixtures.ts` module so the tests that hold `cellSlots` to the
 * layout's cells, and the page goldens, read the same diagrams.
 */
export interface PageLayoutFixture {
  name: string;
  document: DiagramDocument;
}

const WORDS = [
  'Fold in half.',
  'Fold the bottom edge up to the top edge, crease firmly, then unfold.',
  '',
  'Turn the model over.',
  'Squash-fold the flap so the crease lines up with the centre.',
];

function diagram(entries: readonly DiagramEntry[], page: Partial<DiagramPageSetup>, assets: DiagramDocument['assets'] = {}): DiagramDocument {
  const document = insertSteps(createDiagram({ title: 'Crane', newId: () => 'diagram-fixture' }), entries, 0);
  return setPageSetup({ ...document, assets }, page);
}

/** A run of steps: crease patterns, References cards and empty steps in turn, each with its words. */
function steps(count: number, prefix = 'step', breaks: readonly number[] = []): DiagramStep[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `${prefix}-${index}`;
    const base = index % 5 === 2 ? referencesStep(id) : index % 7 === 6 ? createStep(() => id) : cpStep(id);
    return { ...base, text: WORDS[index % WORDS.length]!, breakBefore: breaks.includes(index) };
  });
}

const over = (id: string): DiagramTurn => createTurn({ kind: 'turn-over', axis: 'vertical' }, () => id);
const round = (id: string): DiagramTurn => createTurn({ kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } }, () => id);

/** Turns put in before the steps at `before` (indices into `list`), and after the last when asked. */
function withTurns(list: readonly DiagramStep[], before: readonly number[], after = false): DiagramEntry[] {
  const entries: DiagramEntry[] = [];
  list.forEach((step, index) => {
    if (before.includes(index)) entries.push(index % 2 === 0 ? over(`turn-${index}`) : round(`turn-${index}`));
    entries.push(step);
  });
  if (after) entries.push(over('turn-last'));
  return entries;
}

/** A newer build's step: carried whole, it takes a cell as any step. */
function lockedStep(id: string, breakBefore = false): DiagramStep {
  return { ...createStep(() => id), breakBefore, unknown: { id, revision: 0, source: { kind: 'hologram' }, breakBefore } };
}

/** A newer build's turn: carried whole, never drawn. */
function lockedTurn(id: string): DiagramTurn {
  return { id, kind: 'turn-over', axis: 'vertical', unknown: { id, kind: 'spin', axis: 'diagonal' } };
}

const AREA: KnownDiagramAnnotation = { id: 'area-1', kind: 'zoom', from: [0.5, 0.4], to: [0.5, 0.4], radius: 0.15 };
const ZOOM: DiagramStepZoom = { from: 'area-1', shape: 'circle', frame: { centre: [1, 0.5], radius: 0.3 } };

function areaStep(id: string): DiagramStep {
  const step = cpStep(id);
  return { ...step, text: 'Mark the corner.', annotations: [AREA], annotatedPictureKey: step.picture!.key };
}

function enlargedStep(id: string, scale?: number): DiagramStep {
  const step = cpStep(id);
  return { ...step, text: 'Close up.', zoom: { ...ZOOM, ...(scale ? { scale } : {}) }, annotatedPictureKey: step.picture!.key };
}

/** A 20 × 10 px PNG's table entry: what an upload's layout reads is its size. */
const RASTER: DiagramRasterAsset = {
  id: 'asset-1',
  kind: 'raster',
  src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAKCAYAAACjd+KYAAAADklEQVR4nGNgGAWjAAMAAToAAa1HmV0AAAAASUVORK5CYII=',
  widthPx: 20,
  heightPx: 10,
  bytes: 120,
};

function uploadStep(id: string): DiagramStep {
  return {
    ...createStep(() => id),
    text: 'As in the photo.',
    source: { kind: 'upload', assetId: RASTER.id, rotationQuarterTurns: 0, mirrored: false },
    picture: { kind: 'asset', assetId: RASTER.id, paperScale: null, key: uploadPictureKey(RASTER.id) },
  };
}

export function pageLayoutFixtures(): PageLayoutFixture[] {
  return [
    { name: 'grid, two pages', document: diagram(steps(11), { layout: 'grid', columns: 3, rows: 3 }) },
    {
      name: 'grid, a page break, turns and an upload',
      document: diagram(
        withTurns([...steps(6, 'step', [4]), uploadStep('step-upload'), ...steps(3, 'more')], [1, 3, 6], true),
        { layout: 'grid', columns: 4, rows: 2, showTitle: false },
        { [RASTER.id]: RASTER }
      ),
    },
    {
      name: 'flow, a page break and turns at a row’s end',
      document: diagram(withTurns(steps(14, 'step', [8]), [3, 5, 9]), { layout: 'flow', stepsPerPage: 9 }),
    },
    {
      name: 'flow from the right, across spreads, rows read upward',
      document: diagram(steps(10), { layout: 'flow', stepsPerPage: 4, firstPageSide: 'right', pageNumbers: { enabled: false, first: 1 } }),
    },
    {
      name: 'flow, seven steps a page: short last rows, across a spread and a page turn',
      // 3 · 3 · 1 on Letter: page 1's lane runs on through its empty cells to the spine.
      document: diagram(withTurns(steps(17), [3, 6, 10]), { layout: 'flow', stepsPerPage: 7, size: 'letter' }),
    },
    {
      name: 'flow landscape, an odd row count',
      document: diagram(withTurns(steps(16), [7]), { layout: 'flow', stepsPerPage: 12, orientation: 'landscape', size: 'letter', marginMm: 6 }),
    },
    {
      name: 'enlarged steps: a Fill run, a Size, and one waiting for its picture',
      document: diagram(
        [
          cpStep('step-a'),
          areaStep('step-area'),
          enlargedStep('step-zoom-1'),
          enlargedStep('step-zoom-2', 2),
          { ...createStep(() => 'step-seeded'), zoom: ZOOM },
          cpStep('step-b'),
          over('turn-1'),
          cpStep('step-c'),
        ],
        // 2 × 3: until Phase 1b, 3 × 2, which prints six steps smaller on A4 (48 mm, not 58).
        { layout: 'flow', stepsPerPage: 6 }
      ),
    },
    {
      name: 'a newer build’s steps and turns',
      document: diagram(
        [cpStep('step-0'), lockedStep('step-locked-1'), lockedTurn('turn-locked'), cpStep('step-2'), lockedStep('step-locked-3', true), cpStep('step-4'), cpStep('step-5')],
        { layout: 'grid', columns: 2, rows: 2 }
      ),
    },
    { name: 'no steps', document: diagram([], { layout: 'flow' }) },
  ];
}
