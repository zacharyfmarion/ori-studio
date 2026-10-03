import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DiagramDocument } from '../../diagram/document/diagramDocument';
import { PRINT_SHOP_BLEED_MM } from '../../diagram/export/diagramPdf';
import {
  useDiagramExport,
  type DiagramExportBinding,
  type DiagramExportDependencies,
} from '../../diagram/export/useDiagramExport';
import { DIAGRAM_PAGE_PANE_ID, revealDiagramPane } from '../../diagram/useDiagramPaneReveal';
import { useDiagramExportUiStore, type DiagramExportRequest } from '../../store/diagramExportUiStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ExportModalFrame } from '../paperExport/ExportModalFrame';
import { formatPageMm } from '../paperExport/PaperExportPreview';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { DiagramExportOptions } from './DiagramExportOptions';
import styles from './DiagramExportModal.module.css';

/**
 * The Diagram's export dialog (D11), mounted once at the app root and opened
 * by `file.exportDiagram`: a PDF of the pages, or a file for each step, with
 * the page or file it will write beside the options. Each opening mounts a
 * fresh dialog on the diagram as it is then. The state and the save are
 * `useDiagramExport`'s; this is the layout.
 */
export function DiagramExportModal() {
  const request = useDiagramExportUiStore((state) => state.request);
  const diagram = useWorkspaceStore((state) => state.diagram);
  if (!request || !diagram) return null;
  return <DiagramExportDialog key={request.id} request={request} diagram={diagram} />;
}

/** The dialog for one opening; exported for tests, which hand it their own fonts and save. */
export function DiagramExportDialog({
  request,
  diagram,
  dependencies,
}: {
  request: DiagramExportRequest;
  diagram: DiagramDocument;
  dependencies?: DiagramExportDependencies;
}) {
  const { t } = useTranslation();
  const closeRequest = useDiagramExportUiStore((state) => state.closeRequest);
  const close = useCallback(() => closeRequest(request.id), [closeRequest, request.id]);
  // The diagram as it was when the dialog opened: what the preview shows is what is written.
  const [document] = useState(diagram);
  const binding = useDiagramExport(document, close, dependencies);

  // Enter exports at the remembered options in one keystroke: focus moves to
  // Export the first time there is something to export, unless the reader has
  // already moved it off the dialog's own frame.
  const exportRef = useRef<HTMLButtonElement>(null);
  const focusedExport = useRef(false);
  useEffect(() => {
    if (focusedExport.current || !binding.canExport) return;
    focusedExport.current = true;
    const active = window.document.activeElement;
    if (active instanceof HTMLElement && active.getAttribute('role') === 'document') exportRef.current?.focus();
  }, [binding.canExport]);

  const title = t('dialogs:diagramExport.title', 'Export diagram');
  return (
    <ExportModalFrame
      title={title}
      onClose={close}
      onSubmit={() => void binding.exportNow()}
      busy={binding.busy}
      returnFocus={request.returnFocus}
      preview={<DiagramExportPreview binding={binding} />}
      options={
        <DiagramExportOptions
          binding={binding}
          onEditPageSetup={() => {
            close();
            revealDiagramPane(DIAGRAM_PAGE_PANE_ID);
          }}
        />
      }
      footer={
        <>
          {binding.saveError && (
            <span className={styles.saveError} role="alert">
              {t('dialogs:diagramExport.saveFailed', 'Couldn’t export: {{message}}', { message: binding.saveError })}
            </span>
          )}
          <Button size="sm" variant="ghost" disabled={binding.busy} onClick={close}>
            {binding.phase === 'writing'
              ? t('dialogs:diagramExport.stop', 'Stop')
              : t('dialogs:common.cancel', 'Cancel')}
          </Button>
          <Button ref={exportRef} size="sm" variant="primary" type="submit" disabled={!binding.canExport}>
            {exportLabel(t, binding)}
          </Button>
        </>
      }
    />
  );
}

/** The primary button: what it will write, or how far it has got. */
function exportLabel(t: TFunction, binding: DiagramExportBinding): string {
  if (binding.progress && binding.progress.done < binding.progress.total) {
    return t('dialogs:diagramExport.exportingFiles', 'Exporting {{done}} of {{total}}…', {
      done: Math.min(binding.progress.done + 1, binding.progress.total),
      total: binding.progress.total,
    });
  }
  if (binding.phase === 'writing' && binding.draft.kind === 'pdf') {
    return t('dialogs:diagramExport.writingPdf', 'Writing PDF…');
  }
  if (binding.phase !== null) return t('dialogs:diagramExport.exporting', 'Exporting…');
  if (binding.draft.kind === 'pdf') return t('dialogs:diagramExport.confirmPdf', 'Export PDF');
  return t('dialogs:diagramExport.confirmZip', 'Export {{format}}s as ZIP', { format: binding.draft.format.toUpperCase() });
}

