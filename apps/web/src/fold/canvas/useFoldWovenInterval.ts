import { useCallback, useState } from 'react';
import type { FoldCrossSection } from '../engine/foldEngineWire';
import type { FoldHit } from './foldPicking';

export interface FoldWovenInterval {
  /** The interval of the woven section on show whose stack the picker shows; null for the first, or no woven section. */
  interval: number | null;
  /** The folded pane's hover: an interval it is over becomes the one shown. */
  onHover: (hit: FoldHit | null) => void;
}

/**
 * Which stack of a woven section the layer picker shows (plan D14
 * cross-section, 3): the interval under the pointer on the folded pane, which
 * the pane's hit test names (`FoldHit.interval`), kept when the pointer
 * leaves the line or the pane so the picker does not jump back as the reader
 * moves to it. A new section starts again from its first interval.
 */
export function useFoldWovenInterval(section: FoldCrossSection | null): FoldWovenInterval {
  const [shown, setShown] = useState<{ section: FoldCrossSection; interval: number } | null>(null);
  const onHover = useCallback(
    (hit: FoldHit | null) => {
      const interval = hit?.interval;
      if (interval === undefined || !section) return;
      setShown((current) => (current?.section === section && current.interval === interval ? current : { section, interval }));
    },
    [section]
  );
  return { interval: shown && shown.section === section ? shown.interval : null, onHover };
}
