import { useTranslation } from 'react-i18next';
import { trackFoldToolPickerOpened } from '../../analytics';
import { useFoldRailGroups } from '../../fold/canvas/useFoldRailGroups';
import { useFoldTools } from '../../fold/tools/foldToolState';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { SheetPortal } from '../SheetLayer';
import { ToolsTriggerButton } from '../ui/tools/ToolsTriggerButton';
import { useToolPickerSheet } from '../ui/tools/useToolPickerSheet';
import { FoldAltLatchToggle } from './canvas/FoldAltLatchToggle';
import { FoldToolGlyph } from './FoldToolGlyph';
import { FoldToolPickerSheet } from './FoldToolPickerSheet';

/**
 * The phone layout's Tools pill for Fold, and the sheet behind it: Edit's
 * (`CpToolsTrigger`) and Simulate's, from the same kit (`components/ui/tools/`).
 * The pill shows the tool in hand; the sheet names every tool, with the
 * free-point latch in its modes row, where Edit's holds its Shift latch.
 *
 * Seated by the Fold header beside the Settings pill, as Edit's sits beside
 * View in the canvas's pill lane: on Fold that lane would sit over the header,
 * so the header carries the pills. Rendered only in the phone layout, where
 * the panel leaves the rail out — one predicate decides both. `compact` drops
 * the pill's word where the header has no room for it (a long locale), the
 * glyph of the tool in hand saying the most it can alone.
 */
export function FoldToolsTrigger({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const phone = useIsPhoneLayout();
  const groups = useFoldRailGroups();
  const tool = useFoldTools((state) => state.tool);
  const { open, pickerId, openPicker, close, triggerRef } = useToolPickerSheet({
    available: phone,
    onOpened: trackFoldToolPickerOpened,
  });
  if (!phone) return null;
  return (
    <>
      <ToolsTriggerButton
        label={t('tools:fold.picker.trigger', 'Tools')}
        glyph={<FoldToolGlyph id={tool} compact />}
        open={open}
        pickerId={pickerId}
        onOpen={openPicker}
        triggerRef={triggerRef}
        compact={compact}
      />
      {/* A page-level dialog, into the sheet layer before every modal, as
          every sheet is: nothing in the header should cap its stacking or its taps. */}
      {open && (
        <SheetPortal>
          <FoldToolPickerSheet pickerId={pickerId} groups={groups} close={close} modes={<FoldAltLatchToggle fill />} />
        </SheetPortal>
      )}
    </>
  );
}
