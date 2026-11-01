import { useEffect, useSyncExternalStore, type DragEventHandler, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { registerModalHistory, type ModalHistory } from '../../keyboard/dialogShortcuts';
import { IconButton } from './IconButton';
import { useModalDialog } from './useModalDialog';
import styles from './ModalFrame.module.css';

/**
 * How big the dialog is on a screen wider than a phone:
 * - `form`: up to 560px wide, as tall as its content, up to 760px (Import CP);
 * - `workspace`: up to 1320 × 880, a fixed height its content lays out in
 *   (two canvases and an inspector).
 */
export type ModalFrameSize = 'form' | 'workspace';

/**
 * When the frame is the whole screen: below 720px wide, the References
 * browser's rule. `ModalFrame.module.css` asks the same in its media query,
 * which a test holds to this string.
 */
export const MODAL_FULL_SCREEN_QUERY = '(max-width: 720px)';

function fullScreenQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MODAL_FULL_SCREEN_QUERY)
    : null;
}

function subscribeFullScreen(onChange: () => void): () => void {
  const query = fullScreenQuery();
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

/**
 * Whether a modal frame is the whole screen now, following the window: for
 * a dialog that lays out differently there (one pane at a time, D6). False
 * where media queries can't be asked, so a headless render lays out wide.
 */
export function useModalFullScreen(): boolean {
  return useSyncExternalStore(subscribeFullScreen, () => fullScreenQuery()?.matches ?? false, () => false);
}

/**
 * How the body holds its content:
 * - `stack`: padded, one item under another, scrolling when it runs long;
 * - `fill`: the content takes the whole body and lays itself out, edge to edge.
 */
export type ModalFrameLayout = 'stack' | 'fill';

export interface ModalFrameProps {
  /** Names the dialog and its close button, and heads the bar. */
  title: string;
  /**
   * Right after the title, before any detail: a control that belongs with it
   * (a phone's pane switch). On a phone the title, the lead and the close
   * button keep one line: the title truncates first, then the lead shrinks.
   */
  lead?: ReactNode;
  /** After the title, quieter: what the dialog is about (a figure's name). */
  detail?: ReactNode;
  /** The bar's controls, at its end before the close button; on a phone, a row of their own under the title's. */
  tools?: ReactNode;
  size?: ModalFrameSize;
  layout?: ModalFrameLayout;
  /** The foot's note: what the dialog does. */
  footer?: ReactNode;
  /** The foot's verbs, at its end. */
  actions?: ReactNode;
  /** Escape, the close button and, unless {@link closeOnBackdrop} is false, a press on the backdrop. */
  onClose: () => void;
  /**
   * Whether a press on the backdrop closes the dialog (the default). A dialog
   * that holds work a stray press must not throw away (the Layer order
   * dialog's constraints) closes only by its own verbs, Escape and the close
   * button.
   */
  closeOnBackdrop?: boolean;
  /** Focus goes back here when the dialog closes, if it is still in the document. */
  returnFocus: HTMLElement | null;
  /**
   * The dialog's own undo history: Undo and Redo, from the keys and the menu
   * bar, act on it while the dialog is on top (`registerModalHistory`).
   * Without one they are refused while it is open.
   */
  history?: ModalHistory;
  /** A drag over any of the dialog, backdrop included: a dialog that takes a dropped file. */
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  /** The body. */
  children: ReactNode;
}

/**
 * A modal dialog's frame, mounted at the app root: a dimmed backdrop, and on
 * it a surface with a title bar, the body and a foot. Below 720px it is the
 * whole screen.
 *
 * A shortcut barrier with `useModalDialog`'s focus and Escape: no key aimed
 * inside it reaches the workspace behind, focus stays inside it and goes back
 * to `returnFocus` on close, and Escape, the close button and a press on the
 * backdrop (unless `closeOnBackdrop` is false) call `onClose`.
 */
export function ModalFrame({
  title,
  lead,
  detail,
  tools,
  size = 'form',
  layout = 'stack',
  footer,
  actions,
  onClose,
  closeOnBackdrop = true,
  returnFocus,
  history,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: ModalFrameProps) {
  const { t } = useTranslation();
  const { rootRef, documentRef, keepFocus } = useModalDialog(onClose, returnFocus);

  useEffect(() => {
    const root = rootRef.current;
    if (!history || !root) return;
    return registerModalHistory(root, history);
  }, [history, rootRef]);

  const heading = (
    <>
      <span className={styles.title}>{title}</span>
      {lead !== undefined && <div className={styles.lead}>{lead}</div>}
      {detail !== undefined && <span className={styles.detail}>{detail}</span>}
    </>
  );
  // A bar with a lead or tools lays out in rows on a phone: the title's line, then the tools.
  const rows = lead !== undefined || tools !== undefined;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-shortcut-barrier=""
      className={styles.backdrop}
      onMouseDown={closeOnBackdrop ? onClose : undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        ref={documentRef}
        role="document"
        tabIndex={-1}
        className={styles.surface}
        data-size={size}
        onMouseDown={(event) => event.stopPropagation()}
        onBlur={keepFocus}
      >
        <div className={styles.bar} data-rows={rows || undefined}>
          {rows ? <div className={styles.head}>{heading}</div> : heading}
          {tools !== undefined && <div className={styles.tools}>{tools}</div>}
          <IconButton size="sm" aria-label={t('dialogs:common.closeNamed', 'Close {{name}}', { name: title })} onClick={onClose}>
            <X size={15} />
          </IconButton>
        </div>
        <div className={styles.body} data-layout={layout}>
          {children}
        </div>
        {(footer !== undefined || actions !== undefined) && (
          <div className={styles.footer}>
            {footer}
            {actions !== undefined && <div className={styles.actions}>{actions}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
