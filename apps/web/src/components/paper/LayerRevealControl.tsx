import { registerCanvasSessionEnder } from '../../cp-workspace/canvasObjects/canvasSessions';
import { useEffect, useId, useRef, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { clampReveal, DEFAULT_CONNECTED_SPREAD, REVEAL_RADIUS } from '../../cp-workspace/folded/layerSpreadSettings';
import { spreadDirectionLabel, spreadValuesHold, type LayerSpreadDrag } from '../../cp-workspace/folded/layerSpreadControls';
import type { SpreadDirection } from '../../cp-workspace/folded/foldedLayerSpread';
import { FieldRow } from '../ui/fieldRows';
import styles from './LayerRevealControl.module.css';

const DIRECTIONS: SpreadDirection[] = ['left', 'up-left', 'up', 'up-right', 'right', 'down-right', 'down', 'down-left'];
/** In the 100-unit SVG; also the pointer's reach as a share of the pad. */
const PAD_RADIUS = 42;

/** A Default spread's reveal, as the rows lay a spread out (`LayerSpreadRows`): its pad on the spread's drag. */
export function LayerRevealControl({ spread }: { spread: LayerSpreadDrag }) {
  if (spread.spread.kind !== 'connected') return null;
  const { disabled, hint } = spreadValuesHold(spread);
  return (
    <LayerRevealPad
      value={spread.spread.reveal}
      disabled={disabled}
      title={hint}
      begin={spread.start}
      update={spread.previewReveal}
      end={spread.commit}
    />
  );
}

/**
 * The reveal pad on the continuous protocol: `begin` opens an edit and may
 * refuse it, `update` follows each move, `end` commits once — a drag, or one
 * key's step. Its reset puts the default reveal back: `onReset` when the host
 * records a reset as an edit of its own, else one edit through the same three.
 * Shared by the spread rows (`LayerRevealControl`) and the Properties sheet's
 * `reveal` field (`PropertySheetView`).
 */
export function LayerRevealPad({
  value,
  disabled,
  title,
  label: shownLabel,
  begin,
  update,
  end,
  onReset,
}: {
  /** The reveal shown: a drag's, while it is previewed. */
  value: readonly [number, number];
  disabled: boolean;
  /** Why it is disabled, on hover, as a row says it. */
  title?: string;
  /** The row's label; "Layer reveal" when absent. */
  label?: string;
  begin: () => boolean;
  update: (value: [number, number]) => void;
  end: () => void;
  onReset?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const hintId = useId();
  const gesture = useRef<{ id: number; start: [number, number]; shown: [number, number] } | null>(null);
  // A pointer released after Undo or a file change cannot start a fresh edit.
  useEffect(() => registerCanvasSessionEnder(() => { gesture.current = null; }), []);
  const radius = Math.min(REVEAL_RADIUS.max, Math.hypot(...value));
  const padScale = PAD_RADIUS / REVEAL_RADIUS.max;
  const percent = new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(radius / REVEAL_RADIUS.max);
  const direction = spreadDirectionLabel(DIRECTIONS[(Math.round(Math.atan2(value[1], value[0]) / (Math.PI / 4)) + 8) % 8]!, t);
  const label = shownLabel ?? t('panels:diagram.spread.reveal', 'Layer reveal');
  const point = (event: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const box = event.currentTarget.getBoundingClientRect();
    const unit = Math.min(box.width, box.height) * padScale / 100;
    g.shown = clampReveal([(event.clientX - box.left - box.width / 2) / unit, (event.clientY - box.top - box.height / 2) / unit], g.shown);
    update(g.shown);
  };
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    if (event.type === 'pointercancel') update(g.start);
    end();
  };
  const edit = (next: [number, number]) => {
    if (!begin()) return;
    update(clampReveal(next, value));
    end();
  };
  return (
    <div className={styles.control} data-layer-reveal="">
      <FieldRow label={label} kind="text" disabled={disabled} divider={false} title={title}
        onReset={onReset ?? (() => edit([...DEFAULT_CONNECTED_SPREAD.reveal]))}>
        {percent}
      </FieldRow>
      <button type="button" role="slider" className={styles.pad} disabled={disabled} title={title}
        aria-label={label} aria-describedby={hintId} aria-valuemin={Math.min(radius, REVEAL_RADIUS.min) / REVEAL_RADIUS.max * 100} aria-valuemax={100}
        aria-valuenow={radius / REVEAL_RADIUS.max * 100} aria-valuetext={`${percent} · ${direction}`}
        onPointerDown={(event) => {
          if (event.button !== 0 || gesture.current || !begin()) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = { id: event.pointerId, start: [...value], shown: [...value] };
          point(event);
        }} onPointerMove={point} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
        onKeyDown={(event) => {
          const delta = event.shiftKey ? 0.2 : 0.05;
          const [x, y] = value;
          const next: [number, number] | undefined = event.key === 'ArrowLeft' ? [x - delta, y]
            : event.key === 'ArrowRight' ? [x + delta, y] : event.key === 'ArrowUp' ? [x, y - delta]
              : event.key === 'ArrowDown' ? [x, y + delta] : event.key === 'Home' ? [...DEFAULT_CONNECTED_SPREAD.reveal] : undefined;
          if (!next) return;
          event.preventDefault();
          event.stopPropagation();
          edit(next);
        }}>
        <svg viewBox="0 0 100 100" aria-hidden="true" className={styles.drawing}>
          <circle cx="50" cy="50" r="49" className={styles.surface} />
          <path d="M 14 50 H 86 M 50 14 V 86" className={styles.axes} />
          <circle cx="50" cy="50" r={REVEAL_RADIUS.min * padScale} className={styles.excluded} />
          <circle cx={50 + value[0] * padScale} cy={50 + value[1] * padScale} r="5" className={styles.handle} />
        </svg>
      </button>
      <div id={hintId} className={styles.hint}>{t('panels:diagram.spread.padHint', 'Drag to reveal layers. Arrow keys adjust; Shift moves farther.')}</div>
    </div>
  );
}
