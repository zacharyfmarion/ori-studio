/**
 * A flat folded figure's layer spread in its Properties sheet: the "Spread"
 * section, after Pose (canvas board A of
 * `implementation-plans/spread-and-layer-order-in-edit-export-share.md`). The
 * rows are the ones every surface that spreads a picture lays out
 * (`components/paper/LayerSpreadRows`), in the same words and order, from the
 * same verbs (`layerSpreadControls`): Spread layers; then, while on, Spread by
 * (Default, Affine or Depth) and Amount, and Default's Layer reveal, Depth's
 * Direction, or Affine's Keep still, Skew and Axis. Head-on only: Edit has no
 * Perspective, so no Presentation row.
 *
 * A figure whose layers cannot be spread keeps its rows in place, disabled,
 * and says why under Spread layers (`foldedFigureSpreadBlock`); its spread is
 * kept for when it can. The switch itself is held too, but for a spread the
 * canvas could not draw, which it can always turn off. There is no word while
 * a spread is being prepared: the figure draws flat until it lands.
 *
 * Discrete edits — the switch, a kind, a direction, the layer held still, a
 * reset — are one entry each (`setSpread`); a drag on Amount, Skew, Axis or
 * the reveal pad is one gesture on the continuous protocol, one entry
 * "Change layer spread", under the pane's owner (`pane:spread-amount`, …).
 *
 * React-free and store-free, as `foldedFigureActions.ts` is.
 */
import type { TFunction } from 'i18next';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import type { FieldNote, PropertyField, PropertySection, PropertySupport, ToggleField } from '../../lib/propertyDescriptors';
import {
  foldedFigureSpreadBlock,
  foldedFigureSpreadOptions,
  type FoldedFigureSpread,
  type FoldedFigureSpreadBlock,
} from './foldedFigureSpread';
import type { FoldedFigureSpreadStatus } from './foldedFigureSpreadStatus';
import type { LayerSpreadOptions } from './foldedLayerSpread';
import { layerSpreadControls, spreadSliderEdit, type LayerSpreadChoice } from './layerSpreadControls';
import {
  DEFAULT_CONNECTED_SPREAD,
  SPREAD_AMOUNT_RANGE,
  SPREAD_AXIS_RANGE,
  withSpreadField,
  type LayerSpreadEdit,
  type LayerSpreadStarts,
} from './layerSpreadSettings';

/** The amount slider moves in half percents, as the readout says them (`LayerSpreadRows`). */
const AMOUNT_STEP_PERCENT = 0.5;

export interface FoldedFigureSpreadFieldDeps {
  t: TFunction;
  /** The language numbers are written in. */
  locale: string;
  /** Where the figure's spread stands on the canvas (`foldedFigureSpreadStatus.ts`); read, never written. */
  spreadStatus: FoldedFigureSpreadStatus | null;
  /** True while another surface holds the folded layer's bracket. */
  held: boolean;
  /** Open the layer's bracket for a continuous field; false when refused. */
  begin(field: string): boolean;
  /** Close the bracket and record `label` once. */
  end(label: string): void;
  /** What a spread turned on, or switched to a kind, starts from: read when pressed (`foldedFigureSpreadStarts`). */
  spreadStarts(): LayerSpreadStarts;
  /** One discrete spread edit as one entry, or `null` to turn it off. */
  setSpread(spread: FoldedFigureSpread | null): void;
  /** One move of a drag, inside the bracket `begin` opened: the figure's spread as it is then, with `edit` applied. */
  writeSpread(edit: LayerSpreadEdit): void;
}

/** Why a figure's layers cannot be spread, as Spread layers says it under its label. */
export function foldedFigureSpreadReason(block: FoldedFigureSpreadBlock, t: TFunction): string {
  switch (block) {
    case 'newer':
      return t(
        'panels:cpProperties.folded.spreadNewer',
        'Made with a newer Ori Studio: its layer spread can’t be changed here.'
      );
    case 'spatial':
      return t('panels:diagram.pose.spreadNeedsFlat', 'Only a flat folded picture has layers to spread');
    case 'no-layer-order':
      return t('panels:diagram.pose.spreadNeedsOrder', 'This fold has no layer order, so it has no layers to spread');
    case 'look':
      return t('panels:cpProperties.folded.spreadNeedsLook', 'Only the Paper and X-ray looks can spread their layers');
    case 'refold':
      return t('panels:cpProperties.folded.spreadRefold', 'Refold to show the spread');
    case 'unavailable':
      return t('panels:cpProperties.folded.spreadUnavailable', 'These layers couldn’t be spread');
  }
}

