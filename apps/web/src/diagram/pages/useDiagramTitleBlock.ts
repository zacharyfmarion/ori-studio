import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { trackDiagramPageSetupChanged, type DiagramTitleBlockCreditChange } from '../../analytics';
import i18n from '../../i18n';
import { getFileService } from '../../platform/fileService';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  DEFAULT_PAGE_SETUP,
  defaultTitleBlockContent,
  randomDiagramId,
  TITLE_BLOCK_ART_SIZE_DEFAULTS,
  titleBlockArtSizes,
  titleBlockStepCount,
  type DiagramTitleBlockContentPatch,
  type DiagramTitleBlockCredit,
  type DiagramTitleBlockCreditEdit,
} from '../document/diagramDocument';
import { titleBlockDefaultWords } from '../document/titleBlockWords';
import { hasTitleBlock, titleBlockFits } from './pagePlan';
import { titleBlockChoiceSource, titleBlockChoices, type TitleBlockChoices } from './titleBlockChoices';
import { artSizeLimits, fittedArtSizes } from './titleBlockGeometry';
import { PATTERN_FILE_EXTENSIONS, readPatternFile } from './titleBlockPatternFile';

const NO_CHOICES: TitleBlockChoices = {
  model: { value: 'auto', autoNumber: null, steps: [] },
  pattern: { value: 'auto', autoNumber: null, steps: [] },
};

const NO_CREDITS: readonly DiagramTitleBlockCredit[] = [];

/** A size of the block's art: the model's height, or the crease pattern's side. */
export type TitleBlockArtSize = keyof typeof TITLE_BLOCK_ART_SIZE_DEFAULTS;

/**
 * The store bindings of the title block's rows in the Page pane's Header &
 * footer (AGENTS.md › Panel components; `implementation-plans/diagram-title-block.md`,
 * section 7 and Phase 1c): the toggle, a page setting (`titleBlock`), and what
 * the block shows — its model and crease pattern, from the choices
 * `titleBlockChoices` offers or, for the pattern, a file uploaded for it, and
 * their sizes; its subtitle, credits and note.
 * Each change is one undo step and one count of which setting changed, never
 * its words or its size; a text field's commits, at each pause in typing, are
 * one of each per sitting at it.
 */
export function useDiagramTitleBlock() {
  const { t } = useTranslation();
  const document = useWorkspaceStore((state) => state.diagram);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const loadId = useWorkspaceStore((state) => state.diagramLoadId);
  const page = document?.page ?? DEFAULT_PAGE_SETUP;
  const shown = hasTitleBlock(page);
  // Only while the selects are there to offer them: a file without the block pays nothing.
  const choices = useMemo(() => (document && shown ? titleBlockChoices(document) : NO_CHOICES), [document, shown]);
  const stepCount = useMemo(() => (document ? titleBlockStepCount(document) : 0), [document]);
  // Before a diagram exists, what the first edit will make it with: a field typed or a credit added then lands among them.
  const firstContent = useMemo(() => (document ? undefined : defaultTitleBlockContent(titleBlockDefaultWords(t))), [document, t]);
  const content = document ? document.titleBlockContent : firstContent;
  const credits = content?.credits ?? NO_CREDITS;
  const sizes = fittedArtSizes(titleBlockArtSizes(content));
  /** The sitting at a text field last counted: sessions are numbered across every field, so one is enough. */
  const countedSession = useRef<number | null>(null);

  /** Set a part of the content as a text field types it: counted once per sitting, by what `count` says. */
  const typed = useCallback(
    (patch: DiagramTitleBlockContentPatch, session: number, count: () => void) => {
      if (!useWorkspaceStore.getState().setDiagramTitleBlockContent(patch, { loadId, session })) return;
      if (countedSession.current === session) return;
      countedSession.current = session;
      count();
    },
    [loadId]
  );

  const setModel = useCallback((choice: string) => choose('model', choice), []);
  const setPattern = useCallback((choice: string) => choose('pattern', choice), []);
  /** Pick a crease-pattern file for the block's pattern: call it from the click itself, which the picker needs. */
  const uploadPattern = useCallback(() => void uploadPatternFile(loadId), [loadId]);
  const setSubtitle = useCallback(
    (subtitle: string, session: number) =>
      typed({ subtitle }, session, () =>
        trackDiagramPageSetupChanged('title_block_subtitle', { titleBlockSubtitle: subtitle.trim() ? 'shown' : 'hidden' })
      ),
    [typed]
  );
  const setNote = useCallback(
    (note: string, session: number) =>
      typed({ note }, session, () =>
        trackDiagramPageSetupChanged('title_block_note', { titleBlockNote: note.trim() ? 'shown' : 'hidden' })
      ),
    [typed]
  );
  const setCreditLabel = useCallback(
    (at: number, label: string, session: number) =>
      typed({ credits: { op: 'set', at, label } }, session, () => countCredits('label')),
    [typed]
  );
  const setCreditValue = useCallback(
    (at: number, value: string, session: number) =>
      typed({ credits: { op: 'set', at, value } }, session, () => countCredits('value')),
    [typed]
  );
  /** Add a credit at the end, with nothing in it, for the author to fill in. */
  const addCredit = useCallback(() => editCredits({ op: 'add' }, 'add'), []);
  /** Add the live step count at the end, labelled as a new diagram's is. */
  const addStepCount = useCallback(
    () => editCredits({ op: 'add', credit: { label: titleBlockDefaultWords(t).steps, value: { kind: 'step-count' } } }, 'step_count_on'),
    [t]
  );
  const removeCredit = useCallback((at: number) => editCredits({ op: 'remove', at }, 'remove'), []);
  /** Stop a credit following the step count: its value empty, for the author to type. */
  const typeCreditValue = useCallback((at: number) => editCredits({ op: 'set', at, value: '' }, 'step_count_off'), []);

  return {
    readOnly,
    /** The diagram the text fields type into: a field of its own for each. */
    loadId,
    /** Whether the first page has room for a block: a grid of one row has none (`titleBlockFits`). */
    fits: titleBlockFits(page),
    /** Whether the first page carries the block: on, and room for it. */
    shown,
    model: choices.model,
    pattern: choices.pattern,
    /** The model's and the pattern's sizes as the block draws them, shares of its height: the content's, or the defaults. */
    sizes,
    /** The largest each size may be with the other as it is: past it the model would no longer cover the pattern's corner. */
    sizeLimits: artSizeLimits(sizes),
    subtitle: content?.subtitle ?? '',
    credits,
    /** The number a live step count prints now. */
    stepCount,
    /** Whether a credit already follows the step count: only then is there none to add. */
    hasStepCount: credits.some((credit) => typeof credit.value !== 'string'),
    note: content?.note ?? '',
    setEnabled,
    setModel,
    setPattern,
    uploadPattern,
    setSize,
    setSubtitle,
    setNote,
    addCredit,
    addStepCount,
    removeCredit,
    setCreditLabel,
    setCreditValue,
    typeCreditValue,
  };
}

