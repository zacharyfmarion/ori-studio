import type { TFunction } from 'i18next';
import type {
  FoldedFigurePlacement,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureState,
} from '../../engine/oristudioCpTypes';
import { FOLDED_FIGURE_SIDES } from '../../lib/foldedFigureSides';
import { frontierSolutions, layerOrderCount, solutionPlaceCount } from '../../lib/layerOrderPlace';
import type {
  PaperStyle,
  PaperStyleField,
  PaperStyleOverrides,
  PaperStyleValue,
} from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, policyApplies } from '../../lib/paper/paperStyleResolve';
import type {
  ControlVerb,
  FieldNote,
  LiveValue,
  PropertyField,
  PropertyNotice,
  PropertySection,
  PropertySheet,
  PropertySupport,
  StepperField,
} from '../../lib/propertyDescriptors';
import { clampSimulatorZoom, SIMULATOR_MAX_ZOOM, SIMULATOR_MIN_ZOOM } from '../../lib/simulatorOrbit';
import { degreesToRadians, radiansToDegrees, wrapDegrees } from '../../lib/angleUnits';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { DEFAULT_FOLDED_3D_CAMERA, type FoldedFigureCamera } from './folded3dCamera';
import {
  anotherSolutionCommand,
  foldedDisplayStyleChoiceLabel,
  foldedFigureHeaderCommands,
  isFoldedFigureReady,
  layerOrderCommand,
  previousSolutionCommand,
} from './foldedFigureActions';
import {
  foldedFigureAwaitsFlatRefold,
  foldedFigureDetachedLayerOrder,
  foldedFigureLayerOrderHold,
  foldedFigureLayerOrderRecord,
} from './foldedFigureLayerOrderState';
import { foldedSolutionPlace } from './foldedSolutionCursor';
import {
  foldedAppearanceSupport,
  foldedAppearanceVisible,
  type FoldedAppearanceOption,
} from './foldedFigureAppearance';
import { foldedFigureCapabilities, isFolded3dFigure } from './foldedFigureCapabilities';
import { foldedColorLabel, foldedStateLabel } from './foldedFigureControlOptions';
import {
  foldedFigureLayerOrderAttentionNotice,
  foldedFigureSubtitle,
  foldedFigureSubtitleTone,
} from './foldedFigureNotice';
import {
  foldedFigureCurrentCase,
  foldedFigureFrontier,
  foldedFigureHasLayerOrder,
  foldedFigureModel,
} from './foldedFigureState';
import type { PaperStyleOverrideEdit } from '../paper/objectPaperStyle';
import { auxAndErodeFields, edgeInkEdits, foldPenFields } from '../paper/paperStyleFields';

export interface FoldedFigurePropertyDeps {
  t: TFunction;
  /** Whether the figure's source creases have changed since it was folded. */
  stale: boolean;
  /** True while another surface holds the folded layer's bracket. */
  held: boolean;
  /** Open the layer's bracket for a continuous field; false when refused. */
  begin(field: string): boolean;
  /** Close the bracket and record `label` once — after the kernel has answered. */
  end(label: string): void;
  /** One discrete model change as one entry. */
  commitModel(patch: Partial<OristudioCpFoldedFigureModel>): void;
  /** The figure's effective paper style: the app's display style with its own pins on top. */
  style: PaperStyle;
  /** The app's display style: what a style row shows once its pin is cleared. */
  inherited: PaperStyle;
  /** Which fields are pinned on this figure, and to what. */
  overrides: PaperStyleOverrides | undefined;
  /** A continuous pin inside an open bracket; the kernel follows through the mirror, records nothing. */
  writeOverride<F extends PaperStyleField>(field: F, value: PaperStyleValue<F>): void;
  /** Discrete pins, or clears with `undefined`, as one entry. */
  commitOverrides(edits: readonly PaperStyleOverrideEdit[]): void;
  setDisplayStyle(style: OristudioCpFoldedFigureDisplayStyle): void;
  /** Move a 3D figure's eye as one entry. Spread the current camera so `orient` survives. */
  setCamera(camera: FoldedFigureCamera): void;
  /** Where the figure is being drawn right now: the orbit frame mid-drag, the stored camera otherwise. */
  liveCamera: LiveValue<FoldedFigureCamera>;
  /** A typed placement edit as one entry, under the canvas gesture's own label. */
  setPlacement(patch: Partial<FoldedFigurePlacement>, label: string): void;
  /** On to the next layer order, as the toolbar's Another solution (`foldedFigureVerbs.ts`). */
  foldAnother(figure: OristudioCpFoldedFigureEntry): void;
  /** Back one layer order, by fold case. */
  foldPrevious(figure: OristudioCpFoldedFigureEntry): void;
  /** The header's verbs, as the toolbar binds them. */
  exportFigure(figure: OristudioCpFoldedFigureEntry): void;
  duplicate(figure: OristudioCpFoldedFigureEntry): void;
  remove(figure: OristudioCpFoldedFigureEntry): void;
  /** The Layer order row's Edit…: the toolbar's Layer order… (`openFoldedFigureLayerOrder.ts`). */
  openLayerOrder(figure: OristudioCpFoldedFigureEntry): void;
  /** The Pose section's flag's Review…: the dialog on the rows that need attention (D14). */
  reviewLayerOrder(figure: OristudioCpFoldedFigureEntry): void;
  /** Beside Review… on constraints a reload found detached: let them go, as one entry. */
  dismissDetachedLayerOrder(figure: OristudioCpFoldedFigureEntry): void;
}