/** The page or the file the export will write, how big it is, and how many there are. */
function DiagramExportPreview({ binding }: { binding: DiagramExportBinding }) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => value.toLocaleString(i18n.language);
  const { preview, pager, draft } = binding;
  const pdf = draft.kind === 'pdf';
  const parts: string[] = [];
  if (preview) {
    parts.push(
      t('dialogs:diagramExport.sizeMm', '{{width}} × {{height}} mm', {
        width: formatPageMm(preview.page.widthPt),
        height: formatPageMm(preview.page.heightPt),
      })
    );
    if (binding.pngSize) {
      parts.push(
        t('dialogs:diagramExport.sizePx', '{{width}} × {{height}} px', {
          width: number(binding.pngSize.width),
          height: number(binding.pngSize.height),
        })
      );
    }
    parts.push(
      pdf
        ? t('dialogs:diagramExport.pageCount', '{{count}} pages', {
            count: binding.count,
            defaultValue_one: '{{count}} page',
          })
        : t('dialogs:diagramExport.fileCount', '{{count}} files · ZIP', {
            count: binding.count,
            defaultValue_one: '{{count}} file · ZIP',
          })
    );
    if (pdf && draft.pdf === 'print-shop') {
      parts.push(t('dialogs:diagramExport.bleedNote', 'with {{bleed}} mm bleed', { bleed: PRINT_SHOP_BLEED_MM }));
    }
  }

  let state: string | null = null;
  if (binding.status === 'loading') state = t('dialogs:diagramExport.preparing', 'Preparing preview…');
  else if (binding.status === 'failed') {
    state = t('dialogs:diagramExport.fontsFailed', 'The diagram’s fonts couldn’t be loaded. Check your connection and try again.');
  } else if (!preview) state = t('dialogs:diagramExport.nothing', 'No step has a picture yet: there is nothing to export.');

  return (
    <div className={styles.column}>
      <div
        className={styles.preview}
        aria-label={t('dialogs:export.preview', 'Export preview')}
        aria-busy={binding.status === 'loading'}
      >
        {preview && (
          <div
            className={styles.sheet}
            data-transparent={(!pdf && draft.transparent) || undefined}
            style={{ '--page-aspect': String(preview.page.widthPt / preview.page.heightPt) } as CSSProperties}
          >
            <img src={preview.url} alt="" />
          </div>
        )}
        {state && (
          <span className={styles.state} data-tone={binding.status === 'failed' ? 'error' : undefined}>
            {state}
          </span>
        )}
      </div>
      {pager && (
        <div className={styles.pager}>
          <IconButton
            size="sm"
            aria-label={pdf ? t('dialogs:diagramExport.previousPage', 'Previous page') : t('dialogs:diagramExport.previousFile', 'Previous step')}
            disabled={pager.index <= 0}
            onClick={() => pager.setIndex(pager.index - 1)}
          >
            <ChevronLeft size={14} />
          </IconButton>
          <span aria-live="polite">
            {t('dialogs:diagramExport.pagerLabel', '{{label}} · {{index}} of {{total}}', {
              label: pager.label,
              index: pager.index + 1,
              total: pager.count,
            })}
          </span>
          <IconButton
            size="sm"
            aria-label={pdf ? t('dialogs:diagramExport.nextPage', 'Next page') : t('dialogs:diagramExport.nextFile', 'Next step')}
            disabled={pager.index >= pager.count - 1}
            onClick={() => pager.setIndex(pager.index + 1)}
          >
            <ChevronRight size={14} />
          </IconButton>
        </div>
      )}
      <p className={styles.caption} data-tone={binding.pngTooLarge ? 'error' : undefined} aria-live="polite">
        {binding.pngTooLarge && binding.pngSize
          ? t(
              'dialogs:diagramExport.pngTooLarge',
              'Too large to export as PNG: {{width}} × {{height}} px. Lower the resolution or the size.',
              { width: number(binding.pngSize.width), height: number(binding.pngSize.height) }
            )
          : parts.join(' · ')}
      </p>
    </div>
  );
}
