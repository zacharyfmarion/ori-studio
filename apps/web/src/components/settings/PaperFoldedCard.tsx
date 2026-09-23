/**
 * What folding does to the drawing — the one group of a paper style the crease
 * pattern never shows: the creases already in the sheet, how far a crease
 * pulls back from the edge of its face, and the light the figure is shaded by.
 *
 * One card rather than three: they are all answers about a folded figure, and
 * each is a switch or a single number, so a card apiece would be more border
 * than field. The rules between them are what a boxed group of its own would
 * have said.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ERODE_SLIDER_RANGE,
  type PaperLight,
} from '../../lib/paper/paperStyle';
import { Slider } from '../ui/Slider';
import { PaperLightDisc } from './PaperLightDisc';
import { SettingsToggleRow } from './SettingsToggleRow';
import type { PaperSettingsBinding } from './usePaperSettings';

/** Erode is stated as a percentage of the sheet; the style keeps a fraction. */
const ERODE_PERCENT = 100;

/** A percentage as the label states it: two decimals at most, and no trailing zeroes. */
export function formatErodePercent(percent: number): string {
  return String(Math.round(percent * 100) / 100);
}

/**
 * How far the slider reaches, in percent.
 *
 * Normally the design's band, which is where every useful erode lives. A style
 * that already carries more — a file, or the CP inspector's own number field,
 * both of which reach the full erode range — stretches it instead, so the
 * value on show is one the handle can actually be dragged back from.
 */
export function erodeSliderMax(erodePercent: number): number {
  return Math.max(ERODE_SLIDER_RANGE.max * ERODE_PERCENT, erodePercent);
}

/**
 * That reach, held rather than recomputed — a track that keeps one length for
 * the whole gesture.
 *
 * The value is written on every pointer move of a drag, so a ceiling derived
 * from it collapses underneath the pointer: on a style at 10%, a drag to the
 * middle reads 5, which makes the track 5 long, which puts the handle back at
 * the far end while the pointer is halfway. The handle chases the pointer
 * instead of following it. The ceiling only ever rises, so it still stretches
 * the moment a style with more erode arrives.
 */
function useErodeCeiling(erodePercent: number): number {
  const reach = erodeSliderMax(erodePercent);
  const [ceiling, setCeiling] = useState(reach);
  if (ceiling < reach) setCeiling(reach);
  return Math.max(ceiling, reach);
}

/**
 * A ref for a range input whose drag should settle once, at the end.
 *
 * React's `onChange` is the DOM's `input` — every pointer move of a drag — so
 * the end of the gesture only exists as the native `change`, which fires once
 * on release and once per keyboard step. The callback is held in a ref so the
 * listener is attached on mount rather than re-attached whenever the binding
 * hands back a fresh closure, which it does on every write.
 */
function useSettleOnChange(settle: () => void) {
  const latest = useRef(settle);
  useEffect(() => {
    latest.current = settle;
  });
  return useCallback((element: HTMLInputElement | null) => {
    if (!element) return;
    const onChange = () => latest.current();
    element.addEventListener('change', onChange);
    return () => element.removeEventListener('change', onChange);
  }, []);
}

export function PaperFoldedCard({ paper }: { paper: PaperSettingsBinding }) {
  const { t } = useTranslation();
  const { style, editable } = paper;
  const erodeSettled = useSettleOnChange(paper.endAdjustment);
  const erodePercent = style.erode * ERODE_PERCENT;
  const erodeMax = useErodeCeiling(erodePercent);
  const erodeLabel = style.erode
    ? t('dialogs:settings.paper.erodeAmount', '{{percent}}% of the sheet', {
        percent: formatErodePercent(erodePercent),
      })
    : t('dialogs:settings.paper.erodeOff', 'Off');

  const setLight = (light: PaperLight) => paper.setField('light', light);

  return (
    <div className="settings-paper__card settings-paper__card--folded">
      <SettingsToggleRow
        label={t('dialogs:settings.paper.auxVisible', 'Show auxiliary creases')}
        description={t(
          'dialogs:settings.paper.auxVisibleHint',
          'The crease pattern’s auxiliary lines, drawn on every surface.'
        )}
        checked={style.auxCreases.visible}
        disabled={!editable}
        onChange={(visible) => paper.setField('auxCreases.visible', visible)}
      />
      <hr className="settings-paper__rule" />
      <div className="settings-paper-folded__field">
        <div className="settings-paper-folded__head">
          {/* Decoration: the slider carries the name, and the value with it. */}
          <span className="settings-paper-folded__name" aria-hidden="true">
            {t('dialogs:settings.paper.erode', 'Erode')}
          </span>
          <span className="settings-paper-folded__value">{erodeLabel}</span>
        </div>
        <Slider
          ref={erodeSettled}
          aria-label={t('dialogs:settings.paper.erode', 'Erode')}
          aria-valuetext={erodeLabel}
          value={erodePercent}
          min={ERODE_SLIDER_RANGE.min * ERODE_PERCENT}
          max={erodeMax}
          step={ERODE_SLIDER_RANGE.step * ERODE_PERCENT}
          disabled={!editable}
          onChange={(percent) => paper.adjustField('erode', percent / ERODE_PERCENT)}
        />
        <span className="settings-paper-folded__desc">
          {t(
            'dialogs:settings.paper.erodeHint',
            'Creases pull back from the edge of the face they lie on.'
          )}
        </span>
      </div>
      <hr className="settings-paper__rule" />
      <SettingsToggleRow
        label={t('dialogs:settings.paper.lightEnabled', 'Directional light')}
        description={t(
          'dialogs:settings.paper.lightEnabledHint',
          'Shades folded paper. Flat figures stay unlit.'
        )}
        checked={style.light.enabled}
        disabled={!editable}
        onChange={(enabled) => setLight({ ...style.light, enabled })}
      />
      {/* Unlit, the angles are nothing: the disc shows only what it governs. */}
      {style.light.enabled && (
        <PaperLightDisc
          light={style.light}
          disabled={!editable}
          onAdjust={(light) => paper.adjustField('light', light)}
          onSet={setLight}
          onCommit={paper.endAdjustment}
        />
      )}
    </div>
  );
}
