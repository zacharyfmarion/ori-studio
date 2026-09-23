import type { TFunction } from 'i18next';
import {
  applyCreaseStyle,
  creaseStyleOf,
  ERODE_RANGE,
  PEN_WIDTH_RANGE,
  type Hex,
  type PaperStyle,
  type PaperStyleField,
  type PaperStyleOverrides,
  type PaperStyleValue,
} from '../../lib/paper/paperStyle';
import type { ColorField, PropertyField, PropertySupport } from '../../lib/propertyDescriptors';
import { SIMULATOR_FOLD_WEIGHT_RANGE } from '../../simulator/useSimulatorPaperStyle';
import type { PaperStyleOverrideEdit } from './objectPaperStyle';

/**
 * The paper-style rows a document object's Properties sheet composes from,
 * written once for the folded-figure and inline-simulation catalogs, which
 * differ only in what a row is gated on: the fold pens as the simulator's
 * controls offer them, and the fields Phase 5 put on every surface's policy —
 * whether existing (aux) creases are drawn, the pen they are drawn with, and
 * how far a crease is pulled back from the edge of its face (D8).
 *
 * Each row edits the object's own pin on that field and offers `reset` only
 * while pinned, like every other paper-style row. A pen is pinned whole: a
 * colour or width edit copies the effective pen and changes that one part.
 */
export interface PaperStyleRowDeps {
  t: TFunction;
  /** The object's effective style: the app's display style with its own pins on top. */
  style: PaperStyle;
  /** Which fields are pinned on this object, and to what. */
  overrides: PaperStyleOverrides | undefined;
  /** True while another surface holds the object's layer bracket. */
  held: boolean;
  /** Open the layer's bracket for a continuous field; false when refused. */
  begin(field: string): boolean;
  /** Close the bracket and record `label` once. */
  end(label: string): void;
  /** A continuous pin inside an open bracket; records nothing. */
  writeOverride<F extends PaperStyleField>(field: F, value: PaperStyleValue<F>): void;
  /** Discrete pins, or clears with `undefined`, as one entry. */
  commitOverrides(edits: readonly PaperStyleOverrideEdit[]): void;
  /** Laid over every row: a figure that is not ready offers them disabled with the reason. */
  support?: { support: PropertySupport; reason?: string };
}

/** One field pinned to a value: a {@link PaperStyleOverrideEdit} that never clears. */
export type PaperStylePin = {
  [F in PaperStyleField]: { field: F; value: PaperStyleValue<F> };
}[PaperStyleField];

/** Erode is stated to the user as a percentage of the sheet, not a fraction. */
const ERODE_PERCENT = 100;

/** What every row here shares: the label, the gate, and a reset while pinned. */
function rowParts(deps: PaperStyleRowDeps) {
  const { t, overrides } = deps;
  const changeStyle = t('panels:cpProperties.paperStyle.changeAction', 'Change paper style');
  const support = deps.support ?? { support: 'supported' as const };
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
  return { changeStyle, support, resetOf };
}

/**
 * The pins a new edge ink writes, in order. The edge pen is pinned whole, so
 * the colour copies the effective pen and changes its colour. Under a mono
 * style the fold pens *are* the edge ink, so on a surface that draws them —
 * the inline window, the 3D figure — a new edge colour re-applies the mode
 * and pins them with it, rather than leaving them on the old ink as custom;
 * the flat figure's policy has no fold pens to carry it onto (D6).
 */
export function edgeInkEdits(style: PaperStyle, color: Hex, foldPens: boolean): PaperStylePin[] {
  const edges = { ...style.edges, color };
  const mode = creaseStyleOf(style);
  if (!foldPens || (mode !== 'mono' && mode !== 'mono-dashed')) {
    return [{ field: 'edges', value: edges }];
  }
  const written = applyCreaseStyle({ ...style, edges }, mode);
  return [
    { field: 'edges', value: edges },
    { field: 'mountainFolds', value: written.mountainFolds },
    { field: 'valleyFolds', value: written.valleyFolds },
  ];
}

/**
 * The fold pens as the simulator's controls offer them: whether every fold is
 * drawn as an edge, the two colours, and one fold line weight — the simulator
 * draws every crease at the fold pens' width
 * (`useSimulatorPaperStyle.setCreaseWeight`). How the folds are dashed is the
 * paper preset's, in Settings ▸ Paper. For a surface whose policy applies
 * `mountainFolds` / `valleyFolds`: a simulation window.
 *
 * While folds are drawn as edges the two colours do nothing, so they are
 * offered disabled with the reason rather than live.
 */
