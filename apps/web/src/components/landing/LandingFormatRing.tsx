import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { OPENABLE_FILE_EXTENSIONS } from '../../lib/fileDrop';
import { NATIVE_PROJECT_EXTENSION } from '../../lib/nativeProjectFile';

/**
 * Everything File › Export offers, plus the two image formats the export-image
 * modal writes.
 *
 * Unlike the import side there is no single constant to derive this from — the
 * export menu builds its entries one at a time — so this is a hand-kept list and
 * `LandingFormatRing.test.tsx` guards the half that *can* be checked.
 */
const EXPORTABLE_FILE_EXTENSIONS = [
  NATIVE_PROJECT_EXTENSION,
  'tmd5',
  'tmd4',
  'cp',
  'fold',
  'bps',
  'ori',
  'orh',
  'svg',
  'png',
] as const;

/** Which way data moves between Ori Studio and a format. */
export type FormatDirection = 'import' | 'export' | 'both';

export interface RingFormat {
  extension: string;
  direction: FormatDirection;
}

function directionFor(extension: string): FormatDirection {
  const opens = (OPENABLE_FILE_EXTENSIONS as readonly string[]).includes(extension);
  const writes = (EXPORTABLE_FILE_EXTENSIONS as readonly string[]).includes(extension);
  if (opens && writes) return 'both';
  return opens ? 'import' : 'export';
}

/**
 * Every format on the ring, in orbit order, with the direction it travels.
 *
 * The import side is derived from `OPENABLE_FILE_EXTENSIONS` rather than typed
 * out again: that constant already exists so the Open dialog and the drop
 * handler cannot disagree, and a landing page claiming a format the app will not
 * open is the same class of bug. The native project format is not here — it sits
 * in the hub, because it is the thing the others convert to and from.
 */
export const RING_FORMATS: readonly RingFormat[] = [
  ...OPENABLE_FILE_EXTENSIONS.filter((extension) => extension !== NATIVE_PROJECT_EXTENSION),
  // Export-only formats have no counterpart in the openable list, so they are
  // appended rather than derived. Nothing opens an image as a crease pattern.
  ...EXPORTABLE_FILE_EXTENSIONS.filter(
    (extension) =>
      extension !== NATIVE_PROJECT_EXTENSION &&
      !(OPENABLE_FILE_EXTENSIONS as readonly string[]).includes(extension)
  ),
].map((extension) => ({ extension, direction: directionFor(extension) }));

// --- Wire geometry ---------------------------------------------------------
//
// The SVG shares the ring's square box on a 0–100 viewBox, so these are
// percentages of it. `--ring-radius` is set in `cqw` for exactly this reason:
// the files sit at 40% of the box whatever its pixel size, so the wires can be
// drawn against a fixed coordinate space instead of being measured at runtime.

const CENTRE = 50;
/** Clear of the hub file and its label. */
const WIRE_START = 18;
/** Stops short of the file it points at, so the arrowhead is not buried. */
const WIRE_END = 31;

/**
 * How far back from a line's end the arrowhead's base sits, in viewBox units.
 *
 * The marker is `markerUnits="strokeWidth"` at 5 wide with `refX="4"`, on a
 * 0.5-wide stroke — so its base lands 4 × 0.5 = 2 units behind the endpoint. The
 * travelling dash stops there rather than running out under the head, plus a
 * hair of daylight.
 */
const HEAD_CLEARANCE = 2.6;

function pointAt(index: number, count: number, radius: number) {
  const angle = ((index / count) * 360 - 90) * (Math.PI / 180);
  return {
    x: CENTRE + radius * Math.cos(angle),
    y: CENTRE + radius * Math.sin(angle),
  };
}

/**
 * React's `CSSProperties` has no slot for custom properties, so setting one
 * needs a cast. Kept here rather than inline so the cast is named once.
 */
function cssVars(vars: Record<`--${string}`, string>): CSSProperties {
  return vars as CSSProperties;
}

/**
 * The interchange formats as file icons in orbit around the native project file,
 * wired to it by arrows showing which way each one travels.
 *
 * The arrangement is the argument: `.osf` holds everything Ori Studio can
 * represent, and the arrows say what can get in, what can get out, and what does
 * both — which is the question anyone with an existing library of crease
 * patterns is actually asking.
 */
