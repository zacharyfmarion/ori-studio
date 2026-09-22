/**
 * One pen of a paper style: its colour, the line it draws, and the three
 * things that shape that line.
 *
 * The sample strip is the point of the card. A pen is a width in pt, a list of
 * dash multiples and a cap, and none of those three is a picture of anything —
 * so the strip draws the pen at the size and pattern the app will really use
 * (`ptToDevicePx` at dpr 1, the dash resolved against that width), on the
 * paper the pen actually draws on rather than on a neutral ground, because a
 * black edge pen on a dark field is a pen you cannot see.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { penCapLabel } from '../../i18n/enumLabels';
import { penDashDevicePx } from '../../lib/paper/paperStyleResolve';
import { PEN_WIDTH_RANGE, ptToDevicePx, type Hex, type Pen, type PenCap } from '../../lib/paper/paperStyle';
import { ColorField } from '../ui/ColorField';
import { NumberField } from '../ui/NumberField';
import { SegmentedControl } from '../ui/SegmentedControl';
import { PaperDashMenu } from './PaperDashMenu';

/** Device px, at a screen's own scale; the strip is drawn in CSS px. */
const SAMPLE_DPR = 1;

/** Enough decimals for any pen the field can hold, and none of the float noise. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The width the sample strip draws `pen` at, in the strip's own px. */
export function samplePenWidth(pen: Pen): number {
  return round(ptToDevicePx(pen.width, SAMPLE_DPR));
}

/** The sample strip's `stroke-dasharray` for `pen`: its multiples at that width. */
export function samplePenDash(pen: Pen): string | undefined {
  const runs = penDashDevicePx(pen, SAMPLE_DPR);
  return runs ? runs.map(round).join(' ') : undefined;
}

export function PaperPenCard({
  label,
  pen,
  ground,
  disabled,
  onAdjust,
  onSet,
  onCommit,
}: {
  /** The pen's name, which is the card's heading and the stem of every field's name. */
  label: string;
  pen: Pen;
  /** The paper the sample sits on, so the sample says what the pen will look like. */
  ground: Hex;
  disabled: boolean;
  /** A continuous write — the colour picker, firing per pointer move. */
  onAdjust: (pen: Pen) => void;
  /** A discrete write: a width committed, a cap picked, a dash chosen. */
  onSet: (pen: Pen) => void;
  onCommit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="settings-paper__card settings-paper-pen"
      data-testid={`settings-paper-pen-${label}`}
    >
      <ColorField
        layout="inline"
        showValue
        className="settings-paper-pen__head"
        label={label}
        inputLabel={t('dialogs:settings.paper.penColorNamed', '{{pen}} color', { pen: label })}
        value={pen.color}
        disabled={disabled}
        onChange={(color) => onAdjust({ ...pen, color })}
        onCommit={onCommit}
      />
      {/* Decoration: the card's words already name the pen this draws. */}
      <svg
        className="settings-paper-pen__sample"
        style={{ '--settings-paper-sample-ground': ground } as CSSProperties}
        aria-hidden="true"
        focusable="false"
      >
        <line
          x1="11"
          y1="16"
          x2="95%"
          y2="16"
          stroke={pen.color}
          strokeWidth={samplePenWidth(pen)}
          strokeDasharray={samplePenDash(pen)}
          strokeLinecap={pen.cap}
        />
      </svg>
      <div className="settings-paper-pen__row">
        <PenField label={t('dialogs:settings.paper.penWidth', 'Width (pt)')}>
          <NumberField
            label={t('dialogs:settings.paper.penWidthNamed', '{{pen}} width', { pen: label })}
            value={pen.width}
            min={PEN_WIDTH_RANGE.min}
            max={PEN_WIDTH_RANGE.max}
            step={PEN_WIDTH_RANGE.step}
            disabled={disabled}
            onCommit={(width) => onSet({ ...pen, width })}
          />
        </PenField>
        <PenField label={t('dialogs:settings.paper.penCap', 'Cap')}>
          <SegmentedControl<PenCap>
            aria-label={t('dialogs:settings.paper.penCapNamed', '{{pen}} cap', { pen: label })}
            value={pen.cap}
            disabled={disabled}
            onChange={(cap) => onSet({ ...pen, cap })}
            options={[
              { value: 'butt', label: penCapLabel(t, 'butt') },
              { value: 'round', label: penCapLabel(t, 'round') },
            ]}
          />
        </PenField>
      </div>
      <PenField label={t('dialogs:settings.paper.penDash', 'Dash')}>
        <PaperDashMenu
          label={t('dialogs:settings.paper.penDashNamed', '{{pen}} dash', { pen: label })}
          pen={pen}
          disabled={disabled}
          onCommit={(dash) => onSet({ ...pen, dash })}
        />
      </PenField>
    </div>
  );
}

/**
 * One labelled control inside a pen card. The label is decoration — every
 * control carries the pen's name in its own accessible name, because "Width"
 * four times over says nothing about which pen is being set.
 */
function PenField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="settings-paper-pen__field">
      <span className="settings-paper-pen__field-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}
