import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagramAnnotation } from '../../diagram/document/diagramDocument';
import type { SceneBounds } from '../../lib/paper/paperScene';
import { ViewportStatusReadout } from '../ui/ViewportStatusReadout';
import styles from './DiagramPoseStage.module.css';

/** How much of an annotation shows in Pose: a ghost of where it is (D8). */
const GHOST_OPACITY = 0.3;

/** The step's annotations, and the frame of the capture they were drawn on. */
export interface DiagramPoseAnnotations {
  annotations: readonly DiagramAnnotation[];
  /** The stored scene's bounds: the picture's frame (D8). */
  bounds: SceneBounds;
}

/** The step's annotations, painted for the view in its own device px. */
export interface DiagramPoseGhost {
  markup: string;
  width: number;
  height: number;
}

/**
 * A live view in Pose (D5, D19) — a step folded in 3D, or shown Simulated —
 * over the stage, above the toolbar floating at its foot: the view itself
 * (`children`, handed the class that sizes its canvas), the step's
 * annotations ghosted over it while it shows the pose they were drawn at, its
 * camera's yaw and pitch in the corner, and how to turn it. Positioned, so the
 * viewport's view cube anchors to it.
 */
export function DiagramPoseStage({
  status,
  hidden = false,
  ghost,
  yaw,
  pitch,
  children,
}: {
  /** The view's own state, for the inspector (`data-status`). */
  status: string;
  /** Laid out but not shown: a view still loading sizes itself under the picture. */
  hidden?: boolean;
  ghost: DiagramPoseGhost | null;
  /** Degrees, as the readout says them. */
  yaw: number;
  pitch: number;
  children: (canvasClassName: string) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.view} data-status={status} data-hidden={hidden || undefined}>
      {children(styles.canvas)}
      {ghost && (
        <svg
          className={styles.ghost}
          viewBox={`0 0 ${ghost.width} ${ghost.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          data-annotation-ghost=""
        >
          <g opacity={GHOST_OPACITY} dangerouslySetInnerHTML={{ __html: ghost.markup }} />
        </svg>
      )}
      <ViewportStatusReadout>
        <span>{t('panels:diagram.pose.cameraReadout', 'Yaw {{yaw}}° · Pitch {{pitch}}°', { yaw, pitch })}</span>
      </ViewportStatusReadout>
      <p className={styles.hint} aria-hidden="true">
        {t('panels:diagram.pose.orbitHint', 'Drag to turn · Double-click to reset')}
      </p>
    </div>
  );
}
