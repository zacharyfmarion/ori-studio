/**
 * Shared preview/options dialog chrome, used by paper export and step import.
 * Keeps the established modal styles and responsive layout in one place.
 * The legacy global class names stay intact until the shared modal CSS migration.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { useModalDialog } from './useModalDialog';

/** The inputs Enter commits: the ones typed into, not a switch or a colour swatch. */
const TEXT_ENTRY = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password']);

export function PreviewDialog({
  title,
  icon,
  onClose,
  onSubmit,
  busy,
  returnFocus,
  preview,
  options,
  footer,
}: {
  title: string;
  icon: ReactNode;
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
            {icon}
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
