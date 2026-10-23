import type { FoldKind } from '../../fold/tools/foldToolCatalog';
import styles from './FoldKindMark.module.css';

/**
 * A fold's shape in the control's ink, shared by the rail, phone tool sheet,
 * menus and tool-window controls. The parent control supplies its accessible
 * name; these drawings are decorative.
 */
export function FoldKindMark({
  kind,
  size = 20,
  strokeWidth = 1.7,
}: {
  kind: FoldKind | 'inside-reverse' | 'crimp' | 'squash' | 'swivel' | 'crease' | 'repeat';
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={styles.mark}
      data-kind={kind}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'valley' && <path d="M5 6 12 18 19 6" />}
      {kind === 'mountain' && <path d="M5 18 12 6 19 18" />}
      {/* A precrease is the fold line, dashed; an existing crease is the line already there, solid. */}
      {kind === 'precrease' && <path d="M5 19 19 5" strokeDasharray="2.9 2.7" />}
      {kind === 'crease' && <path d="M5 19 19 5" />}
      {/* The diagram's repeat symbol: an arrow with a stroke across it. */}
      {kind === 'repeat' && <path d="M12 3v17.5M6.5 7.5h11M6.5 15l5.5 5.5 5.5-5.5" />}
      {kind === 'crimp' && (
        <>
          <path d="M9 5.5h12M9 18.5h12" />
          <path d="M2 9.5h11m-3-2.5 3 2.5-3 2M2 14.5h11m-3-2 3 2-3 2.5" />
        </>
      )}
      {kind === 'squash' && (
        <>
          <path d="m12 2 10 10-10 10L2 12Z" />
          <path d="M12 2 7 17h10L12 2M12 17v5" />
          <path d="M12 2v15" />
        </>
      )}
      {kind === 'swivel' && (
        <>
          <path d="m12 2 10 10-10 10L2 12Z" />
          <path d="M12 2 7.5 10.5 12 22l5.5-7.5L12 2M7.5 10.5 12 9l5.5 5.5M12 9v13m0-9.5 5.5 2" />
          <path d="M12 2v7" />
        </>
      )}
      {kind === 'inside-reverse' && (
        <>
          <path d="M4 21 7 6.5 11 3.5 22 9.5 10.5 8 8.5 21Z" />
          <path d="m11 3.5-.5 4.5-2 13" />
        </>
      )}
    </svg>
  );
}
