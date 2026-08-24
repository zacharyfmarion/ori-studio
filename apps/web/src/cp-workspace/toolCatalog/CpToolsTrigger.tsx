/**
 * The phone layout's tool button, and the sheet behind it.
 *
 * On a phone the tool rail is gone — 152px of a 375px screen, leaving the canvas
 * a sliver — so the tools move into a pill in the top-right of the canvas,
 * beside View, and the picker sheet becomes the whole tool surface rather than
 * an overflow of the rail.
 *
 * The glyph is the **active tool's**, not a generic wrench, because that is the
 * question the button has to answer without being pressed: on a rail you can see
 * which button is lit, and with the rail gone the only place left to say what
 * the next tap on the canvas will do is here.
 *
 * Mounted by `WorkspaceShell` into `WorkspaceViewDrawer`'s `leading` slot rather
 * than positioned on its own. "Left of the View pill" needs the View pill's
 * rendered width, which changes with the locale (View / Ansicht / Вид), so the
 * two share one flex row instead of each insetting from the same corner. The
 * coupling that buys: this renders only where the View pill does. In Edit that
 * is unconditional (`layoutStore` maps edit → cp-view-controls under a coarse
 * pointer), so today it costs nothing.
 */
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { activeCpToolGlyph } from './activeCpTool';
import { CpToolGlyph } from './cpToolGlyph';
import { CpToolPickerSheet } from './CpToolPickerSheet';
import { useCpToolsTrigger } from './useCpToolsTrigger';

export function CpToolsTrigger() {
  const { t } = useTranslation();
  const { surface, open, pickerId, openPicker, close, triggerRef } = useCpToolsTrigger();

  if (!surface) return null;

  const active = activeCpToolGlyph(surface.activeActionId, surface.activeOperationId);

  return (
    <>
      <Button
        ref={triggerRef}
        size="md"
        variant="secondary"
        className="cp-tools-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={pickerId}
        onClick={openPicker}
      >
        {active && (
          <span className="cp-tools-trigger__glyph">
            <CpToolGlyph
              action={active.action}
              glyphOperationId={active.glyphOperationId}
              size={16}
            />
          </span>
        )}
        {t('tools:cpToolPicker.trigger', 'Tools')}
      </Button>
      {/*
        Portaled, because this component is mounted *inside* the pill lane and
        that lane is `pointer-events: none` so the dock keeps every tap that is
        not on a pill. A sheet rendered there inherits it: measured, the backdrop
        and every row in it were transparent to touch — `elementFromPoint` over
        the open sheet returned the canvas underneath. The lane is also a
        stacking context at `--z-canvas-overlay`, which would cap a `--z-modal`
        sheet at 900 rather than 9999.

        `document.body` and not a sibling of the lane, which is what the View
        drawer does: this one has no component above it to be a sibling *of*.
      */}
      {open &&
        createPortal(
          <CpToolPickerSheet
            pickerId={pickerId}
            close={close}
            activeActionId={surface.activeActionId}
            activeOperationId={surface.activeOperationId}
            activeLineColor={surface.activeLineColor}
            onSelectAction={surface.onSelectAction}
          />,
          document.body
        )}
    </>
  );
}
