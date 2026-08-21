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
 * # Why it is visible
 *
 * Press-and-hold (`useTouchLabel`) also names a tool, in place, and costs
 * nothing — but nobody discovers a gesture they were not told about. This has a
 * trigger you can see, which is the half of the problem a hold cannot solve.
 */
import { useTranslation } from 'react-i18next';
import { LayoutGrid, X } from 'lucide-react';
import type { OristudioCpActionDefinition, OristudioCpActionId } from '../../lib/oristudioCpActions';
import type { OristudioCpLineColor } from '../../engine/oristudioCpTypes';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { shortcutLabelForAction, type ShortcutResolution } from '../../keyboard/shortcuts';
import { cpActionLabel, cpActionTooltip, cpGroupLabel } from '../../i18n/cpVocab';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { cpRailGroups } from './cpRailActions';
import { CpToolGlyph } from './cpToolGlyph';
import { useCpToolPicker } from './useCpToolPicker';

export function CpToolPicker({
  activeActionId,
  activeOperationId,
  activeLineColor,
  editable,
  onSelectAction,
  shortcutResolution,
}: {
  activeActionId: OristudioCpActionId | null;
  activeOperationId: OristudioCpOperationId | null;
  activeLineColor: OristudioCpLineColor;
  editable: boolean;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
  shortcutResolution: ShortcutResolution;
}) {
  const { t } = useTranslation();
  const { available, open, pickerId, openPicker, close, triggerRef } = useCpToolPicker();

  if (!available) return null;

  const title = t('tools:cpToolPicker.title', 'All tools');

  return (
    <>
      <Button
        ref={triggerRef}
        size="md"
        variant="ghost"
        className="cp-tool-rail__picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={pickerId}
        onClick={openPicker}
      >
        <LayoutGrid size={14} aria-hidden="true" />
        {title}
      </Button>
      {open && (
        <div
          id={pickerId}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="cp-tool-picker"
          /*
            `click`, not `pointerdown` — the same retargeting hazard the View
            drawer documents. Dismissing on `pointerdown` unmounts the backdrop
            inside the commit, and the rest of the gesture is delivered to
            whatever is newly underneath: here that is the tool rail, so the tap
            that closed the sheet would also change the active tool.
          */
          onClick={close}
        >
          <div
            role="document"
            className="cp-tool-picker__sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="cp-tool-picker__header">
              <span className="cp-tool-picker__title">{title}</span>
              <IconButton
                size="sm"
                aria-label={t('tools:cpToolPicker.close', 'Close tool list')}
                onClick={close}
              >
                <X size={15} />
              </IconButton>
            </header>
            <div className="cp-tool-picker__body">
              {cpRailGroups().map(({ group, actions }) => (
                <section key={group.id} className="cp-tool-picker__group">
                  <h3 className="cp-tool-picker__group-title">{cpGroupLabel(t, group)}</h3>
                  <ul className="cp-tool-picker__list">
                    {actions.map((action) => (
                      <li key={action.id}>
                        <CpToolPickerRow
                          action={action}
                          isActive={
                            action.kind === 'line-type'
                              ? activeLineColor === action.lineColor
                              : activeActionId === action.id
                          }
                          glyphOperationId={
                            activeActionId === action.id ? activeOperationId : null
                          }
                          available={editable && action.uiStatus === 'ready'}
                          shortcutLabel={shortcutLabelForAction(action.id, shortcutResolution)}
                          onSelect={() => {
                            onSelectAction(action);
                            close();
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CpToolPickerRow({
  action,
  isActive,
  glyphOperationId,
  available,
  shortcutLabel,
  onSelect,
}: {
  action: OristudioCpActionDefinition;
  isActive: boolean;
  glyphOperationId: OristudioCpOperationId | null;
  available: boolean;
  shortcutLabel?: string;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="cp-tool-picker__item"
      data-active={isActive || undefined}
      data-line-color={action.kind === 'line-type' ? action.lineColor : undefined}
      aria-disabled={!available}
      onClick={() => {
        if (!available) return;
        onSelect();
      }}
    >
      <span className="cp-tool-picker__icon">
        <CpToolGlyph action={action} glyphOperationId={glyphOperationId} size={18} />
      </span>
      <span className="cp-tool-picker__text">
        <span className="cp-tool-picker__label">{cpActionLabel(t, action)}</span>
        {/*
          The one-line description the tooltip carried, which on a fine pointer
          was the only place it appeared. There is room for it here, and "what
          does Parallel Alternating Lines mean" is the question the picker is
          open to answer.
        */}
        <span className="cp-tool-picker__hint">{cpActionTooltip(t, action)}</span>
      </span>
      {shortcutLabel && <kbd className="cp-tool-picker__shortcut">{shortcutLabel}</kbd>}
    </button>
  );
}
