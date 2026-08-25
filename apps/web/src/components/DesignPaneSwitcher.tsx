import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Check, Columns2, X } from 'lucide-react';
import { isShortcutEditingTarget } from '../keyboard/shortcutDispatcher';
import { useDesignPaneSwitcher, type DesignPaneOption } from '../hooks/useDesignPaneSwitcher';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

/**
 * Moving between a design's panes, on a phone.
 *
 * Two shapes, because the kinds are two shapes. Box-pleat and ExplOri declare
 * exactly two panes, and for two the pill *is* the switch: it is labelled with
 * the one you are not looking at, so getting there is one tap and the label says
 * where it goes. TreeMaker declares four (its canvas plus the Inspector /
 * Diagnostics / Conditions column), which no toggle can express, so that one
 * opens a list.
 *
 * A pill in `CanvasPillLane` rather than a row of its own. A segmented control
 * under the design tab strip was the obvious answer and costs ~44pt of a screen
 * that is already spending a quarter of its height on chrome; the lane costs
 * nothing and is where the touch layout already puts controls with nowhere to
 * dock.
 *
 * A kind can decline it — `phonePaneSwitcher: false` — when its panes are a
 * flow rather than a split and it carries its own navigation. ExplOri does:
 * Search takes you to the results and Back brings you home, both inside the
 * panes, and a floating pill would be a third control for the same move.
 */
export function DesignPaneSwitcher() {
  const { panes, active, floating, show } = useDesignPaneSwitcher();
  if (!floating || !panes || !active || panes.length < 2) return null;
  if (panes.length === 2) return <PaneToggle panes={panes} active={active} show={show} />;
  return <PaneList panes={panes} active={active} show={show} />;
}

type Show = ReturnType<typeof useDesignPaneSwitcher>['show'];

function PaneToggle({
  panes,
  active,
  show,
}: {
  panes: DesignPaneOption[];
  active: DesignPaneOption;
  show: Show;
}) {
  const other = panes.find((pane) => pane.component !== active.component) ?? panes[0];
  return (
    <Button
      size="md"
      variant="secondary"
      className="canvas-pill design-pane-switcher"
      onClick={() => show(other.component, 'switcher')}
    >
      <ArrowLeftRight size={15} aria-hidden="true" />
      {other.title}
    </Button>
  );
}

function PaneList({
  panes,
  active,
  show,
}: {
  panes: DesignPaneOption[];
  active: DesignPaneOption;
  show: Show;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Focus the sheet itself rather than the first row, so a screen reader
  // announces what opened before reading the list — the same reason, and the
  // same shape, as `CpToolPickerSheet` and the View drawer.
  useEffect(() => {
    if (open) sheetRef.current?.focus();
  }, [open]);

  // Escape, capture-phase on `window`, so it fires wherever focus is inside the
  // sheet. `isShortcutEditingTarget` is the repo's one answer to "does this
  // target own its keystrokes"; there is no copy of it here for that reason.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isShortcutEditingTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, close]);

  const title = t('panels:design.paneSwitcher.title', 'Panes');

  return (
    <>
      <Button
        ref={triggerRef}
        size="md"
        variant="secondary"
        className="canvas-pill design-pane-switcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(true)}
      >
        <Columns2 size={15} aria-hidden="true" />
        {active.title}
      </Button>
      {/*
        Portaled for the reason every sheet in this lane is: the lane is
        `pointer-events: none` so the dock keeps taps that miss a pill, and it is
        a stacking context at `--z-canvas-overlay` — a sheet rendered inside it
        would be transparent to touch and capped below the modal layer.
      */}
      {open &&
        createPortal(
          <div
            id={listId}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="design-pane-sheet"
            /* `click`, not `pointerdown`: dismissing on pointerdown unmounts the
               backdrop inside the same commit and the browser delivers the rest
               of the tap to whatever is newly underneath. Measured on an iPad —
               see the note in `WorkspaceViewDrawer`. */
            onClick={close}
          >
            <div
              ref={sheetRef}
              role="document"
              tabIndex={-1}
              className="design-pane-sheet__sheet"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="design-pane-sheet__header">
                <span className="design-pane-sheet__title">{title}</span>
                <IconButton
                  size="sm"
                  aria-label={t('panels:design.paneSwitcher.close', 'Close pane list')}
                  onClick={close}
                >
                  <X size={15} />
                </IconButton>
              </header>
              <ul className="design-pane-sheet__list">
                {panes.map((pane) => (
                  <li key={pane.component}>
                    <button
                      type="button"
                      className="design-pane-sheet__item"
                      data-active={pane.component === active.component || undefined}
                      aria-current={pane.component === active.component ? 'true' : undefined}
                      onClick={() => {
                        show(pane.component, 'switcher');
                        close();
                      }}
                    >
                      <span>{pane.title}</span>
                      {pane.component === active.component && <Check size={15} aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
