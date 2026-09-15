import type { TFunction } from 'i18next';
import type {
  FoldedFigurePlacement,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureState,
} from '../../engine/oristudioCpTypes';
import { FOLDED_FIGURE_SIDES } from '../../lib/foldedFigureSides';
import type {
  LiveValue,
  PropertyField,
  PropertySection,
  PropertySheet,
  PropertySupport,
} from '../../lib/propertyDescriptors';
import { hexToRgbColor, rgbColorToHex } from '../../lib/rgbColor';
import { clampSimulatorZoom, SIMULATOR_MAX_ZOOM, SIMULATOR_MIN_ZOOM } from '../../lib/simulatorOrbit';
import { degreesToRadians, radiansToDegrees, wrapDegrees } from '../../lib/angleUnits';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { DEFAULT_FOLDED_3D_CAMERA, type FoldedFigureCamera } from './foldedFigure3dProjection';
import { foldedDisplayStyleChoiceLabel, isFoldedFigureReady } from './foldedFigureActions';
import { foldedAppearanceSupport, type FoldedAppearanceOption } from './foldedFigureAppearance';
import { foldedFigureCapabilities, isFolded3dFigure } from './foldedFigureCapabilities';
import { FOLDED_COLOR_FIELDS, foldedColorLabel, foldedStateLabel } from './foldedFigureControlOptions';
import { foldedFigureSubtitle } from './foldedFigureNotice';
import { foldedFigureModel } from './foldedFigureState';

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
  /** A continuous model write inside an open bracket; queued to the kernel, records nothing. */
  writeModel(patch: Partial<OristudioCpFoldedFigureModel>): void;
  /** One discrete model change as one entry. */
  commitModel(patch: Partial<OristudioCpFoldedFigureModel>): void;
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
 * Support per field comes from the kind's own oracle, `foldedAppearanceSupport`,
 * so a control that would render enabled-and-inert on a 3D figure is a
 * catalog bug a pure test catches. A figure that is not ready — reopened from
 * a file, still folding, failed — has nothing to draw with, so every
 * appearance field is offered disabled with the reason; Refold itself is a
 * verb on the floating toolbar.
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
  const changeColor = t('panels:creasePattern.changeFoldedColor', 'Change folded model color');
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
      case 'shadow':
        return t(
          'panels:creasePattern.shadowUnsupported3d',
          'Shadows are not drawn for a 3D folded model yet'
        );
      case 'side':
        return t('panels:foldedFigureActions.sideUnsupported3d', 'Turn a 3D model with Other side');
      default:
        return null;
    }
  };

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
    ...FOLDED_COLOR_FIELDS.map((field): PropertyField => {
      const option: FoldedAppearanceOption =
        field.key === 'front_color'
          ? 'frontColor'
          : field.key === 'back_color'
            ? 'backColor'
            : 'lineColor';
      return {
        id: option,
        kind: 'color',
        label: foldedColorLabel(t, field.key),
        ...appearance(option),
        undoLabel: changeColor,
        protocol: 'continuous',
        value: rgbColorToHex(model?.[field.key] ?? field.fallback),
        begin: () => deps.begin(option),
        update: (hex) => deps.writeModel({ [field.key]: hexToRgbColor(hex) }),
        end: () => deps.end(changeColor),
        held: deps.held,
      };
    }),
    {
      id: 'shadows',
      kind: 'toggle',
      label: t('panels:creasePattern.shadow', 'Shadow'),
      ...appearance('shadow'),
      undoLabel: changeModel,
      protocol: 'discrete',
      value: model?.display_shadows ?? false,
      commit: (display_shadows) => deps.commitModel({ display_shadows }),
    },
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
