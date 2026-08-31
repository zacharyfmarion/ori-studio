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
  // The viewpoint currently lit, so the previous one can be put out.
  const litRef = useRef<string | null>(null);

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

  /**
   * Light every cell that reaches one viewpoint, and put out the last.
   *
   * A corner belongs to three faces and an edge to two, so around a visible
   * corner there are three cells that snap to the identical view. Lighting only
   * the one under the pointer says they are three different targets, which is
   * the opposite of true — and it is what you notice first, because the three
   * sit together in plain sight.
   *
   * Found by attribute rather than through kept references: hover happens at
   * human speed, so a query over 54 buttons costs nothing, and there is no
   * bookkeeping to fall out of step with the DOM.
   */
  const lightViewpoint = useCallback((viewpoint: string | null) => {
    if (litRef.current === viewpoint) return;
    const root = rootRef.current;
    if (!root) return;
    const set = (key: string, lit: boolean) => {
      root.querySelectorAll<HTMLElement>(`[data-viewpoint="${key}"]`).forEach((spot) => {
        spot.dataset.lit = lit ? 'true' : 'false';
      });
    };
    if (litRef.current) set(litRef.current, false);
    litRef.current = viewpoint;
    if (viewpoint) set(viewpoint, true);
  }, []);

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
      // `out` then `over` is the order the browser sends these in, so moving
      // between two cells puts the old viewpoint out and lights the new one with
      // nothing in between. A captured drag reports both against the face it
      // grabbed, so the highlight holds still while the cube turns under it.
      onPointerOver={(event) =>
        lightViewpoint((event.target as HTMLElement).dataset?.viewpoint ?? null)
      }
      onPointerOut={() => lightViewpoint(null)}
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
            {/*
              The name belongs to the face, not to the ninth of it in the middle,
              and saying so is what keeps it centred. Held inside the middle cell
              it was a grid item wider than its own area — and a grid item's
              automatic minimum is its min-content width, so it could neither
              shrink to the cell nor be centred in it, and sat half its overflow
              off the face's midline. Out here it is simply centred on the face
              and free to overhang whatever it likes.

              `aria-hidden` because the middle cell now carries the same name;
              the two together would read it twice.
            */}
            <span className="simulator-view-cube__label" aria-hidden>
              {faceLabel(t, face.id)}
            </span>
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
                  data-viewpoint={spot.viewpoint}
                  className="simulator-view-cube__spot simulator-view-cube__spot--face"
                  aria-label={faceLabel(t, face.id)}
                  disabled={!interactive}
                  onClick={press}
                />
              ) : (
                <button
                  key={cell}
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  data-kind={spot.kind}
                  data-viewpoint={spot.viewpoint}
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
