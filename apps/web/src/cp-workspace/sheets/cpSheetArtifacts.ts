import { AUX_LINES_KEY } from '@treemaker/origami-simulator';
import type { FoldArtifacts, FoldDocument } from '../../engine/types';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { creaseFingerprint } from '../../lib/creaseFingerprint';
import {
  foldArtifactsSimulating,
  segmentationFoldArtifactsFromFold,
} from '../../lib/creasePatternImport';
import { wholeFoldSegment } from '../../lib/creasePatternSegmentation';
import { splitSimulationLines } from './simulationLines';
import { exportOristudioCpLinesAsFold } from '../../store/workspaceStore/oristudioCpRuntime';
import { ensureCpSheetIndex } from './cpSheetIndex';

/**
 * One sheet's faces, built when something acts on that sheet: its lines as the
 * kernel exports them (`exportOristudioCpLinesAsFold`), with the kernel's faces
 * where it can trust them and faces inferred from the lines where it cannot —
 * what segmentation did for the whole canvas, for one sheet. On the 489k-line
 * reference canvas that is tens of milliseconds a sheet, where the whole canvas
 * took eleven seconds.
 *
 * The artifacts carry one segment, the whole sheet ({@link wholeFoldSegment}),
 * whose id is the sheet's position in the index. Callers that took a fold and a
 * segment from whole-canvas segmentation take them from here unchanged.
 */
export function sheetArtifactsFromFold(fold: FoldDocument, sheet: number): FoldArtifacts {
  const artifacts = segmentationFoldArtifactsFromFold(fold);
  return { ...artifacts, segments: [wholeFoldSegment(artifacts.fold, sheet)] };
}

/**
 * Enough for every sheet one action or one diagram page touches; a superseded
 * crease geometry drops them all, as `cpSheetIndex` drops its one index.
 */
const MAX_CACHED_SHEETS = 8;

let cached: { fingerprint: string; sheets: Map<number, FoldArtifacts> } | null = null;
const inFlight = new Map<string, Promise<FoldArtifacts | null>>();

function cachedSheets(fingerprint: string): Map<number, FoldArtifacts> {
  if (cached?.fingerprint !== fingerprint) cached = { fingerprint, sheets: new Map() };
  return cached.sheets;
}

/**
 * The artifacts for one sheet of the open crease pattern, built once per crease
 * geometry. `null` without a document, for a sheet the index does not have, or
 * when the export fails.
 *
 * Like the whole-canvas segmentation before it, this reads the kernel's current
 * document: an edit landing between the index and the export is not detected.
 */
export function ensureCpSheetArtifacts(
  document: OristudioCpDocumentSnapshot | null | undefined,
  sheet: number
): Promise<FoldArtifacts | null> {
  if (!document) return Promise.resolve(null);
  const fingerprint = creaseFingerprint(document);
  const hit = cached?.fingerprint === fingerprint ? cached.sheets.get(sheet) : undefined;
  if (hit) return Promise.resolve(hit);
  const key = `${fingerprint}#${sheet}`;
  const running = inFlight.get(key);
  if (running) return running;

  const promise = (async (): Promise<FoldArtifacts | null> => {
    const index = await ensureCpSheetIndex(document);
    if (!index || sheet < 0 || sheet >= index.sheetCount) return null;
    const fold = JSON.parse(await exportOristudioCpLinesAsFold(index.lines(sheet))) as FoldDocument;
    const artifacts = sheetArtifactsFromFold(fold, sheet);
    const sheets = cachedSheets(fingerprint);
    sheets.set(sheet, artifacts);
    if (sheets.size > MAX_CACHED_SHEETS) {
      const oldest = sheets.keys().next().value;
      if (oldest !== undefined) sheets.delete(oldest);
    }
    return artifacts;
  })()
    .catch((error: unknown) => {
      // Not cached: one transient failure must not disable the sheet until the
      // next edit.
      console.warn('Crease-pattern sheet faces failed.', error);
      return null;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

/** The sheets' meshes, by sheet and by what their aux lines are, for the same crease geometry. */
let cachedSimulations: { fingerprint: string; sheets: Map<string, FoldArtifacts> } | null = null;
const simulationsInFlight = new Map<string, Promise<FoldArtifacts | null>>();

/**
 * {@link ensureCpSheetArtifacts} with the simulation mesh as well — the
 * triangulated fold Simulate, an inline window and a Diagram pose solve —
 * built for this sheet alone and cached with its faces.
 *
 * The mesh is the sheet's fold lines alone (`simulationSourceFold`), so an aux
 * line never cuts the paper; it rides on it instead. With
 * `auxLinesAreFacets`, the document's aux lines are facets and are built in.
 */
export function ensureCpSheetSimulationArtifacts(
  document: OristudioCpDocumentSnapshot | null | undefined,
  sheet: number,
  auxLinesAreFacets = false
): Promise<FoldArtifacts | null> {
  if (!document) return Promise.resolve(null);
  const fingerprint = creaseFingerprint(document);
  const key = `${sheet}:${auxLinesAreFacets ? 'facets' : 'drawn'}`;
  const hit = cachedSimulations?.fingerprint === fingerprint ? cachedSimulations.sheets.get(key) : undefined;
  if (hit) return Promise.resolve(hit);
  const flightKey = `${fingerprint}#${key}`;
  const running = simulationsInFlight.get(flightKey);
  if (running) return running;

  const promise = (async (): Promise<FoldArtifacts | null> => {
    const artifacts = await ensureCpSheetArtifacts(document, sheet);
    const index = await ensureCpSheetIndex(document);
    if (!artifacts || !index) return artifacts;
    const source = await simulationSourceFold(document, index.lines(sheet), artifacts.fold, auxLinesAreFacets);
    const meshed: FoldArtifacts = {
      ...foldArtifactsSimulating(artifacts.fold, source),
      segments: artifacts.segments,
    };
    if (cachedSimulations?.fingerprint !== fingerprint) {
      cachedSimulations = { fingerprint, sheets: new Map() };
    }
    const sheets = cachedSimulations.sheets;
    sheets.set(key, meshed);
    if (sheets.size > MAX_CACHED_SHEETS) {
      const oldest = sheets.keys().next().value;
      if (oldest !== undefined) sheets.delete(oldest);
    }
    return meshed;
  })()
    .catch((error: unknown) => {
      console.warn('Crease-pattern sheet mesh failed.', error);
      return null;
    })
    .finally(() => {
      simulationsInFlight.delete(flightKey);
    });
  simulationsInFlight.set(flightKey, promise);
  return promise;
}

/**
 * The fold a sheet's paper is simulated from: its fold lines alone, exported
 * by the kernel so the faces it traces — and its Euler check — are those of
 * exactly the paper simulated, with its aux lines carried beside them
 * (`AUX_LINES_KEY`). The base fold when every line is the paper's.
 */
export async function simulationSourceFold(
  document: OristudioCpDocumentSnapshot,
  lineIds: readonly number[],
  base: FoldDocument,
  auxLinesAreFacets: boolean
): Promise<FoldDocument> {
  const { paper, aux } = splitSimulationLines(document, lineIds, auxLinesAreFacets);
  if (aux.length === 0) return base;
  const fold = JSON.parse(await exportOristudioCpLinesAsFold(paper)) as FoldDocument;
  return { ...fold, [AUX_LINES_KEY]: aux };
}
