import type { SheetStroke } from '../../cp-workspace/sheets/sheetThumbnail';
import {
  createDiagram,
  createStep,
  createTurn,
  insertSteps,
  setTitleBlockContent,
  type DiagramCpRender,
  type DiagramDocument,
  type DiagramEntry,
  type DiagramFoldStepSource,
  type DiagramPageSetup,
  type DiagramStep,
  type DiagramTitleBlockContentPatch,
} from '../document/diagramDocument';
import { cpSource, cpStep, foldStepStep } from '../document/diagramSteps.fixtures';
import { titleBlockBand, titleBlockParts, type TitleBlockGeometry, type TitleBlockSizes } from './titleBlockGeometry';

/**
 * The steps and diagrams the title block's tests build: one of each kind
 * Auto takes or passes over. A `.fixtures.ts` module so what the block
 * resolves (`titleBlockContent`), what the Page pane offers
 * (`titleBlockChoices`) and the pane's section read the same steps.
 */

/** A turn, which has no number and is never the block's. */
export const turnOver = (id: string) => createTurn({ kind: 'turn-over', axis: 'vertical' }, () => id);

/** A step with nothing in it yet. */
export const emptyStep = (id: string) => createStep(() => id);

/** A step a newer build wrote: locked, never the block's. */
export const lockedStep = (id: string): DiagramStep => ({ ...cpStep(id), unknown: { id } });

/** An uploaded picture: a picture, and no pattern. */
export const uploadStep = (id: string): DiagramStep => ({
  ...createStep(() => id),
  source: { kind: 'upload', assetId: 'asset-1', rotationQuarterTurns: 0, mirrored: false },
  picture: { kind: 'asset', assetId: 'asset-1', paperScale: 1, key: 'upload-asset-1' },
});

/** A valley across a 100-unit square: another pattern than `cpStep`'s. */
export const OTHER_PATTERN: readonly SheetStroke[] = [{ x1: 0, y1: 0, x2: 100, y2: 100, role: 'valley' }];

/**
 * A step linked to a pattern whose stored thumbnail is `strokes` in a
 * 100-unit square: by default {@link OTHER_PATTERN}; none, or aux lines only,
 * for a link with no line the block draws.
 */
export function patternStep(id: string, strokes: readonly SheetStroke[] = OTHER_PATTERN, render?: DiagramCpRender): DiagramStep {
  return { ...cpStep(id), source: { ...cpSource(render), thumbnail: { viewBox: '0 0 100 100', strokes: [...strokes] } } };
}

/**
 * A step linked to a Fold step, its stored thumbnail — the crease pattern of
 * the step's state — `strokes` in a 100-unit square: by default
 * {@link OTHER_PATTERN}. `patch` makes it another step, or a run (`through`).
 */
export function foldPatternStep(
  id: string,
  strokes: readonly SheetStroke[] = OTHER_PATTERN,
  patch: Partial<DiagramFoldStepSource> = {}
): DiagramStep {
  return foldStepStep(id, { thumbnail: { viewBox: '0 0 100 100', strokes: [...strokes] }, ...patch });
}

/** The band and its parts at once, as the layout takes them: `titleBlockBand`, then `titleBlockParts`. */
export function titleBlockGeometry(setup: DiagramPageSetup, headMm: number, footMm: number, sizes: TitleBlockSizes): TitleBlockGeometry | null {
  const band = titleBlockBand(setup, headMm, footMm);
  return band ? titleBlockParts(band, sizes) : null;
}

/** A diagram of `entries`, its title block's content set by `content`. */
export function titleBlockDiagram(entries: DiagramEntry[], content: DiagramTitleBlockContentPatch = {}): DiagramDocument {
  return setTitleBlockContent(insertSteps(createDiagram({ title: 'Crane', newId: () => 'diagram-1' }), entries, 0), content);
}
