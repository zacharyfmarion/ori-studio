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
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { OristudioCpActionDefinition, OristudioCpActionId } from '../../lib/oristudioCpActions';
import type { OristudioCpLineColor } from '../../engine/oristudioCpTypes';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { shortcutLabelForAction } from '../../keyboard/shortcuts';
import { cpActionLabel, cpActionTooltip, cpGroupLabel } from '../../i18n/cpVocab';
import { useShortcutResolution } from '../../store/shortcutStore';
import { IconButton } from '../../components/ui/IconButton';
import { CpShiftLatchToggle } from '../touchModifiers/CpShiftLatchToggle';
import { cpRailGroups } from './cpRailActions';
import { CpToolGlyph } from './cpToolGlyph';

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
  // Read here rather than passed in: this sheet is mounted by the shell, so its
  // hints have nobody upstream to resolve them and must name the key that
  // actually fires under the active layout.
  const shortcutResolution = useShortcutResolution();
  const title = t('tools:cpToolPicker.title', 'Tools');

  // Focus the sheet itself, the way the View drawer does and for the same
  // reason: `aria-modal` hides everything outside this dialog from a screen
  // reader, so focus left on the trigger behind it sits on a node VoiceOver no
  // longer sees — nothing is announced and the tool list is reachable only by
  // exploring the screen. Focusing the container rather than the first row
  // announces what opened before it starts reading the catalogue.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  return (
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
        whatever is newly underneath: measured on an iPad, the tap that closed
        a sheet also changed the active tool on the rail behind it.
      */
      onClick={close}
    >
      <div
        ref={sheetRef}
        role="document"
        tabIndex={-1}
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
        {/* A mode, not a tool, so it sits above the catalogue and outside it —
            and unlike a tool it does not close the sheet, because reaching it
            costs two taps here and toggling it twice should not cost four. */}
        <div className="cp-tool-picker__modes">
          <CpShiftLatchToggle />
        </div>
        <div className="cp-tool-picker__body">
          {cpRailGroups().map(({ group, actions }) => (
            <section key={group.id} className="cp-tool-picker__group">
              <h3 className="cp-tool-picker__group-title">{cpGroupLabel(t, group)}</h3>
              {/* The line types are five one-letter choices, so as full rows
                  they cost a third of the sheet to say what five chips say —
                  and the same segmented group the rail uses is already the
                  clearer picture of "one control, one answer". Every other
                  group stays a list: those are tools with names worth reading,
                  which is what the rows are for. */}
              {group.id === 'line-type' ? (
                <div
                  className="cp-tool-picker__types"
                  role="radiogroup"
                  aria-label={cpGroupLabel(t, group)}
                >
                  {actions.map((action) => {
                    const isActive =
                      action.kind === 'line-type' && activeLineColor === action.lineColor;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        className="cp-tool-picker__type"
                        role="radio"
                        aria-checked={isActive}
                        aria-label={cpActionLabel(t, action)}
                        data-active={isActive || undefined}
                        data-line-color={action.kind === 'line-type' ? action.lineColor : undefined}
                        onClick={() => {
                          onSelectAction(action);
                          close();
                        }}
                      >
                        {action.railLabel}
                      </button>
                    );
                  })}
                </div>
              ) : (
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
                      glyphOperationId={activeActionId === action.id ? activeOperationId : null}
                      available={action.uiStatus === 'ready'}
                      shortcutLabel={shortcutLabelForAction(action.id, shortcutResolution)}
                      onSelect={() => {
                        onSelectAction(action);
                        close();
                      }}
                    />
                  </li>
                ))}
              </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
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
