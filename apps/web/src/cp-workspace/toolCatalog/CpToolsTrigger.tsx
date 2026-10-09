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
import { useTranslation } from 'react-i18next';
import { SheetPortal } from '../../components/SheetLayer';
import { ToolsTriggerButton } from '../../components/ui/tools/ToolsTriggerButton';
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
      <ToolsTriggerButton
        label={t('tools:cpToolPicker.trigger', 'Tools')}
        glyph={
          active && (
            <CpToolGlyph
              action={active.action}
              glyphOperationId={active.glyphOperationId}
              size={16}
              compact
            />
          )
        }
        open={open}
        pickerId={pickerId}
        onOpen={openPicker}
        triggerRef={triggerRef}
      />
      {/*
        Portaled, because this component is mounted *inside* the pill lane and
        that lane is `pointer-events: none` so the dock keeps every tap that is
        not on a pill. A sheet rendered there inherits it: measured, the backdrop
        and every row in it were transparent to touch — `elementFromPoint` over
        the open sheet returned the canvas underneath. The lane is also a
        stacking context at `--z-canvas-overlay`, which would cap a `--z-modal`
        sheet at 900 rather than 9999.

        Into the sheet layer, before every modal, as every sheet is
        (`SheetLayer`): a dialog that opens while it is up is over it.
      */}
      {open && (
        <SheetPortal>
          <CpToolPickerSheet
            pickerId={pickerId}
            close={close}
            activeActionId={surface.activeActionId}
            activeOperationId={surface.activeOperationId}
            activeLineColor={surface.activeLineColor}
            onSelectAction={surface.onSelectAction}
          />
        </SheetPortal>
      )}
    </>
  );
}