export function LandingFormatRing() {
  const { t } = useTranslation();
  const ringRef = useRef<HTMLDivElement | null>(null);
  const flowing = useInView(ringRef);
  const markerPrefix = useId();

  const count = RING_FORMATS.length;

  return (
    <div
      ref={ringRef}
      className="landing-ring"
      data-flowing={flowing || undefined}
      style={cssVars({ '--ring-count': String(count) })}
    >
      {/*
        Decorative: every arrow restates what the visually-hidden direction
        label on each file already says, so announcing the wires as well would
        be noise.
      */}
      <svg className="landing-ring__wires" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <defs>
          <marker
            id={`${markerPrefix}-head`}
            markerWidth="5"
            markerHeight="5"
            refX="4"
            refY="2.5"
            // `auto-start-reverse` is what lets one marker serve both ends:
            // the inbound arrowhead sits at the *start* of the line and has to
            // point back down it.
            orient="auto-start-reverse"
            markerUnits="strokeWidth"
          >
            <path d="M0 0.6 L4.4 2.5 L0 4.4 Z" className="landing-ring__arrowhead" />
          </marker>
        </defs>

        {RING_FORMATS.map(({ extension, direction }, index) => {
          const inboundHead = direction !== 'export';
          const outboundHead = direction !== 'import';

          const from = pointAt(index, count, WIRE_START);
          const to = pointAt(index, count, WIRE_END);
          const wire = { x1: from.x, y1: from.y, x2: to.x, y2: to.y };

          // The dash runs between the arrowheads rather than under them: each
          // end that carries a head is pulled in by its depth, so the dash
          // arrives at the base of the head and stops there.
          const flowFrom = pointAt(index, count, WIRE_START + (inboundHead ? HEAD_CLEARANCE : 0));
          const flowTo = pointAt(index, count, WIRE_END - (outboundHead ? HEAD_CLEARANCE : 0));
          const flow = { x1: flowFrom.x, y1: flowFrom.y, x2: flowTo.x, y2: flowTo.y };

          return (
            <g key={extension} style={cssVars({ '--slot': String(index) })}>
              <line
                {...wire}
                className="landing-ring__wire"
                markerStart={inboundHead ? `url(#${markerPrefix}-head)` : undefined}
                markerEnd={outboundHead ? `url(#${markerPrefix}-head)` : undefined}
              />
              {outboundHead ? (
                <line {...flow} className="landing-ring__flow" data-way="out" />
              ) : null}
              {inboundHead ? (
                <line {...flow} className="landing-ring__flow" data-way="in" />
              ) : null}
            </g>
          );
        })}
      </svg>

      <ul
        className="landing-ring__orbit"
        aria-label={t('landing:formats.ringLabel', 'Supported file formats')}
      >
        {RING_FORMATS.map(({ extension, direction }, index) => (
          <li
            key={extension}
            className="landing-ring__slot"
            style={cssVars({ '--slot': String(index) })}
          >
            <FormatFile extension={extension} direction={direction} />
          </li>
        ))}
      </ul>

      <div className="landing-ring__hub">
        <FormatFile extension={NATIVE_PROJECT_EXTENSION} native />
        <span className="landing-ring__hub-label">
          {t('landing:formats.hubLabel', 'Your project')}
        </span>
      </div>
    </div>
  );
}

/** One file icon: a document silhouette with its extension across the face. */
function FormatFile({
  extension,
  direction,
  native = false,
}: {
  extension: string;
  direction?: FormatDirection;
  native?: boolean;
}) {
  const { t } = useTranslation();
  const description: Record<FormatDirection, string> = {
    both: t('landing:formats.a11yBoth', 'opens and exports'),
    import: t('landing:formats.a11yImport', 'opens only'),
    export: t('landing:formats.a11yExport', 'exports only'),
  };

  return (
    <span className="landing-file" data-native={native || undefined}>
      <span className="landing-file__fold" aria-hidden="true" />
      <span className="landing-file__ext">{`.${extension}`}</span>
      {direction ? (
        // The arrows are decorative, so this is where the direction is actually
        // available to a screen reader.
        <span className="landing-file__direction">{description[direction]}</span>
      ) : null}
    </span>
  );
}

/**
 * Whether `ref`'s element is on screen.
 *
 * The wires animate continuously, and the ring is far below the fold — leaving
 * twenty animated strokes running against a page nobody is looking at is the
 * kind of thing that shows up as battery drain rather than as a bug.
 */
function useInView(ref: React.RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver !== 'function') {
      // No observer (jsdom, ancient browsers): animate rather than sit frozen.
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold: 0.15 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return inView;
}
