/**
 * An export dialog's chrome: backdrop, document, header, the preview beside the
 * options, and the footer — the crease-pattern export dialog's markup and
 * classes (`.simple-modal__document--export`, `.export-modal`), so the two
 * read as one dialog. The crease-pattern dialog keeps its own copy for now; it
 * can move onto this frame when it moves off the command-dialog host.
 *
 * The keys are the dialog's while it is open (`useModalDialog`): it is a
 * shortcut barrier, so no key aimed inside it reaches the workspace behind —
 * Space on its focused Export button would otherwise play References' fold,
 * and the arrows step it — and Escape closes it. Enter in a field commits it
 * and keeps focus in the dialog; Enter with the dialog itself focused exports.
 *
 * While `busy` (a save in flight) nothing closes it: the save would otherwise
 * carry on after the reader said no.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, X } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { useModalDialog } from '../ui/useModalDialog';

/** The inputs Enter commits: the ones typed into, not a switch or a colour swatch. */
const TEXT_ENTRY = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password']);

export function ExportModalFrame({
  title,
  onClose,
  onSubmit,
  busy,
  returnFocus,
  preview,
  options,
  footer,
}: {
  title: string;
  onClose: () => void;
  /** Enter with the dialog focused, or the primary button: the form's submit. */
  onSubmit: () => void;
  /** A save is in flight: the dialog cannot be closed until it settles. */
  busy: boolean;
  /** Focus goes back here when the dialog closes, if it is still in the document. */
  returnFocus: HTMLElement | null;
  preview: ReactNode;
  options: ReactNode;
  footer: ReactNode;
}) {
  const { t } = useTranslation();
  const closeRef = useRef(() => {});
  useEffect(() => {
    closeRef.current = () => {
      if (!busy) onClose();
    };
  });
  // Into the dialog at once, so no key meant for it reaches the view behind
  // while its first preview builds; the caller moves it on from there.
  const { rootRef, documentRef, keepFocus } = useModalDialog(() => closeRef.current(), returnFocus);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-shortcut-barrier=""
      className="simple-modal"
      onMouseDown={() => closeRef.current()}
    >
      <div
        ref={documentRef}
        role="document"
        tabIndex={-1}
        className="simple-modal__document simple-modal__document--export"
        onMouseDown={(event) => event.stopPropagation()}
        onBlur={keepFocus}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.defaultPrevented) return;
          if (event.target === documentRef.current) {
            event.preventDefault();
            onSubmit();
            return;
          }
          // A field takes Enter as "commit" and lets go of focus (NumberField
          // blurs itself); keep it in the dialog, where the next Enter exports.
          // Not the form's implicit submission: that would save the page before
          // the value just typed has reached it.
          if (event.target instanceof HTMLInputElement && TEXT_ENTRY.has(event.target.type)) {
            event.preventDefault();
            documentRef.current?.focus({ preventScroll: true });
          }
        }}
      >
        <header className="simple-modal__header">
          <span>
            <Download size={15} aria-hidden="true" />
            {title}
          </span>
          <IconButton
            size="sm"
            aria-label={t('dialogs:common.closeNamed', 'Close {{name}}', { name: title })}
            disabled={busy}
            onClick={() => closeRef.current()}
          >
            <X size={15} />
          </IconButton>
        </header>
        <form
          className="simple-modal__body export-modal paper-export"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {preview}
          <div className="export-modal__controls">{options}</div>
          <footer className="simple-modal__footer">{footer}</footer>
        </form>
      </div>
    </div>
  );
}
