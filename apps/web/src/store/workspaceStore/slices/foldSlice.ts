import { withFoldCursor } from '../../../fold/document/foldReaderState';
import {
  createFoldSequence,
  type FoldOpKind,
  type FoldSequenceDocument,
} from '../../../fold/document/foldSequenceDocument';
import * as foldEdits from '../../../fold/document/foldSequenceEdits';
import {
  discardFoldState,
  foldReaderAfter,
  settledFoldReader,
  shownFoldSequence,
  type FoldSequences,
} from '../foldState';
import { createProjectDocumentHistory } from '../projectDocumentHistory';
import type { FoldSlice, WorkspaceSliceCreator, WorkspaceState } from '../types';

/** A committed step's undo entry, by what it does. */
const STEP_LABELS: Record<FoldOpKind, string> = {
  pleat: 'Pleat',
  repeat: 'Repeat on the other side',
  valley: 'Valley fold',
  mountain: 'Mountain fold',
  precrease: 'Precrease',
  unfold: 'Unfold',
  'unfold-to': 'Unfold to step',
  refold: 'Refold',
  turn: 'Turn over',
  rotate: 'Rotate',
  'cp-jump': 'Import crease pattern',
  // Compound folds (plan D4), one block per family.
  'inside-reverse': 'Inside reverse fold',
  'outside-reverse': 'Outside reverse fold',
  crimp: 'Crimp',
  tuck: 'Tuck',
  squash: 'Squash fold',
  petal: 'Petal fold',
  'rabbit-ear': 'Rabbit ear',
  swivel: 'Swivel fold',
  'open-sink': 'Open sink',
  'closed-sink': 'Closed sink',
  unsink: 'Unsink',
};

/**
 * The Fold workspace's sequences and the reader's place in them
 * (implementation-plans/fold-workspace.md, D6 and D7).
 *
 * Every edit goes through the project-document kit's commit
 * (`projectDocumentHistory`), over the whole array: it creates the first
 * sequence on first use, records one undo entry, and marks the project dirty
 * — and does nothing at all for an edit that changes nothing, so a no-op
 * never costs an undo step. The edits themselves are the document module's
 * (`foldSequenceEdits`), applied to the sequence shown; a newer build's
 * sequence takes none.
 *
 * The reader state is set directly: neither history nor a reason to save. It
 * follows every change of the sequences through one rule, here — after an
 * edit, an undo and a redo — so no verb can leave it on a step that is gone
 * (`foldReaderAfter`).
 */
