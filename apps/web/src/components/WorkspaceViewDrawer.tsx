import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
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
 * `reconcileViewPanel`), and this is how you reach it: a pill floating over the
 * top-right of the canvas, opening a sheet from the right.
 *
 * Mounted by `WorkspaceShell` inside `.workspace-shell__canvas`, which is column
 * 2 row 2 of the shell grid — so "over the content, never over the menu bar" is
 * a fact about where it sits rather than a z-index that has to keep winning.
 * Mounting it inside a dock panel instead would mean one copy per workspace and
 * would put shell chrome in a composition site.
 */
export function WorkspaceViewDrawer({
  leading,
}: {
  /**
   * A pill to sit to the *left* of View, in the same row.
   *
   * A slot rather than a second absolutely-positioned box: "left of View" needs
   * View's rendered width, which changes with the locale, and two boxes insetting
   * from the same corner would have to agree about a number neither of them
   * knows. One row, two flex children, and the row owns the inset.
   */
  leading?: ReactNode;
}) {
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
      {/*
        Its own grid item in the canvas, sharing row 2 with the dock rather than
        insetting from the canvas itself — that box also spans the design tab
        strip and the attribution footer, so the trigger would be positioned
        against whatever chrome sits above the dock. See `.view-drawer-anchor`.
      */}
      <div className="view-drawer-anchor" data-view-panel={spec.id}>
        <div className="view-drawer-anchor__row">
          {leading}
          <Button
            ref={triggerRef}
            size="md"
            variant="secondary"
            className="view-drawer-anchor__trigger"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={drawerId}
            onClick={openDrawer}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            {t('common:viewDrawer.open', 'View')}
          </Button>
        </div>
      </div>
      {open && (
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
        </div>
      )}
    </>
  );
}
