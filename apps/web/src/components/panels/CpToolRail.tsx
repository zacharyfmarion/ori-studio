import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  type OristudioCpActionDefinition,
  type OristudioCpActionId,
  type OristudioCpLineTypeActionDefinition,
} from '../../lib/oristudioCpActions';
import type { OristudioCpLineColor } from '../../engine/oristudioCpTypes';
import { shortcutLabelForAction, type ShortcutResolution } from '../../keyboard/shortcuts';
import { storageKey, STORAGE_KEYS } from '../../lib/storage';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { useShortcutResolution } from '../../store/shortcutStore';
import {
  cpActionLabel,
  cpActionTooltip,
  cpActionDisabledReason,
  cpGroupLabel,
  cpGroupRailLabel,
} from '../../i18n/cpVocab';
import { cpRailGroups } from '../../cp-workspace/toolCatalog/cpRailActions';
import { CpLineTypeMark } from '../../cp-workspace/toolCatalog/CpLineTypeMark';
import { CpToolGlyph } from '../../cp-workspace/toolCatalog/cpToolGlyph';
import { CpShiftLatchToggle } from '../../cp-workspace/touchModifiers/CpShiftLatchToggle';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ToolRail, type ToolRailGroup } from '../ui/ToolRail';

const RAIL_GROUPS_STORAGE_KEY = storageKey(STORAGE_KEYS.cpToolRailGroups);

interface CpToolRailProps {
  activeActionId: OristudioCpActionId | null;
  /**
   * The operation the active tool would run. For a merged tool (Extend Line,
   * Divided Line) this is the variant its mode currently names, not the action's
   * own — the button draws that variant's glyph, so the mode is readable from
   * the rail without opening the context panel.
   */
  activeOperationId: OristudioCpOperationId | null;
  activeLineColor: OristudioCpLineColor;
  editable: boolean;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
}

/**
 * The Edit workspace's tool rail: the CP catalog's groups as a `ToolRail`.
 * 37 of its 52 tools draw an origami-specific icon font ported from Oriedita —
 * nobody reads U+E00F as "Parallel Alternating Lines" without being told — so
 * the rail's tooltips and press-and-hold labels carry more weight here than
 * anywhere.
 */
export const CpToolRail = memo(function CpToolRail({
  activeActionId,
  activeOperationId,
  activeLineColor,
  editable,
  onSelectAction,
}: CpToolRailProps) {
  const { t } = useTranslation();
  const coarsePointer = useIsCoarsePointerSurface();
  // The phone layout hides this rail entirely and moves the latch into the tool
  // sheet that replaces it, so the header must not also render one here — two
  // buttons over one module-level latch, one of them invisible.
  const phoneLayout = useIsPhoneLayout();
  // The rail's hints have to name the key that actually fires, so they resolve
  // against the active layout rather than the shipped table.
  const shortcutResolution = useShortcutResolution();

  const groups: ToolRailGroup[] = cpRailGroups().map(({ group, actions }) => ({
    id: group.id,
    label: cpGroupLabel(t, group),
    railLabel: cpGroupRailLabel(t, group),
    collapsedByDefault: group.collapsedByDefault,
    content:
      group.id === 'line-type'
        ? {
            // One control with one answer, so the line types are a segmented
            // control rather than five loose tool buttons.
            control: (
              <CpLineTypeControl
                label={cpGroupLabel(t, group)}
                actions={actions.filter((action) => action.kind === 'line-type')}
                activeLineColor={activeLineColor}
                editable={editable}
                onSelectAction={onSelectAction}
                shortcutResolution={shortcutResolution}
              />
            ),
          }
        : {
            tools: actions.map((action) => {
              const active = activeActionId === action.id;
              return {
                id: action.id,
                label: cpActionLabel(t, action),
                tooltip: railTooltip(
                  t,
                  action,
                  editable,
                  shortcutLabelForAction(action.id, shortcutResolution)
                ),
                glyph: (
                  <CpToolGlyph action={action} glyphOperationId={active ? activeOperationId : null} />
                ),
                active,
                available: editable && action.uiStatus === 'ready',
                onSelect: () => onSelectAction(action),
              };
            }),
          },
  }));

  return (
    <ToolRail
      aria-label={t('tools:cpRail.ariaLabel', 'Crease pattern tools')}
      idPrefix="cp-tool-rail-group"
      groups={groups}
      storageKey={RAIL_GROUPS_STORAGE_KEY}
      // One full-width row for the Shift latch. It used to carry an "All tools"
      // button above the latch, and that is gone: on a tablet the rail is right
      // there and scrolls, and press-and-hold names any glyph in place — so the
      // button bought a row of height and nothing else. The sheet it opened
      // survives as the *phone* tool surface, where there is no rail at all
      // (see `CpToolsTrigger`).
      header={coarsePointer && !phoneLayout ? <CpShiftLatchToggle /> : undefined}
    />
  );
});

/**
 * The line types, as one segmented control across the rail's width. Each keeps
 * what a tool button gives it: the tooltip naming it with its shortcut, the
 * press-and-hold label on touch, and a refusal while nothing is editable.
 */
function CpLineTypeControl({
  label,
  actions,
  activeLineColor,
  editable,
  onSelectAction,
  shortcutResolution,
}: {
  label: string;
  actions: readonly OristudioCpLineTypeActionDefinition[];
  activeLineColor: OristudioCpLineColor;
  editable: boolean;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
  shortcutResolution: ShortcutResolution;
}) {
  const { t } = useTranslation();
  return (
    <SegmentedControl<OristudioCpLineColor>
      size="lg"
      fill
      iconsOnly
      tooltipSide="right"
      aria-label={label}
      value={activeLineColor}
      options={actions.map((action) => ({
        value: action.lineColor,
        label: cpActionLabel(t, action),
        icon: <CpLineTypeMark action={action} />,
        tooltip: railTooltip(
          t,
          action,
          editable,
          shortcutLabelForAction(action.id, shortcutResolution)
        ),
        disabled: !(editable && action.uiStatus === 'ready'),
      }))}
      onChange={(lineColor) => {
        const action = actions.find((candidate) => candidate.lineColor === lineColor);
        if (action) onSelectAction(action);
      }}
    />
  );
}

/** What a rail tool's tooltip says: its name, its shortcut, and what it does or why it cannot. */
function railTooltip(
  t: TFunction,
  action: OristudioCpActionDefinition,
  editable: boolean,
  shortcutLabel: string | undefined
): string {
  const label = cpActionLabel(t, action);
  const status = !editable
    ? t('tools:cpRail.openEditableFirst', 'Open an editable crease pattern first')
    : action.uiStatus === 'ready'
      ? cpActionTooltip(t, action)
      : cpActionDisabledReason(t, action);
  return shortcutLabel ? `${label} (${shortcutLabel}) - ${status}` : `${label} - ${status}`;
}
