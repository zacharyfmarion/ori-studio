import type { TFunction } from 'i18next';
import type {
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import type { FoldedFigureExportFormat } from './foldedFigureExport';
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
  | 'first-solution'
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

export interface FoldedFigureChoiceOption {
  id: string;
  label: string;
  /** Marks the current member of an exclusive set. Always false otherwise. */
  checked: boolean;
  run: () => void;
}

/**
 * A group of related picks rendered as one control: a dropdown on the toolbar,
 * a submenu in the context menu.
 *
 * Each option carries its own `run` rather than the group carrying a
 * `run(value)`, so the option's value type never escapes into the renderers —
 * they only ever need a label, a checked flag, and something to call.
 */
export interface FoldedFigureChoice {
  kind: 'choice';
  id: 'display-style' | 'export';
  label: string;
  icon: FoldedFigureActionIcon;
  disabled: boolean;
  /**
   * Whether the options are a mutually exclusive set (a display mode) rather
   * than a list of one-shot actions (export formats).
   *
   * Renderers use this to decide whether to reserve the leading check column.
   * It cannot be derived from `options.some(checked)`: an exclusive set can
   * legitimately have nothing checked — the figure's current display style may
   * be one of the values the quick list does not offer — and a column that
   * disappears in that case would shift every label sideways.
   */
  exclusive: boolean;
  options: FoldedFigureChoiceOption[];
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
  /** Save the figure on its own as an image. Omitted drops the export menu. */
  exportAs?: (
    figure: OristudioCpFoldedFigureEntry,
    format: FoldedFigureExportFormat
  ) => void;
}

/** A figure whose kernel handle and snapshot are both live. */
export function isFoldedFigureReady(figure: OristudioCpFoldedFigureEntry): boolean {
  return figure.status === 'ready' && figure.handle !== null && figure.snapshot !== null;
}

/** A folded figure is geometry on a page, so it exports as an image only. */
export const FOLDED_FIGURE_EXPORT_FORMATS: readonly FoldedFigureExportFormat[] = [
  'svg',
  'png',
];

export function foldedExportFormatLabel(t: TFunction, value: FoldedFigureExportFormat): string {
  // Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
  switch (value) {
    case 'svg':
      return t('panels:foldedFigureActions.exportSvg', 'SVG image');
    case 'png':
      return t('panels:foldedFigureActions.exportPng', 'PNG image');
  }
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
  const hasNextSolution = figure.snapshot?.find_another_overlap_valid === true;
  // The kernel wraps by restarting the enumeration, so wrapping only makes sense
  // once more than one solution is known to exist.
  const wrapsToFirst = !hasNextSolution && (figure.snapshot?.discovered_fold_cases ?? 0) > 1;

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
      exclusive: true,
      options: FOLDED_FIGURE_STYLE_CHOICES.map((value) => ({
        id: `display-style-${value}`,
        label: foldedDisplayStyleChoiceLabel(t, value),
        checked: value === currentStyle,
        run: () => deps.setDisplayStyle(figure, value),
      })),
    },
    { kind: 'separator', id: 'after-appearance' },
    {
      kind: 'command',
      id: 'another',
      // At the end of the enumeration the kernel wraps to the first solution
      // rather than dead-ending, so say which of the two the press will do.
      label: wrapsToFirst
        ? t('panels:foldedFigureActions.firstSolution', 'Back to first solution')
        : t('panels:foldedFigureActions.anotherSolution', 'Another solution'),
      icon: wrapsToFirst ? 'first-solution' : 'another',
      // Disabled only with nowhere to go: a single-solution fold, where wrapping
      // would land exactly where it started.
      disabled: !ready || (!hasNextSolution && !wrapsToFirst),
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

  if (deps.exportAs) {
    const exportAs = deps.exportAs;
    actions.push(
      { kind: 'separator', id: 'before-export' },
      {
        kind: 'choice',
        id: 'export',
        label: t('panels:foldedFigureActions.export', 'Export…'),
        icon: 'export',
        // Exported from the render snapshot, so anything on screen can be saved
        // — including a figure whose creases have since moved.
        disabled: figure.renderSnapshot === null,
        // One-shot actions, not a mode: no current format to check.
        exclusive: false,
        options: FOLDED_FIGURE_EXPORT_FORMATS.map((value) => ({
          id: `export-${value}`,
          label: foldedExportFormatLabel(t, value),
          checked: false,
          run: () => exportAs(figure, value),
        })),
      }
    );
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
