import { useCallback, useEffect, useState, type DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { dragCarriesFiles } from '../../../lib/fileDrop';
import { useLayoutStore } from '../../../store/layoutStore';
import { useFoldSessionState } from '../../../fold/session/useFoldSession';
import type { FoldSessionSnapshot } from '../../../fold/session/foldSessionState';
import type { FoldImportFlowState, FoldImportRequest } from '../../../fold/io/foldImportFlow';
import { foldImportFileSource, foldImportFormatOf } from '../../../fold/io/foldImportFiles';
import { foldImportNotice, type FoldImportNoticeModel } from '../../../fold/io/foldImportRefusal';
import { foldStepIsNumbered } from '../../../fold/io/foldStepPages';
import { useFoldImportUiStore, type FoldImportOpening } from '../../../fold/io/foldImportUiStore';
import { useFoldImportFlow } from '../../../fold/io/useFoldImport';
import { useFoldStartingSheetFlow } from '../../../fold/io/useFoldStartingSheet';
import { ModalFrame } from '../../ui/ModalFrame';
import { FoldRefusalNotice } from '../FoldRefusalNotice';
import { FoldImportPicker } from './FoldImportPicker';
import styles from './FoldImportDialog.module.css';

/**
 * Import CP's dialog (plan D16), mounted at the app root while Fold is the
 * workspace on screen and the store says it is open (`foldImportUiStore`):
 * a pattern as a step, or — opened from the Paper tab — only its outline, as
 * the sheet the sequence starts from.
 */
export function FoldImportModal() {
  const opening = useFoldImportUiStore((store) => store.opening);
  const shown = useLayoutStore((store) => store.activeWorkspace === 'fold');
  if (!opening || !shown) return null;
  return opening.mode === 'sheet' ? (
    <FoldStartingSheetDialog key={opening.id} opening={opening} />
  ) : (
    <FoldImportDialog key={opening.id} opening={opening} />
  );
}

/** A file read off a pick or a drop, as the flow imports it. */
async function fileRequest(file: File): Promise<FoldImportRequest> {
  if (foldImportFormatOf(file.name) === null) return { kind: 'file', name: file.name, source: null };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { kind: 'file', name: file.name, source: foldImportFileSource(file.name, bytes) };
  } catch {
    return { kind: 'file', name: file.name, source: null, unreadable: true };
  }
}

/** Where the step goes, said under the choices (the design's footnote). */
function placement(t: TFunction, snapshot: Pick<FoldSessionSnapshot, 'sequence' | 'cursor' | 'activePath'>): string {
  const steps = snapshot.sequence?.steps ?? [];
  if (steps.length === 0) {
    return t(
      'dialogs:foldImport.placement.empty',
      'Starts the sequence on the crease pattern’s sheet, folded along its creases. Use it when a state can’t be reached one fold at a time.'
    );
  }
  const byId = new Map(steps.map((node) => [node.id, node]));
  let number = 0;
  for (const id of snapshot.activePath) {
    const op = byId.get(id)?.op;
    if (op && foldStepIsNumbered(op)) number += 1;
    if (id === snapshot.cursor) break;
  }
  const at = snapshot.cursor === null ? 0 : number;
  const branches = snapshot.cursor !== (snapshot.activePath.at(-1) ?? null);
  const where =
    at === 0
      ? t(
          'dialogs:foldImport.placement.afterSheet',
          'Adds a step after the flat sheet, its folded state computed from the creases.'
        )
      : t(
          'dialogs:foldImport.placement.afterStep',
          'Adds a step after step {{number}}, its folded state computed from the creases.',
          { number: at }
        );
  const branch = branches ? ` ${t('dialogs:foldImport.placement.branch', 'It starts a new branch.')}` : '';
  return `${where}${branch} ${t(
    'dialogs:foldImport.placement.why',
    'Use it when the next state can’t be reached one fold at a time.'
  )}`;
}

function workingLabel(t: TFunction, state: FoldImportFlowState): string {
  if (state.phase !== 'working') return '';
  const { request } = state;
  switch (request.kind) {
    case 'project-cp':
      return t('dialogs:foldImport.working.projectCp', 'Resolving the project crease pattern…');
    case 'file':
      return t('dialogs:foldImport.working.file', 'Importing {{name}}…', { name: request.name });
    case 'sample':
      return t('dialogs:foldImport.working.sample', 'Importing the sample…');
    case 'edit-folded-figure':
      return t('dialogs:foldImport.working.figure', 'Importing Edit’s folded figure…');
  }
}

/**
 * The dialog: what to import — a file, by the picker or a drop anywhere on
 * the dialog, a linked Edit pattern, or Edit's folded figure — and, when the pattern's
 * creases leave several layer orders, which. A shortcut barrier
 * (`ModalFrame`): Escape, the close button and a press on the backdrop
 * close it, and closing lets go of whatever the engine holds for it. It
 * closes itself once the step is committed.
 */
