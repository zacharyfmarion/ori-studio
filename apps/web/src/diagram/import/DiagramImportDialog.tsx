import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '../../components/ui/Button';
import { Check, FilePlus2, Files, FolderOpen, Import, LoaderCircle } from 'lucide-react';
import { PreviewDialog } from '../../components/ui/PreviewDialog';
import { NumberField } from '../../components/ui/NumberField';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { FieldRow, NumberRow, ToggleRow } from '../../components/ui/fieldRows';
import { Notice } from '../../components/ui/Notice';
import {
  FolderTooLargeError,
  getFileService,
  pickImportFolder,
  type PickedFile,
} from '../../platform/fileService';
import { naturalFileOrder } from '../../lib/naturalFileOrder';
import { ensureDiagramImportTarget, importTarget } from '../../store/workspaceStore/diagramBatchImport';
import { useImportDialogStore } from './importDialogStore';
import {
  runImportJob,
  STEP_IMPORT_EXTENSIONS,
  supportsStepImport,
  type ImportProgress,
} from './importJob';
import styles from './DiagramImportDialog.module.css';
import { ImportFileList } from './ImportFileList';

/** What went wrong, without the "Error:" a bare String(e) puts in front. */
function problem(e: unknown, t: TFunction): string {
  if (e instanceof FolderTooLargeError)
    return t('panels:diagram.import.folderTooLarge', 'The folder has more than 10,000 entries. Choose a smaller folder.');
  return e instanceof Error ? e.message : String(e);
}