/**
 * The properties of a folded figure, laid out as the Diagram's Step pane
 * (the approved Properties board, A4): the figure's verbs in the header
 * (Export…, Duplicate, Delete — the toolbar's last group, from the catalog),
 * Render as over a control across the pane, then Pose (a flat figure's
 * Rotation, its Side, and its Layer order: ‹ where it stands ›), Camera on a
 * 3D figure, Appearance (what the kernel or the canvas draws) and Placement
 * (where it sits on the paper; a 3D figure's Rotation stays here, since its
 * pose is its camera). The title is the figure's own and the subtitle a state
 * — stale, folding, failed, a 3D verdict — context, not a field; which layer
 * order it shows is the Layer order row's.
 *
 * The Layer order row's › is the toolbar's Another solution and its ‹ the
 * catalog's Previous solution (`previousSolutionCommand`); between them,
 * where it stands as the Diagram reads it (`layerOrderCount`), from the
 * search's frontier the figure keeps. A figure whose fold found no layer
 * order has none to step through, and says so under the row's label.
 *
 * The colours and, on a 3D figure, the light are the figure's *paper style*:
 * the surface policy's fields (`PAPER_STYLE_POLICIES`) with their effective
 * values, where a row edits the figure's own pin on that field and offers
 * `reset` only while pinned — the affordance's absence says the row is still
 * following the app style. The kernel model's colours follow through the
 * paper-style mirror. Side and the flat figure's shadow stay model fields.
 *
 * Support per field comes from the kind's own oracle, `foldedAppearanceSupport`,
 * so a control that would render enabled-and-inert on a 3D figure is a
 * catalog bug a pure test catches; an option that is not a control on the
 * kind at all is left out. A figure that is not ready — reopened from a file,
 * still folding, failed — has nothing to draw with, so every appearance field
 * is offered disabled with the reason; Refold itself is a verb on the floating
 * toolbar.
 *
 * Never wired: `model.scale` / `model.rotation` (Oriedita's own display
 * transform; the placement is ours and the canvas handles drive it),
 * `transparent_transparency`, the title, the starting face. Not here because
 * they are verbs the toolbar keeps: flip / other side, reset view as a whole,
 * set upright, refold.
 */
