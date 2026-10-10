import { useState, type ReactNode } from 'react';
import {
  autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift,
  useClick, useDismiss, useFloating, useInteractions, useRole,
} from '@floating-ui/react';
import { Info } from 'lucide-react';
import { FloatingPanel, FloatingPanelBody } from './FloatingPanel';
import { IconButton } from './IconButton';
import styles from './InfoPopover.module.css';

/** Clickable help for content containing links. Tooltips intentionally cannot host interaction. */
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { refs: { setReference, setFloating }, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top-end',
    strategy: 'fixed',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);
  return (
    <>
      <IconButton ref={setReference} size="sm" aria-label={label} {...getReferenceProps()}>
        <Info size={13} aria-hidden="true" />
      </IconButton>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <FloatingPanel
              ref={setFloating}
              className={styles.popover}
              style={floatingStyles}
              aria-label={label}
              data-shortcut-barrier=""
              {...getFloatingProps()}
            >
              <FloatingPanelBody>{children}</FloatingPanelBody>
            </FloatingPanel>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