export function DiagramImportDialogHost() {
  const target = useImportDialogStore((s) => s.target);
  return target ? <DiagramImportDialog /> : null;
}
function DiagramImportDialog() {
  const { t } = useTranslation();
  const { target, files: initial, opener, close, folder } = useImportDialogStore();
  const [files, setFiles] = useState(initial),
    [columns, setColumns] = useState(0),
    [gap, setGap] = useState(100),
    [timeout, setTimeoutSeconds] = useState(5),
    [recursive, setRecursive] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null),
    [error, setError] = useState<string | null>(null),
    [running, setRunning] = useState(false),
    [finishing, setFinishing] = useState(false);
  const job = useRef<AbortController | null>(null),
    folds = useRef<AbortController | null>(null);
  const cancel = () => {
    if (progress?.phase === 'placing') return;
    if (running) {
      job.current?.abort();
      folds.current?.abort();
    } else close();
  };
  useEffect(
    () => () => {
      job.current?.abort();
      folds.current?.abort();
    },
    []
  );
  const picked = (next: PickedFile[] | null) => {
    if (!next) return;
    const selected = naturalFileOrder(next.filter((f) => supportsStepImport(f.name)));
    setFiles(selected);
    setColumns(0);
    setError(
      selected.length ? null : t('panels:diagram.import.noFiles', 'No crease patterns, Defox projects or pictures were found.')
    );
  };
  useEffect(() => {
    if (!folder) return;
    let live = true;
    setFiles([]);
    void folder(recursive)
      .then((next) => {
        if (live) {
          setFiles(naturalFileOrder(next.filter((f) => supportsStepImport(f.name))));
          setColumns(0);
        }
      })
      .catch((e) => {
        if (live) setError(problem(e, t));
      });
    return () => {
      live = false;
    };
  }, [folder, recursive, t]);
  const pick = async (folder: boolean) => {
    try {
      if (folder) {
        // Listed by the effect above, again whenever Include subfolders changes.
        const reader = await pickImportFolder(t('panels:diagram.import.folderTitle', 'Choose a folder to import'));
        if (reader) useImportDialogStore.setState({ folder: reader });
        return;
      }
      const next = await getFileService().openBinaryFiles({
        title: t('panels:diagram.import.title', 'Import steps'),
        extensions: STEP_IMPORT_EXTENSIONS,
        multiple: true,
      });
      if (next) useImportDialogStore.setState({ folder: null });
      picked(next);
    } catch (e) {
      setError(problem(e, t));
    }
  };
  const start = async () => {
    if (!target || running || !files.length) return;
    job.current = new AbortController();
    folds.current = new AbortController();
    setRunning(true);
    setError(null);
    setProgress(null);
    setFinishing(false);
    try {
      // The destination as it is now, not as the dialog opened on: anything
      // since would reject the commit, and every retry with it.
      const now = importTarget();
      if (now.loadId !== target.loadId)
        throw new Error(
          t('panels:diagram.import.destinationChanged', 'The diagram changed while importing. Start the import again.')
        );
      const current = { ...now, anchor: target.anchor };
      const destination = files.some((file) => /\.(cp|defox)$/i.test(file.name))
        ? await ensureDiagramImportTarget(current)
        : current;
      if (job.current.signal.aborted) {
        setError(t('panels:diagram.import.cancelled', 'Import cancelled. No files were added.'));
        return;
      }
      useImportDialogStore.setState({ target: destination });
      await runImportJob(
        files,
        destination,
        { columns, gap, foldTimeoutMs: timeout * 1000 },
        job.current.signal,
        folds.current.signal,
        setProgress
      );
    } catch (e) {
      // A failed publication must release the placing phase's dismissal lock.
      setProgress(null);
      if (job.current.signal.aborted) {
        setError(t('panels:diagram.import.cancelled', 'Import cancelled. No files were added.'));
      } else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };
  const done = progress?.phase === 'done';
  const cells = files.filter((file) => /\.cp$/i.test(file.name)).length;
  const hasCp = files.some((file) => /\.(cp|defox)$/i.test(file.name));
  const previewColumns = columns || Math.max(1, Math.ceil(Math.sqrt(cells)));
  const title = t('panels:diagram.import.title', 'Import steps');
  const phase =
    progress?.phase === 'placing'
      ? t('panels:diagram.import.placing', 'Adding to workspaces…')
      : progress?.phase === 'reading'
        ? t('panels:diagram.import.reading', 'Reading files…')
        : t('panels:diagram.import.preparing', 'Preparing steps…');
  const dismiss = () => {
    if (progress?.phase === 'placing') return;
    job.current?.abort();
    folds.current?.abort();
    close();
  };
  return createPortal(
    <PreviewDialog
      title={title}
      icon={<Import size={15} aria-hidden="true" />}
      onClose={dismiss}
      onSubmit={() => {
        if (done) close();
        else void start();
      }}
      // A stray click or Escape must not throw away a long run: Cancel stops it.
      busy={running}
      returnFocus={opener}
      preview={
        <div className={styles.fileColumn}>
          <div className={styles.fileActions}>
            <Button size="sm" disabled={running || done} onClick={() => void pick(false)}>
              <FilePlus2 size={14} aria-hidden="true" />
              {t('panels:diagram.import.files', 'Choose files…')}
            </Button>
            <Button size="sm" disabled={running || done} onClick={() => void pick(true)}>
              <FolderOpen size={14} aria-hidden="true" />
              {t('panels:diagram.import.folder', 'Choose folder…')}
            </Button>
          </div>
          <div className={styles.fileWell}>
            {files.length === 0 ? (
              <div className={styles.empty}>
                <Files size={28} strokeWidth={1.5} aria-hidden="true" />
                <p>{t('panels:diagram.import.empty', 'Choose files or a folder to begin.')}</p>
                <span>{t('panels:diagram.import.formats', 'CP · Defox · SVG · PNG · JPEG · WebP')}</span>
              </div>
            ) : (
              <ImportFileList
                files={files}
                currentName={running ? progress?.name : undefined}
              />
            )}
          </div>
        </div>
      }
      options={
        <>
          <p className="simple-modal__message">
            {t(
              'panels:diagram.import.description',
              'CPs become folded steps and are appended together to Edit. Pictures become steps of their own. Defox keeps its saved views.'
            )}
          </p>
          {!running && !done && (
            <>
              <ToggleRow
                label={t('panels:diagram.import.recursive', 'Include subfolders')}
                checked={recursive}
                onChange={setRecursive}
                divider={false}
              />
              {hasCp && (
                <CollapsibleSection title={t('panels:diagram.import.layoutHeading', 'Edit layout')}>
                  <FieldRow
                    label={t('panels:diagram.import.columns', 'Columns')}
                    htmlFor="diagram-import-columns"
                    kind="input"
                  >
                    <NumberField
                      id="diagram-import-columns"
                      label={t('panels:diagram.import.columns', 'Columns')}
                      value={columns || (cells ? previewColumns : null)}
                      min={1}
                      max={1000}
                      normalize={Math.round}
                      onCommit={setColumns}
                    />
                  </FieldRow>
                  <NumberRow
                    label={t('panels:diagram.import.gap', 'Gap')}
                    value={gap}
                    min={1}
                    max={10000}
                    onCommit={setGap}
                    divider={false}
                  />
                  {cells > 0 && (
                    <svg
                      className={styles.preview}
                      viewBox={`0 0 ${Math.min(previewColumns, cells) * 5} ${Math.ceil(cells / previewColumns) * 5}`}
                      role="img"
                      aria-label={t('panels:diagram.import.layout', 'Edit layout preview')}
                    >
                      {Array.from({ length: cells }, (_, index) => (
                        <rect
                          key={index}
                          x={(index % previewColumns) * 5}
                          y={Math.floor(index / previewColumns) * 5}
                          width={4}
                          height={4}
                        />
                      ))}
                    </svg>
                  )}
                </CollapsibleSection>
              )}
              {cells > 0 && (
                <CollapsibleSection title={t('panels:diagram.import.foldingHeading', 'Folding')}>
                  <NumberRow
                    label={t('panels:diagram.import.budget', 'Max seconds per fold')}
                    value={timeout}
                    min={1}
                    max={120}
                    onCommit={setTimeoutSeconds}
                    divider={false}
                  />
                </CollapsibleSection>
              )}
            </>
          )}
          {progress && (
            <div className={styles.progress}>
              <p className={styles.progressHeading} role="status">
                {done ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <LoaderCircle size={16} className={styles.spinner} aria-hidden="true" />
                )}
                {done
                  ? t('panels:diagram.import.added', 'Steps added: {{total}}', { total: progress.added })
                  : phase}
              </p>
              {!done && (
                <>
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-label={phase}
                    aria-valuemin={0}
                    aria-valuemax={Math.max(1, progress.total)}
                    aria-valuenow={progress.done}
                  >
                    <div
                      className={styles.progressFill}
                      style={{
                        width: `${Math.min(100, (progress.done / Math.max(1, progress.total)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className={styles.progressFile}>
                    {progress.done} / {progress.total} · {progress.name}
                  </p>
                </>
              )}
            </div>
          )}
          {error && (
            <div role="alert">
              <Notice tone="warning">{error}</Notice>
            </div>
          )}
          {progress && (progress.failures.length > 0 || progress.notices.length > 0) && (
            <ul className={styles.results}>
              {[...progress.failures, ...progress.notices].map((notice, index) => (
                <li key={index}>
                  <strong>{notice.name}</strong>
                  <span>{notice.message}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      }
      footer={
        <>
          <span className={styles.selectionCount}>
            {files.length > 0 &&
              t('panels:diagram.import.selected', 'Selected files: {{total}}', { total: files.length })}
          </span>
          <Button
            size="sm"
            variant={done ? 'primary' : 'ghost'}
            disabled={progress?.phase === 'placing'}
            onClick={cancel}
          >
            {running ? t('common:cancel', 'Cancel') : t('common:close', 'Close')}
          </Button>
          {running && cells > 0 && (
            <Button
              size="sm"
              disabled={finishing || progress?.phase === 'placing'}
              onClick={() => {
                folds.current?.abort();
                setFinishing(true);
              }}
            >
              {t('panels:diagram.import.finish', 'Finish import now')}
            </Button>
          )}
          {!running && !done && (
            <Button size="sm" variant="primary" type="submit" disabled={!files.length}>
              {t('panels:diagram.import.start', 'Import')}
            </Button>
          )}
        </>
      }
    />,
    document.body
  );
}
