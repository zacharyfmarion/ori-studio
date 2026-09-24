import type { TFunction } from 'i18next';
import { simulatorColorModeLabel } from '../../i18n/enumLabels';
import type {
  PaperStyle,
  PaperStyleField,
  PaperStyleOverrides,
  PaperStyleValue,
} from '../../lib/paper/paperStyle';
import type { ColorField, PropertyField, PropertySheet } from '../../lib/propertyDescriptors';
import type { SimulatorColorMode, SimulatorSettings } from '../../lib/simulatorSettings';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import type { PaperStyleOverrideEdit } from '../paper/objectPaperStyle';
import { auxAndErodeFields, edgeInkEdits, foldPenFields } from '../paper/paperStyleFields';

export interface InlineSimulationPropertyDeps {
  t: TFunction;
  settings: SimulatorSettings;
  setSetting<K extends keyof SimulatorSettings>(key: K, value: SimulatorSettings[K]): void;
  /** The window's effective style: the app's display style with its own pins on top. */
  style: PaperStyle;
  /** Which fields are pinned on this window, and to what. */
  overrides: PaperStyleOverrides | undefined;
  /** True while another surface holds the inline-simulation layer's bracket. */
  held: boolean;
  /** Open the layer's bracket for a continuous field; false when refused. */
  begin(field: string): boolean;
  /** Close the bracket and record `label` once. */
  end(label: string): void;
  /** A continuous pin inside an open bracket; records nothing. */
  writeOverride<F extends PaperStyleField>(field: F, value: PaperStyleValue<F>): void;
  /** Discrete pins, or clears with `undefined`, as one entry. */
  commitOverrides(edits: readonly PaperStyleOverrideEdit[]): void;
}

const COLOR_MODES: readonly SimulatorColorMode[] = ['paper', 'strain'];

/**
 * The properties an inline simulation window shows: the simulator's shared
 * render settings, then the paper style as this window draws it — the
 * `inline-simulation` policy's fields with their effective values. A row edits
 * the window's own pin on that field, so it stops following the app's display
 * style for that field alone, and offers `reset` only while pinned — the
 * affordance's absence says the row is still following.
 *
 * The render settings are preferences (no `undoLabel`, no bracket); the paper
 * rows are document edits, one entry each, with continuous colours going
 * through the layer's bracket under the pane's owner. Only the keys
 * `resolveRenderSettings` consumes appear. Transport, refresh, export and
 * delete stay on the floating inspector.
 */
export function buildInlineSimulationProperties(
  target: TargetOf<'inline-simulation'>,
  deps: InlineSimulationPropertyDeps
): PropertySheet {
  const { t, settings, setSetting, style, overrides, held } = deps;
  const changeLabel = t('panels:cpProperties.paperStyle.changeAction', 'Change paper style');
  const pinned = (field: PaperStyleField) => overrides?.[field] !== undefined;
  const resetOf = (field: PaperStyleField) =>
    pinned(field)
      ? { reset: () => deps.commitOverrides([{ field, value: undefined } as PaperStyleOverrideEdit]) }
      : {};
  const paperColor = (side: 'paper.front' | 'paper.back', id: string, label: string): ColorField => ({
    id,
    kind: 'color',
    label,
    support: 'supported',
    undoLabel: changeLabel,
    protocol: 'continuous',
    value: side === 'paper.front' ? style.paper.front : style.paper.back,
    begin: () => deps.begin(id),
    update: (value) => deps.writeOverride(side, value),
    end: () => deps.end(changeLabel),
    held,
    ...resetOf(side),
  });
  // The edge pen is pinned whole, and under a mono style the fold pens follow
  // it (`edgeInkEdits`); a reset clears the whole pen.
  const edgeColor: ColorField = {
    id: 'edgeColor',
    kind: 'color',
    label: t('panels:simulatorViewControls.borderEdge', 'Edge'),
    support: 'supported',
    undoLabel: changeLabel,
    protocol: 'continuous',
    value: style.edges.color,
    begin: () => deps.begin('edgeColor'),
    update: (value) => {
      for (const pin of edgeInkEdits(style, value, true)) deps.writeOverride(pin.field, pin.value);
    },
    end: () => deps.end(changeLabel),
    held,
    ...resetOf('edges'),
  };

  const paperFields: PropertyField[] = [
    paperColor('paper.front', 'frontColor', t('panels:simulatorViewControls.paperFront', 'Front')),
    paperColor('paper.back', 'backColor', t('panels:simulatorViewControls.paperBack', 'Back')),
    edgeColor,
    ...foldPenFields(deps),
    {
      id: 'lighting',
      kind: 'toggle',
      label: t('panels:simulatorViewControls.lighting', 'Lighting'),
      support: 'supported',
      undoLabel: changeLabel,
      protocol: 'discrete',
      value: style.light.enabled,
      commit: (enabled) =>
        deps.commitOverrides([{ field: 'light', value: { ...style.light, enabled } }]),
      ...resetOf('light'),
    },
    // The window's aux creases are the source's `F` edges; erode pulls them,
    // and only them, back from the edge of their face.
    ...auxAndErodeFields(deps),
  ];

  return {
    kind: 'inline-simulation',
    targetId: target.id,
    title: t('panels:cpProperties.inlineSimulation.title', 'Simulation window'),
    icon: 'inline-simulation',
    sections: [
      {
        id: 'simulator',
        title: t('panels:cpProperties.inlineSimulation.settings', 'Simulator settings'),
        description: t(
          'panels:cpProperties.inlineSimulation.sharedNote',
          'Shared with the Simulate workspace and every window'
        ),
        fields: [
          {
            id: 'colorMode',
            kind: 'select',
            label: t('panels:simulatorViewControls.colorMode', 'Color'),
            support: 'supported',
            options: COLOR_MODES.map((mode) => ({
              id: mode,
              label: simulatorColorModeLabel(t, mode),
            })),
            protocol: 'discrete',
            value: settings.colorMode,
            commit: (next) => {
              if (next !== null) setSetting('colorMode', next as SimulatorColorMode);
            },
          },
          {
            id: 'showEdges',
            kind: 'toggle',
            label: t('panels:simulatorViewControls.creaseLines', 'Crease lines'),
            support: 'supported',
            protocol: 'discrete',
            value: settings.showEdges,
            commit: (next) => setSetting('showEdges', next),
          },
        ],
      },
      {
        id: 'paper',
        title: t('panels:cpProperties.inlineSimulation.paper', 'Paper'),
        description: t(
          'panels:cpProperties.inlineSimulation.followsNote',
          'Follows the paper style unless overridden'
        ),
        fields: paperFields,
      },
    ],
  };
}
