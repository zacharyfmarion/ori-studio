/**
 * The diagnostic HUD: a collapsed headline over the canvas, expanding to the
 * list of issues behind it.
 *
 * Takes no props. Its store bindings are in {@link useCpDiagnosticList} and its
 * headline rule is in `hudStatus.ts`; what is here is the surface itself — the
 * expand toggle and the windowed list.
 *
 * # Why the list is windowed
 *
 * It used to render `entries.slice(0, 12)`, so a pattern with 2,000 foldability
 * errors showed twelve and said nothing about the rest. Removing the cap without
 * windowing would put every row in the DOM, inside a 320px box, above a WebGL
 * canvas — thousands of grid containers and SVG glyphs, each running
 * `cpDiagnosticEntryMessage` and `cpDiagnosticMarkerStyle`.
 *
 * So the rows near the viewport are the only ones mounted. Heights are measured
 * rather than fixed: messages wrap, and the eight shipped locales run longer
 * than English, so a fixed height would mean truncating exactly the languages
 * that need the words most.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cpDiagnosticEntryMessage } from './foldabilityMessages';
import { CpDiagnosticGlyph } from './CpDiagnosticGlyph';
import { useCpDiagnosticList } from './useCpDiagnosticList';

/**
 * A one-line row, from the stylesheet: 7px padding twice, 0.72rem at line-height
 * 1.25, and the 1px rule. Only a starting guess — every mounted row is measured —
 * but it sets the scrollbar before anything has been measured, so a bad value
 * shows up as the thumb jumping while you scroll into new rows.
 */
const ROW_ESTIMATE_PX = 7 + 7 + Math.round(0.72 * 16 * 1.25) + 1;

export function CpDiagnosticHud() {
  const { t } = useTranslation();
  const { entries, status, activeId, selectDiagnostic } = useCpDiagnosticList();
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Nothing to report means nothing to expand — otherwise the HUD would come
  // back already open the next time an issue appears.
  useEffect(() => {
    if (!status) setExpanded(false);
  }, [status]);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    // By entry id, not index: keys survive the list shifting under a CAMV
    // recompute, so a mounted row is not remounted just because rows above it
    // changed.
    getItemKey: (index) => entries[index]?.id ?? index,
    overscan: 8,
  });

  if (!status) return null;

  const items = virtualizer.getVirtualItems();

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
          ref={listRef}
          // The total, not the headline's issue count: the headline names errors
          // and warnings, and an informational row is neither.
          aria-label={t('panels:creasePattern.canvasDiagnostics', 'Canvas diagnostics: {{count}}', {
            count: entries.length,
          })}
        >
          <div
            className="cp-diagnostic-hud__spacer"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {items.map((item) => {
              const entry = entries[item.index];
              if (!entry) return null;
              return (
                <button
                  type="button"
                  className="cp-diagnostic-hud__row"
                  data-active={entry.id === activeId || undefined}
                  data-severity={entry.severity}
                  data-index={item.index}
                  key={item.key}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${item.start}px)` }}
                  onClick={() => selectDiagnostic(entry.id)}
                >
                  <CpDiagnosticGlyph t={t} entry={entry} />
                  <span>{cpDiagnosticEntryMessage(t, entry)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
