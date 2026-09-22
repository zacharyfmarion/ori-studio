import type { TFunction } from 'i18next';
import type {
  FoldedFigurePlacement,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureState,
} from '../../engine/oristudioCpTypes';
import { FOLDED_FIGURE_SIDES } from '../../lib/foldedFigureSides';
import type {
  PaperStyle,
  PaperStyleField,
  PaperStyleOverrides,
  PaperStyleValue,
} from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, policyApplies } from '../../lib/paper/paperStyleResolve';
import type {
  LiveValue,
  PropertyField,
  PropertySection,
  PropertySheet,
  PropertySupport,
} from '../../lib/propertyDescriptors';
import { clampSimulatorZoom, SIMULATOR_MAX_ZOOM, SIMULATOR_MIN_ZOOM } from '../../lib/simulatorOrbit';
import { degreesToRadians, radiansToDegrees, wrapDegrees } from '../../lib/angleUnits';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { DEFAULT_FOLDED_3D_CAMERA, type FoldedFigureCamera } from './foldedFigure3dProjection';
import { foldedDisplayStyleChoiceLabel, isFoldedFigureReady } from './foldedFigureActions';
import {
  foldedAppearanceSupport,
  foldedAppearanceVisible,
  type FoldedAppearanceOption,
} from './foldedFigureAppearance';
import { foldedFigureCapabilities, isFolded3dFigure } from './foldedFigureCapabilities';
import { foldedColorLabel, foldedStateLabel } from './foldedFigureControlOptions';
import { foldedFigureSubtitle } from './foldedFigureNotice';
import { foldedFigureModel } from './foldedFigureState';
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
}

/**
 * The properties of a folded figure: appearance (what the kernel or the
 * projector draws), camera (a 3D figure's eye), placement (where it sits on
 * the paper). The title is the figure's own and the subtitle its stale / case
 * note — context, not a field.
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
 * they are verbs: flip / other side, reset view as a whole, set upright,
 * another solution, refold, export, duplicate, delete.
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

  const appearanceFields: PropertyField[] = [
    {
      id: 'displayStyle',
      kind: 'select',
      label: t('panels:foldedFigureActions.renderAs', 'Render as'),
      ...appearance('displayStyle'),
      undoLabel: t('panels:creasePattern.changeFoldedDisplayStyle', 'Change folded display style'),
      // The kind's own choices, as the Style menu offers them; a legacy style
      // a file carries shows nothing chosen, and picking any is the way out.
      options: foldedFigureCapabilities(figure).styleChoices.map((style) => ({
        id: style,
        label: foldedDisplayStyleChoiceLabel(t, style),
      })),
      protocol: 'discrete',
      value: figure.displayStyle,
      commit: (next) => {
        if (next !== null) deps.setDisplayStyle(next as OristudioCpFoldedFigureDisplayStyle);
      },
    },
    {
      id: 'side',
      kind: 'segmented',
      label: t('panels:foldedFigureActions.side', 'Side'),
      ...appearance('side'),
      undoLabel: changeModel,
      options: FOLDED_FIGURE_SIDES.map((side) => ({ id: side, label: foldedStateLabel(t, side) })),
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
    },
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

  const sections: PropertySection[] = [
    {
      id: 'appearance',
      title: t('panels:cpProperties.folded.appearance', 'Appearance'),
      fields: appearanceFields,
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

  sections.push({
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
      {
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
      },
    ],
  });

  return {
    kind: 'folded-figure',
    targetId: figure.id,
    title: figure.title,
    subtitle: foldedFigureSubtitle(t, figure, deps.stale),
    icon: 'folded-figure',
    sections,
  };
}