export function foldPenFields(deps: PaperStyleRowDeps): PropertyField[] {
  const { t, style, held } = deps;
  const { changeStyle, support: rowSupport, resetOf } = rowParts(deps);
  const asEdges = style.foldsAsEdges;
  const support =
    asEdges && rowSupport.support === 'supported'
      ? {
          support: 'unsupported' as const,
          reason: t(
            'panels:cpProperties.paperStyle.foldsAsEdgesReason',
            'Every fold is drawn as an edge'
          ),
        }
      : rowSupport;
  // A pen is pinned whole, so a colour pick copies the effective pen and
  // changes its colour; a reset clears the whole pen.
  const penColor = (pen: 'mountainFolds' | 'valleyFolds', id: string, label: string): ColorField => ({
    id,
    kind: 'color',
    label,
    ...support,
    undoLabel: changeStyle,
    protocol: 'continuous',
    value: style[pen].color,
    begin: () => deps.begin(id),
    update: (value) => deps.writeOverride(pen, { ...style[pen], color: value }),
    end: () => deps.end(changeStyle),
    held,
    ...resetOf(pen),
  });
  return [
    {
      id: 'foldsAsEdges',
      kind: 'toggle',
      label: t('panels:simulatorViewControls.foldsAsEdges', 'Render all creases as edges'),
      ...rowSupport,
      undoLabel: changeStyle,
      protocol: 'discrete',
      value: asEdges,
      commit: (on) => deps.commitOverrides([{ field: 'foldsAsEdges', value: on }]),
      ...resetOf('foldsAsEdges'),
    },
    penColor('mountainFolds', 'mountainColor', t('panels:simulatorViewControls.mountain', 'Mountain')),
    penColor('valleyFolds', 'valleyColor', t('panels:simulatorViewControls.valley', 'Valley')),
    {
      id: 'foldLineWeight',
      kind: 'slider',
      label: t('panels:simulatorViewControls.foldLineWeight', 'Fold line weight (pt)'),
      // Still the weight every line is drawn at when folds are edges.
      ...rowSupport,
      undoLabel: changeStyle,
      min: SIMULATOR_FOLD_WEIGHT_RANGE.min,
      max: SIMULATOR_FOLD_WEIGHT_RANGE.max,
      step: SIMULATOR_FOLD_WEIGHT_RANGE.step,
      protocol: 'continuous',
      value: style.mountainFolds.width,
      begin: () => deps.begin('foldLineWeight'),
      update: (width) => {
        deps.writeOverride('mountainFolds', { ...style.mountainFolds, width });
        deps.writeOverride('valleyFolds', { ...style.valleyFolds, width });
      },
      end: () => deps.end(changeStyle),
      held,
      ...resetOf('mountainFolds', 'valleyFolds'),
    },
  ];
}

/**
 * The aux-crease toggle, the aux pen's colour and width, and erode.
 */
export function auxAndErodeFields(deps: PaperStyleRowDeps): PropertyField[] {
  const { t, style, held } = deps;
  const { changeStyle, support, resetOf } = rowParts(deps);
  const pen = style.auxCreases.pen;
  return [
    {
      id: 'auxVisible',
      kind: 'toggle',
      label: t('panels:cpProperties.paperStyle.auxVisible', 'Auxiliary creases'),
      ...support,
      undoLabel: changeStyle,
      protocol: 'discrete',
      value: style.auxCreases.visible,
      commit: (visible) => deps.commitOverrides([{ field: 'auxCreases.visible', value: visible }]),
      ...resetOf('auxCreases.visible'),
    },
    {
      id: 'auxColor',
      kind: 'color',
      label: t('panels:cpProperties.paperStyle.auxColor', 'Aux crease color'),
      ...support,
      undoLabel: changeStyle,
      protocol: 'continuous',
      value: pen.color,
      begin: () => deps.begin('auxColor'),
      update: (color) => deps.writeOverride('auxCreases.pen', { ...pen, color }),
      end: () => deps.end(changeStyle),
      held,
      ...resetOf('auxCreases.pen'),
    },
    {
      id: 'auxWidth',
      kind: 'number',
      label: t('panels:cpProperties.paperStyle.auxWidth', 'Aux crease width (pt)'),
      ...support,
      undoLabel: changeStyle,
      min: PEN_WIDTH_RANGE.min,
      max: PEN_WIDTH_RANGE.max,
      step: PEN_WIDTH_RANGE.step,
      normalize: (width) => Math.min(PEN_WIDTH_RANGE.max, Math.max(PEN_WIDTH_RANGE.min, width)),
      protocol: 'draft',
      value: pen.width,
      commit: (width) =>
        deps.commitOverrides([{ field: 'auxCreases.pen', value: { ...pen, width } }]),
      ...resetOf('auxCreases.pen'),
    },
    {
      id: 'erode',
      kind: 'number',
      label: t('panels:cpProperties.paperStyle.erode', 'Erode (% of sheet)'),
      ...support,
      undoLabel: changeStyle,
      min: ERODE_RANGE.min * ERODE_PERCENT,
      max: ERODE_RANGE.max * ERODE_PERCENT,
      step: ERODE_RANGE.step * ERODE_PERCENT,
      suffix: '%',
      normalize: (percent) =>
        Math.min(ERODE_RANGE.max * ERODE_PERCENT, Math.max(ERODE_RANGE.min * ERODE_PERCENT, percent)),
      protocol: 'draft',
      value: style.erode * ERODE_PERCENT,
      commit: (percent) =>
        deps.commitOverrides([{ field: 'erode', value: percent / ERODE_PERCENT }]),
      ...resetOf('erode'),
    },
  ];
}
