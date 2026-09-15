import type { TFunction } from 'i18next';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import {
  buildFoldedFigureActions,
  type FoldedFigureActionDeps,
  type FoldedFigureChoice,
  type FoldedFigureGroup,
} from './foldedFigureActions';
import { foldedFigureActionIconNode } from './foldedFigureActionIcons';

/**
 * A choice group's options as menu rows.
 *
 * An exclusive set (a render style) becomes radio rows so the current member is
 * checked; a list of one-shot actions (export formats) becomes plain rows,
 * which carry no check column to sit under. `keepOpen` is for a set that is
 * adjusted alongside its neighbours rather than picked and left — the Style
 * menu's rows — and is meaningless for a one-shot action, which closes the menu
 * by doing its job.
 */
export function choiceMenuItems(
  choice: FoldedFigureChoice,
  options: { keepOpen?: boolean } = {}
): ContextMenuItem[] {
  return choice.options.map((option) =>
    choice.exclusive
      ? {
          kind: 'radio',
          id: option.id,
          label: option.label,
          checked: option.checked,
          keepOpen: options.keepOpen,
          onSelect: option.run,
        }
      : {
          kind: 'action',
          id: option.id,
          label: option.label,
          onSelect: option.run,
        }
  );
}

/** A choice group as a submenu, its options nested behind the trigger. */
export function choiceMenuItem(
  choice: FoldedFigureChoice,
  options: { keepOpen?: boolean } = {}
): ContextMenuItem {
  return {
    kind: 'submenu',
    id: choice.id,
    label: choice.label,
    icon: foldedFigureActionIconNode(choice.icon),
    disabled: choice.disabled,
    hint: choice.hint,
    items: choiceMenuItems(choice, options),
  };
}

/**
 * The Style group's rows: two submenus, three colour rows and a check row.
 *
 * `keepOpen` is for the toolbar's menu, whose rows are rebuilt on every render:
 * a figure's style is adjusted as a set — pick a render style, then a colour,
 * then turn the shadow off — and a menu that closed on each pick would be
 * reopened three times for one visit. The context menu builds its rows once at
 * open, so there a pick closes it, as a context menu's picks do everywhere.
 */
export function styleMenuItems(
  group: FoldedFigureGroup,
  options: { keepOpen?: boolean } = {}
): ContextMenuItem[] {
  return group.items.map((item): ContextMenuItem => {
    switch (item.kind) {
      case 'separator':
        return { kind: 'separator' };
      case 'choice':
        return choiceMenuItem(item, options);
      case 'color':
        return {
          kind: 'color',
          id: item.id,
          label: item.label,
          value: item.value,
          disabled: item.disabled,
          onChange: item.set,
          onCommit: item.commit,
        };
      case 'toggle':
        return {
          kind: 'checkbox',
          id: item.id,
          label: item.label,
          checked: item.checked,
          disabled: item.disabled,
          hint: item.hint,
          keepOpen: options.keepOpen,
          onToggle: item.toggle,
        };
    }
  });
}

/**
 * Renders the folded-figure action catalog as context-menu items.
 *
 * The sibling of {@link CpFoldedFigureToolbar}: same actions, different surface.
 * Neither decides what a figure can do — `buildFoldedFigureActions` does — so
 * the two cannot drift apart, and this file only answers "what does a command,
 * a choice group, the style group, and a separator look like in a menu".
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
      // Grouped picks nest as a submenu rather than spending top-level slots.
      case 'choice':
        return choiceMenuItem(action);
      case 'group':
        return {
          kind: 'submenu',
          id: action.id,
          label: action.label,
          icon: foldedFigureActionIconNode(action.icon),
          disabled: action.disabled,
          items: styleMenuItems(action),
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
