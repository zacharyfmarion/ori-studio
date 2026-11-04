import { useMemo } from 'react';
import { documentPaperStyleOf, type ResolvedDocumentPaperStyle } from '../../lib/paper/documentPaperStyle';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { shownFoldSequence } from '../../store/workspaceStore/foldState';
import { FOLD_DEFAULT_PAPER_STYLE, type FoldSequenceDocument } from '../document/foldSequenceDocument';

/** The style a sequence keeps, or the default for one that has none yet (or for no sequence). */
export function foldStoredPaperStyle(document: FoldSequenceDocument | null | undefined): ResolvedDocumentPaperStyle {
  return document?.style ?? FOLD_DEFAULT_PAPER_STYLE;
}

/** The style the shown sequence keeps, as the Paper tab's Style shows it. */
export function useFoldStoredPaperStyle(): ResolvedDocumentPaperStyle {
  return useWorkspaceStore((state) => foldStoredPaperStyle(shownFoldSequence(state)?.document));
}

/**
 * The paper style the shown sequence is drawn in — its own, picked in the
 * Paper tab, else the default (the built-in Diagram style) — for every Fold
 * surface that paints paper: the canvas's folded pane, the step strip's
 * cards. Never the app's display style: a sequence's look is its own, as a
 * diagram's is.
 */
export function useFoldPaperStyle(): PaperStyle {
  const stored = useFoldStoredPaperStyle();
  return useMemo(() => documentPaperStyleOf(stored), [stored]);
}
