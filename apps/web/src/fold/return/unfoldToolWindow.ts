/**
 * Unfold to step's window, as the plain descriptor the one Fold window
 * renderer draws (`components/fold/FoldToolWindow`).
 *
 * Unfold to step locates nothing: from the moment it is in hand the canvas
 * shows the paper back in the pose of the step it returns to, every crease
 * kept (`useFoldUnfoldTool`), so its window opens previewing —
 *
 * - **Return to**: the earlier steps of this path that have landed, the
 *   flat sheet among them, latest first; the step before the one on screen
 *   to start with;
 * - a refusal in the window's words when the pose cannot be restored, and a
 *   note when the paper is in that pose already;
 * - and Cancel, which puts the tool down, and its commit, which adds the
 *   step — or, rebuilding a saved unfold, replaces it.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import type { FoldPathEntry } from '../sequence/foldSequencePath';
import { foldToolLabel } from '../tools/foldToolCatalog';
import {
  settingsMeta,
  type FoldToolHost,
  type FoldToolWindowModel,
  type FoldToolWindowVerbs,
  type FoldToolWindowView,
} from '../tools/foldToolWindow';
import { foldReturnEntryLabel, foldReturnFailure } from './foldReturnWords';

/** What Unfold to step's window is drawn from, beside every tool's view. */
export interface FoldUnfoldWindowView {
  /** The path, which the targets are numbered along. */
  entries: readonly FoldPathEntry[];
  /** The entries it may return to, latest first (`unfoldTargets`); none at the flat sheet. */
  targets: readonly FoldPathEntry[];
  /** The one it returns to; null while there is none. */
  target: FoldPathEntry | null;
  /** The landed pose is the one on screen already: there is nothing to add. */
  noop: boolean;
  /** Why the step could not be added when it was committed: the session's or the store's code. */
  failure: string | null;
  /** A saved unfold is being rebuilt in place. */
  rebuilding: boolean;
  /** The commit is under way. */
  busy: boolean;
}

/** Unfold to step's own calls, beside every tool's. */
export interface FoldUnfoldWindowVerbs {
  /** Return to this entry of the path, by its id; null for the flat sheet. */
  setTarget: (id: string | null) => void;
}

/** The flat sheet's option: a select's value is never empty, and no step is named so. */
const SHEET_OPTION = '__sheet__';

const optionOf = (entry: FoldPathEntry) => entry.id ?? SHEET_OPTION;

/** What the window says of the preview, in a note. */
function previewNote(t: TFunction, unfold: FoldUnfoldWindowView, landing: boolean, refused: boolean): string | null {
  if (unfold.target === null) return t('panels:fold.return.empty', 'Fold a step first.');
  if (refused) return null;
  if (landing) return t('panels:fold.return.loading', 'Preparing unfold preview…');
  if (unfold.noop) return t('panels:fold.return.noop', 'The paper is already in this pose with these creases.');
  return t('tools:fold.note.unfoldPreview', 'The canvas shows the paper back in that pose. Every crease is kept.');
}

/** Unfold to step's window: its target, previewing from the start, and Cancel and its commit. */
export function unfoldToolWindow(
  t: TFunction,
  view: FoldToolWindowView,
  unfold: FoldUnfoldWindowView,
  verbs: FoldToolWindowVerbs,
  host: FoldToolHost
): FoldToolWindowModel {
  const readOnly = view.readOnly !== null;
  const title = foldToolLabel(t, 'unfold-to');
  const action = unfold.rebuilding ? t('panels:fold.return.rebuild', 'Rebuild unfold') : title;
  const preview = view.preview;
  const landing = preview?.landing ?? true;
  const code = unfold.failure ?? preview?.refused?.refusal.code ?? null;
  const note = previewNote(t, unfold, landing, code !== null);
  const setTarget = verbs.unfold?.setTarget ?? (() => {});
  return {
    phase: 'preview',
    title,
    meta: settingsMeta(t, unfold.target ? 1 : 0),
    instructions: {
      heading: t('tools:fold.window.instructions', 'Instructions'),
      items: [
        t('tools:fold.steps.unfoldTarget', 'Choose the step to return to.'),
        host.coarse
          ? t('tools:fold.steps.unfoldCommitTouch', 'Tap {{action}} to add the step.', { action })
          : t('tools:fold.steps.unfoldCommit', 'Press Enter to add the step.'),
      ],
      // The step before the one on screen is chosen from the start: the choice is optional.
      current: 0,
      notes: [
        ...(note ? [note] : []),
        ...(host.coarse ? [] : [t('tools:fold.note.unfoldCancel', 'Esc puts Unfold to step down without adding the step.')]),
      ],
    },
    lineMode: null,
    kind: null,
    movingSide: null,
    layers: null,
    refusal:
      code === null
        ? null
        : {
            code,
            title: t('panels:fold.return.failureTitle', 'Cannot unfold'),
            text: foldReturnFailure(t, code),
            actions: [],
          },
    divide: null,
    steps:
      unfold.targets.length > 0
        ? {
            label: t('panels:fold.return.target', 'Return to'),
            value: unfold.target ? optionOf(unfold.target) : null,
            options: unfold.targets.map((entry) => ({ id: optionOf(entry), label: foldReturnEntryLabel(t, entry, unfold.entries) })),
            disabled: readOnly || unfold.busy,
            set: (id) => {
              const entry = unfold.targets.find((each) => optionOf(each) === id);
              if (entry) setTarget(entry.id);
            },
          }
        : null,
    footer: {
      cancel: {
        label: t('tools:fold.window.cancel', 'Cancel'),
        shortcut: 'viewport.cancel',
        disabled: false,
        run: verbs.cancel,
      },
      commit: {
        label: action,
        shortcut: 'fold.commit',
        disabled: readOnly || unfold.target === null || landing || code !== null || unfold.noop || unfold.busy,
        run: verbs.commit,
      },
    },
  };
}
