import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  VIEW_CUBE_FACES,
  viewCubeTransform,
  visibleViewCubeFaces,
  type ViewCubeFaceId,
} from './viewCubeGeometry';
import type { SimulatorOrbitView, SimulatorViewDirection } from '../../lib/simulatorOrbit';
import { track } from '../../analytics';
import { ANALYTICS_EVENTS } from '../../analytics/events';

/**
 * The view cube: a small labelled cube in the corner of a simulation, showing
 * which way the model is turned and snapping to a named viewpoint when clicked.
 *
 * An ordinary CSS 3D cube — six `<button>`s in a `preserve-3d` container — which
 * is possible only because `viewCubeRotation` is a proper rotation; see the note
 * on handedness there. The browser then does the painting, the culling, the hit
 * testing and the hover states, and this component does one thing per frame:
 * write a `transform`.
 *
 * It cannot be drawn into the simulator's own canvas. In GPU mode the worker
 * owns that canvas, and on the windowed surfaces it holds a `bitmaprenderer`
 * context — neither can be drawn into from here. So it is a DOM sibling, and
 * positions itself against whichever container the caller mounted it in.
 *
 * The camera arrives through the imperative handle rather than as a prop, for
 * the same reason solver frames do: an orbit moves it 60 times a second, and
 * that must not be 60 React renders. It has no opening view of its own for the
 * same reason there is one camera: the surface that owns `viewRef` points it
 * here as the handle is attached, so the cube is turned before its first paint
 * and there is no second answer to where the model is.
 */

export interface SimulatorViewCubeHandle {
  /** Turn the cube to match the camera. One style write; never reads layout. */
  setView: (view: SimulatorOrbitView) => void;
}

export interface SimulatorViewCubeProps {
  ref?: Ref<SimulatorViewCubeHandle>;
  /** Whether the faces accept clicks (false while loading or errored). */
  interactive: boolean;
  /** A face was chosen: look at the model from here. */
  onSnap: (direction: SimulatorViewDirection, face: ViewCubeFaceId) => void;
}

/**
 * Face names, as literal `t()` calls so the i18n extractor can see them.
 *
 * Not `t(\`panels:simulator.viewCube.${id}\`)`: the parser only reads literals,
 * and a template key would extract as nothing and ship untranslated.
 */
function faceLabel(t: TFunction, id: ViewCubeFaceId): string {
  switch (id) {
    case 'front':
      return t('panels:simulator.viewCube.front', 'Front');
    case 'back':
      return t('panels:simulator.viewCube.back', 'Back');
    case 'left':
      return t('panels:simulator.viewCube.left', 'Left');
    case 'right':
      return t('panels:simulator.viewCube.right', 'Right');
    case 'top':
      return t('panels:simulator.viewCube.top', 'Top');
    case 'bottom':
      return t('panels:simulator.viewCube.bottom', 'Bottom');
  }
}

export function SimulatorViewCube({ ref, interactive, onSnap }: SimulatorViewCubeProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const faceRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Compared before writing, so the six `data-hidden` attributes are touched
  // when a face crosses the horizon rather than on every frame of a drag.
  const visibleRef = useRef<number | null>(null);

  const applyView = useCallback((view: SimulatorOrbitView) => {
    const scene = sceneRef.current;
    if (scene) scene.style.transform = viewCubeTransform(view);
    const visible = visibleViewCubeFaces(view);
    if (visible === visibleRef.current) return;
    visibleRef.current = visible;
    faceRefs.current.forEach((face, index) => {
      if (face) face.dataset.hidden = (visible & (1 << index)) === 0 ? 'true' : 'false';
    });
  }, []);

  useImperativeHandle(ref, () => ({ setView: applyView }), [applyView]);

  // A wheel over the cube would otherwise reach the page rather than the canvas
  // behind it, and a trackpad pinch — reported as ctrl+wheel — would zoom the
  // whole app. The canvas claims its own wheel the same way and for the same
  // reason; see `SimulatorViewport`.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const swallow = (event: WheelEvent) => event.preventDefault();
    root.addEventListener('wheel', swallow, { passive: false });
    return () => root.removeEventListener('wheel', swallow);
  }, []);

  return (
    <div
      ref={rootRef}
      className="simulator-view-cube"
      data-interactive={interactive || undefined}
      role="group"
      aria-label={t('panels:simulator.viewCube.label', 'View cube')}
    >
      <div ref={sceneRef} className="simulator-view-cube__scene">
        {VIEW_CUBE_FACES.map((face, index) => (
          <button
            key={face.id}
            type="button"
            ref={(element) => {
              faceRefs.current[index] = element;
            }}
            className="simulator-view-cube__face"
            style={{ transform: face.transform }}
            disabled={!interactive}
            onClick={() => {
              // Counted here rather than by the caller, because this is the only
              // place that knows a *face* was pressed: the viewport above sees a
              // direction, which by then could have come from anywhere.
              track(ANALYTICS_EVENTS.simulatorViewCubeSnapped, { face: face.id });
              onSnap(face.direction, face.id);
            }}
          >
            {faceLabel(t, face.id)}
          </button>
        ))}
      </div>
    </div>
  );
}
