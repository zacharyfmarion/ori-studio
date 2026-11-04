import type { TFunction } from 'i18next';
import type {
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import type { ControlVerb } from '../../lib/controlVerb';
import { FOLDED_FIGURE_SIDES } from '../../lib/foldedFigureSides';
import type { Hex, PaperStyle, PaperStyleField, PaperStyleValue } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, policyApplies } from '../../lib/paper/paperStyleResolve';
import { flipFoldedState, foldedFigureCycling, foldedFigureModel } from './foldedFigureState';
import { foldedFigureCapabilities, isFolded3dFigure } from './foldedFigureCapabilities';
import { foldedAppearanceEnabled, foldedAppearanceVisible } from './foldedFigureAppearance';
import {
  FOLDED_COLOR_FIELDS,
  foldedColorLabel,
  foldedStateLabel,
  type FoldedColorKey,
} from './foldedFigureControlOptions';
import { foldedFigureNotice, type FoldedFigureNotice } from './foldedFigureNotice';
import {
  foldedFigureLayerOrderBlock,
  foldedFigureLayerOrderHold,
  foldedFigureLayerOrderRecord,
  foldedFigureSolutionsHeldForReview,
  refoldHeldByLayerOrder,
  refoldHeldByLayerOrderReason,
  type FoldedFigureLayerOrderBlock,
} from './foldedFigureLayerOrderState';
import { foldedSolutionPlace } from './foldedSolutionCursor';
import { solutionPlaceEnds } from '../../layer-order/host/solutionCursorTable';
import { edgeInkEdits } from '../paper/paperStyleFields';

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

/** Icon names, resolved to components by each surface (this module stays JSX-free). */
export type FoldedFigureActionIcon =
  | 'flip'
  | 'reset-view'
  | 'set-upright'
  | 'style'
  | 'display-style'
  | 'side'
  | 'another'
  | 'previous'
  | 'first-solution'
  | 'refold'
  | 'layer-order'
  | 'export'
  | 'duplicate'
  | 'delete'
  | 'notice-warn'
  | 'notice-error';

/**
 * One verb. A {@link ControlVerb} — its label, whether it can act now and why
 * not, what it does — so any surface that draws verbs takes it as it is: the
 * toolbar, the menu, the Properties pane's header and its Layer order row.
 */