export function buildFoldedFigureProperties(
  target: TargetOf<'folded-figure'>,
  deps: FoldedFigurePropertyDeps
): PropertySheet {
  const { t } = deps;
  const figure = target.figure;
  const ready = isFoldedFigureReady(figure);
  const spatial = isFolded3dFigure(figure);
  const model = foldedFigureModel(figure);
  const notReady = t(
    'panels:cpProperties.folded.refoldToChange',
    'Refold to change how this figure looks'
  );
  const changeModel = t('panels:creasePattern.changeFoldedModel', 'Change folded model');
  const changeView = t('panels:cpProperties.folded.changeView', 'Change folded model view');

  /** The oracle's answer for an appearance option, with readiness laid over it. */
  const appearance = (
    option: FoldedAppearanceOption
  ): { support: PropertySupport; reason?: string } => {
    const support = foldedAppearanceSupport(figure, option);
    if (support === 'not-applicable') return { support };
    if (!ready) return { support: 'unsupported', reason: notReady };
    if (support === 'unsupported') {
      return { support, reason: unsupportedReason(option) ?? notReady };
    }
    return { support };
  };
  /** Why an option the oracle declines is inert on this figure — the Style menu's hints, word for word. */
  const unsupportedReason = (option: FoldedAppearanceOption): string | null => {
    switch (option) {
      case 'side':
        return t('panels:foldedFigureActions.sideUnsupported3d', 'Turn a 3D model with Other side');
      default:
        return null;
    }
  };

  const { style, overrides, held } = deps;
  const policy = PAPER_STYLE_POLICIES[spatial ? 'folded-3d' : 'folded-flat'];
  /** A style row's support: only readiness gates it, as for every appearance row. */
  const styleSupport = ready
    ? { support: 'supported' as const }
    : { support: 'unsupported' as const, reason: notReady };
  const changeStyle = t('panels:cpProperties.paperStyle.changeAction', 'Change paper style');
  const pinned = (field: PaperStyleField) => overrides?.[field] !== undefined;
  const resetOf = (field: PaperStyleField) =>
    pinned(field)
      ? { reset: () => deps.commitOverrides([{ field, value: undefined } as PaperStyleOverrideEdit]) }
      : {};
  /** A colour row over one style field: effective value, pin on change, reset while pinned. */
  const styleColor = (
    option: FoldedAppearanceOption,
    key: 'front_color' | 'back_color' | 'line_color',
    field: 'paper.front' | 'paper.back' | 'edges',
    value: string,
    pin: (hex: string) => void
  ): PropertyField => ({
    id: option,
    kind: 'color',
    label: foldedColorLabel(t, key),
    ...appearance(option),
    undoLabel: changeStyle,
    protocol: 'continuous',
    value,
    begin: () => deps.begin(option),
    update: pin,
    end: () => deps.end(changeStyle),
    held,
    ...resetOf(field),
  });

  const styleChoices = foldedFigureCapabilities(figure).styleChoices;
  const renderAs: PropertyField = {
    id: 'displayStyle',
    kind: 'segmented',
    // Over a control across the pane, as the Step pane's Show as: the three
    // choices are too wide to sit beside their label in a narrow pane.
    layout: 'stacked',
    label: t('panels:foldedFigureActions.renderAs', 'Render as'),
    ...appearance('displayStyle'),
    undoLabel: t('panels:creasePattern.changeFoldedDisplayStyle', 'Change folded display style'),
    // The kind's own choices, as the Style menu offers them; a legacy style
    // a file carries shows nothing chosen, and picking any is the way out.
    options: styleChoices.map((choice) => ({
      id: choice,
      label: foldedDisplayStyleChoiceLabel(t, choice),
    })),
    protocol: 'discrete',
    value: figure.displayStyle,
    commit: (next) => {
      if (next !== null) deps.setDisplayStyle(next as OristudioCpFoldedFigureDisplayStyle);
    },
  };
  const side: PropertyField = {
    id: 'side',
    kind: 'segmented',
    label: t('panels:foldedFigureActions.side', 'Side'),
    ...appearance('side'),
    undoLabel: changeModel,
    options: FOLDED_FIGURE_SIDES.map((value) => ({ id: value, label: foldedStateLabel(t, value) })),
    protocol: 'discrete',
    // The kernel's full state, not just the two offered sides: a figure
    // loaded from Oriedita in an overlay state marks neither side current.
    value:
      model && (FOLDED_FIGURE_SIDES as readonly string[]).includes(model.state)
        ? model.state
        : null,
    commit: (next) => {
      if (next !== null) deps.commitModel({ state: next as OristudioCpFoldedFigureState });
    },
  };

  const appearanceFields: PropertyField[] = [
    styleColor('frontColor', 'front_color', 'paper.front', style.paper.front, (hex) =>
      deps.writeOverride('paper.front', hex)
    ),
    styleColor('backColor', 'back_color', 'paper.back', style.paper.back, (hex) =>
      deps.writeOverride('paper.back', hex)
    ),
    // A pen is pinned whole, so the line colour copies the effective edge pen
    // and changes its colour, and under a mono style the fold pens a 3D figure
    // draws follow it (`edgeInkEdits`); its reset clears the whole pen.
    styleColor('lineColor', 'line_color', 'edges', style.edges.color, (hex) => {
      for (const pin of edgeInkEdits(style, hex, policyApplies(policy, 'mountainFolds'))) {
        deps.writeOverride(pin.field, pin.value);
      }
    }),
    ...(foldedAppearanceVisible(figure, 'shadow')
      ? [
          {
            id: 'shadows',
            kind: 'toggle',
            label: t('panels:creasePattern.shadow', 'Shadow'),
            ...appearance('shadow'),
            undoLabel: changeModel,
            protocol: 'discrete',
            value: model?.display_shadows ?? false,
            commit: (display_shadows) => deps.commitModel({ display_shadows }),
          } satisfies PropertyField,
        ]
      : []),
    // A 3D figure draws its folds as the simulator does — M/V pens by fold
    // sign — so it offers the simulator's controls for them (Phase 5); the
    // flat figure has no visible M/V and its policy leaves them out (D6).
    ...(policyApplies(policy, 'mountainFolds')
      ? foldPenFields({ ...deps, support: styleSupport })
      : []),
    ...(policyApplies(policy, 'light')
      ? [
          {
            id: 'lighting',
            kind: 'toggle',
            label: t('panels:simulatorViewControls.lighting', 'Lighting'),
            // A style field rather than a model option, so the oracle has no
            // say; only readiness gates it, as for every appearance row.
            ...styleSupport,
            undoLabel: changeStyle,
            protocol: 'discrete',
            value: style.light.enabled,
            inherited: deps.inherited.light.enabled,
            commit: (enabled) =>
              deps.commitOverrides([{ field: 'light', value: { ...style.light, enabled } }]),
            ...resetOf('light'),
          } satisfies PropertyField,
        ]
      : []),
    // Every surface's policy applies these since Phase 5; the flat figure's
    // aux creases are the document's own carried through the fold, the 3D
    // figure's its 0° folds.
    ...auxAndErodeFields({ ...deps, support: styleSupport }),
  ];

  const rotation: PropertyField = {
    id: 'rotation',
    kind: 'number',
    label: t('panels:cpProperties.folded.rotation', 'Rotation'),
    support: 'supported',
    undoLabel: t('panels:creasePattern.rotateFoldedForm', 'Rotate folded form'),
    step: 1,
    suffix: '°',
    normalize: wrapDegrees,
    protocol: 'draft',
    value: radiansToDegrees(figure.placement.rotation),
    commit: (degrees) =>
      deps.setPlacement(
        { rotation: degreesToRadians(degrees) },
        t('panels:creasePattern.rotateFoldedForm', 'Rotate folded form')
      ),
  };

  const sections: PropertySection[] = [
    // Untitled, so the sheet's plain body: Render as heads the pane, over
    // everything it changes, as Show as heads the Step pane.
    { id: 'render', fields: [renderAs] },
    {
      id: 'pose',
      title: t('panels:cpProperties.folded.pose', 'Pose'),
      spaced: true,
      // A flat figure's turn is its pose; a 3D figure's pose is its camera,
      // and its turn on the page stays with where it sits (Placement).
      fields: spatial ? [side, layerOrderField(figure, deps)] : [rotation, side, layerOrderField(figure, deps)],
      // Under the Layer order row, while its constraints need a look.
      notice: layerOrderAttentionNotice(figure, deps),
    },
  ];

  if (spatial) {
    // The camera rows read the live orbit while a drag turns the figure and the
    // stored camera otherwise, and each writes back over the *current* camera
    // so `orient` — which way the model is up — survives a yaw edit. A reset
    // is per axis: the fold's view for that one number, everything else kept.
    const current = () => deps.liveCamera.read();
    const angle = (axis: 'yaw' | 'pitch', label: string): PropertyField => ({
      id: axis,
      kind: 'number',
      label,
      support: 'supported',
      undoLabel: changeView,
      step: 1,
      suffix: '°',
      normalize: wrapDegrees,
      live: {
        read: () => radiansToDegrees(current()[axis]),
        subscribe: deps.liveCamera.subscribe,
      },
      protocol: 'draft',
      value: radiansToDegrees(current()[axis]),
      commit: (degrees) => deps.setCamera({ ...current(), [axis]: degreesToRadians(degrees) }),
      reset: () => deps.setCamera({ ...current(), [axis]: DEFAULT_FOLDED_3D_CAMERA[axis] }),
    });
    sections.push({
      id: 'camera',
      title: t('panels:cpProperties.folded.camera', 'Camera'),
      fields: [
        angle('yaw', t('panels:cpProperties.folded.yaw', 'Turn')),
        angle('pitch', t('panels:cpProperties.folded.pitch', 'Tilt')),
        {
          id: 'zoom',
          kind: 'number',
          label: t('panels:cpProperties.folded.zoom', 'Zoom'),
          support: 'supported',
          undoLabel: changeView,
          min: SIMULATOR_MIN_ZOOM,
          max: SIMULATOR_MAX_ZOOM,
          step: 0.05,
          normalize: clampSimulatorZoom,
          live: { read: () => current().zoom, subscribe: deps.liveCamera.subscribe },
          protocol: 'draft',
          value: current().zoom,
          commit: (zoom) => deps.setCamera({ ...current(), zoom: clampSimulatorZoom(zoom) }),
          reset: () => deps.setCamera({ ...current(), zoom: DEFAULT_FOLDED_3D_CAMERA.zoom }),
        },
      ],
    });
  }

  sections.push(
    {
      id: 'appearance',
      title: t('panels:cpProperties.folded.appearance', 'Appearance'),
      fields: appearanceFields,
    },
    {
      id: 'placement',
      title: t('panels:cpProperties.folded.placement', 'Placement'),
      fields: [
        {
          id: 'scale',
          kind: 'number',
          label: t('panels:cpProperties.folded.scale', 'Scale'),
          support: 'supported',
          undoLabel: t('panels:creasePattern.resizeFoldedForm', 'Resize folded form'),
          min: 0.05,
          step: 0.05,
          normalize: (scale) => Math.max(0.05, scale),
          protocol: 'draft',
          value: figure.placement.scale,
          commit: (scale) =>
            deps.setPlacement(
              { scale: Math.max(0.05, scale) },
              t('panels:creasePattern.resizeFoldedForm', 'Resize folded form')
            ),
        },
        ...(spatial ? [rotation] : []),
      ],
    }
  );

  return {
    kind: 'folded-figure',
    targetId: figure.id,
    title: figure.title,
    subtitle: foldedFigureSubtitle(t, figure, deps.stale),
    subtitleTone: foldedFigureSubtitleTone(figure),
    icon: 'folded-figure',
    // The toolbar's last group, from the same catalog and as it is: what is
    // done to the figure as a whole, at the header's end as the Step pane has
    // its step's.
    actions: foldedFigureHeaderCommands(figure, deps),
    sections,
  };
}

