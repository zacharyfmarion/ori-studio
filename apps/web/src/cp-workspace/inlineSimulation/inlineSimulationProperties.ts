import type { TFunction } from 'i18next';
import { simulatorColorModeLabel, simulatorCreaseStyleLabel } from '../../i18n/enumLabels';
import {
  applyCreaseStyle,
  creaseStyleOf,
  PAPER_CREASE_STYLES,
  type PaperStyle,
  type PaperStyleField,
  type PaperStyleOverrides,
  type PaperStyleValue,
} from '../../lib/paper/paperStyle';
import type { ColorField, PropertyField, PropertySheet } from '../../lib/propertyDescriptors';
import type { SimulatorColorMode, SimulatorSettings } from '../../lib/simulatorSettings';
import { SIMULATOR_FOLD_WEIGHT_RANGE } from '../../simulator/useSimulatorPaperStyle';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import type { PaperStyleOverrideEdit } from '../paper/objectPaperStyle';

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

/** The pens the sheet offers a colour for. */
type PenField = 'edges' | 'mountainFolds' | 'valleyFolds';

/**
 * The properties an inline simulation window shows: the simulator's shared
 * render settings, then the paper style as this window draws it — the
 * `inline-simulation` policy's fields with their effective values. A row edits
 * the window's own pin on that field, so it stops following the app's display
 * style for that field alone, and offers `reset` only while pinned — the
 * affordance's absence says the row is still following.
 *
 * The render settings are preferences (no `undoLabel`, no bracket); the paper
 * rows are document edits, one entry each, with continuous colours and the
 * weight going through the layer's bracket under the pane's owner. Only the
 * keys `resolveRenderSettings` consumes appear. Transport, refresh, export and
 * delete stay on the floating inspector.
 */
export function buildInlineSimulationProperties(
  target: TargetOf<'inline-simulation'>,
  deps: InlineSimulationPropertyDeps
): PropertySheet {
  const { t, settings, setSetting, style, overrides, held } = deps;
  const changeLabel = t('panels:cpProperties.paperStyle.changeAction', 'Change paper style');
  const pinned = (field: PaperStyleField) => overrides?.[field] !== undefined;
  const resetOf = (...fields: PaperStyleField[]) =>
    fields.some(pinned)
      ? {
          reset: () =>
            deps.commitOverrides(
              fields.map((field) => ({ field, value: undefined }) as PaperStyleOverrideEdit)
            ),
        }
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
  // A pen is pinned whole, so a colour pick copies the effective pen and
  // changes its colour; a reset clears the whole pen. Under a mono style the
  // fold pens *are* the edge ink, so a new edge colour re-applies the mode and
  // pins them with it, rather than leaving them on the old ink as custom.
  const penColor = (pen: PenField, id: string, label: string): ColorField => ({
    id,
    kind: 'color',
    label,
    support: 'supported',
    undoLabel: changeLabel,
    protocol: 'continuous',
    value: style[pen].color,
    begin: () => deps.begin(id),
    update: (value) => {
      deps.writeOverride(pen, { ...style[pen], color: value });
      const mode = pen === 'edges' ? creaseStyleOf(style) : 'custom';
      if (mode !== 'mono' && mode !== 'mono-dashed') return;
      const written = applyCreaseStyle({ ...style, edges: { ...style.edges, color: value } }, mode);
      deps.writeOverride('mountainFolds', written.mountainFolds);
      deps.writeOverride('valleyFolds', written.valleyFolds);
    },
    end: () => deps.end(changeLabel),
    held,
    ...resetOf(pen),
  });
  const creaseStyle = creaseStyleOf(style);

  const paperFields: PropertyField[] = [
    paperColor('paper.front', 'frontColor', t('panels:simulatorViewControls.paperFront', 'Front')),
    paperColor('paper.back', 'backColor', t('panels:simulatorViewControls.paperBack', 'Back')),
    penColor('edges', 'edgeColor', t('panels:simulatorViewControls.borderEdge', 'Edge')),
    {
      id: 'creaseStyle',
      kind: 'select',
      label: t('panels:simulatorViewControls.creaseStyle', 'Style'),
      support: 'supported',
      undoLabel: changeLabel,
      options: PAPER_CREASE_STYLES.map((mode) => ({
        id: mode,
        label: simulatorCreaseStyleLabel(t, mode),
      })),
      placeholder: t('panels:simulatorViewControls.creaseStyleCustom', 'Custom'),
      protocol: 'discrete',
      // Pens edited past the three modes select nothing rather than lying.
      value: creaseStyle === 'custom' ? null : creaseStyle,
      commit: (next) => {
        if (next === null) return;
        const written = applyCreaseStyle(style, next as (typeof PAPER_CREASE_STYLES)[number]);
        deps.commitOverrides([
          { field: 'mountainFolds', value: written.mountainFolds },
          { field: 'valleyFolds', value: written.valleyFolds },
        ]);
      },
      ...resetOf('mountainFolds', 'valleyFolds'),
    },
    penColor('mountainFolds', 'mountainColor', t('panels:simulatorViewControls.mountain', 'Mountain')),
    penColor('valleyFolds', 'valleyColor', t('panels:simulatorViewControls.valley', 'Valley')),
    {
      id: 'foldLineWeight',
      kind: 'slider',
      label: t('panels:simulatorViewControls.foldLineWeight', 'Fold line weight (pt)'),
      support: 'supported',
      undoLabel: changeLabel,
      min: SIMULATOR_FOLD_WEIGHT_RANGE.min,
      max: SIMULATOR_FOLD_WEIGHT_RANGE.max,
      step: SIMULATOR_FOLD_WEIGHT_RANGE.step,
      protocol: 'continuous',
      // The simulator draws every crease at the fold pens' width; see
      // `useSimulatorPaperStyle.setCreaseWeight`.
      value: style.mountainFolds.width,
      begin: () => deps.begin('foldLineWeight'),
      update: (width) => {
        deps.writeOverride('mountainFolds', { ...style.mountainFolds, width });
        deps.writeOverride('valleyFolds', { ...style.valleyFolds, width });
      },
      end: () => deps.end(changeLabel),
      held,
      ...resetOf('mountainFolds', 'valleyFolds'),
    },
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
