import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
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
import {
  normalizeAngle,
  type SimulatorOrbitGesture,
  type SimulatorOrbitView,
  type SimulatorViewDirection,
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
  /** Spin the picture about the line of sight to this angle, in radians. */
  onRoll: (roll: number) => void;
  /**
   * Turning the model by dragging — the same gesture the canvas behind offers,
   * so a drag that starts on the cube is the drag it would have been anywhere
   * else. Grabbing the cube and turning it is what most people try first.
   */
  orbit: SimulatorOrbitGesture;
}

/** How far an arrow key nudges the roll ring. */
const ROLL_KEY_STEP = Math.PI / 12;

/**
 * The ring's radius, in its own 100-unit box.
 *
 * Exactly half the box, so the circle passes through the corners of the square
 * face — the svg is sized `√2` times the cube's edge, which is what makes "50"
 * here the circumscribing circle rather than an approximation of it. Its stroke
 * and its dot spill past the box, hence `overflow: visible` in the stylesheet.
 */
const RING_RADIUS = 50;

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

export function SimulatorViewCube({
  ref,
  interactive,
  onSnap,
  onRoll,
  orbit,
}: SimulatorViewCubeProps) {
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
  const ringRef = useRef<SVGSVGElement | null>(null);
  const ringMarkRef = useRef<SVGGElement | null>(null);
  const ringHitRef = useRef<SVGCircleElement | null>(null);
  /**
   * A grab of the ring in flight.
   *
   * `x`/`y` are where the ring is centred on screen, read once when the drag
   * starts rather than per move: the cube does not move under the pointer, and
   * this is the only layout read the component makes. `angle` is where the
   * pointer was last seen and `roll` what the view had reached by then — the two
   * that make this a steering wheel rather than a dial.
   */
  const ringDragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    angle: number;
    roll: number;
  } | null>(null);
  // The roll the ring is showing, so a key press can nudge from it.
  const rollRef = useRef(0);

  const applyView = useCallback((view: SimulatorOrbitView) => {
    const scene = sceneRef.current;
    if (scene) scene.style.transform = viewCubeTransform(view);

    // The mark tracks every change, not only the ones that move a face across
    // the horizon — a roll moves it and moves nothing else. So this sits above
    // the early return below rather than after it.
    const roll = view.roll ?? 0;
    rollRef.current = roll;
    const degrees = (roll * 180) / Math.PI;
    ringMarkRef.current?.setAttribute('transform', `rotate(${degrees.toFixed(3)})`);
    ringHitRef.current?.setAttribute('aria-valuenow', String(Math.round(degrees)));

    const visible = visibleViewCubeFaces(view);
    if (visible === visibleRef.current) return;
    visibleRef.current = visible;
    faceRefs.current.forEach((face, index) => {
      if (face) face.dataset.hidden = (visible & (1 << index)) === 0 ? 'true' : 'false';
    });
    // The ring is offered only square-on to a face, which is exactly when one
    // face is turned toward the eye and the other five are edge-on or behind —
    // so the mask having a single bit *is* the test. At any other angle the
    // picture is already tilted and a circle drawn round the cube would not sit
    // on anything; Shift and drag still rolls from wherever you are.
    const squareOn = visible !== 0 && (visible & (visible - 1)) === 0;
    if (ringRef.current) ringRef.current.dataset.available = String(squareOn);
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

  /**
   * Where the pointer sits on the ring: clockwise from straight up, which is the
   * sense `rollRotation` turns the picture in.
   */
  const ringAngle = (event: { clientX: number; clientY: number }) => {
    const drag = ringDragRef.current;
    if (!drag) return 0;
    return Math.atan2(event.clientX - drag.x, drag.y - event.clientY);
  };

  const handleRingPointerDown = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!interactive) return;
    // Stop it reaching the root, whose handlers would read the same press as the
    // start of a turn of the cube.
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    ringDragRef.current = {
      pointerId: event.pointerId,
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      angle: 0,
      roll: rollRef.current,
    };
    // Where you took hold, not where the mark should go: a steering wheel turns
    // by how far your hand travels, and grabbing it at ten to two does not
    // straighten the wheels. So the press only anchors, and `onRoll` is left for
    // the first move.
    ringDragRef.current.angle = ringAngle(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleRingPointerMove = (event: ReactPointerEvent<SVGCircleElement>) => {
    const drag = ringDragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const angle = ringAngle(event);
    // Accumulated a step at a time rather than measured from the press, so a
    // sweep the long way round keeps turning instead of snapping back through
    // the short arc when it passes half a turn.
    drag.roll += normalizeAngle(angle - drag.angle);
    drag.angle = angle;
    onRoll(normalizeAngle(drag.roll));
  };

  const handleRingPointerEnd = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (ringDragRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    ringDragRef.current = null;
    track(ANALYTICS_EVENTS.simulatorViewRolled, { input: 'ring' });
  };

  const handleRingKeyDown = (event: ReactKeyboardEvent<SVGCircleElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? ROLL_KEY_STEP
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -ROLL_KEY_STEP
          : 0;
    if (!step) return;
    event.preventDefault();
    track(ANALYTICS_EVENTS.simulatorViewRolled, { input: 'key' });
    onRoll(rollRef.current + step);
  };

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
    // The arrows are buttons in their own right; a press on one is not a drag.
    if ((event.target as HTMLElement).closest('.simulator-view-cube__roll')) return;
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
    orbit.begin(
      { x: event.clientX, y: event.clientY },
      event.shiftKey ? 'roll' : 'orbit'
    );
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
      {/*
        The roll ring: the circle through the corners of the square face, with a
        mark showing which way up the picture is. Shown only square-on to a face,
        where the cube itself has nothing left to press that would change that.

        Drawn in its own 100-unit box centred on the origin, so the radius is
        literally half of it and the svg's own size — `√2` cube edges — is what
        makes the circle circumscribe the face.
      */}
      <svg
        ref={ringRef}
        className="simulator-view-cube__ring"
        data-available="false"
        viewBox="-50 -50 100 100"
        aria-hidden={!interactive}
      >
        <circle className="simulator-view-cube__ring-track" r={RING_RADIUS} />
        {/* Rotated rather than repositioned: one attribute per frame, and the
            mark's own shape stays put in its group. */}
        <g ref={ringMarkRef} transform="rotate(0)">
          <circle className="simulator-view-cube__ring-mark" cy={-RING_RADIUS} r={4} />
        </g>
        {/*
          The hit target, last so it takes the press, and `pointer-events: stroke`
          so only the band of the ring is grabbable — the cube inside it stays
          pressable, which is the whole reason this is a ring and not a disc.
        */}
        <circle
          ref={ringHitRef}
          className="simulator-view-cube__ring-hit"
          r={RING_RADIUS}
          role="slider"
          tabIndex={interactive ? 0 : -1}
          aria-label={t('panels:simulator.viewCube.roll', 'Roll the view')}
          aria-valuemin={-180}
          aria-valuemax={180}
          aria-valuenow={0}
          onPointerDown={handleRingPointerDown}
          onPointerMove={handleRingPointerMove}
          onPointerUp={handleRingPointerEnd}
          onPointerCancel={handleRingPointerEnd}
          onKeyDown={handleRingKeyDown}
        />
      </svg>
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
