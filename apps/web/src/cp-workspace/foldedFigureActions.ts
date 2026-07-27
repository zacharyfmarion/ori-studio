import type { TFunction } from 'i18next';
import type {
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
} from '../engine/oristudioCpTypes';
import { flipFoldedState } from './foldedFigureState';

/**
 * The verbs a folded figure offers, in the order both surfaces present them.
 *
 * This exists so the floating toolbar and the right-click context menu cannot
 * drift: adding a verb here makes it appear in both. Each surface owns only its
 * *rendering* — the toolbar maps actions to icon buttons and the choice group to
 * a dropdown, the menu maps them to items and a submenu — while gating, labels,
 * ordering, and the calls themselves live here.
 *
 * Deliberately free of React and of the store: it takes an entry plus bound
 * callbacks and returns plain data, which is what makes it directly testable.
 */

/** Display styles offered as quick choices, matching the viewport dropdown. */
export const FOLDED_FIGURE_STYLE_CHOICES: readonly OristudioCpFoldedFigureDisplayStyle[] = [
  'Paper5',
  'Wire2',
  'Transparent3',
];

/** Icon names, resolved to components by each surface (this module stays JSX-free). */
export type FoldedFigureActionIcon =
  | 'flip'
  | 'style'
  | 'another'
  | 'refold'
  | 'export'
  | 'duplicate'
  | 'delete';

export interface FoldedFigureCommand {
  kind: 'command';
  id: 'flip' | 'another' | 'refold' | 'duplicate' | 'delete';
  label: string;
  icon: FoldedFigureActionIcon;
  disabled: boolean;
  danger?: boolean;
  run: () => void;
}

export interface FoldedFigureChoiceOption<T> {
  id: string;
  label: string;
  value: T;
  checked: boolean;
}

export interface FoldedFigureChoice {
  kind: 'choice';
  id: 'display-style';
  label: string;
  icon: FoldedFigureActionIcon;
  disabled: boolean;
  options: FoldedFigureChoiceOption<OristudioCpFoldedFigureDisplayStyle>[];
  run: (value: OristudioCpFoldedFigureDisplayStyle) => void;
}

export interface FoldedFigureSeparator {
  kind: 'separator';
  id: string;
}

export type FoldedFigureAction =
  | FoldedFigureCommand
  | FoldedFigureChoice
  | FoldedFigureSeparator;

/**
 * Store bindings the actions call. Every mutating call is expected to be wrapped
 * by the panel's `runFoldedFigureAction`, which snapshots → acts → records so
 * each verb lands as exactly one undo entry.
 */
export interface FoldedFigureActionDeps {
  t: TFunction;
  flip: (figure: OristudioCpFoldedFigureEntry) => void;
  setDisplayStyle: (
    figure: OristudioCpFoldedFigureEntry,
    style: OristudioCpFoldedFigureDisplayStyle
  ) => void;
  foldAnother: (figure: OristudioCpFoldedFigureEntry) => void;
  duplicate: (figure: OristudioCpFoldedFigureEntry) => void;
  remove: (figure: OristudioCpFoldedFigureEntry) => void;
  /**
   * Refold from the figure's recorded source region. Omitted until the caller
   * supports it; the action is dropped entirely rather than shown disabled,
   * since a figure that is up to date has nothing to refold.
   */
  refold?: (figure: OristudioCpFoldedFigureEntry) => void;
  /** Whether the figure's source creases have changed since it was folded. */
  isStale?: (figure: OristudioCpFoldedFigureEntry) => boolean;
}

/** A figure whose kernel handle and snapshot are both live. */
export function isFoldedFigureReady(figure: OristudioCpFoldedFigureEntry): boolean {
  return figure.status === 'ready' && figure.handle !== null && figure.snapshot !== null;
}

