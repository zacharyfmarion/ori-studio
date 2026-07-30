import { clearAllInlineSimulationSources } from '../../cp-workspace/inlineSimulation/inlineSimulationRuntime';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import type { WorkspaceState } from './types';

/**
 * The keys whose values belong to *one open crease-pattern document*, and must
 * therefore all be replaced together when a different document is opened.
 *
 * Listed as a tuple rather than only as a type so the same list is available at
 * runtime — {@link CP_DOCUMENT_SCOPED_KEYS} is what lets a test prove an entry
 * point resets every one of them without that test needing its own copy of the
 * list to fall out of date.
 *
 * Fold artifacts are deliberately absent: they are derived from the document but
 * have their own trio of helpers (`staleFoldArtifactResourceState`,
 * `emptyFoldArtifactResourceState`, `pickFoldArtifactResourceState`) because
 * callers legitimately choose between discarding, emptying and preserving them.
 * That is the same pattern as this one, applied to a field group with three
 * outcomes instead of two.
 */
export const CP_DOCUMENT_SCOPED_KEYS = [
  'importedCreasePattern',
  'oristudioCpDocument',
  'oristudioCpLineage',
  'oristudioCpOperationDescriptors',
  'oristudioCpError',
  'oristudioCpCamvResult',
  'oristudioCpHistoryPast',
  'oristudioCpHistoryFuture',
  'oristudioCpSelection',
  'oristudioCpActiveDiagnosticId',
  'oristudioCpRevision',
  'oristudioCpFoldedFigures',
  'oristudioCpActiveFoldedFigureId',
  'oristudioCpAnnotations',
  'oristudioCpSelectedAnnotationId',
  'oristudioCpInlineSimulations',
  'oristudioCpFocusedInlineSimulationId',
  'oristudioCpDocumentExtensions',
] as const;

/**
 * Everything scoped to one open crease-pattern document.
 *
 * Deliberately **not** `Partial`. Every producer below returns this type in
 * full, so adding a key to {@link CP_DOCUMENT_SCOPED_KEYS} is a compile error
 * until each producer says what happens to it when a document is replaced.
 * Before that, a new per-document field simply survived into the next document
 * and nothing said so — which is how a simulation window opened over a `.cp`
 * import lived on, reporting itself merely "out of date" over a crease pattern
 * it had never been built from.
 */
export type CpDocumentScopedState = {
  [K in (typeof CP_DOCUMENT_SCOPED_KEYS)[number]]: WorkspaceState[K];
};

/**
 * Let go of the document-scoped state, for a replacement that brings its own.
 *
 * Also drops the simulation folds, which is the half of this that does not live
 * in the store: a window is a descriptor here plus a captured `FoldDocument` in
 * a module side table, and clearing either alone is a bug that does not look
 * like one. Leave the descriptors and the previous document's windows survive
 * into the new one; leave the folds and hundreds of KB to megabytes apiece stay
 * resident with nothing able to reach them, since window ids are never reused.
 *
 * Spread it into the replacing `set`, then override whatever the incoming
 * document supplies of its own.
 */
export function discardCpDocumentState(): CpDocumentScopedState {
  clearAllInlineSimulationSources();
  return {
    importedCreasePattern: null,
    oristudioCpDocument: null,
    oristudioCpLineage: null,
    oristudioCpOperationDescriptors: [],
    oristudioCpError: null,
    oristudioCpCamvResult: null,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    oristudioCpSelection: emptyOristudioCpSelection(),
    oristudioCpActiveDiagnosticId: null,
    oristudioCpRevision: 0,
    oristudioCpFoldedFigures: [],
    oristudioCpActiveFoldedFigureId: null,
    oristudioCpAnnotations: [],
    oristudioCpSelectedAnnotationId: null,
    oristudioCpInlineSimulations: [],
    oristudioCpFocusedInlineSimulationId: null,
    oristudioCpDocumentExtensions: {},
  };
}