/** Turn the first page's title block on — at today's height, with a new diagram's words where it has none — or off. */
function setEnabled(enabled: boolean) {
  if (useWorkspaceStore.getState().setDiagramTitleBlockShown(enabled)) trackDiagramPageSetupChanged('title_block');
}

/** Set where a part of the block comes from, from the choice the Page pane offered: its file again changes nothing. */
function choose(part: 'model' | 'pattern', choice: string) {
  const source = titleBlockChoiceSource(choice);
  if (source === null || !useWorkspaceStore.getState().setDiagramTitleBlockContent({ [part]: source })) return;
  trackDiagramPageSetupChanged(part === 'model' ? 'title_block_model' : 'title_block_pattern', {
    titleBlockChoice: source === 'auto' ? 'auto' : source.kind,
  });
}

/**
 * Pick a crease-pattern file and make it the block's crease pattern
 * (`implementation-plans/diagram-title-block-final-cp.md`), for the diagram
 * `loadId` names. Called from the click itself: a browser opens a picker only
 * inside a user gesture, so nothing is awaited before it. One undo step and
 * one count where the file gives a pattern; a notice, and nothing changed,
 * where it gives none.
 */
async function uploadPatternFile(loadId: number): Promise<void> {
  const t = i18n.t;
  const file = await getFileService().openBinaryFile({
    title: t('dialogs:diagram.titleBlockPatternTitle', 'Upload crease pattern'),
    extensions: [...PATTERN_FILE_EXTENSIONS],
    // As Import CP offers them: none of these formats is registered with Apple, and iOS greys out a file it cannot
    // match. The format is read from the name, and one no loader takes is refused.
    mimeTypes: ['application/octet-stream'],
    filterName: 'Ori Studio',
  });
  if (!file) return;
  const read = await readPatternFile(file.bytes, file.name, randomDiagramId('asset'));
  if (!read.ok) {
    toast.error(
      read.reason === 'no-folds'
        ? t('toasts:diagram.titleBlockPattern.noFolds', 'This crease pattern has no mountain or valley folds to show.')
        : t('toasts:diagram.titleBlockPattern.unreadable', 'This file couldn’t be read as a crease pattern.')
    );
    return;
  }
  if (!useWorkspaceStore.getState().setDiagramTitleBlockPatternUpload(read.asset, { loadId })) return;
  if (read.trimmed) {
    toast.message(
      t('toasts:diagram.titleBlockPattern.trimmed', 'This crease pattern has more lines than a diagram keeps, so its shortest creases were left out.')
    );
  }
  trackDiagramPageSetupChanged('title_block_pattern', { titleBlockChoice: 'upload', titleBlockPatternFormat: read.format });
}

/** Set a size of the block's art, as a share of its height, or put it back to the default. */
function setSize(key: TitleBlockArtSize, size: number | 'default') {
  const store = useWorkspaceStore.getState();
  if (!store.setDiagramTitleBlockContent({ [key]: size })) return;
  const held = useWorkspaceStore.getState().diagram?.titleBlockContent?.[key];
  trackDiagramPageSetupChanged(key === 'modelSize' ? 'title_block_model_size' : 'title_block_pattern_size', {
    titleBlockSize: held === undefined ? 'default' : 'custom',
  });
}

/** Change the credits by one edit that is not typing: one undo step and one count. */
function editCredits(edit: DiagramTitleBlockCreditEdit, change: DiagramTitleBlockCreditChange) {
  if (!useWorkspaceStore.getState().setDiagramTitleBlockContent({ credits: edit })) return;
  countCredits(change);
}

/** Count a change to the credits, with how many there are now. */
function countCredits(change: DiagramTitleBlockCreditChange) {
  const credits = useWorkspaceStore.getState().diagram?.titleBlockContent?.credits ?? [];
  trackDiagramPageSetupChanged('title_block_credits', { titleBlockCreditChange: change, titleBlockCredits: credits.length });
}
