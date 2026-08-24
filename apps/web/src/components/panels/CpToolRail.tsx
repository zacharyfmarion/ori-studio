import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronDown } from 'lucide-react';
import {
  type OristudioCpActionDefinition,
  type OristudioCpActionGroupDefinition,
  type OristudioCpActionId,
} from '../../lib/oristudioCpActions';
import type { OristudioCpLineColor } from '../../engine/oristudioCpTypes';
import { shortcutLabelForAction, type ShortcutResolution } from '../../keyboard/shortcuts';
import { readJson, storageKey, writeJson, STORAGE_KEYS } from '../../lib/storage';
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
import { CpToolGlyph } from '../../cp-workspace/toolCatalog/cpToolGlyph';
import { CpShiftLatchToggle } from '../../cp-workspace/touchModifiers/CpShiftLatchToggle';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip';
import { useTouchLabel } from '../ui/useTouchLabel';

const RAIL_GROUPS_STORAGE_KEY = storageKey(STORAGE_KEYS.cpToolRailGroups);

/** Which collapsible rail groups the user has opened, keyed by group id. */
function readRailGroupOpenState(): Record<string, boolean> {
  const stored = readJson<unknown>(RAIL_GROUPS_STORAGE_KEY, {});
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  return stored as Record<string, boolean>;
}

function writeRailGroupOpenState(groupId: string, open: boolean): void {
  writeJson(RAIL_GROUPS_STORAGE_KEY, { ...readRailGroupOpenState(), [groupId]: open });
}

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

  return (
    <aside className="cp-tool-rail" aria-label={t('tools:cpRail.ariaLabel', 'Crease pattern tools')}>
      {/*
        One full-width row for the Shift latch: the rail's constraint is
        horizontal, so its button grid keeps every pixel it has today and what
        this spends is height, in a column that already scrolls.

        It used to carry an "All tools" button above the latch, and that is gone.
        On a tablet the rail is right there and scrolls, and press-and-hold
        (`useTouchLabel`) names any glyph in place — so the button bought a row of
        height and nothing else. The sheet it opened survives as the *phone* tool
        surface, where there is no rail at all (see `CpToolsTrigger`).

        Gated here as well as inside the child, which is not belt and braces.
        `.cp-tool-rail` is a grid with one explicit row, so an *empty* header div
        would still open a second implicit one and move the desktop rail.
      */}
      {coarsePointer && !phoneLayout && (
        <div className="cp-tool-rail__touch-header">
          <CpShiftLatchToggle />
        </div>
      )}
      <div className="cp-tool-rail__groups">
        {cpRailGroups().map(({ group, actions }) => (
          <CpToolRailGroup
            key={group.id}
            group={group}
            actions={actions}
            activeActionId={activeActionId}
            activeOperationId={activeOperationId}
            activeLineColor={activeLineColor}
            editable={editable}
            onSelectAction={onSelectAction}
            shortcutResolution={shortcutResolution}
          />
        ))}
      </div>
    </aside>
  );
});

function CpToolRailGroup({
  group,
  actions,
  activeActionId,
  activeOperationId,
  activeLineColor,
  editable,
  onSelectAction,
  shortcutResolution,
}: {
  group: OristudioCpActionGroupDefinition;
  actions: readonly OristudioCpActionDefinition[];
  activeActionId: OristudioCpActionId | null;
  activeOperationId: OristudioCpOperationId | null;
  activeLineColor: OristudioCpLineColor;
  editable: boolean;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
  shortcutResolution: ShortcutResolution;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(
    () => readRailGroupOpenState()[group.id] ?? group.collapsedByDefault !== true
  );
  const buttonsId = `cp-tool-rail-group-${group.id}`;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeRailGroupOpenState(group.id, next);
  };

  return (
    <section
      className="cp-tool-rail__group"
      aria-label={cpGroupLabel(t, group)}
      data-open={open || undefined}
    >
      <button
        type="button"
        className="cp-tool-rail__group-toggle"
        aria-expanded={open}
        aria-controls={buttonsId}
        onClick={toggle}
      >
        <span className="cp-tool-rail__group-label">{cpGroupRailLabel(t, group)}</span>
        <ChevronDown className="cp-tool-rail__group-chevron" size={10} aria-hidden="true" />
      </button>
      {open && (
        <div className="cp-tool-rail__buttons" id={buttonsId} data-group={group.id}>
          {actions.map((action) => {
            const isActive =
              action.kind === 'line-type'
                ? activeLineColor === action.lineColor
                : activeActionId === action.id;
            return (
              <CpToolButton
                key={action.id}
                action={action}
                editable={editable}
                isActive={isActive}
                glyphOperationId={isActive ? activeOperationId : null}
                onSelectAction={onSelectAction}
                shortcutLabel={shortcutLabelForAction(action.id, shortcutResolution)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

const CpToolButton = memo(function CpToolButton({
  action,
  editable,
  isActive,
  glyphOperationId,
  onSelectAction,
  shortcutLabel,
}: {
  action: OristudioCpActionDefinition;
  editable: boolean;
  isActive: boolean;
  /** The resolved operation to draw, when this is the active tool; else null. */
  glyphOperationId: OristudioCpOperationId | null;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
  shortcutLabel?: string;
}) {
  const { t } = useTranslation();
  // The rail does not use `IconButton`, so it wires the hold itself. Worth it
  // here more than anywhere: this is 52 of the app's icon-only controls, and 37
  // of them draw an origami-specific icon font ported from Oriedita — nobody
  // reads U+E00F as "Parallel Alternating Lines" without being told.
  const hold = useTouchLabel();
  const available = editable && action.uiStatus === 'ready';
  const label = cpActionLabel(t, action);
  const statusLabel = commandStatusLabel(action, editable, t);
  const title = shortcutLabel
    ? `${label} (${shortcutLabel}) - ${statusLabel}`
    : `${label} - ${statusLabel}`;

  const button = (
    <button
      type="button"
      className="cp-tool-rail__button"
      aria-label={label}
      aria-disabled={!available}
      data-active={isActive || undefined}
      data-action-kind={action.kind}
      data-line-color={action.kind === 'line-type' ? action.lineColor : undefined}
      data-ui-status={action.uiStatus}
      {...hold.handlers}
      onClick={() => {
        // Holding a tool to find out what it is must not also arm it.
        if (hold.consumeClick()) return;
        if (!available) return;
        onSelectAction(action);
      }}
    >
      <CpToolGlyph action={action} glyphOperationId={glyphOperationId} />
    </button>
  );

  return (
    <Tooltip open={hold.open}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{title}</TooltipContent>
    </Tooltip>
  );
});

function commandStatusLabel(
  action: OristudioCpActionDefinition,
  editable: boolean,
  t: TFunction
): string {
  if (!editable) return t('tools:cpRail.openEditableFirst', 'Open an editable crease pattern first');
  if (action.uiStatus === 'ready') return cpActionTooltip(t, action);
  return cpActionDisabledReason(t, action);
}