function FoldImportDialog({ opening }: { opening: FoldImportOpening }) {
  const { t } = useTranslation();
  const close = useFoldImportUiStore((store) => store.close);
  const { flow, state } = useFoldImportFlow(opening.request);
  const sequence = useFoldSessionState((snapshot) => snapshot.sequence);
  const cursor = useFoldSessionState((snapshot) => snapshot.cursor);
  const activePath = useFoldSessionState((snapshot) => snapshot.activePath);

  useEffect(() => {
    if (state.phase === 'done') close();
  }, [state.phase, close]);

  const request = state.phase === 'idle' ? opening.request : state.request;
  const projectCp = request?.kind === 'project-cp';
  const updating = projectCp && !!request.stepId;
  const title = updating
    ? t('dialogs:foldImport.updateTitle', 'Update from CP')
    : projectCp ? t('dialogs:foldImport.collapseTitle', 'Collapse from CP')
      : t('dialogs:foldImport.title', 'Import crease pattern');
  const verbs = { searchLonger: () => void flow?.searchLonger() };
  const notice =
    state.phase === 'refused'
      ? foldImportNotice(t, state.refusal, verbs)
      : state.phase === 'failed'
        ? // A failure is no refusal the user can act on: said plainly, reported by the flow's hook.
          foldImportNotice(t, { kind: 'engine', refused: { refusal: { code: 'import_internal' } } }, verbs)
        : null;

  const shownNotice = notice && state.phase === 'refused' && state.searchLimited
    ? { ...notice, actions: notice.actions.filter((action) => action.id !== 'search-longer') }
    : notice;
  if (state.phase === 'choosing') return null;

  return (
    <ImportDialogFrame
      title={title}
      opening={opening}
      onClose={close}
      onRequest={(next) => void flow?.open(next)}
      busy={state.phase === 'working'}
      offerFigure
      status={state.phase === 'working' ? workingLabel(t, state) : null}
      notice={shownNotice}
      footer={
        state.phase !== 'idle' && state.request.kind === 'project-cp' && state.request.stepId
          ? t('dialogs:foldImport.placement.update', 'Updates this Collapse step. Later steps and branches are kept and replayed; affected folds are marked Changed or Broken.')
          : placement(t, { sequence, cursor, activePath })
      }
    />
  );
}

/**
 * Import starting sheet, the dialog in its sheet mode (`foldStartingSheet`):
 * a file or a linked Edit pattern, of which only the outline is taken, as
 * the sheet the sequence starts from — starting it over, which the foot says
 * beforehand. Edit's folded figure is no sheet and is not offered. It closes
 * itself once the sheet is the sequence's.
 */
function FoldStartingSheetDialog({ opening }: { opening: FoldImportOpening }) {
  const { t } = useTranslation();
  const close = useFoldImportUiStore((store) => store.close);
  const { flow, state } = useFoldStartingSheetFlow();
  const steps = useFoldSessionState((snapshot) => snapshot.sequence?.steps.length ?? 0);

  useEffect(() => {
    if (state.phase === 'done') close();
  }, [state.phase, close]);

  const title = t('dialogs:foldImport.sheetTitle', 'Import starting sheet');
  const verbs = { searchLonger: () => undefined };
  const notice =
    state.phase === 'refused'
      ? foldImportNotice(t, state.refusal, verbs)
      : state.phase === 'failed'
        ? foldImportNotice(t, { kind: 'engine', refused: { refusal: { code: 'import_internal' } } }, verbs)
        : null;
  const outline = t(
    'dialogs:foldImport.placement.sheet',
    'Takes the pattern’s outline as the sheet the sequence starts from: any convex shape of 3 to 8 sides. Its creases are not imported; use Import CP to fold from them.'
  );
  const startsOver =
    steps > 0
      ? ` ${t('dialogs:foldImport.placement.sheetStartsOver', {
          count: steps,
          defaultValue_one: 'The sequence starts over: its {{count}} step is cleared. Undo brings it back.',
          defaultValue_other: 'The sequence starts over: its {{count}} steps are cleared. Undo brings them back.',
        })}`
      : '';

  return (
    <ImportDialogFrame
      title={title}
      opening={opening}
      onClose={close}
      onRequest={(next) => void flow?.open(next)}
      busy={state.phase === 'working'}
      offerFigure={false}
      status={state.phase === 'working' ? t('dialogs:foldImport.working.sheet', 'Reading the sheet…') : null}
      notice={notice}
      footer={`${outline}${startsOver}`}
    />
  );
}

/**
 * The dialog's content, both modes', in the app's modal frame (`ModalFrame`):
 * the picker, the status and a refusal's notice, and a foot that says what
 * the import does. A file dropped anywhere on it is imported. Escape, the
 * close button and a press on the backdrop close it.
 */
function ImportDialogFrame({
  title,
  opening,
  onClose,
  onRequest,
  busy,
  offerFigure,
  status,
  notice,
  footer,
}: {
  title: string;
  opening: FoldImportOpening;
  onClose: () => void;
  onRequest: (request: FoldImportRequest) => void;
  busy: boolean;
  /** Offer Edit's folded figure: a step can start from it, a sheet cannot. */
  offerFigure: boolean;
  status: string | null;
  notice: FoldImportNoticeModel | null;
  footer: string;
}) {
  const [dragging, setDragging] = useState(false);

  const importFile = useCallback(
    async (file: File) => {
      onRequest(await fileRequest(file));
    },
    [onRequest]
  );

  // A file dropped anywhere on the dialog is imported: the dialog covers the
  // workspace, whose own target would otherwise never see the drag, and the
  // browser would open the file in place of the app.
  const onDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!dragCarriesFiles({ types: Array.from(event.dataTransfer.types), items: event.dataTransfer.items })) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  const onDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    const into = event.relatedTarget;
    if (!(into instanceof Node) || !event.currentTarget.contains(into)) setDragging(false);
  };
  const onDrop = (event: ReactDragEvent<HTMLElement>) => {
    setDragging(false);
    const [file] = Array.from(event.dataTransfer.files);
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    void importFile(file);
  };

  return (
    <ModalFrame
      title={title}
      onClose={onClose}
      returnFocus={opening.returnFocus}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      footer={<p className={styles.placement}>{footer}</p>}
    >
      <FoldImportPicker dragging={dragging} busy={busy} offerFigure={offerFigure} onRequest={onRequest} />
      <div className={styles.status} role="status">
        {status}
      </div>
      {notice && <FoldRefusalNotice notice={notice} />}
    </ModalFrame>
  );
}