/**
 * The Layer order row: ‹ where it stands ›. The verbs are the catalog's —
 * Another solution, as the toolbar has it, and Previous solution — and the
 * readout the Diagram's, from the search's frontier the figure keeps, so a
 * step back never shrinks what it says was found. A figure whose fold found
 * no layer order has nothing to step through: the row says why, under its
 * label. Before the figure is ready, the row waits as the appearance does.
 *
 * On a constrained figure the verbs step through the solutions that fit its
 * record (H6) and the readout is where the cursor they step with stands
 * ({@link constrainedSolutionReadout}); before the first press there is no
 * cursor, and the row says only what the record says, on its note (D11).
 */
function layerOrderField(
  figure: OristudioCpFoldedFigureEntry,
  deps: FoldedFigurePropertyDeps
): StepperField {
  const { t } = deps;
  // Unknown while the first fold runs or after it failed: nothing to read out.
  const found = foldedFigureHasLayerOrder(figure);
  const none = found === false;
  const held = foldedFigureLayerOrderHold(figure);
  const readout =
    found === null || held === 'newer'
      ? ''
      : held === 'record'
        ? constrainedSolutionReadout(figure, t)
        : layerOrderCount(
            foldedFigureCurrentCase(figure),
            none
              ? { discovered: 0, hasNext: false, none: true }
              : frontierSolutions(foldedFigureFrontier(figure)),
            t
          );
  const row = {
    id: 'layerOrder',
    kind: 'stepper',
    label: t('panels:cpProperties.folded.layerOrder', 'Layer order'),
    protocol: 'stepped',
    readout,
  } as const;
  const solutionDeps = { ...deps, isStale: () => deps.stale };
  const previous = previousSolutionCommand(figure, solutionDeps);
  const next = anotherSolutionCommand(figure, solutionDeps);
  // The toolbar's Layer order…, as the row's Edit… after the pager.
  const layerOrder = layerOrderCommand(figure, { t, openLayerOrder: deps.openLayerOrder });
  const action = layerOrder
    ? { ...layerOrder, label: t('panels:cpProperties.folded.layerOrderEdit', 'Edit…') }
    : undefined;
  const note = layerOrderNote(figure, t);

  // A step, a refold or a duplicate is folding: the row stays as it is, as
  // the Diagram's does while a capture runs, and both verbs wait for it —
  // refused, so the one pressed keeps the focus through the step it started.
  if (figure.status === 'loading') {
    const waiting = t('panels:cpProperties.folded.layerOrderWaiting', 'Its layer order is being found');
    const wait = <V extends ControlVerb>(verb: V): V => ({ ...verb, disabled: true, hint: waiting });
    return {
      ...row,
      support: 'supported',
      previous: wait(previous),
      next: wait(next),
      ...(action ? { action: wait(action) } : {}),
      ...(note ? { note } : {}),
    };
  }
  // A 3D figure whose creases fold flat again, its record flagged by a refold
  // on them: a stale figure on flat creases. Edit… opens on them; no pager,
  // since its 3D solutions are not the ones its record orders; the flag below.
  const record = foldedFigureLayerOrderRecord(figure);
  if (foldedFigureAwaitsFlatRefold(figure)) {
    return { ...row, readout: '', support: 'supported', ...(action ? { action } : {}), ...(note ? { note } : {}) };
  }
  // A 3D figure keeps a chosen order for when its creases fold flat again
  // (D13): no pager, Edit… held, and why under the label.
  if (isFolded3dFigure(figure) && record) {
    const flat = t('panels:foldedFigureActions.layerOrder3d', 'Layer order works on flat figures');
    return {
      ...row,
      // No pager, so nothing to read out between it (the Properties board's state D).
      readout: '',
      support: 'unsupported',
      reason: flat,
      // The row says the rest under its label: the button's own reason stays short.
      ...(action ? { action: { ...action, hint: flat } } : {}),
      note: {
        kind: 'reason',
        text: t('panels:cpProperties.folded.layerOrderKept3d', {
          count: record.constraints.length,
          defaultValue_one: 'Layer order works on flat figures. Its constraint is kept for when it folds flat again.',
          defaultValue_other:
            'Layer order works on flat figures. Its {{count}} constraints are kept for when it folds flat again.',
        }),
      },
    };
  }
  // Failed or reopened from a file: as every kernel-backed row waits. A
  // reopened flat figure can still open Layer order…, which folds it first,
  // and a constrained one still steps, folding it as it goes (H6).
  if (!isFoldedFigureReady(figure)) {
    const refold = t('panels:cpProperties.folded.refoldToChange', 'Refold to change how this figure looks');
    if (held === 'record' && action && !action.disabled) {
      return { ...row, support: 'supported', previous, next, action, ...(note ? { note } : {}) };
    }
    if (action && !action.disabled) {
      const wait = <V extends ControlVerb>(verb: V): V => ({ ...verb, disabled: true, hint: refold });
      return {
        ...row,
        support: 'supported',
        previous: wait(previous),
        next: wait(next),
        action,
        ...(note ? { note } : {}),
      };
    }
    return {
      ...row,
      support: 'unsupported',
      reason: refold,
      previous,
      next,
      ...(action ? { action } : {}),
      ...(note ? { note } : {}),
    };
  }
  if (none) {
    const undetermined = t(
      'panels:cpProperties.folded.layerOrderUndetermined',
      'Layer order couldn’t be determined for this figure.'
    );
    return {
      ...row,
      support: 'unsupported',
      reason: undetermined,
      note: { kind: 'reason', text: undetermined },
      previous,
      next,
      ...(action ? { action } : {}),
    };
  }
  return { ...row, support: 'supported', previous, next, ...(action ? { action } : {}), ...(note ? { note } : {}) };
}