/**
 * Appearance's Shadow while the figure's layers are spread on the canvas, or
 * will be once its solve lands: held, saying why — a spread picture is the
 * paper scene, which carries no shadow paint. Null while the figure draws
 * its own picture, spread off or held: Shadow works then.
 */
export function foldedFigureShadowWhileSpread(
  figure: OristudioCpFoldedFigureEntry,
  status: FoldedFigureSpreadStatus | null,
  t: TFunction
): { support: 'unsupported'; reason: string; note: FieldNote & { kind: 'reason' } } | null {
  if (!foldedFigureSpreadOptions(figure) || foldedFigureSpreadBlock(figure, status) !== null) return null;
  const reason = t('panels:cpProperties.folded.shadowSpread', 'Spread layers draw without shadows');
  return { support: 'unsupported', reason, note: { kind: 'reason', text: reason } };
}

/** The Spread section of a figure's sheet. */
export function foldedFigureSpreadSection(
  figure: OristudioCpFoldedFigureEntry,
  deps: FoldedFigureSpreadFieldDeps
): PropertySection {
  const { t } = deps;
  const undoLabel = t('panels:cpProperties.folded.changeSpread', 'Change layer spread');
  const block = foldedFigureSpreadBlock(figure, deps.spreadStatus);
  const reason = block === null ? undefined : foldedFigureSpreadReason(block, t);
  // A spread the canvas could not draw can still be turned off: the switch
  // waits only for what turning it on or off cannot change.
  const switchHeld = block !== null && block !== 'unavailable';
  const toggle: ToggleField = {
    id: 'spreadLayers',
    kind: 'toggle',
    label: t('panels:diagram.pose.spreadLayersRow', 'Spread layers'),
    support: switchHeld ? 'unsupported' : 'supported',
    ...(reason ? { reason, note: { kind: 'reason', text: reason } as const } : {}),
    undoLabel,
    protocol: 'discrete',
    // A newer build's spread is on, by that build's rules.
    value: figure.spread != null,
    commit: (on) => deps.setSpread(on ? { kind: 'record', spread: deps.spreadStarts().any } : null),
  };
  const shown = foldedFigureSpreadOptions(figure);
  return {
    id: 'spread',
    title: t('panels:cpProperties.folded.spread', 'Spread'),
    fields: shown ? [toggle, ...spreadValueFields(shown, reason, undoLabel, deps)] : [toggle],
  };
}