export const createFoldSlice: WorkspaceSliceCreator<FoldSlice> = (set, get) => {
  const documentHistory = createProjectDocumentHistory<WorkspaceState, FoldSequences, FoldSequences>({
    get,
    set,
    // No read-only field: each sequence is a newer build's or not on its own (`commitShown`).
    keys: { document: 'foldSequences', history: 'foldHistory', loadId: 'foldLoadId' },
    // A project with none is given the sequence its first edit edits: a square, front up.
    base: (stored) => (stored.length > 0 ? stored : [{ document: createFoldSequence(), readOnlyRaw: null }]),
    discard: discardFoldState,
    // An edit is reconciled as a delete is: an append or an annotation takes
    // nothing away, so it moves nothing; a delete or a change of shape takes
    // the cursor off what it removed.
    beforeCommit: (base, edited) => ({
      document: edited,
      alongside: () => ({ foldReader: foldReaderAfter(get().foldReader, base, edited, 'delete') }),
    }),
    reconcile: (restored, { before, direction }) => ({
      foldReader: foldReaderAfter(get().foldReader, before, restored, direction),
    }),
  });

  /**
   * Apply `edit` to the shown sequence — the first — as one undo step. A
   * newer build's sequence is shown, never changed, and is left as it is;
   * so is one `edit` returns unchanged, which records nothing.
   */
  const commitShown = (
    label: string,
    edit: (document: FoldSequenceDocument) => FoldSequenceDocument,
    extend = false
  ): FoldSequences | null =>
    documentHistory.commit(
      label,
      (sequences) => {
        const [shown, ...rest] = sequences;
        if (!shown || shown.readOnlyRaw !== null) return sequences;
        const document = edit(shown.document);
        return document === shown.document ? sequences : [{ ...shown, document }, ...rest];
      },
      extend
    );

  /** Whether an edit was started against sequences that have since been replaced. */
  const outlived = (loadId: number | undefined) => loadId !== undefined && loadId !== get().foldLoadId;

  return {
    ...discardFoldState(),

    installFoldSequences: (sequences, reader) =>
      documentHistory.install({ foldSequences: sequences, foldReader: settledFoldReader(reader, sequences) }),

    commitFoldStep: (draft, { loadId } = {}) => {
      if (outlived(loadId)) return null;
      let stepId: string | null = null;
      const next = commitShown(STEP_LABELS[draft.op.kind], (document) => {
        const appended = foldEdits.appendFoldStep(document, draft);
        stepId = appended?.id ?? null;
        return appended?.document ?? document;
      });
      const shown = next?.[0];
      if (!shown || stepId === null) return null;
      // The step just folded is the one on screen, and the active path runs through it.
      const reader = get().foldReader;
      if (reader) set({ foldReader: withFoldCursor(reader, shown.document, stepId) });
      return stepId;
    },

    commitFoldSteps: (parent, entries, loadId) => {
      if (outlived(loadId) || get().foldReader?.cursor !== parent) return null;
      let id: string | null = null;
      const next = commitShown('Repeat on the other side', (document) => {
        const result = foldEdits.appendFoldSteps(document, parent, entries);
        id = result?.id ?? null;
        return result?.document ?? document;
      });
      const reader = get().foldReader;
      if (!next?.[0] || !id || !reader) return null;
      set({ foldReader: withFoldCursor(reader, next[0].document, id) });
      return id;
    },
    updateFoldRepeat: (stepId, expected, op, expect, loadId) =>
      !outlived(loadId) && commitShown('Update Repeat from source', (document) =>
        foldEdits.updateFoldRepeat(document, stepId, expected, op, expect)) !== null,

    updateFoldReturn: (stepId, expected, op, expect, loadId) =>
      !outlived(loadId) && commitShown('Rebuild unfold', (document) =>
        foldEdits.updateFoldReturn(document, stepId, expected, op, expect)) !== null,
    updateFoldCollapse: (stepId, expected, op, expect, loadId) =>
      !outlived(loadId) && commitShown('Update Collapse from CP', (document) =>
        foldEdits.updateFoldCollapse(document, stepId, expected, op, expect)) !== null,

    deleteFoldStep: (stepId) =>
      commitShown('Delete step', (document) => foldEdits.deleteFoldStep(document, stepId)) !== null,

    setFoldStepSpread: (stepId, spread, { session, loadId } = {}) => {
      if (outlived(loadId)) return false;
      // A drag of one of its sliders is one sitting: one undo step, however many values it passed.
      const { extend, remember } = documentHistory.session(`spread:${stepId}`, session);
      const next = commitShown('Change spread', (document) => foldEdits.setFoldStepSpread(document, stepId, spread), extend);
      if (!next) return false;
      remember();
      return true;
    },

    setFoldMarks: (stepId, marks) =>
      commitShown('Change marks', (document) => foldEdits.setFoldMarks(document, stepId, marks)) !== null,

    setFoldPaperShape: (shape) =>
      commitShown('Change paper', (document) => foldEdits.setFoldPaperShape(document, shape)) !== null,

    setFoldPaperStyle: (style) =>
      commitShown('Change paper style', (document) => foldEdits.setFoldPaperStyle(document, style)) !== null,

    setFoldSequenceTitle: (title) =>
      commitShown('Rename sequence', (document) => foldEdits.setFoldSequenceTitle(document, title)) !== null,

    setFoldStartSide: (startSide) =>
      commitShown('Change start side', (document) => foldEdits.setFoldStartSide(document, startSide)) !== null,

    moveFoldCursor: (stepId) => {
      const shown = shownFoldSequence(get());
      const reader = get().foldReader;
      if (!shown || !reader) return false;
      const next = withFoldCursor(reader, shown.document, stepId);
      if (next === reader) return false;
      set({ foldReader: next });
      return true;
    },

    undoFold: () => documentHistory.travel('undo'),
    redoFold: () => documentHistory.travel('redo'),
  };
};
