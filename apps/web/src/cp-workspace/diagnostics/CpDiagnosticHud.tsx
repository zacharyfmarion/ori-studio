/**
 * The diagnostic HUD: a collapsed headline over the canvas, expanding to the
 * list of issues behind it.
 *
 * Takes no props. Its store bindings are in {@link useCpDiagnosticList} and its
 * headline rule is in `hudStatus.ts`; what is here is the surface itself — the
 * expand toggle and the row list.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cpDiagnosticEntryMessage } from './foldabilityMessages';
import { CpDiagnosticGlyph } from './CpDiagnosticGlyph';
import { useCpDiagnosticList } from './useCpDiagnosticList';

export function CpDiagnosticHud() {
  const { t } = useTranslation();
  const { entries, status, activeId, selectDiagnostic } = useCpDiagnosticList();
  const [expanded, setExpanded] = useState(false);

  // Nothing to report means nothing to expand — otherwise the HUD would come
  // back already open the next time an issue appears.
  useEffect(() => {
    if (!status) setExpanded(false);
  }, [status]);

  if (!status) return null;

  return (
    <div
      className="cp-diagnostic-hud"
      data-tone={status.tone}
      data-expanded={expanded || undefined}
      aria-live="polite"
    >
      <button
        type="button"
        className="cp-diagnostic-hud__summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="cp-diagnostic-hud__copy">
          <span>{status.label}</span>
          {status.detail && status.detail !== status.label && <small>{status.detail}</small>}
        </span>
        {expanded ? (
          <ChevronDown aria-hidden="true" size={16} />
        ) : (
          <ChevronRight aria-hidden="true" size={16} />
        )}
      </button>
      {expanded && entries.length > 0 && (
        <div
          className="cp-diagnostic-hud__list"
          aria-label={t('panels:creasePattern.canvasDiagnostics', 'Canvas diagnostics')}
        >
          {entries.slice(0, 12).map((entry) => (
            <button
              type="button"
              className="cp-diagnostic-hud__row"
              data-active={entry.id === activeId || undefined}
              data-severity={entry.severity}
              key={entry.id}
              onClick={() => selectDiagnostic(entry.id)}
            >
              <CpDiagnosticGlyph t={t} entry={entry} />
              <span>{cpDiagnosticEntryMessage(t, entry)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
