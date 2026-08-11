import type { TFunction } from 'i18next';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { buildFoldedFigureActions, type FoldedFigureActionDeps } from './foldedFigureActions';
import { foldedFigureActionIconNode } from './foldedFigureActionIcons';

/**
 * Renders the folded-figure action catalog as context-menu items.
 *
 * The sibling of {@link CpFoldedFigureToolbar}: same actions, different surface.
 * Neither decides what a figure can do — `buildFoldedFigureActions` does — so
 * the two cannot drift apart, and this file only answers "what does a command,
 * a choice group, and a separator look like in a menu".
 */
export function foldedFigureMenuItems(
  figure: OristudioCpFoldedFigureEntry,
  deps: FoldedFigureActionDeps
): ContextMenuItem[] {
  return buildFoldedFigureActions(figure, deps).map((action): ContextMenuItem => {
    switch (action.kind) {
      case 'separator':
        return { kind: 'separator' };
      // The verdict, as a header. An item when it offers something to do about
      // it and a disabled one otherwise, so the sentence is readable either way
      // — a menu has no non-item way to say something.
      case 'note':
        return {
          kind: 'action',
          id: action.id,
          label: action.run
            ? `${action.notice.label} — ${action.notice.action?.label ?? ''}`.trim()
            : action.notice.label,
          icon: foldedFigureActionIconNode(action.icon),
          disabled: action.run === null,
          onSelect: action.run ?? (() => {}),
        };
      case 'choice':
        // Grouped picks nest as a submenu rather than spending top-level slots.
        // An exclusive set (display style) becomes radio items so the current
        // mode is checked; a list of one-shot actions (export) becomes plain
        // items, which carry no check column to sit under.
        return {
          kind: 'submenu',
          id: action.id,
          label: action.label,
          icon: foldedFigureActionIconNode(action.icon),
          disabled: action.disabled,
          items: action.options.map((option) =>
            action.exclusive
              ? {
                  kind: 'radio',
                  id: option.id,
                  label: option.label,
                  checked: option.checked,
                  onSelect: option.run,
                }
              : {
                  kind: 'action',
                  id: option.id,
                  label: option.label,
                  onSelect: option.run,
                }
          ),
        };
      case 'command':
        return {
          kind: 'action',
          id: action.id,
          label: action.label,
          icon: foldedFigureActionIconNode(action.icon),
          disabled: action.disabled,
          danger: action.danger,
          onSelect: action.run,
        };
    }
  });
}

/** Convenience for callers that hold the deps without `t` bound in. */
export function foldedFigureMenuItemsWith(
  figure: OristudioCpFoldedFigureEntry,
  deps: Omit<FoldedFigureActionDeps, 't'>,
  t: TFunction
): ContextMenuItem[] {
  return foldedFigureMenuItems(figure, { ...deps, t });
}
