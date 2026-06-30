import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ImagePlus, Search } from 'lucide-react';
import type { ExampleRow } from './types';

const CELL_MIN_PX = 168;
const CELL_GAP_PX = 14;
// Caption + padding reserved below each square thumbnail.
const ROW_LABEL_PX = 48;

interface GalleryViewProps {
  examples: ExampleRow[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  onUpload: () => void;
}

/**
 * Default landing view: a windowed grid of rendered crease-pattern thumbnails
 * over every cached sample (the native-cp dataset by default). Only the rows in
 * view are mounted (row virtualization via @tanstack/react-virtual), so the grid
 * stays smooth across the full 563-sample set.
 */
export function GalleryView({ examples, selectedId, onOpen, onUpload }: GalleryViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return examples;
    return examples.filter((example) => {
      const haystack = `${example.source_id ?? example.id} ${example.family ?? ''} ${example.profile ?? ''}`;
      return haystack.toLowerCase().includes(needle);
    });
  }, [examples, query]);

  const columnCount = Math.max(
    1,
    Math.floor((width + CELL_GAP_PX) / (CELL_MIN_PX + CELL_GAP_PX)),
  );
  const cellSize =
    width > 0 ? (width - CELL_GAP_PX * (columnCount - 1)) / columnCount : CELL_MIN_PX;
  const rowHeight = cellSize + ROW_LABEL_PX + CELL_GAP_PX;
  const rowCount = Math.ceil(filtered.length / columnCount);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
  });

  return (
    <section className="gallery">
      <div className="gallery-toolbar">
        <div className="gallery-heading">
          <strong>{filtered.length}</strong>
          <span>crease pattern{filtered.length === 1 ? '' : 's'}</span>
        </div>
        <label className="gallery-search">
          <Search size={15} />
          <input
            placeholder="Filter by name, family, profile…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <button className="gallery-upload" onClick={onUpload}>
          <ImagePlus size={15} />
          Upload image
        </button>
      </div>
      <div className="gallery-scroll" ref={scrollRef}>
        {width > 0 && filtered.length > 0 ? (
          <div className="gallery-rows" style={{ height: rowVirtualizer.getTotalSize() }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const start = virtualRow.index * columnCount;
              const rowItems = filtered.slice(start, start + columnCount);
              return (
                <div
                  className="gallery-row"
                  key={virtualRow.key}
                  style={{ transform: `translateY(${virtualRow.start}px)`, gap: CELL_GAP_PX }}
                >
                  {rowItems.map((example) => (
                    <button
                      className={example.id === selectedId ? 'gallery-cell selected' : 'gallery-cell'}
                      key={example.id}
                      onClick={() => onOpen(example.id)}
                      style={{ width: cellSize }}
                      title={example.source_id ?? example.id}
                    >
                      <div className="gallery-thumb" style={{ height: cellSize }}>
                        <img alt="" loading="lazy" src={example.input_image_url} />
                      </div>
                      <span className="gallery-caption">{example.source_id ?? example.id}</span>
                      <span className="gallery-meta">
                        {example.family ?? 'unknown'} · {example.edge_count ?? 0} edges
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ) : filtered.length === 0 ? (
          <div className="gallery-empty">
            <strong>No samples match</strong>
            <span>Clear the filter, or start the backend with a dense-cache manifest.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
