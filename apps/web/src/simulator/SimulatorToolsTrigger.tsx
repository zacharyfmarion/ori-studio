import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { trackSimulatorToolPickerOpened } from '../analytics';
import { ToolPickerList } from '../components/ui/tools/ToolPickerGroup';
import { ToolPickerRow } from '../components/ui/tools/ToolPickerRow';
import { ToolPickerSheet } from '../components/ui/tools/ToolPickerSheet';
import { ToolsTriggerButton } from '../components/ui/tools/ToolsTriggerButton';
import { useToolPickerSheet } from '../components/ui/tools/useToolPickerSheet';
import { SIMULATOR_TOOL_ICONS } from './simulatorToolIcons';
import type { SimulatorToolButton } from './tools/actions';
import type { SimulatorToolSurface } from './tools/toolState';

/**
 * The phone layout's Tools pill for the Simulate canvas, and the sheet behind
 * it: where the rail's tools go when there is no room for a rail.
 *
 * Edit's pill and sheet, from the same kit (`components/ui/tools/`): the pill
 * shows the tool in hand, and the sheet names each tool with what it does,
 * which a phone cannot learn from a tooltip. A pick closes it. There is no
 * modes row — pinning by touch needs no latch, since a finger's box adds and
 * its tap toggles.
 *
 * Seated in the panel's own toolbar, left of the Settings pill, and rendered
 * only in the phone layout, where the panel leaves the rail out: one predicate
 * decides both, so exactly one of them is on screen.
 */
export function SimulatorToolsTrigger({
  buttons,
  disabled,
  surface,
}: {
  buttons: readonly SimulatorToolButton[];
  /** True until the simulation is ready; the rows say so rather than vanish. */
  disabled: boolean;
  /** Which host the pill is in, as the sheet's analytics event says it. */
  surface: SimulatorToolSurface;
}) {
  const { t } = useTranslation();
  const { open, pickerId, openPicker, close, triggerRef } = useToolPickerSheet({
    available: true,
    onOpened: () => trackSimulatorToolPickerOpened({ surface }),
  });
  const active = buttons.find((button) => button.active);
  const ActiveIcon = active ? SIMULATOR_TOOL_ICONS[active.icon] : null;

  return (
    <>
      <ToolsTriggerButton
        label={t('panels:simulator.tools.picker.trigger', 'Tools')}
        glyph={ActiveIcon && <ActiveIcon size={16} aria-hidden="true" />}
        open={open}
        pickerId={pickerId}
        onOpen={openPicker}
        triggerRef={triggerRef}
      />
      {/* Portaled for the reason Edit's is: the sheet is a page-level dialog,
          and nothing in the toolbar should cap its stacking or its taps. */}
      {open &&
        createPortal(
          <ToolPickerSheet
            pickerId={pickerId}
            title={t('panels:simulator.tools.picker.title', 'Tools')}
            closeLabel={t('panels:simulator.tools.picker.close', 'Close tool list')}
            close={close}
          >
            <ToolPickerList label={t('panels:simulator.tools.railLabel', 'Simulator tools')}>
              {buttons.map((button) => {
                const Icon = SIMULATOR_TOOL_ICONS[button.icon];
                return (
                  <ToolPickerRow
                    key={button.id}
                    label={button.label}
                    description={button.description}
                    glyph={<Icon size={18} aria-hidden="true" />}
                    isActive={button.active}
                    available={!disabled}
                    onSelect={() => {
                      button.select();
                      close();
                    }}
                    data={{ 'data-tool': button.id }}
                  />
                );
              })}
            </ToolPickerList>
          </ToolPickerSheet>,
          document.body
        )}
    </>
  );
}
