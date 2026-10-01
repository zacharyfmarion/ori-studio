/**
 * Where the light comes from, aimed on a disc instead of typed as two angles.
 *
 * The disc is a picture of the light it sets: the highlight is drawn where the
 * light is, so aiming it is dragging the shine across a sphere rather than
 * guessing which of 322° and 43° is the one to change. The numbers stay beside
 * it, because a figure that has to match a diagram needs them exactly.
 *
 * A drag is one gesture — `onAdjust` per pointer move, `onCommit` at the end —
 * so it counts once and settles once, the way the colour pickers on this tab
 * do. Arrow keys step it instead, each press a write of its own.
 */
import { useCallback, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  lightAtDiscOffset,
  lightDiscPoint,
  LIGHT_DISC_SIZE,
  stepLight,
} from '../../lib/paper/paperLightDisc';
import type { PaperLight } from '../../lib/paper/paperStyle';

/** The angles as the readouts and the accessible name state them: whole degrees. */
export function formatLightDegrees(degrees: number): string {
  return `${Math.round(degrees)}°`;
}

/** Which way an arrow key moves the light, as steps of azimuth and elevation. */
function arrowStep(key: string): { azimuth: number; elevation: number } | null {
  switch (key) {
    case 'ArrowLeft':
      return { azimuth: -1, elevation: 0 };
    case 'ArrowRight':
      return { azimuth: 1, elevation: 0 };
    // Up is toward the view axis: the light straightens rather than travelling
    // north, which is what the disc shows a press doing.
    case 'ArrowUp':
      return { azimuth: 0, elevation: 1 };
    case 'ArrowDown':
      return { azimuth: 0, elevation: -1 };
    default:
      return null;
  }
}

export function PaperLightDisc({
  light,
  disabled,
  onAdjust,
  onSet,
  onCommit,
}: {
  light: PaperLight;
  disabled: boolean;
  /** A continuous write: one pointer move of a drag. */
  onAdjust: (light: PaperLight) => void;
  /** A discrete write: one arrow press. */
  onSet: (light: PaperLight) => void;
  onCommit: () => void;
}) {
  const { t } = useTranslation();
  const discRef = useRef<HTMLButtonElement>(null);
  const dragging = useRef<number | null>(null);
  const point = lightDiscPoint(light);
  const azimuth = formatLightDegrees(light.azimuth);
  const elevation = formatLightDegrees(light.elevation);

  // The disc is square and the handle is placed as a fraction of it, so one
  // pair of percentages serves both the gradient's centre and the handle.
  const style = {
    '--settings-paper-light-x': `${(point.x / LIGHT_DISC_SIZE) * 100}%`,
    '--settings-paper-light-y': `${(point.y / LIGHT_DISC_SIZE) * 100}%`,
  } as CSSProperties;

  const aimAt = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const rect = discRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      // Through the rect rather than the constant: the disc is 104 px until a
      // browser zoom or a narrow layout says otherwise.
      const scale = LIGHT_DISC_SIZE / rect.width;
      const dx = (event.clientX - (rect.left + rect.width / 2)) * scale;
      const dy = (event.clientY - (rect.top + rect.height / 2)) * scale;
      onAdjust({ ...light, ...lightAtDiscOffset(dx, dy) });
    },
    [light, onAdjust]
  );

  const end = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragging.current !== event.pointerId) return;
    dragging.current = null;
    if (discRef.current?.hasPointerCapture?.(event.pointerId)) {
      discRef.current.releasePointerCapture(event.pointerId);
    }
    onCommit();
  };

  return (
    <div className="settings-paper-light">
      <button
        ref={discRef}
        type="button"
        className="settings-paper-light__disc"
        style={style}
        disabled={disabled}
        aria-label={t(
          'dialogs:settings.paper.light.disc',
          'Light direction: azimuth {{azimuth}}, elevation {{elevation}}',
          { azimuth, elevation }
        )}
        onPointerDown={(event) => {
          if (disabled) return;
          // The press is the first sample of the drag, so the light jumps to
          // where the disc was clicked rather than waiting for a move.
          dragging.current = event.pointerId;
          try {
            discRef.current?.setPointerCapture?.(event.pointerId);
          } catch {
            // No live pointer to capture (a synthetic event); the moves still
            // reach the disc.
          }
          aimAt(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current !== event.pointerId) return;
          aimAt(event);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(event) => {
          const step = arrowStep(event.key);
          if (!step) return;
          event.preventDefault();
          onSet(stepLight(light, step.azimuth, step.elevation));
        }}
      >
        <span className="settings-paper-light__handle" aria-hidden="true" />
      </button>
      <div className="settings-paper-light__readouts">
        <LightReadout label={t('dialogs:settings.paper.lightAzimuth', 'Azimuth')} value={azimuth} />
        <LightReadout
          label={t('dialogs:settings.paper.lightElevation', 'Elevation')}
          value={elevation}
        />
        <span className="settings-paper-folded__desc">
          {t(
            'dialogs:settings.paper.light.discHint',
            'Drag the highlight. Centre is straight at the paper.'
          )}
        </span>
      </div>
    </div>
  );
}

/** One angle, named on the left and stated in monospace on the right. */
function LightReadout({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-paper-light__readout">
      <span className="settings-paper-light__readout-name">{label}</span>
      <span className="settings-paper-light__readout-value">{value}</span>
    </div>
  );
}
