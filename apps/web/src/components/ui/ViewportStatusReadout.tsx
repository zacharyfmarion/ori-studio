import type { ReactNode } from 'react';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import styles from './ViewportStatusReadout.module.css';

/**
 * The status strip in a canvas's top-left corner: the zoom, and whatever the
 * surface reports beside it — the pointer's position, the active tool's step
 * prompt, counts. Pure output, so it takes no pointer events.
 *
 * `hideOnPhone`: gone on a phone, where everything it says is on screen
 * elsewhere (the zoom in the viewport toolbar, the tool on the Tools pill, the
 * step in the hint window) and what it costs is a box over the corner of the
 * scarcest canvas there is. A tablet keeps it.
 *
 * Found by `data-viewport-status-readout`: the diagnostic HUD measures it to
 * stay out of its way (`useCpDiagnosticHudLane`).
 */
export function ViewportStatusReadout({
  children,
  hideOnPhone = false,
}: {
  children: ReactNode;
  hideOnPhone?: boolean;
}) {
  const phone = useIsPhoneLayout();
  if (hideOnPhone && phone) return null;
  return (
    <div className={styles.readout} data-viewport-status-readout="">
      {children}
    </div>
  );
}
