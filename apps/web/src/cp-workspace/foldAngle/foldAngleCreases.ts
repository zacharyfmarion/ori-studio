import { CpGeometry, cpDocumentTransport } from '../../engine/oristudioCpGeometry';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import { FOLD_MAGNITUDE_CLASSIC, isClassicCrease, isFoldingCrease } from '../../lib/foldAngle';

/** A document crease that carries a fold angle worth a badge. */
export interface FoldAngleCrease {
  /** 1-based line id. */
  lineId: number;
  segment: OristudioCpLineSegment;
}

const EMPTY: readonly FoldAngleCrease[] = [];
const cache = new WeakMap<object, readonly FoldAngleCrease[]>();

function wanted(segment: OristudioCpLineSegment): boolean {
  return isFoldingCrease(segment.color) && !isClassicCrease(segment);
}

/**
 * The document's folding creases that are not classic — the only ones the
 * fold-angle layer badges — in id order. Memoized per document's lines.
 *
 * Read from the compact transport when the document has one: a crease with no
 * magnitude there decodes with none, and so is classic, which leaves only the
 * creases that carry one to look at — none at all in an Oriedita-compatible
 * document, where the magnitude array is empty. The layer used to walk every
 * line object on every render to find them, which is also what made it decode
 * the whole document.
 */
export function foldAngleCreasesOf(
  document: OristudioCpDocumentSnapshot | null | undefined
): readonly FoldAngleCrease[] {
  if (!document) return EMPTY;
  const transport = cpDocumentTransport(document);
  const key: object = transport ?? document.crease_pattern.line_segments;
  const cached = cache.get(key);
  if (cached) return cached;

  const found: FoldAngleCrease[] = [];
  if (transport) {
    const magnitudes = transport.segFoldMagnitude;
    if (magnitudes && magnitudes.length > 0) {
      const geometry = new CpGeometry(transport);
      const count = Math.min(magnitudes.length, geometry.lineSegmentCount);
      for (let i = 0; i < count; i += 1) {
        if (magnitudes[i] === FOLD_MAGNITUDE_CLASSIC) continue;
        const segment = geometry.lineSegment(i);
        if (wanted(segment)) found.push({ lineId: i + 1, segment });
      }
    }
  } else {
    document.crease_pattern.line_segments.forEach((segment, index) => {
      if (wanted(segment)) found.push({ lineId: index + 1, segment });
    });
  }
  const result = found.length > 0 ? found : EMPTY;
  cache.set(key, result);
  return result;
}
