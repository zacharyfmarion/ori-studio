import { useId, useRef, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { clampReveal, DEFAULT_CONNECTED_SPREAD, REVEAL_RADIUS } from '../../cp-workspace/folded/layerSpreadSettings';
import { spreadDirectionLabel, type LayerSpreadDrag } from '../../cp-workspace/folded/layerSpreadControls';
import type { SpreadDirection } from '../../cp-workspace/folded/foldedLayerSpread';
import { FieldRow } from '../ui/fieldRows';
import styles from './LayerRevealControl.module.css';

const DIRECTIONS: SpreadDirection[] = ['left', 'up-left', 'up', 'up-right', 'right', 'down-right', 'down', 'down-left'];

/** One two-dimensional edit: the dot follows the pointer, deeper layers move opposite it. */
export function LayerRevealControl({ spread }: { spread: LayerSpreadDrag }) {
  const { t, i18n } = useTranslation();
  const hintId = useId();
  const gesture = useRef<{ id: number; start: [number, number]; shown: [number, number] } | null>(null);
  if (spread.spread.kind !== 'connected') return null;
  const value = spread.spread.reveal;
  const radius = Math.hypot(...value);
  const percent = new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(radius / REVEAL_RADIUS.max);
  const direction = spreadDirectionLabel(DIRECTIONS[(Math.round(Math.atan2(value[1], value[0]) / (Math.PI / 4)) + 8) % 8]!, t);
  const label = t('panels:diagram.spread.reveal', 'Layer reveal');
  const point = (event: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const box = event.currentTarget.getBoundingClientRect();
    const unit = Math.min(box.width, box.height) * 0.42 / REVEAL_RADIUS.max;
    g.shown = clampReveal([(event.clientX - box.left - box.width / 2) / unit, (event.clientY - box.top - box.height / 2) / unit], g.shown);
    spread.previewReveal(g.shown);
  };
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    if (event.type === 'pointercancel') spread.previewReveal(g.start);
    spread.commit();
  };
  const edit = (next: [number, number]) => {
    if (!spread.start()) return;
    spread.previewReveal(clampReveal(next, value));
    spread.commit();
  };
  return (
    <div className={styles.control} data-layer-reveal="">
      <FieldRow label={label} kind="text" disabled={spread.disabled} divider={false}
        onReset={() => edit([...DEFAULT_CONNECTED_SPREAD.reveal])}>
        {percent}
      </FieldRow>
      <button type="button" role="slider" className={styles.pad} disabled={spread.disabled}
        aria-label={label} aria-describedby={hintId} aria-valuemin={radius < REVEAL_RADIUS.min ? 0 : 5} aria-valuemax={100}
        aria-valuenow={Math.round(radius / REVEAL_RADIUS.max * 100)} aria-valuetext={`${percent} · ${direction}`}
        onPointerDown={(event) => {
          if (event.button !== 0 || gesture.current || !spread.start()) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = { id: event.pointerId, start: [...value], shown: [...value] };
          point(event);
        }} onPointerMove={point} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
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
          <circle cx="50" cy="50" r="2.1" className={styles.excluded} />
          <circle cx={50 + value[0] * 21} cy={50 + value[1] * 21} r="5" className={styles.handle} />
        </svg>
      </button>
      <div className={styles.caption}>{direction}</div>
      <div id={hintId} className={styles.hint}>{t('panels:diagram.spread.padHint', 'Drag to reveal layers. Arrow keys adjust; Shift moves farther.')}</div>
    </div>
  );
}
