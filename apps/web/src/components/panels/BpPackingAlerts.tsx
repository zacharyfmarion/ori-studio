import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { OristudioBpDiagnostic } from '../../engine/oristudioBpTypes';
import { bpFlapLabelList } from '../../lib/bpFlapLabel';
import styles from './BpPackingAlerts.module.css';

/** Alerts shown before the stack collapses into a "+N more" row. */
const BP_PACKING_ALERT_LIMIT = 3;

/**
 * The packing pane's warnings, stacked in its bottom-left corner: a pattern the
 * search could not find, a layout that could not be drawn, an operation the port
 * does not support. One that points at something on the canvas is a button that
 * selects it.
 */
export function BpPackingAlerts({
  diagnostics,
  onActivate,
}: {
  diagnostics: OristudioBpDiagnostic[];
  onActivate: (diagnostic: OristudioBpDiagnostic) => void;
}) {
  const { t } = useTranslation();
  if (diagnostics.length === 0) return null;
  const shown = diagnostics.slice(0, BP_PACKING_ALERT_LIMIT);
  const hidden = diagnostics.length - shown.length;
  return (
    <div
      className={styles.alerts}
      aria-label={t('panels:bpPacking.warnings', 'Box Pleat packing warnings')}
    >
      {shown.map((diagnostic) => {
        const content = (
          <>
            <TriangleAlert size={14} />
            <span>
              <strong>{bpPackingAlertLabel(diagnostic, t)}</strong>
              <small>{bpPackingAlertMessage(diagnostic, t)}</small>
            </span>
          </>
        );
        return diagnostic.selection ? (
          <button
            type="button"
            className={styles.alert}
            data-severity={diagnostic.severity}
            key={diagnostic.id}
            onClick={() => onActivate(diagnostic)}
          >
            {content}
          </button>
        ) : (
          <div
            className={styles.alert}
            data-severity={diagnostic.severity}
            key={diagnostic.id}
            role="status"
          >
            {content}
          </div>
        );
      })}
      {hidden > 0 && (
        // Never truncate silently: a capped list otherwise reads as "that's all
        // of them".
        <div className={styles.alert} data-more="" role="status">
          {hidden === 1
            ? t('panels:bpPacking.moreWarningsOne', '{{count}} more warning', { count: hidden })
            : t('panels:bpPacking.moreWarningsOther', '{{count}} more warnings', {
                count: hidden,
              })}
        </div>
      )}
    </div>
  );
}

function bpPackingAlertLabel(diagnostic: OristudioBpDiagnostic, t: TFunction): string {
  if (diagnostic.detail?.kind === 'patternless-stretch') {
    // Name the flaps in the headline. "Pattern not found" on its own left the
    // user with nothing to look for on the canvas.
    return t('panels:bpPacking.patternNotFoundFor', 'No crease pattern for {{flaps}}', {
      flaps: bpFlapLabelList(diagnostic.detail.flapLabels, t),
    });
  }
  if (diagnostic.kind === 'pattern-not-found') return t('panels:bpPacking.patternNotFound', 'Pattern not found');
  if (diagnostic.kind === 'upstream-gap') return t('panels:bpPacking.upstreamGap', 'Upstream gap');
  if (diagnostic.kind === 'layout-graphics-error') {
    return t('panels:bpPacking.layoutGraphicsError', 'Layout could not be drawn');
  }
  return t('panels:bpPacking.unsupportedOperation', 'Unsupported BP operation');
}

function bpPackingAlertMessage(diagnostic: OristudioBpDiagnostic, t: TFunction): string {
  if (diagnostic.detail?.kind !== 'patternless-stretch') return diagnostic.message;
  // The overlap itself is legal in both cases; what differs is how far the
  // search got, and therefore whether cycling configurations is worth trying.
  return diagnostic.detail.hasConfiguration
    ? t(
        'panels:bpPacking.patternNotFoundWithConfig',
        'These flaps overlap in a way Ori Studio can lay out but not crease. Try another configuration, move one flap away from the others, or enlarge the sheet.'
      )
    : t(
        'panels:bpPacking.patternNotFoundNoConfig',
        'These flaps overlap in a way Ori Studio cannot crease yet. Move one of them away from the others, or enlarge the sheet.'
      );
}