export interface FoldedFigureCommand extends ControlVerb {
  kind: 'command';
  id:
    | 'flip'
    | 'reset-view'
    | 'set-upright'
    | 'another'
    | 'previous'
    | 'layer-order'
    | 'refold'
    | 'export'
    | 'duplicate'
    | 'delete';
  icon: FoldedFigureActionIcon;
  danger?: boolean;
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
  id: 'display-style' | 'side';
  label: string;
  icon: FoldedFigureActionIcon;
  disabled: boolean;
  /** Why the choice is disabled, when it is. */
  hint?: string;
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

/**
 * One of the figure's paper colours, as a row that opens a colour picker.
 *
 * The value is the figure's *effective* paper style — the app's display
 * style with the figure's own pins on top — and a change pins that field on
 * the figure, so it stops following the app style for that field alone. Hex,
 * because both renderers hand it straight to a native colour input. A drag
 * streams `set` per pointer move under one gesture, and `commit` closes that
 * gesture as one undo entry — from whichever of blur and unmount fires first;
 * the second is a no-op.
 */
export interface FoldedFigureColorOption {
  kind: 'color';
  id: 'front-color' | 'back-color' | 'line-color';
  label: string;
  /** `#rrggbb`. */
  value: string;
  disabled: boolean;
  set: (hex: string) => void;
  commit: () => void;
}

/** An on/off setting, rendered as a check row that leaves the menu open. */
export interface FoldedFigureToggleOption {
  kind: 'toggle';
  id: 'shadow' | 'light' | 'aux';
  label: string;
  checked: boolean;
  disabled: boolean;
  /** Why the row is disabled, when it is. */
  hint?: string;
  toggle: () => void;
}

export type FoldedFigureStyleItem =
  | FoldedFigureChoice
  | FoldedFigureColorOption
  | FoldedFigureToggleOption
  | FoldedFigureSeparator;

/**
 * The figure's appearance settings, behind one control: a menu on the toolbar,
 * a submenu in the context menu. Everything the viewport bar's Folded models
 * dropdown offered a figure, addressed to *this* figure rather than to
 * whichever happens to be active.
 */
export interface FoldedFigureGroup {
  kind: 'group';
  id: 'style';
  label: string;
  icon: FoldedFigureActionIcon;
  disabled: boolean;
  items: FoldedFigureStyleItem[];
}

/**
 * What a 3D fold concluded about the figure, when it concluded anything.
 *
 * Not a command: the notice itself is a *statement*, and `action` is the one
 * thing the user can do about it. Leading the list because a figure that passes
 * through itself is the first thing to know about it, and rendered as a chip on
 * the toolbar and a disabled header in the menu — the two surfaces switch
 * exhaustively on `kind`, so adding this forced both to answer for it.
 */
export interface FoldedFigureNoteAction {
  kind: 'note';
  id: 'notice';
  notice: FoldedFigureNotice;
  icon: FoldedFigureActionIcon;
  /** The notice's own action, bound. Absent when there is nothing to offer. */
  run: (() => void) | null;
}

export type FoldedFigureAction =
  | FoldedFigureCommand
  | FoldedFigureChoice
  | FoldedFigureGroup
  | FoldedFigureSeparator
  | FoldedFigureNoteAction;

/**
 * Store bindings the actions call. Every mutating call is expected to be wrapped
 * by the panel's `runFoldedFigureAction`, which snapshots → acts → records so
 * each verb lands as exactly one undo entry.
 */
/**
 * One control's run of continuous changes — a colour drag — named so the
 * first change opens the layer's undo bracket under `scope` and
 * `endModelGesture(scope)` closes it as one entry under `label`.
 */
export interface FoldedModelGesture {
  /** Names one control's run of changes, e.g. `folded-color:<figure>:paper.front`. */
  scope: string;
  /** The history label the run lands under, stated when it opens. */
  label: string;
}

/** One field to pin on a figure, or to clear with `undefined`. */
export type FoldedAppearanceEdit = {
  [F in PaperStyleField]: { field: F; value: PaperStyleValue<F> | undefined };
}[PaperStyleField];

export interface FoldedFigureActionDeps {
  t: TFunction;
  flip: (figure: OristudioCpFoldedFigureEntry) => void;
  /**
   * Put a 3D figure's camera back where the fold left it.
   *
   * Yaw, pitch and zoom only. It deliberately does **not** clear an upright the
   * user set: which way the model is up is a property of the model, not of the
   * current look at it, so re-centring must not silently discard it. Undo is
   * the way back from an upright here, which a simulation's has no equivalent of
   * — see `SimulatorViewport.resetView`, which does drop one.
   */
  resetView: (figure: OristudioCpFoldedFigureEntry) => void;
  /**
   * Take the direction now pointing up on screen as the model's up.
   *
   * There is no matching clear verb. This is document state and takes one undo
   * entry, so undo is the way back — which is also why `resetView` can go on
   * leaving an upright alone without stranding anyone.
   */
  setUpright: (figure: OristudioCpFoldedFigureEntry) => void;
  setDisplayStyle: (
    figure: OristudioCpFoldedFigureEntry,
    style: OristudioCpFoldedFigureDisplayStyle
  ) => void;
  /**
   * Write part of the figure's model. Without `gesture` the change records an
   * undo entry immediately; with one, it joins the run named by
   * `gesture.scope` — opened by the first change, closed by
   * {@link endModelGesture} — so a continuous control lands as one entry.
   */
  updateModel: (
    figure: OristudioCpFoldedFigureEntry,
    update: Partial<OristudioCpFoldedFigureModel>,
    gesture?: FoldedModelGesture
  ) => void;
  /**
   * Close a run opened through {@link updateModel} or {@link setAppearance}.
   * A no-op if it is not open.
   */
  endModelGesture: (scope: string) => void;
  /** The figure's effective paper style: the app's display style with its pins on top. */
  paperStyle: (figure: OristudioCpFoldedFigureEntry) => PaperStyle;
  /** The app's display style: what a figure shows for a field it does not pin. */
  inheritedPaperStyle: PaperStyle;
  /**
   * Pin one paper-style field on the figure, or clear it with `undefined` so
   * the figure follows the app style for it again. The same gesture protocol
   * as {@link updateModel}: one entry without a gesture, one run with.
   */
  setAppearance: (
    figure: OristudioCpFoldedFigureEntry,
    edit: FoldedAppearanceEdit,
    gesture?: FoldedModelGesture
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
  /** Open the export dialog on the figure on its own. Omitted drops the verb. */
  exportFigure?: (figure: OristudioCpFoldedFigureEntry) => void;
  /**
   * Open the Layer order dialog on the figure (`openFoldedFigureLayerOrder.ts`).
   * Omitted drops the verb, as for a surface that only reads.
   */
  openLayerOrder?: (figure: OristudioCpFoldedFigureEntry) => void;
  /**
   * Act on a 3D figure's verdict: reveal the CAMV issues, select the creases a
   * crossing names, or simulate a figure whose layers could not be ordered.
   * Omitted leaves the notice as a statement with no button — which is the right
   * shape for a surface that only reads.
   */
  runNoticeAction?: (
    figure: OristudioCpFoldedFigureEntry,
    notice: FoldedFigureNotice
  ) => void;
}

/**
 * A figure whose kernel handle and snapshot are both live.
 *
 * A 3D figure carries `folded3d` where a flat one carries `snapshot`, and one
 * of the two is always null — so this asks for either rather than for the flat
 * one, which would report every 3D figure as not ready.
 */
export function isFoldedFigureReady(figure: OristudioCpFoldedFigureEntry): boolean {
  return (
    figure.status === 'ready' &&
    figure.handle !== null &&
    (figure.snapshot !== null || (figure.folded3d ?? null) !== null)
  );
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

function foldedColorOptionId(key: FoldedColorKey): FoldedFigureColorOption['id'] {
  switch (key) {
    case 'front_color':
      return 'front-color';
    case 'back_color':
      return 'back-color';
    case 'line_color':
      return 'line-color';
  }
}

/**
 * The paper-style pins each colour row edits. The front and back are the
 * paper's two sides; the line colour is the edge pen's, pinned whole, and
 * under a mono style the fold pens a 3D figure draws follow it
 * (`edgeInkEdits`).
 */
function foldedColorEdits(
  key: FoldedColorKey,
  style: PaperStyle,
  hex: Hex,
  foldPens: boolean
): FoldedAppearanceEdit[] {
  switch (key) {
    case 'front_color':
      return [{ field: 'paper.front', value: hex }];
    case 'back_color':
      return [{ field: 'paper.back', value: hex }];
    case 'line_color':
      return edgeInkEdits(style, hex, foldPens);
  }
}

function foldedColorValue(key: FoldedColorKey, style: PaperStyle): string {
  switch (key) {
    case 'front_color':
      return style.paper.front;
    case 'back_color':
      return style.paper.back;
    case 'line_color':
      return style.edges.color;
  }
}

/**
 * The figure's Style group: render style, side, the three colours, then the
 * flat figure's shadow or the 3D figure's light, and the existing-crease
 * toggle.
 *
 * The colours are the figure's effective paper style and a change pins that
 * field on the figure; the shadow is the flat figure's own Oriedita model
 * field, and the light and the existing-crease toggle are the style's,
 * offered where the surface's policy applies them (`PAPER_STYLE_POLICIES`).
 * Switching either back to the app style's value clears the figure's pin
 * rather than pinning a copy of it, as the Properties sheet's switches do
 * (`ToggleRow`): a pin that only agrees with the app would leave that row
 * "Overridden" with no one-click way back. The aux pen and erode are numbers
 * a menu has no row for; the Properties sheet has them.
 *
 * Gated in two layers. The whole group waits on `ready`, like every other
 * kernel-backed verb; the model rows additionally ask `foldedAppearanceEnabled`
 * whether their option does anything on this kind of figure, and a row it
 * declines stays visible, disabled, with the reason as its hint — a control
 * that vanished between figure kinds would read as a bug, and one that is
 * enabled and inert is worse. An option that is not a control on the kind at
 * all (`not-applicable`) is not offered.
 */
export function foldedFigureStyleGroup(
  figure: OristudioCpFoldedFigureEntry,
  deps: FoldedFigureActionDeps
): FoldedFigureGroup {
  const { t } = deps;
  const ready = isFoldedFigureReady(figure);
  const capabilities = foldedFigureCapabilities(figure);
  const model = foldedFigureModel(figure);
  const modelReady = ready && capabilities.editModel;
  const enabled = (option: Parameters<typeof foldedAppearanceEnabled>[1]) =>
    modelReady && foldedAppearanceEnabled(figure, option);
  const sideEnabled = enabled('side');
  const shadowEnabled = enabled('shadow');
  const colorLabel = t('panels:creasePattern.changeFoldedColor', 'Change folded model color');
  const style = deps.paperStyle(figure);
  const inherited = deps.inheritedPaperStyle;
  const policy = PAPER_STYLE_POLICIES[isFolded3dFigure(figure) ? 'folded-3d' : 'folded-flat'];

  return {
    kind: 'group',
    id: 'style',
    label: t('panels:foldedFigureActions.style', 'Style'),
    icon: 'style',
    disabled: !ready,
    items: [
      {
        kind: 'choice',
        id: 'display-style',
        label: t('panels:foldedFigureActions.renderAs', 'Render as'),
        icon: 'display-style',
        disabled: !ready,
        exclusive: true,
        options: capabilities.styleChoices.map((value) => ({
          id: `display-style-${value}`,
          label: foldedDisplayStyleChoiceLabel(t, value),
          checked: value === figure.displayStyle,
          run: () => deps.setDisplayStyle(figure, value),
        })),
      },
      {
        kind: 'choice',
        id: 'side',
        label: t('panels:foldedFigureActions.side', 'Side'),
        icon: 'side',
        disabled: !sideEnabled,
        // A 3D figure's side is wherever the eye is: `model.state` only seeds
        // the camera a fresh fold opens at, and "Other side" is the verb that
        // moves it — so a state write here would change nothing on screen.
        hint: sideEnabled
          ? undefined
          : t('panels:foldedFigureActions.sideUnsupported3d', 'Turn a 3D model with Other side'),
        exclusive: true,
        options: FOLDED_FIGURE_SIDES.map((value) => ({
          id: `side-${value}`,
          label: foldedStateLabel(t, value),
          // Nothing current while the control is inert, and nothing current for
          // a figure loaded in an overlay state the UI does not offer.
          checked: sideEnabled && model?.state === value,
          run: () => deps.updateModel(figure, { state: value }),
        })),
      },
      { kind: 'separator', id: 'before-colors' },
      ...FOLDED_COLOR_FIELDS.map((field): FoldedFigureColorOption => {
        const scope = `folded-color:${figure.id}:${field.key}`;
        return {
          kind: 'color',
          id: foldedColorOptionId(field.key),
          label: foldedColorLabel(t, field.key),
          value: foldedColorValue(field.key, style),
          disabled: !modelReady,
          set: (hex) => {
            const foldPens = policyApplies(policy, 'mountainFolds');
            for (const edit of foldedColorEdits(field.key, style, hex, foldPens)) {
              deps.setAppearance(figure, edit, { scope, label: colorLabel });
            }
          },
          commit: () => deps.endModelGesture(scope),
        };
      }),
      ...(foldedAppearanceVisible(figure, 'shadow')
        ? [
            { kind: 'separator', id: 'before-shadow' } as const,
            {
              kind: 'toggle',
              id: 'shadow',
              label: t('panels:creasePattern.shadow', 'Shadow'),
              checked: model?.display_shadows ?? false,
              disabled: !shadowEnabled,
              toggle: () =>
                deps.updateModel(figure, { display_shadows: !(model?.display_shadows ?? false) }),
            } as const,
          ]
        : []),
      ...(policyApplies(policy, 'light')
        ? [
            { kind: 'separator', id: 'before-light' } as const,
            {
              kind: 'toggle',
              id: 'light',
              label: t('panels:simulatorViewControls.lighting', 'Lighting'),
              checked: style.light.enabled,
              disabled: !modelReady,
              toggle: () => {
                const on = !style.light.enabled;
                deps.setAppearance(figure, {
                  field: 'light',
                  value:
                    on === inherited.light.enabled ? undefined : { ...style.light, enabled: on },
                });
              },
            } as const,
          ]
        : []),
      ...(policyApplies(policy, 'auxCreases.visible')
        ? [
            { kind: 'separator', id: 'before-aux' } as const,
            {
              kind: 'toggle',
              id: 'aux',
              label: t('panels:cpProperties.paperStyle.auxVisible', 'Auxiliary creases'),
              checked: style.auxCreases.visible,
              disabled: !modelReady,
              toggle: () => {
                const on = !style.auxCreases.visible;
                deps.setAppearance(figure, {
                  field: 'auxCreases.visible',
                  value: on === inherited.auxCreases.visible ? undefined : on,
                });
              },
            } as const,
          ]
        : []),
    ],
  };
}

/**
 * Build the ordered action list for `figure`.
 *
 * Order is frequency-first, grouped by intent, destructive last — matching the
 * convention `AnnotationActions` sets for the image and text toolbars:
 * look (flip, style) → solution (another, refold) → manage (duplicate, delete).
 * The Style group is one slot on the bar and one submenu in the menu; what it
 * holds is {@link foldedFigureStyleGroup}'s to decide.
 */
export function buildFoldedFigureActions(
  figure: OristudioCpFoldedFigureEntry,
  deps: FoldedFigureActionDeps
): FoldedFigureAction[] {
  const { t } = deps;
  const ready = isFoldedFigureReady(figure);
  const canRefold = deps.refold !== undefined && deps.isStale?.(figure) === true;
  const capabilities = foldedFigureCapabilities(figure);
  const notice = foldedFigureNotice(t, figure);

  const actions: FoldedFigureAction[] = [];

  // The verdict leads: what is wrong with a figure outranks what can be done to
  // it. Silent on a flat figure and on a 3D one that folded cleanly.
  if (notice) {
    const runNoticeAction = deps.runNoticeAction;
    actions.push(
      {
        kind: 'note',
        id: 'notice',
        notice,
        icon: notice.tone === 'error' ? 'notice-error' : 'notice-warn',
        run:
          notice.action && runNoticeAction ? () => runNoticeAction(figure, notice) : null,
      },
      { kind: 'separator', id: 'after-notice' }
    );
  }

  // One verb, two mechanisms, and the label says which. A flat figure turns the
  // paper over (Front <-> Back, the viewport toolbar's "Side" control — see
  // flipFoldedState); a 3D figure moves the eye to the antipodal camera, because
  // in three dimensions the other side of the paper is somewhere to stand.
  if (capabilities.flip) {
    actions.push({
      kind: 'command',
      id: 'flip',
      label: isFolded3dFigure(figure)
        ? t('panels:foldedFigureActions.otherSide', 'Other side')
        : t('panels:foldedFigureActions.flip', 'Flip'),
      icon: 'flip',
      disabled: !ready,
      run: () => deps.flip(figure),
    });
  }

  // Only a 3D figure has a viewpoint to lose. Orbit can leave the model edge-on
  // or facing away with nothing on screen to say how you got there, and
  // "Other side" is a half-turn from wherever you are rather than a way back —
  // so this is the one action that always recovers a legible view.
  if (isFolded3dFigure(figure)) {
    actions.push({
      kind: 'command',
      id: 'reset-view',
      label: t('panels:foldedFigureActions.resetView', 'Reset view'),
      icon: 'reset-view',
      disabled: !ready,
      run: () => deps.resetView(figure),
    });
    // Which way the model is up, as a verb rather than something the projection
    // decides. Both surfaces orbit as a turntable about the paper's *normal*,
    // which is up for a flat sheet and is not for a model that stands — so a
    // standing figure tumbles instead of turning, and no amount of dragging
    // fixes it because yaw and pitch only move the eye on a sphere whose pole is
    // fixed. This picks the pole.
    actions.push({
      kind: 'command',
      id: 'set-upright',
      label: t('panels:foldedFigureActions.setUpright', 'Set upright'),
      icon: 'set-upright',
      disabled: !ready,
      run: () => deps.setUpright(figure),
    });
  }

  actions.push(
    foldedFigureStyleGroup(figure, deps),
    { kind: 'separator', id: 'after-appearance' },
    anotherSolutionCommand(figure, deps)
  );
  // Right after Another solution, the other way to choose which layer order
  // shows: the toolbar and the menu both get it from here.
  const layerOrder = layerOrderCommand(figure, deps);
  if (layerOrder) actions.push(layerOrder);

  // Refold is present only when it applies: a figure that matches its source
  // creases has nothing to refold, and a disabled button would just be noise.
  // A chosen layer order refolds with it (H4); a newer build's holds it.
  if (canRefold) {
    const held = refoldHeldByLayerOrder(figure);
    actions.push({
      kind: 'command',
      id: 'refold',
      label: t('panels:foldedFigureActions.refold', 'Refold'),
      icon: 'refold',
      disabled: held,
      ...(held ? { hint: refoldHeldByLayerOrderReason(t) } : {}),
      run: () => deps.refold?.(figure),
    });
  }

  const header = foldedFigureHeaderCommands(figure, deps);
  const exportCommand = header.find((command) => command.id === 'export');
  if (exportCommand) actions.push({ kind: 'separator', id: 'before-export' }, exportCommand);
  actions.push(
    { kind: 'separator', id: 'before-manage' },
    ...header.filter((command) => command.id !== 'export')
  );

  return actions;
}

/** What the figure's solution verbs call, and nothing else. */
export interface FoldedFigureSolutionDeps {
  t: TFunction;
  foldAnother: (figure: OristudioCpFoldedFigureEntry) => void;
  /** Back one layer order, by fold case. */
  foldPrevious: (figure: OristudioCpFoldedFigureEntry) => void;
  /** Whether the figure's source creases have changed since it was folded: a constrained figure waits then (H4). */
  isStale?: (figure: OristudioCpFoldedFigureEntry) => boolean;
}

/**
 * On to the next layer order: Another solution, the one solution verb the
 * toolbar and menu offer. At the end of the enumeration the kernel wraps to
 * the first rather than dead-ending, so the label says which the press will
 * do. On a constrained figure it steps through the solutions that fit
 * instead ({@link constrainedSolutionCommand}).
 */
export function anotherSolutionCommand(
  figure: OristudioCpFoldedFigureEntry,
  deps: Pick<FoldedFigureSolutionDeps, 't' | 'foldAnother' | 'isStale'>
): FoldedFigureCommand {
  const { t } = deps;
  const hold = foldedFigureLayerOrderHold(figure);
  if (hold === 'record') return constrainedSolutionCommand(figure, anotherSolutionVerb(figure, deps), 'next', deps);
  if (hold === 'newer') return heldByNewerBuild(anotherSolutionVerb(figure, deps), t);
  const { hasNext, wrapsToFirst } = foldedFigureCycling(figure);
  // Disabled only with nowhere to go: a single-solution fold, where wrapping
  // would land exactly where it started.
  const single = !hasNext && !wrapsToFirst;
  return {
    kind: 'command',
    id: 'another',
    label: wrapsToFirst
      ? t('panels:foldedFigureActions.firstSolution', 'Back to first solution')
      : t('panels:foldedFigureActions.anotherSolution', 'Another solution'),
    icon: wrapsToFirst ? 'first-solution' : 'another',
    disabled: !isFoldedFigureReady(figure) || single,
    ...(single ? { hint: t('panels:foldedFigureActions.onlySolution', 'This figure has one solution') } : {}),
    run: () => deps.foldAnother(figure),
  };
}

/** Another solution as a constrained figure offers it, before saying whether it can. */
function anotherSolutionVerb(
  figure: OristudioCpFoldedFigureEntry,
  deps: Pick<FoldedFigureSolutionDeps, 't' | 'foldAnother'>
): FoldedFigureCommand {
  return {
    kind: 'command',
    id: 'another',
    label: deps.t('panels:foldedFigureActions.anotherSolution', 'Another solution'),
    icon: 'another',
    disabled: false,
    run: () => deps.foldAnother(figure),
  };
}

/** Previous solution as a constrained figure offers it, before saying whether it can. */
function previousSolutionVerb(
  figure: OristudioCpFoldedFigureEntry,
  deps: Pick<FoldedFigureSolutionDeps, 't' | 'foldPrevious'>
): FoldedFigureCommand {
  return {
    kind: 'command',
    id: 'previous',
    label: deps.t('panels:foldedFigureActions.previousSolution', 'Previous solution'),
    icon: 'previous',
    disabled: false,
    run: () => deps.foldPrevious(figure),
  };
}

/** A newer build's order is that build's to step: held, saying so. */
function heldByNewerBuild(verb: FoldedFigureCommand, t: TFunction): FoldedFigureCommand {
  return {
    ...verb,
    disabled: true,
    hint: t('panels:foldedFigureActions.layerOrderNewer', 'Made with a newer Ori Studio: its layer constraints can’t be changed here.'),
  };
}

/**
 * Another solution and ‹ on a constrained figure (H6, D9): they step through
 * the solutions that fit its record, in the stepper's fixed order, on the
 * host engine's cursor (`foldedSolutionCursor.ts`), never through Oriedita's
 * search, which knows nothing of the constraints.
 *
 * Whether they can comes from saved data alone, as "Layer order…"'s does
 * (`foldedFigureLayerOrderBlock`): the press makes the cursor, folding a
 * figure reopened from a file as it steps. Where the order shown lies is
 * known only once a press has answered ({@link foldedSolutionPlace}); then
 * each waits at its end of the solutions, which a stepper through a fixed
 * order has, rather than wrapping round: ‹ on the first, › on the last once
 * the count is final.
 */
function constrainedSolutionCommand(
  figure: OristudioCpFoldedFigureEntry,
  verb: FoldedFigureCommand,
  direction: 'next' | 'previous',
  deps: Pick<FoldedFigureSolutionDeps, 't' | 'isStale'>
): FoldedFigureCommand {
  const { t } = deps;
  const block = foldedFigureLayerOrderBlock(figure);
  if (block !== null) {
    const hint = layerOrderBlockHint(block, t);
    return { ...verb, disabled: true, ...(hint ? { hint } : {}) };
  }
  // Its constraints need a look since an edit (D14): nothing to step through until they are reviewed.
  if (foldedFigureSolutionsHeldForReview(figure)) {
    // An order chosen with no constraint has none to review: the order itself (D16).
    const hint =
      (foldedFigureLayerOrderRecord(figure)?.constraints.length ?? 0) === 0
        ? t('panels:foldedFigureActions.layerOrderReviewChosenFirst', 'Review the chosen layer order first')
        : t('panels:foldedFigureActions.layerOrderReviewFirst', 'Review the layer constraints that need attention first');
    return { ...verb, disabled: true, hint };
  }
  // Its creases changed since it was folded: the solutions of its fold are not theirs. Refold
  // keeps its record (H4), and the dialog opens on them as they are now (D12).
  if (deps.isStale?.(figure) === true) {
    return {
      ...verb,
      disabled: true,
      hint: t('panels:foldedFigureActions.layerOrderCreasesChanged', 'Its creases changed since it was folded'),
    };
  }
  const place = foldedSolutionPlace(figure);
  if (!place) return verb;
  // Every host's stepper waits at the same ends (`solutionCursorTable.ts`), a way a step proved to end
  // (E9) among them, whatever the count says.
  const ends = solutionPlaceEnds(place);
  if (direction === 'previous') {
    return ends.first
      ? { ...verb, disabled: true, hint: t('panels:foldedFigureActions.firstSolutionShown', 'This is its first solution') }
      : verb;
  }
  if (!ends.last) return verb;
  return {
    ...verb,
    disabled: true,
    hint: ends.only
      ? t('panels:foldedFigureActions.onlySolution', 'This figure has one solution')
      : t('panels:foldedFigureActions.lastSolutionShown', 'This is its last solution'),
  };
}

/** What the Layer order verb calls. */
export type FoldedFigureLayerOrderDeps = Pick<FoldedFigureActionDeps, 't' | 'openLayerOrder'>;

/**
 * "Layer order…": open the dialog on the figure (row H3). Null when the
 * surface offers no way to open it. Disabled, with why, from saved data only
 * (`foldedFigureLayerOrderBlock`): a 3D figure (D13), one whose fold found no
 * layer order (D3), a newer build's record, or no source to fold; and with
 * no reason while the figure is folding, as every verb waits. A figure
 * reopened from a file has no live fold and stays enabled: the press folds it
 * again first. So does one whose creases changed since its fold: the dialog
 * opens on them as they are now, and its Apply also refolds (D12).
 *
 * Drawn as its word: no glyph says "layer order" (Layers already means
 * Render as, Precreases and Spread), so the toolbar shows the label and the
 * menu a row with no icon.
 */
export function layerOrderCommand(
  figure: OristudioCpFoldedFigureEntry,
  deps: FoldedFigureLayerOrderDeps
): FoldedFigureCommand | null {
  const { t, openLayerOrder } = deps;
  if (!openLayerOrder) return null;
  const block = foldedFigureLayerOrderBlock(figure);
  const hint = block === '3d' ? layerOrder3dHint(figure, t) : block ? layerOrderBlockHint(block, t) : null;
  return {
    kind: 'command',
    id: 'layer-order',
    label: t('panels:foldedFigureActions.layerOrder', 'Layer order…'),
    icon: 'layer-order',
    disabled: block !== null,
    ...(hint ? { hint } : {}),
    run: () => openLayerOrder(figure),
  };
}

/**
 * Why "Layer order…" waits on a 3D figure, in the States board's words for
 * its 3D lock: and, when it keeps a chosen order, that its constraints are
 * kept for when it folds flat again (D13).
 */
function layerOrder3dHint(figure: OristudioCpFoldedFigureEntry, t: TFunction): string {
  const record = foldedFigureLayerOrderRecord(figure);
  if (!record) return t('panels:foldedFigureActions.layerOrder3d', 'Layer order works on flat figures');
  if (record.constraints.length === 0) {
    return t(
      'panels:foldedFigureActions.layerOrder3dChosenKept',
      'Layer order works on flat figures. Its chosen layer order is kept for when it folds flat again.'
    );
  }
  return t('panels:foldedFigureActions.layerOrder3dKept', {
    count: record.constraints.length,
    defaultValue_one: 'Layer order works on flat figures. Its layer constraint is kept for when it folds flat again.',
    defaultValue_other: 'Layer order works on flat figures. Its {{count}} layer constraints are kept for when it folds flat again.',
  });
}

/** Why "Layer order…" waits, as its hint; null while the figure is folding, which says nothing. */
export function layerOrderBlockHint(block: FoldedFigureLayerOrderBlock, t: TFunction): string | null {
  switch (block) {
    case '3d':
      return t('panels:foldedFigureActions.layerOrder3d', 'Layer order works on flat figures');
    case 'waiting':
      return null;
    case 'undetermined':
      return t('panels:cpProperties.folded.layerOrderUndetermined', 'Layer order couldn’t be determined for this figure.');
    case 'newer':
      return t('panels:foldedFigureActions.layerOrderNewer', 'Made with a newer Ori Studio: its layer constraints can’t be changed here.');
    case 'no-source':
      return t('panels:foldedFigureActions.layerOrderNoSource', 'This folded model has no source creases to work from');
  }
}

/**
 * Back to the layer order before, by fold case: the kernel restarts the
 * enumeration and replays it to that one (`folding_estimate_to_case`), the way
 * the Diagram's ‹ goes back. Not Oriedita's — upstream only goes forward — and
 * not the toolbar's: the Properties pane's Layer order row offers it beside
 * Another solution. A 3D figure has no numbered solutions to go back to
 * (`foldedFigureCapabilities.foldToCase`). On a constrained figure it steps
 * back through the solutions that fit ({@link constrainedSolutionCommand}).
 */
export function previousSolutionCommand(
  figure: OristudioCpFoldedFigureEntry,
  deps: Pick<FoldedFigureSolutionDeps, 't' | 'foldPrevious' | 'isStale'>
): FoldedFigureCommand {
  const { t } = deps;
  const hold = foldedFigureLayerOrderHold(figure);
  if (hold === 'record') return constrainedSolutionCommand(figure, previousSolutionVerb(figure, deps), 'previous', deps);
  if (hold === 'newer') return heldByNewerBuild(previousSolutionVerb(figure, deps), t);
  const canGoBack = foldedFigureCapabilities(figure).foldToCase;
  const first = foldedFigureCycling(figure).current <= 1;
  const hint = !canGoBack
    ? t('panels:foldedFigureActions.previousSolution3d', 'Stepping back works on flat figures')
    : first
      ? t('panels:foldedFigureActions.firstSolutionShown', 'This is its first solution')
      : undefined;
  return {
    kind: 'command',
    id: 'previous',
    label: t('panels:foldedFigureActions.previousSolution', 'Previous solution'),
    icon: 'previous',
    disabled: !isFoldedFigureReady(figure) || !canGoBack || first,
    ...(hint ? { hint } : {}),
    run: () => deps.foldPrevious(figure),
  };
}

/** What the figure's header verbs call. */
export type FoldedFigureManageDeps = Pick<
  FoldedFigureActionDeps,
  't' | 'duplicate' | 'remove' | 'exportFigure'
>;

/**
 * The verbs on the figure as a whole — Export… (when the surface can export),
 * Duplicate, Delete — in that order: the toolbar's and menu's last group, and
 * the Properties pane's header.
 */
export function foldedFigureHeaderCommands(
  figure: OristudioCpFoldedFigureEntry,
  deps: FoldedFigureManageDeps
): FoldedFigureCommand[] {
  const { t } = deps;
  const commands: FoldedFigureCommand[] = [];
  if (deps.exportFigure) {
    const exportFigure = deps.exportFigure;
    commands.push({
      kind: 'command',
      id: 'export',
      // One verb: the dialog it opens chooses the format, with the page in view.
      label: t('panels:foldedFigureActions.export', 'Export…'),
      icon: 'export',
      // Exported from the figure's own picture — a 3D figure's scene, a flat
      // figure's render snapshot — so anything on screen can be saved,
      // including a figure whose creases have since moved.
      disabled: figure.renderSnapshot === null && (figure.scene ?? null) === null,
      run: () => exportFigure(figure),
    });
  }
  commands.push(
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
  return commands;
}

/** The flip target for `figure`, exposed so callers can build the model patch. */
export function foldedFigureFlipState(figure: OristudioCpFoldedFigureEntry) {
  return flipFoldedState(figure.snapshot?.model.state ?? 'Front0');
}