/**
 * Where a constrained figure stands among the solutions that fit its record,
 * as its cursor last answered (`foldedSolutionCursor.ts`), in the words the
 * Diagram's Step pane reads too (`solutionPlaceCount`). Nothing before a
 * press has made the cursor, or once it is gone: the host never counts at
 * rest (D11).
 */
function constrainedSolutionReadout(figure: OristudioCpFoldedFigureEntry, t: TFunction): string {
  const place = foldedSolutionPlace(figure);
  return place ? solutionPlaceCount(place, t) : '';
}

/**
 * What the Layer order row says under its label about a chosen order (D11):
 * how many constraints hold it ("3 constraints"), quietly, as a status,
 * flagged or not — the Pose section's notice says which need attention
 * (`layerOrderAttentionNotice`, the Properties board's state C) — or, for a
 * newer build's, why it can't be changed here. Read from the record alone,
 * never the engine. None for a figure Oriedita's search orders.
 */
function layerOrderNote(figure: OristudioCpFoldedFigureEntry, t: TFunction): FieldNote | null {
  switch (foldedFigureLayerOrderHold(figure)) {
    case null:
      return null;
    case 'newer':
      return {
        kind: 'reason',
        text: t(
          'panels:foldedFigureActions.layerOrderNewer',
          'Made with a newer Ori Studio: its layer constraints can’t be changed here.'
        ),
      };
    case 'record': {
      const record = foldedFigureLayerOrderRecord(figure);
      if (!record) return null;
      // An order chosen with no constraint (D16), as the Diagram's row says it.
      if (record.constraints.length === 0) {
        return { kind: 'status', text: t('panels:cpProperties.folded.chosenOrder', 'Chosen order') };
      }
      return {
        kind: 'status',
        text: t('panels:cpProperties.folded.layerConstraints', {
          count: record.constraints.length,
          defaultValue_one: '1 constraint',
          defaultValue_other: '{{count}} constraints',
        }),
      };
    }
  }
}

