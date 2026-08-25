import { useEffect, useRef, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, X } from 'lucide-react';
import { useWorkspaceViewDrawer } from '../hooks/useWorkspaceViewDrawer';
import type { ViewPanelId } from '../store/layoutStore';
import { ErrorBoundary } from './errors/ErrorBoundary';
import { CpViewControlsPanel } from './panels/CpViewControlsPanel';
import { SimulatorViewControlsPanel } from './panels/SimulatorViewControlsPanel';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

/**
 * What the sheet shows, per View pane.
 *
 * Keyed on `ViewPanelId` rather than `string` on purpose: a workspace added to
 * the layout store's View-pane table without a body here fails to compile, so
 * the touch path cannot quietly ship an empty sheet the way a half-registered
 * `Record<string, …>` would let it.
 */
const VIEW_DRAWER_BODIES: Record<ViewPanelId, ComponentType> = {
  'cp-view-controls': CpViewControlsPanel,
  'simulator-view-controls': SimulatorViewControlsPanel,
};

/**
 * The View pane, as a touch affordance.
 *
 * On an iPad in portrait the docked pane's 260px column and the tool rail leave
 * the canvas a sliver — measured on a base iPad, the pane's own controls ran off
 * the right edge. So under a coarse pointer the pane is not docked at all (see
 * `reconcileViewPanel`), and this is how you reach it: a pill in the canvas's
 * pill lane, opening a sheet from the right.
 *
 * A pill in `CanvasPillLane` and not its own positioned box — the lane owns
 * where the row sits and what order it is in. The dock reconcile that pairs with
 * this lives in `useViewPanelReconcile`, called by `WorkspaceShell`, because it
 * has to keep running on the pointer where this component does not render.
 */
export function WorkspaceViewDrawer() {
  const { t } = useTranslation();
  const { spec, open, drawerId, openDrawer, close, triggerRef } = useWorkspaceViewDrawer();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Focus the dialog itself rather than the first control in it, so a screen
  // reader announces what just opened before reading its contents.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!spec) return null;

  const title = t('common:viewDrawer.title', 'View options');
  const Body = VIEW_DRAWER_BODIES[spec.id];

  return (
    <>
      <Button
        ref={triggerRef}
        size="md"
        variant="secondary"
        className="view-drawer__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={openDrawer}
      >
        <SlidersHorizontal size={15} aria-hidden="true" />
        {t('common:viewDrawer.open', 'View')}
      </Button>
      {/*
        Portaled, for the reason `CpToolPickerSheet` is: this component now
        renders *inside* the pill lane, and that lane is `pointer-events: none`
        so the dock keeps every tap that is not on a pill. A sheet rendered there
        inherits it — backdrop and controls alike transparent to touch. The lane
        is also a stacking context at `--z-canvas-overlay`, which would cap a
        `--z-modal` sheet at 900 rather than 9999.
      */}
      {open &&
        createPortal(
          <div
            id={drawerId}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="view-drawer"
            /*
              `click`, not `pointerdown`.

              Dismissing on `pointerdown` unmounts this backdrop inside the same
              commit, and the browser then retargets the rest of the gesture to
              whatever is newly under the finger — so the tap that dismissed the
              sheet also pressed the control behind it. Measured on an iPad: a
              backdrop tap over the tool rail closed the drawer *and* switched the
              active tool to Eraser, which leaves the next canvas tap deleting a
              crease the user never aimed at. `preventDefault()` here does not help;
              it suppresses the compatibility *mouse* events, not `click`.

              `click` fires only after the whole press/release has resolved against
              this element, so there is nothing left to retarget. It is also
              reliable under touch, which is the objection that pushed the first
              version onto a pointer event — that objection applies to `mousedown`,
              which the other modals in this repo use and which Safari does suppress.
            */
            onClick={close}
          >
            <div
              ref={dialogRef}
              role="document"
              tabIndex={-1}
              className="view-drawer__sheet"
              /* Clicks inside the sheet are not a dismissal. */
              onClick={(event) => event.stopPropagation()}
            >
              <header className="view-drawer__header">
                <span className="view-drawer__title">{title}</span>
                <IconButton
                  size="sm"
                  aria-label={t('common:viewDrawer.close', 'Close view options')}
                  onClick={close}
                >
                  <X size={15} />
                </IconButton>
              </header>
              <div className="view-drawer__body">
                {/*
                  The pane's own boundary, so a crash in the view controls costs the
                  controls and leaves the sheet's header — and the way out of it —
                  standing. The dock gives every panel one for the same reason (see
                  `withPanelErrorBoundary`).
                */}
                <ErrorBoundary surface={`drawer:${spec.id}`} variant="pane">
                  <Body />
                </ErrorBoundary>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