export function foldedDisplayStyleChoiceLabel(
  t: TFunction,
  value: OristudioCpFoldedFigureDisplayStyle
): string {
  // Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
  switch (value) {
    case 'Paper5':
      return t('panels:foldedFigureActions.stylePaper', 'Paper');
    case 'Wire2':
      return t('panels:foldedFigureActions.styleWireframe', 'Wireframe');
    case 'Transparent3':
      return t('panels:foldedFigureActions.styleXray', 'X-ray');
    case 'Development1':
      return t('panels:foldedFigureActions.styleDev1', 'Dev 1');
    case 'Development4':
      return t('panels:foldedFigureActions.styleDev4', 'Dev 4');
    case 'None0':
      return t('panels:foldedFigureActions.styleNone', 'None');
    default:
      return value;
  }
}

/**
 * Build the ordered action list for `figure`.
 *
 * Order is frequency-first, grouped by intent, destructive last — matching the
 * convention `AnnotationActions` sets for the image and text toolbars:
 * look (flip, style) → solution (another, refold) → manage (duplicate, delete).
 */
export function buildFoldedFigureActions(
  figure: OristudioCpFoldedFigureEntry,
  deps: FoldedFigureActionDeps
): FoldedFigureAction[] {
  const { t } = deps;
  const ready = isFoldedFigureReady(figure);
  const currentStyle = figure.displayStyle;
  const canRefold = deps.refold !== undefined && deps.isStale?.(figure) === true;

  const actions: FoldedFigureAction[] = [
    {
      kind: 'command',
      id: 'flip',
      label: t('panels:foldedFigureActions.flip', 'Flip'),
      icon: 'flip',
      disabled: !ready,
      // Turn the paper over: Front <-> Back. The Both/Transparent overlay states
      // are view modes, not sides, and live on the viewport toolbar's "Side"
      // control (see flipFoldedState).
      run: () => deps.flip(figure),
    },
    {
      kind: 'choice',
      id: 'display-style',
      label: t('panels:foldedFigureActions.displayStyle', 'Display style'),
      icon: 'style',
      disabled: !ready,
      options: FOLDED_FIGURE_STYLE_CHOICES.map((value) => ({
        id: `display-style-${value}`,
        label: foldedDisplayStyleChoiceLabel(t, value),
        value,
        checked: value === currentStyle,
      })),
      run: (value) => deps.setDisplayStyle(figure, value),
    },
    { kind: 'separator', id: 'after-appearance' },
    {
      kind: 'command',
      id: 'another',
      label: t('panels:foldedFigureActions.anotherSolution', 'Another solution'),
      icon: 'another',
      // A fold is one of several valid layer orderings only when the kernel says
      // another overlap-valid ordering remains.
      disabled: !ready || figure.snapshot?.find_another_overlap_valid !== true,
      run: () => deps.foldAnother(figure),
    },
  ];

  // Refold is present only when it applies: a figure that matches its source
  // creases has nothing to refold, and a disabled button would just be noise.
  if (canRefold) {
    actions.push({
      kind: 'command',
      id: 'refold',
      label: t('panels:foldedFigureActions.refold', 'Refold'),
      icon: 'refold',
      disabled: false,
      run: () => deps.refold?.(figure),
    });
  }

  actions.push(
    { kind: 'separator', id: 'before-manage' },
    {
      kind: 'command',
      id: 'duplicate',
      label: t('panels:foldedFigureActions.duplicate', 'Duplicate'),
      icon: 'duplicate',
      disabled: figure.handle === null,
      run: () => deps.duplicate(figure),
    },
    {
      kind: 'command',
      id: 'delete',
      label: t('panels:foldedFigureActions.delete', 'Delete'),
      icon: 'delete',
      disabled: false,
      danger: true,
      run: () => deps.remove(figure),
    }
  );

  return actions;
}

/** The flip target for `figure`, exposed so callers can build the model patch. */
export function foldedFigureFlipState(figure: OristudioCpFoldedFigureEntry) {
  return flipFoldedState(figure.snapshot?.model.state ?? 'Front0');
}