/**
 * The Pose section's notice while a flat figure's layer constraints need a
 * look since an edit (D10, D14; the Properties board's state C): the
 * sentence, and Review…, which opens the Layer order dialog on them — held
 * as the row's Edit… is. While the figure folds, Review… waits with the rest
 * of the row. Constraints a reload found detached can be let go beside it
 * (Dismiss, one entry), as they are not the figure's own until an Apply.
 * None when nothing needs a look.
 */
function layerOrderAttentionNotice(
  figure: OristudioCpFoldedFigureEntry,
  deps: FoldedFigurePropertyDeps
): PropertyNotice | undefined {
  const { t } = deps;
  const notice = foldedFigureLayerOrderAttentionNotice(t, figure);
  const edit = layerOrderCommand(figure, { t, openLayerOrder: deps.reviewLayerOrder });
  if (!notice || !edit) return undefined;
  return {
    tone: 'warning',
    text: notice.detail,
    actions: [
      {
        id: 'review-layer-order',
        label: t('panels:foldedFigureActions.reviewLayerOrder', 'Review…'),
        disabled: edit.disabled,
        ...(edit.hint ? { hint: edit.hint } : {}),
        run: edit.run,
      },
      ...(foldedFigureDetachedLayerOrder(figure)
        ? [
            {
              id: 'dismiss-layer-order',
              label: t('panels:foldedFigureActions.dismissDetachedLayerOrder', 'Dismiss'),
              // It writes the figure alone, so it waits only while the figure folds.
              disabled: figure.status !== 'ready',
              run: () => deps.dismissDetachedLayerOrder(figure),
            },
          ]
        : []),
    ],
  };
}
