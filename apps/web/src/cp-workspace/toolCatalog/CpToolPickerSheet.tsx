/**
 * Every crease-pattern tool, named, for a device that cannot summon a tooltip.
 *
 * # Why a sheet and not labels on the rail
 *
 * The rail is 52 icon-only tools in a 3–4 column grid inside a ~200px column,
 * which is ~84px per cell on the widest touch layout. The names those cells
 * would have to carry are "Parallel Alternating Lines", "Concentric from two
 * circles", "Delete Overlapping Lines" — 24 to 27 characters, truncating to a
 * prefix that does not even disambiguate them (three of the concentric tools
 * share their first ten). One column with full labels makes the rail 56 rows
 * tall and eats the canvas an iPad is already short of. `railLabel` is the
 * escape hatch for names that do fit, and it is used for exactly the four that
 * do — `M V E A`.
 *
 * So the labels go somewhere with room for them, and the rail keeps its grid at
 * exactly the width it has today. This is the shape the codebase already reached
 * for twice: `ViewportToolbarOverflowMenu` collapses icon controls into labelled
 * rows, and `WorkspaceViewDrawer` moves a pane that will not fit into a sheet.
 *
 * # Who opens it
 *
 * The **phone** layout, where there is no rail at all and this is the only tool
 * surface there is — see `CpToolsTrigger`. It had a second opener, an "All
 * tools" button at the top of the tablet rail, and that one is gone: on a tablet
 * the rail is right there and scrolls, and press-and-hold (`useTouchLabel`)
 * names any glyph in place, so the button bought nothing but a row of height.
 *
 * That is also why the Shift latch is in here. On a phone the rail it used to
 * live in is hidden, and "add to selection" is the one modifier that costs a
 * capability rather than a convenience (see `touchModifiers/shiftLatch`), so it
 * moves into the surface that replaced the rail rather than disappearing with it.
 */
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import type { OristudioCpActionDefinition, OristudioCpActionId } from '../../lib/oristudioCpActions';
import type { OristudioCpLineColor } from '../../engine/oristudioCpTypes';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { cpActionLabel, cpGroupLabel } from '../../i18n/cpVocab';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { ToolPickerSheet } from '../../components/ui/tools/ToolPickerSheet';
import { ToolPickerGroup, ToolPickerList } from '../../components/ui/tools/ToolPickerGroup';
import { CpShiftLatchToggle } from '../touchModifiers/CpShiftLatchToggle';
import { CpLineTypeMark } from './CpLineTypeMark';
import { cpRailGroups } from './cpRailActions';
import { useCpToolFavorites } from './cpToolFavorites';
import { CpToolPickerFavorites } from './CpToolPickerFavorites';
import { CpToolPickerRow } from './CpToolPickerRow';
import { useCpToolFavoriteToggle } from './useCpToolFavoriteToggle';
import styles from './CpToolPickerSheet.module.css';

export function CpToolPickerSheet({
  pickerId,
  close,
  activeActionId,
  activeOperationId,
  activeLineColor,
  onSelectAction,
}: {
  /** DOM id the trigger points `aria-controls` at, and this dialog wears. */
  pickerId: string;
  close: () => void;
  activeActionId: OristudioCpActionId | null;
  activeOperationId: OristudioCpOperationId | null;
  activeLineColor: OristudioCpLineColor;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
}) {
  const { t } = useTranslation();
  // Read here rather than passed in: favorites are a user preference the shell
  // this sheet is mounted by knows nothing about, so it subscribes rather than
  // being handed them.
  const favorites = useCpToolFavorites();
  const toggleFavorite = useCpToolFavoriteToggle('picker-sheet');

  return (
    <ToolPickerSheet
      pickerId={pickerId}
      title={t('tools:cpToolPicker.title', 'Tools')}
      closeLabel={t('tools:cpToolPicker.close', 'Close tool list')}
      close={close}
      modes={<CpShiftLatchToggle />}
    >
      {cpRailGroups().map(({ group, actions }) => (
        <Fragment key={group.id}>
          <ToolPickerGroup title={cpGroupLabel(t, group)}>
            {/* The line types are five one-letter choices, so as full rows
                they cost a third of the sheet to say what five chips say —
                and the segmented control the rail uses is already the
                clearer picture of "one control, one answer". Every other
                group stays a list: those are tools with names worth reading,
                which is what the rows are for. Unlike the rail's, a pick
                here closes the sheet. */}
            {group.id === 'line-type' ? (
              <div className={styles.types} data-line-types="">
                <CpToolPickerLineTypes
                  label={cpGroupLabel(t, group)}
                  actions={actions}
                  activeLineColor={activeLineColor}
                  onSelect={(action) => {
                    onSelectAction(action);
                    close();
                  }}
                />
              </div>
            ) : (
              <ToolPickerList>
                {actions.map((action) => (
                  <CpToolPickerRow
                    key={action.id}
                    action={action}
                    isActive={activeActionId === action.id}
                    glyphOperationId={activeActionId === action.id ? activeOperationId : null}
                    available={action.uiStatus === 'ready'}
                    favorited={favorites.isFavorite(action.id)}
                    onToggleFavorite={() => toggleFavorite(action.id)}
                    onSelect={() => {
                      onSelectAction(action);
                      close();
                    }}
                  />
                ))}
              </ToolPickerList>
            )}
          </ToolPickerGroup>
          {/* Directly below the crease types, which is the one group that is
              not a tool and the thing everything else hangs off. Rendered
              inside the same map so the two stay adjacent if the catalogue
              ever reorders its groups. */}
          {group.id === 'line-type' && (
            <CpToolPickerFavorites
              activeActionId={activeActionId}
              activeOperationId={activeOperationId}
              onSelectAction={(action) => {
                onSelectAction(action);
                close();
              }}
            />
          )}
        </Fragment>
      ))}
    </ToolPickerSheet>
  );
}

function CpToolPickerLineTypes({
  label,
  actions,
  activeLineColor,
  onSelect,
}: {
  label: string;
  actions: readonly OristudioCpActionDefinition[];
  activeLineColor: OristudioCpLineColor;
  onSelect: (action: OristudioCpActionDefinition) => void;
}) {
  const { t } = useTranslation();
  const lineTypes = actions.filter((action) => action.kind === 'line-type');
  return (
    <SegmentedControl<OristudioCpLineColor>
      fill
      iconsOnly
      aria-label={label}
      value={activeLineColor}
      options={lineTypes.map((action) => ({
        value: action.lineColor,
        label: cpActionLabel(t, action),
        icon: <CpLineTypeMark action={action} size="lg" />,
        // A letter names nothing to someone who has not met it; holding one
        // says which, without picking it and closing the sheet.
        tooltip: cpActionLabel(t, action),
      }))}
      onChange={(lineColor) => {
        const action = lineTypes.find((candidate) => candidate.lineColor === lineColor);
        if (action) onSelect(action);
      }}
    />
  );
}
