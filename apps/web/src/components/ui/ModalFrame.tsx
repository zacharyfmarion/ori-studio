import type { DragEventHandler, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
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
 * How the body holds its content:
 * - `stack`: padded, one item under another, scrolling when it runs long;
 * - `fill`: the content takes the whole body and lays itself out, edge to edge.
 */
export type ModalFrameLayout = 'stack' | 'fill';

export interface ModalFrameProps {
  /** Names the dialog and its close button, and heads the bar. */
  title: string;
  /** After the title, quieter: what the dialog is about (a figure's name). */
  detail?: ReactNode;
  /** The bar's controls, at its end before the close button. */
  tools?: ReactNode;
  size?: ModalFrameSize;
  layout?: ModalFrameLayout;
  /** The foot's note: what the dialog does. */
  footer?: ReactNode;
  /** The foot's verbs, at its end. */
  actions?: ReactNode;
  /** Escape, the close button and a press on the backdrop. */
  onClose: () => void;
  /** Focus goes back here when the dialog closes, if it is still in the document. */
  returnFocus: HTMLElement | null;
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
 * backdrop call `onClose`.
 */
export function ModalFrame({
  title,
  detail,
  tools,
  size = 'form',
  layout = 'stack',
  footer,
  actions,
  onClose,
  returnFocus,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: ModalFrameProps) {
  const { t } = useTranslation();
  const { rootRef, documentRef, keepFocus } = useModalDialog(onClose, returnFocus);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-shortcut-barrier=""
      className={styles.backdrop}
      onMouseDown={onClose}
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
        <div className={styles.bar}>
          <span className={styles.title}>{title}</span>
          {detail !== undefined && <span className={styles.detail}>{detail}</span>}
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
