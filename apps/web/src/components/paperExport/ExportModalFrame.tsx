/**
 * An export dialog's chrome: backdrop, document, header, the preview beside the
 * options, and the footer — the crease-pattern export dialog's markup and
 * classes (`.simple-modal__document--export`, `.export-modal`), so the two
 * read as one dialog. The crease-pattern dialog keeps its own copy for now; it
 * can move onto this frame when it moves off the command-dialog host.
 *
 * The keys are the dialog's while it is open:
 *
 * - It is a shortcut barrier (`isShortcutBarrierTarget`), so no key aimed
 *   inside it reaches the workspace behind — Space on its focused Export
 *   button would otherwise play References' fold, and the arrows step it.
 *   The document takes focus on open and on a click anywhere inside it, and
 *   takes it back when a field lets go of it (NumberField blurs itself on
 *   Enter and Escape, ColorField on Escape), so focus is never on `<body>` —
 *   outside the barrier — with the dialog up.
 * - Escape is the house pattern (`useCpToolsTrigger`, the View drawer): capture
 *   on `window`, ahead of the workspace's own Escape, standing down while a
 *   field or an open layer holds the key — Escape in a number field reverts
 *   it, in an open Select closes the Select — and while another dialog is
 *   open over this one, whose Escape it is.
 * - Enter in a field commits it and keeps focus in the dialog; Enter with the
 *   dialog itself focused exports.
 *
 * While `busy` (a save in flight) nothing closes it: the save would otherwise
 * carry on after the reader said no.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, X } from 'lucide-react';
import { isOpenLayerTarget, isShortcutEditingTarget } from '../../keyboard/shortcutDispatcher';
import { IconButton } from '../ui/IconButton';

/** The inputs Enter commits: the ones typed into, not a switch or a colour swatch. */
const TEXT_ENTRY = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password']);

/** Is `root` the dialog on top — the last modal dialog in the document, as they stack? */
function isTopmostDialog(root: Element | null): boolean {
  const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
  return root !== null && dialogs[dialogs.length - 1] === root;
}

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
  const rootRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(() => {});
  useEffect(() => {
    closeRef.current = () => {
      if (!busy) onClose();
    };
  });

  // Into the dialog at once, so no key meant for it reaches the view behind
  // while its first preview builds; the caller moves it on from here.
  useEffect(() => {
    documentRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isShortcutEditingTarget(event.target) || isOpenLayerTarget(event.target)) return;
      if (!isTopmostDialog(rootRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  useEffect(
    () => () => {
      if (returnFocus?.isConnected) returnFocus.focus();
    },
    [returnFocus]
  );

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
        onBlur={(event) => {
          // Focus moving within the dialog, or into a portalled layer of it
          // (an open Select), names where it went; a field blurring itself
          // names nowhere, and the browser parks focus on <body>.
          if (event.relatedTarget !== null) return;
          queueMicrotask(() => {
            const active = document.activeElement;
            if (active === null || active === document.body) {
              documentRef.current?.focus({ preventScroll: true });
            }
          });
        }}
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
