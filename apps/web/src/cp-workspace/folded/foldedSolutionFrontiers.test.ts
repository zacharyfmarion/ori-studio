import { afterEach, describe, expect, it } from 'vitest';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS, emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import { UNSEARCHED_FRONTIER } from '../../lib/layerOrderPlace';
import {
  createNativeCreasePatternProjectFile,
  parseNativeProjectFile,
  serializeNativeProjectFile,
} from '../../lib/nativeProjectFile';
import { importedCpLineage } from '../../lib/oristudioCpLineage';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { FIGURE } from '../canvasObjects/canvasObjectKinds.fixtures';
import { foldedFigureFrontier } from './foldedFigureState';
import {
  noteSolutionFrontier,
  resetSolutionFrontiers,
  seedSolutionFrontier,
  solutionFrontierOf,
  startSolutionFrontier,
} from './foldedSolutionFrontiers';

afterEach(() => resetSolutionFrontiers());

/** A flat figure on handle 5, back on its second solution after a restart that forgot four. */
const FIGURE_ON_SECOND = {
  ...FIGURE,
  status: 'ready',
  handle: 5,
  snapshot: {
    model: { state: 'Front0' },
    display_style: 'Paper5',
    discovered_fold_cases: 2,
    current_fold_case: 2,
    find_another_overlap_valid: true,
  },
} as unknown as OristudioCpFoldedFigureEntry;

describe('the layer-order search’s frontier, by handle', () => {
  it('only grows, and closes when a search at its edge fails', () => {
    noteSolutionFrontier(5, { discovered: 4, hasNext: true });
    noteSolutionFrontier(5, { discovered: 2, hasNext: true });
    expect(solutionFrontierOf(5)).toEqual({ cases: 4, complete: false });
    noteSolutionFrontier(5, { discovered: 4, hasNext: false });
    expect(solutionFrontierOf(5)).toEqual({ cases: 4, complete: true });
  });

  it('starts a new fold fresh, and a duplicate where its original stood', () => {
    noteSolutionFrontier(5, { discovered: 4, hasNext: false });
    seedSolutionFrontier(6, 5);
    expect(solutionFrontierOf(6)).toEqual({ cases: 4, complete: true });
    startSolutionFrontier(5);
    expect(solutionFrontierOf(5)).toEqual(UNSEARCHED_FRONTIER);
    // A duplicate of a figure never stepped starts at nothing, not at a stale slot's.
    noteSolutionFrontier(7, { discovered: 9, hasNext: false });
    seedSolutionFrontier(7, 5);
    expect(solutionFrontierOf(7)).toEqual(UNSEARCHED_FRONTIER);
  });

  it('lays a figure’s own report over its handle’s, and reads nothing for no handle', () => {
    noteSolutionFrontier(5, { discovered: 4, hasNext: false });
    expect(foldedFigureFrontier(FIGURE_ON_SECOND)).toEqual({ cases: 4, complete: true });
    expect(foldedFigureFrontier({ ...FIGURE_ON_SECOND, handle: null })).toEqual({ cases: 2, complete: false });
  });

  it('is never written to a file, and a reopened figure reads only its snapshot', () => {
    noteSolutionFrontier(5, { discovered: 4, hasNext: false });
    const file = createNativeCreasePatternProjectFile({
      title: 'Kabuto',
      filename: 'kabuto.osf',
      path: null,
      document: createStarterOristudioCpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [FIGURE_ON_SECOND],
      activeFoldedFigureId: FIGURE_ON_SECOND.id,
      lineage: importedCpLineage(),
      appVersion: '0.6.2',
      now: new Date('2026-10-25T12:00:00.000Z'),
    });
    const text = serializeNativeProjectFile(file);
    const written = JSON.parse(text) as {
      workspace: { creasePattern: { viewState: { foldedFigures: Record<string, unknown>[] } } };
    };
    const figure = written.workspace.creasePattern.viewState.foldedFigures[0]!;
    // What it was written with: its own snapshot's report, and no word of the search's reach.
    expect((figure.snapshot as { discovered_fold_cases: number }).discovered_fold_cases).toBe(2);
    expect(text).not.toMatch(/frontier/iu);

    const reopened = parseNativeProjectFile(text).workspace.creasePattern?.viewState.foldedFigures[0];
    expect(reopened?.handle).toBeNull();
    // Reloaded, it has no search: it shows what its snapshot says.
    expect(foldedFigureFrontier(reopened)).toEqual({ cases: 2, complete: false });
  });
});
