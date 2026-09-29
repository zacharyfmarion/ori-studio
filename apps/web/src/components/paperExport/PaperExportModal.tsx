/**
 * The export dialog for every paper surface, mounted once at the app root.
 *
 * A surface opens it with a target it has captured (`usePaperExportUiStore`);
 * each opening mounts a fresh dialog, so a draft never leaks from one export
 * into the next. The state and the save are the binding's
 * (`usePaperExportDialog`); this is the layout.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PaperExportMark } from '../../lib/paperExportSettings';
import {
  usePaperExportDialog,
  type PaperExportDialogBinding,
} from '../../paperExport/usePaperExportDialog';
import { usePaperExportUiStore, type PaperExportRequest } from '../../store/paperExportUiStore';
import { Button } from '../ui/Button';
import { ExportModalFrame } from './ExportModalFrame';
import { PaperExportOptions } from './PaperExportOptions';
import { PaperExportPreview } from './PaperExportPreview';
import { paperExportPinsHint } from './PaperStylePicker';

const NO_MARKS: readonly PaperExportMark[] = [];

export function PaperExportModal() {
  const request = usePaperExportUiStore((state) => state.request);
  if (!request) return null;
  return <PaperExportDialog key={request.id} request={request} />;
}

function PaperExportDialog({ request }: { request: PaperExportRequest }) {
  const { t, i18n } = useTranslation();
  const closeRequest = usePaperExportUiStore((state) => state.closeRequest);
  // This dialog only: a save settling after it was replaced leaves the newer one open.
  const close = useCallback(() => closeRequest(request.id), [closeRequest, request.id]);
  const dialog = usePaperExportDialog(request, close);
  const { draft, patch } = dialog;
  const format = draft.format.toUpperCase();

  // Enter exports at the remembered options in one keystroke: focus moves to
  // Export the first time there is something to export — unless the reader has
  // already moved it off the dialog's own frame.
  const exportRef = useRef<HTMLButtonElement>(null);
  const focusedExport = useRef(false);
  useEffect(() => {
    if (focusedExport.current || !dialog.canExport) return;
    focusedExport.current = true;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.getAttribute('role') === 'document') {
      exportRef.current?.focus();
    }
  }, [dialog.canExport]);
  return (
    <ExportModalFrame
      title={dialog.title}
      onClose={close}
      onSubmit={() => void dialog.exportNow()}
      busy={dialog.busy}
      returnFocus={request.returnFocus}
      preview={
        <PaperExportPreview
          status={dialog.status}
          error={dialog.error}
          image={dialog.preview}
          transparent={draft.background === null}
          format={draft.format}
          pngSize={dialog.pngSize}
          pngTooLarge={dialog.pngTooLarge}
          hiddenFacesDropped={dialog.hiddenFacesDropped}
          pager={dialog.pager}
        />
      }
      options={
        <PaperExportOptions
          draft={draft}
          patch={patch}
          buriesFaces={request.target.buriesFaces}
          sheetAsShown={request.target.sheetAsShown}
          marks={request.target.marks ?? NO_MARKS}
          scopes={dialog.scopes}
          fixed={dialog.fixed}
          styleHint={
            [paperExportPinsHint(t, i18n.language, request.target.pins), request.target.hint ?? null]
              .filter(Boolean)
              .join(' ') || null
          }
        />
      }
      footer={
        <>
          {dialog.saveError && (
            <span className="paper-export__save-error" role="alert">
              {t('dialogs:paperExport.saveFailed', 'Couldn’t export: {{message}}', {
                message: dialog.saveError,
              })}
            </span>
          )}
          <Button size="sm" variant="ghost" disabled={dialog.busy} onClick={close}>
            {t('dialogs:common.cancel', 'Cancel')}
          </Button>
          <Button
            ref={exportRef}
            size="sm"
            variant="primary"
            type="submit"
            disabled={!dialog.canExport}
          >
            {exportLabel(t, dialog, format)}
          </Button>
        </>
      }
    />
  );
}

/** The primary button: what it will write, or how far it has got. */
function exportLabel(t: TFunction, dialog: PaperExportDialogBinding, format: string): string {
  if (dialog.progress) {
    return t('dialogs:paperExport.exportingPages', 'Exporting {{done}} of {{total}}…', {
      done: Math.min(dialog.progress.done + 1, dialog.progress.total),
      total: dialog.progress.total,
    });
  }
  if (dialog.saving) return t('dialogs:paperExport.exporting', 'Exporting…');
  if (dialog.pager) return t('dialogs:paperExport.confirmZip', 'Export {{format}}s as ZIP', { format });
  return t('dialogs:export.confirm', 'Export {{format}}', { format });
}