/** The rows under Spread layers while on: its kind and values, each disabled with `reason` while one applies. */
function spreadValueFields(
  shown: LayerSpreadOptions,
  reason: string | undefined,
  undoLabel: string,
  deps: FoldedFigureSpreadFieldDeps
): PropertyField[] {
  const { t } = deps;
  const support: { support: PropertySupport; reason?: string } = reason
    ? { support: 'unsupported', reason }
    : { support: 'supported' };
  const set = (spread: LayerSpreadOptions) => deps.setSpread({ kind: 'record', spread });
  const edit = (value: LayerSpreadEdit) => set(withSpreadField(shown, value));
  const controls = layerSpreadControls(shown, {
    hint: reason,
    busy: false,
    t,
    kind: (kind) => set(deps.spreadStarts()[kind]),
    direction: (toward) => edit({ verb: 'spread-direction', toward }),
    keep: (keep) => edit({ verb: 'spread-keep', keep }),
  });
  const percent = (value: number) =>
    new Intl.NumberFormat(deps.locale, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100);
  const degrees = (value: number) =>
    t('panels:diagram.pose.spreadAxisDegrees', '{{degrees}}°', {
      degrees: new Intl.NumberFormat(deps.locale, { maximumFractionDigits: 0 }).format(value),
    });
  const choose = <T extends string>(choices: readonly LayerSpreadChoice<T>[]) => (value: string | null) =>
    choices.find((choice) => choice.value === value)?.run();
  /** A slider's drag on the continuous protocol, under the pane's owner for it. */
  const drag = (owner: string, toEdit: (value: number) => LayerSpreadEdit) => ({
    protocol: 'continuous' as const,
    begin: () => deps.begin(owner),
    update: (value: number) => deps.writeSpread(toEdit(value)),
    end: () => deps.end(undoLabel),
    held: deps.held,
  });

  // Default's percentage covers its full height range; saved multipliers stay as they are.
  const scale = shown.kind === 'connected' ? 100 / SPREAD_AMOUNT_RANGE.connected.max : 100;
  const fields: PropertyField[] = [
    {
      id: 'spreadKind',
      kind: 'segmented',
      label: t('panels:diagram.pose.spreadKind', 'Spread by'),
      ...support,
      undoLabel,
      options: controls.kinds.map(({ value, label }) => ({ id: value, label })),
      protocol: 'discrete',
      value: shown.kind,
      commit: choose(controls.kinds),
    },
    {
      id: 'spreadAmount',
      kind: 'slider',
      label: t('panels:diagram.pose.spreadAmount', 'Amount'),
      ariaLabel: t('panels:diagram.pose.spreadAmountName', 'Spread amount'),
      ...support,
      undoLabel,
      min: SPREAD_AMOUNT_RANGE[shown.kind].min * scale,
      max: SPREAD_AMOUNT_RANGE[shown.kind].max * scale,
      step: AMOUNT_STEP_PERCENT,
      format: percent,
      valueText: (value) =>
        shown.kind === 'connected'
          ? percent(value)
          : shown.kind === 'depth'
            ? t('panels:diagram.pose.spreadAmountValue', '{{percent}} of the model', { percent: percent(value) })
            : t(
                'panels:diagram.pose.spreadAffineAmountValue',
                '{{percent}} of the way back to the sheet along the axis',
                { percent: percent(value) }
              ),
      value: shown.amount * scale,
      ...drag('spread-amount', (value) => spreadSliderEdit('amount', shown.kind, value / scale)),
      // Default's amount has a way back to the default, there whatever the
      // value, so nothing moves under a drag; the others have none, as the
      // spread rows have it.
      ...(shown.kind === 'connected'
        ? {
            reset: () => edit({ verb: 'spread-amount', amount: DEFAULT_CONNECTED_SPREAD.amount, kind: 'connected' }),
          }
        : {}),
    },
  ];

  if (shown.kind === 'connected') {
    fields.push({
      id: 'spreadReveal',
      kind: 'reveal',
      label: t('panels:diagram.spread.reveal', 'Layer reveal'),
      ...support,
      undoLabel,
      protocol: 'continuous',
      value: shown.reveal,
      begin: () => deps.begin('spread-reveal'),
      update: (reveal) => deps.writeSpread({ verb: 'spread-reveal', reveal: [reveal[0], reveal[1]] }),
      end: () => deps.end(undoLabel),
      held: deps.held,
      reset: () => edit({ verb: 'spread-reveal', reveal: [...DEFAULT_CONNECTED_SPREAD.reveal] }),
    });
  } else if (shown.kind === 'depth') {
    fields.push({
      id: 'spreadDirection',
      kind: 'direction',
      label: t('panels:diagram.pose.spreadDirection', 'Direction'),
      groupLabel: t('panels:diagram.pose.spreadDirectionName', 'Spread direction'),
      ...support,
      undoLabel,
      options: controls.directions.map(({ value, label }) => ({ id: value, label })),
      protocol: 'discrete',
      value: shown.toward,
      commit: choose(controls.directions),
    });
  } else {
    fields.push(
      {
        id: 'spreadKeep',
        kind: 'segmented',
        label: t('panels:diagram.pose.spreadKeep', 'Keep still'),
        help: t(
          'panels:diagram.pose.spreadKeepHelp',
          'The layer that does not move: the one on top, or the one at the bottom, as the front shows them.'
        ),
        ...support,
        undoLabel,
        options: controls.keeps.map(({ value, label }) => ({ id: value, label })),
        protocol: 'discrete',
        value: shown.keep,
        commit: choose(controls.keeps),
      },
      {
        id: 'spreadSkew',
        kind: 'slider',
        label: t('panels:diagram.pose.spreadSkew', 'Skew'),
        ariaLabel: t('panels:diagram.pose.spreadSkewName', 'Spread skew'),
        ...support,
        undoLabel,
        min: 0,
        max: 100,
        step: 1,
        format: percent,
        valueText: (value) =>
          t('panels:diagram.pose.spreadSkewValue', '{{percent}} skewed about the axis', { percent: percent(value) }),
        value: shown.skew * 100,
        ...drag('spread-skew', (value) => spreadSliderEdit('skew', shown.kind, value / 100)),
      },
      {
        id: 'spreadAxis',
        kind: 'slider',
        label: t('panels:diagram.pose.spreadAxis', 'Axis'),
        ariaLabel: t('panels:diagram.pose.spreadAxisName', 'Spread axis'),
        ...support,
        undoLabel,
        min: SPREAD_AXIS_RANGE.min,
        max: SPREAD_AXIS_RANGE.max,
        step: 1,
        format: degrees,
        valueText: (value) =>
          t('panels:diagram.pose.spreadAxisValue', 'Axis at {{degrees}} on the sheet', { degrees: degrees(value) }),
        value: shown.axisDeg,
        ...drag('spread-axis', (value) => spreadSliderEdit('axis', shown.kind, value)),
      }
    );
  }
  return fields;
}
