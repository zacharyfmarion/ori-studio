import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { OPENABLE_FILE_EXTENSIONS } from '../../lib/fileDrop';
import { NATIVE_PROJECT_EXTENSION } from '../../lib/nativeProjectFile';

/**
 * Formats that leave the app but cannot come back into it. They are exports, so
 * they belong on the ring, but they are not in `OPENABLE_FILE_EXTENSIONS` —
 * nothing opens an image as a crease pattern.
 */
const EXPORT_ONLY_EXTENSIONS = ['svg', 'png'] as const;

/**
 * Every extension on the ring, in orbit order.
 *
 * Derived from `OPENABLE_FILE_EXTENSIONS` rather than typed out again: that
 * constant already exists so the Open dialog and the drop handler cannot
 * disagree, and a landing page claiming a format the app does not open would be
 * the same class of bug. The native project format is not here — it sits in the
 * hub instead.
 */
export const RING_EXTENSIONS: readonly string[] = [
  ...OPENABLE_FILE_EXTENSIONS.filter((extension) => extension !== NATIVE_PROJECT_EXTENSION),
  ...EXPORT_ONLY_EXTENSIONS,
];

/**
 * React's `CSSProperties` has no slot for custom properties, so setting one
 * needs a cast. Kept here rather than inline so the cast is named once.
 */
function cssVars(vars: Record<`--${string}`, string>): CSSProperties {
  return vars as CSSProperties;
}

/**
 * The interchange formats as file icons in orbit around the native project file.
 *
 * The arrangement is the argument: `.osf` holds everything Ori Studio knows how
 * to represent, and around it sit the formats it can hand that work to. The
 * point being made is that nothing here is a one-way door, which is the question
 * anyone with an existing library of crease patterns is actually asking.
 */
export function LandingFormatRing() {
  const { t } = useTranslation();

  return (
    <div
      className="landing-ring"
      style={cssVars({ '--ring-count': String(RING_EXTENSIONS.length) })}
    >
      <ul
        className="landing-ring__orbit"
        aria-label={t('landing:formats.ringLabel', 'Supported file formats')}
      >
        {RING_EXTENSIONS.map((extension, index) => (
          <li
            key={extension}
            className="landing-ring__slot"
            style={cssVars({ '--slot': String(index) })}
          >
            <FormatFile extension={extension} />
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
function FormatFile({ extension, native = false }: { extension: string; native?: boolean }) {
  return (
    <span className="landing-file" data-native={native || undefined}>
      <span className="landing-file__fold" aria-hidden="true" />
      <span className="landing-file__ext">{`.${extension}`}</span>
    </span>
  );
}
