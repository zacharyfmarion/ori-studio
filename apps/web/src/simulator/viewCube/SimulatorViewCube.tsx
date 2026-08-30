import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  VIEW_CUBE_FACES,
  viewCubeTransform,
  visibleViewCubeFaces,
  type ViewCubeFaceId,
} from './viewCubeGeometry';
import type {
  SimulatorOrbitGesture,
  SimulatorOrbitView,
  SimulatorViewDirection,
} from '../../lib/simulatorOrbit';
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
  /** Whether the faces accept presses (false while loading or errored). */
  interactive: boolean;
  /** A face was chosen: look at the model from here. */
  onSnap: (direction: SimulatorViewDirection, face: ViewCubeFaceId) => void;
  /**
   * Turning the model by dragging — the same gesture the canvas behind offers,
   * so a drag that starts on the cube is the drag it would have been anywhere
   * else. Grabbing the cube and turning it is what most people try first.
   */
  orbit: SimulatorOrbitGesture;
}

/**
 * How far the pointer may travel and still be a press, in CSS pixels.
 *
 * A press and a drag begin identically here, so one of them has to be decided
 * late. Nothing is turned until the pointer has passed this, and once it has,
 * the press that would otherwise follow on release is swallowed — a drag that
 * ends over the Top face must not also snap to Top.
 */
const DRAG_SLOP_PX = 3;

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

export function SimulatorViewCube({ ref, interactive, onSnap, orbit }: SimulatorViewCubeProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const faceRefs = useRef<Array<HTMLDivElement | null>>([]);
  // Compared before writing, so the six `data-hidden` attributes are touched
  // when a face crosses the horizon rather than on every frame of a drag.
  const visibleRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; turned: boolean } | null>(
    null
  );
  // Set when a drag ends, and cleared by the press it swallows.
  const swallowPressRef = useRef(false);

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

  /*
   * Turning the cube.
   *
   * The handlers sit on the root, which takes no pointer events itself — they
   * run on what bubbles up from a face. That is deliberate: a drag can only
   * start on a face that is actually facing you, so the empty corners of the
   * cube's box stay the canvas's to press.
   *
   * Capture goes on the pressed face rather than on the root for the same
   * reason. A `pointer-events: none` element is a poor capture target, and the
   * face is what the gesture is on anyway; capturing it is what lets the drag
   * carry on out over the canvas and back.
   */
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const face = event.target as Element;
    face.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      turned: false,
    };
    // Begun on the press, not on the first move past the slop: this is also what
    // stops a snap that is still animating, and it fixes the angles the drag
    // turns from before anything can move them.
    orbit.begin({ x: event.clientX, y: event.clientY });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.turned) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_SLOP_PX) return;
      drag.turned = true;
    }
    orbit.move({ x: event.clientX, y: event.clientY });
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    swallowPressRef.current = drag.turned;
    orbit.end();
  };

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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      role="group"
      aria-label={t('panels:simulator.viewCube.label', 'View cube')}
    >
      <div ref={sceneRef} className="simulator-view-cube__scene">
        {VIEW_CUBE_FACES.map((face, index) => (
          <div
            key={face.id}
            ref={(element) => {
              faceRefs.current[index] = element;
            }}
            className="simulator-view-cube__face"
            style={{ transform: face.transform }}
          >
            {face.spots.map((spot, cell) => {
              const press = () => {
                // A drag that happened to end over a face is not a press on it.
                if (swallowPressRef.current) {
                  swallowPressRef.current = false;
                  return;
                }
                // Counted here rather than by the caller, because this is the
                // only place that knows *which* region was pressed: the viewport
                // above sees a direction, which by then could have come from
                // anywhere.
                track(ANALYTICS_EVENTS.simulatorViewCubeSnapped, {
                  face: face.id,
                  region: spot.kind,
                });
                onSnap(spot.direction, face.id);
              };
              // The middle cell is the face, and carries its name. The eight
              // around it are pointer affordances only: they are redundant with
              // dragging, and 48 more stops in the tab order would cost every
              // keyboard user far more than they give.
              return spot.kind === 'face' ? (
                <button
                  key={cell}
                  type="button"
                  className="simulator-view-cube__spot simulator-view-cube__spot--face"
                  disabled={!interactive}
                  onClick={press}
                >
                  {faceLabel(t, face.id)}
                </button>
              ) : (
                <button
                  key={cell}
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  data-kind={spot.kind}
                  className="simulator-view-cube__spot"
                  disabled={!interactive}
                  onClick={press}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
