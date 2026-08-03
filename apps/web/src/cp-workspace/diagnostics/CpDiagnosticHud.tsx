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
import { memo, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TFunction } from 'i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
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

/**
 * One issue.
 *
 * Memoized, and it has to be by hand: React Compiler skips this file (see the
 * `useVirtualizer` call below), and the parent re-renders on every scroll frame.
 * Without it, each frame would re-run `cpDiagnosticEntryMessage` and
 * `cpDiagnosticMarkerStyle` and rebuild the glyph SVG for every mounted row,
 * rather than only for the rows that just entered the window.
 *
 * Every prop is stable per index: `start` is an absolute offset, and
 * `measureElement` is bound in the virtualizer's constructor and the instance
 * itself comes from `useState`. There is deliberately no `onClick` — a closure
 * per row per render would defeat the memo on its own. The list container reads
 * `data-diagnostic-id` instead.
 */
const CpDiagnosticHudRow = memo(function CpDiagnosticHudRow({
  t,
  entry,
  index,
  start,
  active,
  measureElement,
}: {
  t: TFunction;
  entry: OristudioCpDiagnosticEntry;
  index: number;
  start: number;
  active: boolean;
  measureElement: (node: Element | null) => void;
}) {
  return (
    <button
      type="button"
      className="cp-diagnostic-hud__row"
      data-active={active || undefined}
      data-severity={entry.severity}
      data-index={index}
      data-diagnostic-id={entry.id}
      ref={measureElement}
      style={{ transform: `translateY(${start}px)` }}
    >
      <CpDiagnosticGlyph t={t} entry={entry} />
      <span>{cpDiagnosticEntryMessage(t, entry)}</span>
    </button>
  );
});

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

  // One handler for the whole list rather than a closure per row, which would
  // give every mounted row a new prop each render and defeat its memo.
  const handleRowClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-diagnostic-id]');
      const id = row?.dataset.diagnosticId;
      if (id) selectDiagnostic(id);
    },
    [selectDiagnostic]
  );

  // React Compiler cannot memoize a component that uses `useVirtualizer`, so
  // this one is not compiler-memoized and re-renders on every scroll frame.
  // That is exactly why the row above is hand-memoized and why the click
  // handler is delegated rather than passed down.
  //
  // The rule's real warning is about passing this API's functions into memoized
  // children. `CpDiagnosticHudRow` takes one — `measureElement` — and it is
  // safe: the instance comes from `useState` and `measureElement` is bound in
  // its constructor, so both are stable for the life of the component.
  // eslint-disable-next-line react-hooks/incompatible-library
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

  // Reveal whatever became active. Clicking a marker on the canvas activates a
  // diagnostic and frames it there (`cpDiagnosticFocus.ts`); windowed, its row
  // may not be in the DOM at all, so the list has to be told to go find it.
  //
  // Keyed on the id, not on the entry or its index. `cpDiagnosticFocus.ts`
  // records the same mistake on the camera side: framing was keyed on a derived
  // object, so merely re-deriving the entry list replayed the jump and threw the
  // user back to an issue they had moved away from. The id changing is the
  // event; the list re-deriving is not.
  const revealedId = useRef<string | null>(null);
  useEffect(() => {
    if (!expanded) {
      // Nothing to scroll while collapsed, and the id must not count as revealed
      // — expanding later should still land on it.
      revealedId.current = null;
      return;
    }
    if (!activeId || activeId === revealedId.current) return;
    const index = entries.findIndex((entry) => entry.id === activeId);
    if (index < 0) return;
    revealedId.current = activeId;
    virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [activeId, entries, expanded, virtualizer]);

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
          onClick={handleRowClick}
          // `group` so the label below is actually exposed: `aria-label` on a
          // bare div is not reliably announced. It matters more now than it did
          // behind the 12-row cap — windowed, assistive tech can only see the
          // ~27 mounted rows, so the count in the label is the only place the
          // real total is stated.
          role="group"
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
                <CpDiagnosticHudRow
                  key={item.key}
                  t={t}
                  entry={entry}
                  index={item.index}
                  start={item.start}
                  active={entry.id === activeId}
                  measureElement={virtualizer.measureElement}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
